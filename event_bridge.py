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

# Autopilot API (hackathon.client): six control inputs [x, y, z, roll, pitch, yaw], each a signed pulse count.
# For each axis: the thruster that increases that velocity or rotation rate, and the one that decreases it.
INPUT_THRUSTERS = (("translate_backward", "translate_forward"), ("translate_right", "translate_left"), ("translate_up", "translate_down"),
                   ("roll_left", "roll_right"), ("pitch_up", "pitch_down"), ("yaw_left", "yaw_right"))
MAX_PULSES = 50  # per axis per control request
REQUEST_HELP = 'send {"request": "telemetry"} or {"request": "control", "inputs": [x, y, z, roll, pitch, yaw]}'
OFFLINE = "The simulator tab is not connected. Keep it open and visible."


def to_pulses(inputs):
    """Six numbers -> six whole pulse counts, each rounded half away from zero and limited to +/-50."""
    if not isinstance(inputs, list) or len(inputs) != 6:
        raise ValueError('"inputs" must be a list of 6 numbers: [x, y, z, roll, pitch, yaw]')
    out = []
    for v in inputs:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError('"inputs" must be 6 finite numbers: [x, y, z, roll, pitch, yaw]')
        n = int(math.copysign(math.floor(abs(v) + 0.5), v))
        out.append(max(-MAX_PULSES, min(MAX_PULSES, n)))
    return out


def state_vector(s):
    """Flight state -> [x, y, z, x_dot, y_dot, z_dot, roll, pitch, yaw, roll_dot, pitch_dot, yaw_dot]."""
    try:
        p, v, a, r = s["position"], s["velocity"], s["attitude"], s["rotation_rate"]
        return [p["x"], p["y"], p["z"], v["x"], v["y"], v["z"], a["roll"], a["pitch"], a["yaw"], r["roll"], r["pitch"], r["yaw"]]
    except (KeyError, TypeError):
        return None


def commanded_rates(s):
    try:
        c = s["rotation_rate_commanded"]
        return [c["roll"], c["pitch"], c["yaw"]]
    except (KeyError, TypeError):
        return None


def time_ms(s):
    return int(round(float((s or {}).get("time_s") or 0) * 1000))


class EventBridge:
    def __init__(self, event_url, track="autopilot", open_browser=True, site_dir=None, port=0):
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
        self.flight = None  # most recent flight launched in the browser
        self.flight_active = False
        self.ranked = False
        self.clients = {}  # autopilot client id -> what it was last served
        self.client_lock = threading.Lock()
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

            def autopilot(self, path):
                """POST /ap/<token>/request: the hackathon.client request-reply API. The URL carries the token."""
                parts = path.strip("/").split("/")
                if not self.permitted():
                    return
                if len(parts) != 3 or parts[2] != "request" or not hmac.compare_digest(parts[1], owner.token):
                    return self.reply(404, {"error": "Unknown autopilot URL. Copy the current URL printed by python -m hackathon.server."})
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 0 < size <= 32768:
                        return self.reply(413, {"error": "Request size invalid."})
                    body = json.loads(self.rfile.read(size))
                    return self.reply(200, owner.autopilot_request(body))
                except (ValueError, TypeError) as e:
                    return self.reply(400, {"error": str(e) if isinstance(e, ValueError) and str(e).startswith('"') else REQUEST_HELP})

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
                path = urlsplit(self.path).path
                if path.startswith("/ap/"):
                    return self.autopilot(path)
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
                        flight = meta.get("flight")
                        owner.flight_active = isinstance(flight, str) and bool(flight)
                        if owner.flight_active:
                            owner.flight = flight[:40]
                            owner.ranked = bool(meta.get("ranked"))
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
                            if command["command"] in ("pause", "step"):
                                return self.reply(400, {"error": "Flights run in real time. Pause and step are not available."})
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

        self.server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.server.daemon_threads = True
        self.url = "http://127.0.0.1:%d" % self.server.server_port
        query = urlencode({"mode": track, "local": "1", "event": event_url.rstrip("/")})
        self.page_url = self.url + "/sim/?" + query + "#bridge=" + self.token
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.closed = False
        if open_browser:
            webbrowser.open(self.page_url)

    @property
    def autopilot_url(self):
        return self.url + "/ap/" + self.token

    def _status(self, client):
        """Flight status as one autopilot client should see it."""
        if not self.bridge.connected():
            return "offline"
        sim = (self.bridge.state or {}).get("status")
        if self.flight_active and sim == "flying" and self.ready.is_set():
            return "flying"
        # A finished flight is reported only to the client that flew it; a newly started program waits.
        if self.flight and client["flight"] == self.flight and not self.flight_active and sim in ("success", "fail"):
            return "docked" if sim == "success" else "failed"
        return "waiting"

    def autopilot_request(self, body):
        if not isinstance(body, dict):
            raise TypeError("request must be a JSON object")
        key = str(body.get("client", ""))[:64]
        with self.client_lock:
            if key not in self.clients:
                if len(self.clients) > 100:  # forget the oldest program runs
                    del self.clients[min(self.clients, key=lambda k: self.clients[k]["last"])]
                self.clients[key] = {"flight": None, "served": None, "hold_ms": -1}
            client = self.clients[key]
            client["last"] = time.time()
        kind = body.get("request")
        if kind == "telemetry":
            return self._telemetry(client)
        if kind == "control":
            return self._control(client, to_pulses(body.get("inputs")))
        raise ValueError(REQUEST_HELP)

    def _telemetry(self, client):
        status = self._status(client)
        latest = dict(self.bridge.state or {})
        reply = {"ok": True, "status": status, "docked": status == "docked", "flight_id": self.flight if status != "waiting" else None,
                 "ranked": self.ranked, "simulation_speed": latest.get("simulation_speed", 1), "timestamp_ms": None, "state": None,
                 "commanded_rates": None, "message": OFFLINE if status == "offline" else latest.get("message") or ""}
        if status == "flying":
            if client["flight"] != self.flight:
                client.update(flight=self.flight, served=None, hold_ms=-1)
            # Newest telemetry, but never from before this client's last inputs took effect:
            # telemetry that does not show them yet would make the autopilot fire the same burn twice.
            if state_vector(latest) and time_ms(latest) > client["hold_ms"]:
                client["served"] = latest
            latest = client["served"]
        elif status not in ("docked", "failed"):
            return reply
        if latest and state_vector(latest):
            reply.update(timestamp_ms=time_ms(latest), state=state_vector(latest), commanded_rates=commanded_rates(latest))
        return reply

    def _control(self, client, pulses):
        status = self._status(client)
        if status != "flying":
            return {"ok": False, "error": OFFLINE if status == "offline" else "No flight in progress (status: %s). Launch the flight in the browser." % status}
        commands = [{"command": INPUT_THRUSTERS[i][0 if n > 0 else 1], "count": abs(n)} for i, n in enumerate(pulses) if n]
        if not commands:
            return {"ok": True, "timestamp_ms": time_ms(self.bridge.state), "pulses": pulses}
        try:
            results = self.bridge.run(commands)
        except TimeoutError:
            return {"ok": False, "error": OFFLINE}
        applied_ms = time_ms((results[-1].get("state") if results else None) or self.bridge.state)
        client["hold_ms"] = max(client["hold_ms"], applied_ms)
        errors = [r.get("error") for r in results if not r.get("ok")]
        if errors:
            return {"ok": False, "error": "; ".join(str(e) for e in errors), "timestamp_ms": applied_ms, "pulses": pulses}
        return {"ok": True, "timestamp_ms": applied_ms, "pulses": pulses}

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
