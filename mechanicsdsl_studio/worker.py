"""Runs the engine in a separate process, so the window stays responsive and a long
computation can be stopped."""
import multiprocessing as mp
import threading
import traceback

CANCELLED = {"ok": False, "cancelled": True, "error": "Stopped."}


def _serve(conn):
    from .engine import Engine
    engine = Engine()
    try:
        engine.warm_up()
    except Exception:
        pass
    while True:
        try:
            msg = conn.recv()
        except EOFError:
            return
        if msg is None:
            return
        method, args = msg
        try:
            result = getattr(engine, method)(*args)
        except Exception as e:
            result = {"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()}
        conn.send(result)


class EngineProcess:
    def __init__(self):
        self._ctx = mp.get_context("spawn")
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._start()

    def _start(self):
        self._conn, child = self._ctx.Pipe()
        self._proc = self._ctx.Process(target=_serve, args=(child,), daemon=True, name="mdsl-engine")
        self._proc.start()

    def call(self, method, *args):
        with self._lock:
            self._cancel.clear()
            if not self._proc.is_alive():
                self._start()
            self._conn.send((method, args))
            while True:
                if self._conn.poll(0.05):
                    try:
                        return self._conn.recv()
                    except EOFError:
                        break
                if self._cancel.is_set():
                    self._restart()
                    return dict(CANCELLED)
                if not self._proc.is_alive():
                    break
            self._start()
            return {"ok": False, "error": "The computation stopped unexpectedly. The engine has been restarted."}

    def cancel(self):
        self._cancel.set()

    def _restart(self):
        try:
            self._proc.terminate()
            self._proc.join(2)
        except Exception:
            pass
        self._start()

    def close(self):
        try:
            self._conn.send(None)
            self._proc.join(1)
        except Exception:
            pass
        if self._proc.is_alive():
            self._proc.terminate()
