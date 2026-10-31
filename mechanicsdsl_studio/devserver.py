"""Serve the interface in an ordinary browser for development and testing.

    python -m mechanicsdsl_studio.devserver [port]

The page talks to the same Api over HTTP instead of the pywebview bridge. File dialogs
are not available here.
"""
import json
import multiprocessing
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from .app import Api, resource
from .worker import EngineProcess

ALLOWED = {"info", "examples", "blank", "run", "export", "cancel", "set_title", "set_dirty",
           "read_worksheet", "warm", "startup_file"}


def main():
    multiprocessing.freeze_support()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    api = Api(EngineProcess(), lambda: None)
    web = resource("web")

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=web, **k)

        def log_message(self, *a):
            pass

        def do_GET(self):
            if self.path.split("?")[0] in ("/", "/index.html"):
                with open(os.path.join(web, "index.html"), encoding="utf-8") as fh:
                    page = fh.read().replace('<script src="stage.js">',
                                             '<script>window.MDSL_DEV = true;</script>\n<script src="stage.js">')
                body = page.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

        def do_POST(self):
            name = self.path.rsplit("/", 1)[-1]
            if not self.path.startswith("/api/") or name not in ALLOWED:
                self.send_error(404)
                return
            n = int(self.headers.get("Content-Length") or 0)
            args = json.loads(self.rfile.read(n) or b"[]")
            body = json.dumps(getattr(api, name)(*args)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    print(f"MechanicsDSL Studio dev server on http://127.0.0.1:{port}/index.html")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
