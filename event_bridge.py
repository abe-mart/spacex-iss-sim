"""Automatic loopback server for the packaged Dock the Capsule flight deck.

Only Python's standard library is needed. The simulator and command API share
one origin; flight commands never travel through the hosted event database.
"""
import hmac
import json
import math
import os
from pathlib import Path
import secrets
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlencode, urlsplit
import webbrowser

from server import Bridge, COMMANDS


class EventBridge:
    def __init__(self, event_url, track="autopilot", open_browser=True, site_dir=None):
        event = urlsplit(event_url)
        if event.scheme != "https" and not (event.scheme == "http" and event.hostname in ("localhost", "127.0.0.1")):
            raise ValueError("The event URL must use HTTPS (or localhost for development).")
        if event.username or event.password:
            raise ValueError("Event URL cannot include credentials.")
        if track not in ("autopilot", "agent"):
            raise ValueError("Local tracks are autopilot and agent.")
        here = Path(__file__).resolve().parent
        self.site_dir = Path(site_dir) if site_dir else (here / "site" if (here / "site").is_dir() else here / "dist")
        if not (self.site_dir / "sim" / "index.html").is_file():
            raise RuntimeError("Simulator assets are missing. Download/unzip the starter bundle, or run npm run build in the repository.")
        self.token = secrets.token_hex(32)
        self.bridge = Bridge()
        self.ready = threading.Event()
        self.started = False
        self.last_result = None
        self.receipt_dir = here / ".dock-receipts"
        owner = self

        class Handler(SimpleHTTPRequestHandler):
            # Windows MIME registrations can label .js as text/plain. Browser
            # scripts must have a JavaScript MIME type even on managed machines.
            extensions_map = {
                **SimpleHTTPRequestHandler.extensions_map,
                ".js": "text/javascript",
                ".mjs": "text/javascript",
                ".css": "text/css",
                ".html": "text/html",
                ".json": "application/json",
                ".svg": "image/svg+xml",
                ".wasm": "application/wasm",
                ".glb": "model/gltf-binary",
            }

            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(owner.site_dir), **kwargs)

            def log_message(self, *args):
                pass

            def end_headers(self):
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Cache-Control", "no-store")
                super().end_headers()

            def reply(self, status, body):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def permitted(self, credential=False):
                if self.headers.get("Host") != urlsplit(owner.url).netloc:
                    self.reply(403, {"error": "Invalid local host."})
                    return False
                origin = self.headers.get("Origin")
                if origin and origin != owner.url:
                    self.reply(403, {"error": "Open the local flight page supplied by the helper."})
                    return False
                if credential:
                    supplied = self.headers.get("X-Dock-Bridge", "")
                    if not supplied:
                        supplied = self.headers.get("Authorization", "").removeprefix("Bearer ")
                    if not hmac.compare_digest(supplied, owner.token):
                        self.reply(401, {"error": "Local controller token required."})
                        return False
                return True

            def do_GET(self):
                if not self.permitted():
                    return
                path = urlsplit(self.path).path.rstrip("/")
                if path in ("/api", "/api/state"):
                    if not self.permitted(credential=True):
                        return
                    if path == "/api":
                        return self.reply(200, {"commands": COMMANDS, "ready": owner.ready.is_set()})
                    if not owner.bridge.connected():
                        return self.reply(503, {"error": "Keep the simulator tab open and visible."})
                    return self.reply(200, dict(owner.bridge.state or {}, connected=True, ready=owner.ready.is_set()))
                if self.path == "/":
                    self.send_response(302)
                    self.send_header("Location", owner.page_url)
                    self.end_headers()
                    return
                super().do_GET()

            def do_POST(self):
                if not self.permitted(credential=True):
                    return
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 0 < size <= 32768:
                        return self.reply(413, {"error": "Request size invalid."})
                    body = json.loads(self.rfile.read(size))
                    path = urlsplit(self.path).path
                    if path == "/bridge/sync":
                        if not isinstance(body, dict) or not isinstance(body.get("state"), dict) or not isinstance(body.get("results", []), list):
                            return self.reply(400, {"error": "Invalid browser synchronization."})
                        meta = body.get("meta") or {}
                        if not isinstance(meta, dict):
                            return self.reply(400, {"error": "Invalid browser metadata."})
                        owner.started = owner.started or bool(meta.get("started"))
                        if meta.get("ready"):
                            owner.ready.set()
                        else:
                            owner.ready.clear()
                        receipt = meta.get("result")
                        if isinstance(receipt, dict) and receipt.get("id") != owner.last_result:
                            # Receipt contains a participant token, never a provider key.
                            safe = {k: receipt.get(k) for k in ("id", "body", "event_url", "token")}
                            token = safe.get("token") or ""
                            identity = str(safe.get("id") or "")
                            if len(token) == 64 and all(c in "0123456789abcdef" for c in token) and len(identity) == 36 and all(c in "0123456789abcdef-" for c in identity):
                                owner.receipt_dir.mkdir(exist_ok=True)
                                (owner.receipt_dir / (identity + ".json")).write_text(json.dumps(safe), encoding="utf-8")
                                owner.last_result = identity
                        commands = owner.bridge.sync(body["state"], body.get("results", []))
                        return self.reply(200, {"commands": commands})
                    if path == "/api/command":
                        single = isinstance(body, dict)
                        commands = [body] if single else body
                        if not isinstance(commands, list) or not 1 <= len(commands) <= 50:
                            return self.reply(400, {"error": "Send a command or a batch of 1–50 commands."})
                        for command in commands:
                            if not isinstance(command, dict) or command.get("command") not in COMMANDS:
                                return self.reply(400, {"error": "Unknown command."})
                            if command["command"] == "gravity_off":
                                return self.reply(400, {"error": "Gravity remains enabled for event flights."})
                            if track == "autopilot" and command["command"] in ("pause", "step"):
                                return self.reply(400, {"error": "Autopilot flies in real time. Pause/step is reserved for AI Agent."})
                            count = command.get("count", 1)
                            if type(count) is not int or not 1 <= count <= 50:
                                return self.reply(400, {"error": "count must be an integer from 1 to 50."})
                            if command["command"] == "step":
                                seconds = command.get("seconds", 1)
                                if type(seconds) not in (int, float) or not math.isfinite(seconds) or not 0 < seconds <= 60:
                                    return self.reply(400, {"error": "step seconds must be positive and at most 60."})
                        if not owner.started:
                            return self.reply(409, {"error": "Join and launch the flight in the browser first."})
                        if not owner.bridge.connected():
                            return self.reply(503, {"error": "Simulator browser disconnected."})
                        results = owner.bridge.run(commands)
                        return self.reply(200, results[0] if single else results)
                    self.reply(404, {"error": "Endpoint not found."})
                except (ValueError, TypeError, KeyError):
                    self.reply(400, {"error": "Malformed command or synchronization."})
                except TimeoutError:
                    self.reply(504, {"error": "Simulator stopped responding. Keep the tab visible."})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.url = "http://127.0.0.1:%d" % self.server.server_port
        query = urlencode({"mode": track, "local": "1", "event": event_url.rstrip("/")})
        self.page_url = self.url + "/sim/?" + query + "#bridge=" + self.token
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.closed = False
        if open_browser:
            webbrowser.open(self.page_url)

    def wait_ready(self, timeout=300):
        if not self.ready.wait(timeout):
            raise TimeoutError("Launch the flight in the browser within five minutes, then run the controller again.")

    def close(self):
        if not self.closed:
            self.closed = True
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(timeout=2)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
