"""MechanicsDSL Studio: the desktop window."""
import base64
import json
import multiprocessing
import os
import sys
import webbrowser

from . import __version__
from .examples import BLANK, EXAMPLES

APP_NAME = "MechanicsDSL Studio"
FILE_EXT = ".mdsw"
FILE_TYPES = ("MechanicsDSL worksheet (*.mdsw)", "All files (*.*)")


def resource(*parts):
    base = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
    if getattr(sys, "_MEIPASS", None):
        base = os.path.join(base, "mechanicsdsl_studio")
    return os.path.join(base, *parts)


def core_version():
    try:
        from importlib.metadata import version
        return version("mechanicsdsl-core")
    except Exception:
        return "unknown"


class Api:
    """Methods the interface calls (window.pywebview.api.*). Every one returns JSON data."""

    def __init__(self, engine, window_ref=None, startup_file=None):
        self._engine = engine
        self._window = window_ref
        self._dirty = False
        self._startup = startup_file

    def startup_file(self):
        """A worksheet passed on the command line (for example by double-clicking it)."""
        path, self._startup = self._startup, None
        return path

    # -- information
    def info(self):
        from .engine import TARGETS
        return {"app_version": __version__, "core_version": core_version(), "app_name": APP_NAME,
                "targets": [{"id": k, "label": v[0]} for k, v in TARGETS.items()]}

    def examples(self):
        return EXAMPLES

    def blank(self):
        return BLANK

    # -- computation (in the engine process)
    def warm(self):
        return self._engine.call("warm_up")

    def run(self, source, settings=None):
        return self._engine.call("run", source, settings or {})

    def export(self, source, target):
        return self._engine.call("export", source, target)

    def cancel(self):
        self._engine.cancel()
        return True

    # -- files
    def _dialog(self, kind, **kw):
        import webview
        fd = getattr(webview, "FileDialog", None)
        kinds = {"open": fd.OPEN if fd else webview.OPEN_DIALOG,
                 "save": fd.SAVE if fd else webview.SAVE_DIALOG,
                 "folder": fd.FOLDER if fd else webview.FOLDER_DIALOG}
        w = self._window()
        return w.create_file_dialog(kinds[kind], **kw) if w else None

    def open_worksheet(self):
        paths = self._dialog("open", file_types=FILE_TYPES)
        if not paths:
            return None
        path = paths[0] if isinstance(paths, (list, tuple)) else paths
        return self.read_worksheet(path)

    @staticmethod
    def read_worksheet(path):
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            if data.get("format") != "mechanicsdsl-worksheet":
                return {"error": "This file is not a MechanicsDSL worksheet."}
            return {"path": path, "data": data}
        except Exception as e:
            return {"error": f"Could not open the worksheet: {e}"}

    def save_worksheet(self, data, path=None, save_as=False):
        if not path or save_as:
            name = (data.get("title") or "Untitled worksheet").strip() or "Untitled worksheet"
            result = self._dialog("save", save_filename=_safe(name) + FILE_EXT,
                                  file_types=FILE_TYPES)
            if not result:
                return None
            path = result[0] if isinstance(result, (list, tuple)) else result
            if not path.lower().endswith(FILE_EXT):
                path += FILE_EXT
        try:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=1, ensure_ascii=False)
            os.replace(tmp, path)
            self._dirty = False
            return {"path": path}
        except Exception as e:
            return {"error": f"Could not save the worksheet: {e}"}

    def save_code(self, files, system):
        from .engine import Engine
        result = self._dialog("folder")
        if not result:
            return None
        folder = result[0] if isinstance(result, (list, tuple)) else result
        try:
            written = Engine.write_files(folder, files)
            return {"folder": folder, "count": len(written)}
        except Exception as e:
            return {"error": f"Could not write the files: {e}"}

    def save_image(self, name, data_url):
        result = self._dialog("save", save_filename=_safe(name) + ".png",
                              file_types=("PNG image (*.png)",))
        if not result:
            return None
        path = result[0] if isinstance(result, (list, tuple)) else result
        try:
            with open(path, "wb") as fh:
                fh.write(base64.b64decode(data_url.split(",", 1)[1]))
            return {"path": path}
        except Exception as e:
            return {"error": f"Could not save the image: {e}"}

    def open_link(self, url):
        if url.startswith(("https://", "http://")):
            webbrowser.open(url)
        return True

    def set_title(self, title):
        w = self._window()
        if w:
            w.title = f"{title} - {APP_NAME}" if title else APP_NAME
        return True

    def set_dirty(self, dirty):
        self._dirty = bool(dirty)
        return True


def _safe(name):
    keep = "".join(c if c.isalnum() or c in " -_." else "_" for c in name).strip()
    return keep[:80] or "worksheet"


def selftest(report_path):
    """Run every example and every code generator in the engine process; used after a build."""
    from .engine import TARGETS
    from .worker import EngineProcess
    lines, failures = [], 0
    engine = EngineProcess()
    try:
        for ex in EXAMPLES:
            r = engine.call("run", ex["source"], ex["settings"])
            ok = r.get("ok") and r.get("animation")
            failures += not ok
            lines.append(f"{'PASS' if ok else 'FAIL'} run {ex['id']} {r.get('error', '')}")
        for target in TARGETS:
            r = engine.call("export", EXAMPLES[0]["source"], target)
            failures += not r.get("ok")
            lines.append(f"{'PASS' if r.get('ok') else 'FAIL'} export {target} {r.get('error', '')}")
        web = os.path.exists(resource("web", "index.html")) and os.path.exists(resource("web", "vendor", "plotly.min.js"))
        failures += not web
        lines.append(f"{'PASS' if web else 'FAIL'} interface files")
    finally:
        engine.close()
    lines.append(f"{APP_NAME} {__version__}, MechanicsDSL {core_version()}: "
                 + ("all checks passed" if not failures else f"{failures} checks failed"))
    with open(report_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    return 1 if failures else 0


def main():
    multiprocessing.freeze_support()
    if "--selftest" in sys.argv:
        i = sys.argv.index("--selftest")
        out = sys.argv[i + 1] if len(sys.argv) > i + 1 else "selftest.txt"
        sys.exit(selftest(out))
    import webview
    from .worker import EngineProcess

    engine = EngineProcess()            # starts loading MechanicsDSL straight away
    holder = {}
    startup = None
    if len(sys.argv) > 1 and sys.argv[1].lower().endswith(FILE_EXT) and os.path.isfile(sys.argv[1]):
        startup = os.path.abspath(sys.argv[1])
    api = Api(engine, lambda: holder.get("w"), startup)
    start = resource("web", "index.html")
    window = webview.create_window(APP_NAME, url=start, js_api=api, width=1380, height=900,
                                   min_size=(960, 640), background_color="#F3F5F8",
                                   text_select=True)
    holder["w"] = window

    def on_closing():
        if api._dirty:
            ok = window.create_confirmation_dialog(
                "Unsaved changes", "This worksheet has unsaved changes. Close without saving?")
            if not ok:
                return False
        return True

    window.events.closing += on_closing
    try:
        webview.start(debug=bool(os.environ.get("MDSL_STUDIO_DEBUG")), private_mode=False,
                      storage_path=_storage_dir())
    finally:
        engine.close()


def _storage_dir():
    root = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/.local/share")
    path = os.path.join(root, "MechanicsDSL Studio")
    os.makedirs(path, exist_ok=True)
    return path


if __name__ == "__main__":
    main()
