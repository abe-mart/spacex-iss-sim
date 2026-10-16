"""hackathon.client: connect your autopilot to the simulator. Standard library only (Python 3.8+).

    import hackathon.client as hackathon_client

    connection = hackathon_client.connect()                          # or connect("http://127.0.0.1:<port>/ap/<key>")
    data = hackathon_client.request_telemetry(connection)            # or connection.request_telemetry()
    hackathon_client.send_control_inputs(connection, [0, 0, -2, 0, 1, 0])

Start the local simulator server first with: python -m hackathon.server
connect() with no argument uses the autopilot URL that the server saved to .hackathon_url.

TELEMETRY (a dict):
    data["status"]           "flying" while you have control; otherwise "waiting" (no flight launched yet),
                             "docked", "failed", or "offline" (the simulator tab is not connected)
    data["docked"]           True once you have docked
    data["flight_id"]        changes with every flight
    data["ranked"]           True for leaderboard flights; False for faster-than-real-time test flights
    data["timestamp_ms"]     simulator time in this flight, in ms. Unchanged means nothing new yet
    data["state"]            12 numbers, or None when there is no flight:
                               [x, y, z, x_dot, y_dot, z_dot, roll, pitch, yaw, roll_dot, pitch_dot, yaw_dot]
                               metres, m/s, degrees, and deg/s; position is relative to the docking port
    data["commanded_rates"]  [roll, pitch, yaw] rates in deg/s that the rotation rates are easing toward
    data["message"]          why a flight ended, or why the simulator is unavailable

CONTROL INPUTS: 6 numbers [x, y, z, roll, pitch, yaw], each a number of thruster pulses. A positive pulse adds
0.06 m/s to that velocity (or 0.3 deg/s to that rotation rate); a negative pulse subtracts it. Values are rounded
to whole pulses and limited to +/-50 per axis. Velocities persist because there is no friction.

Every function returns the reply as a dict with "ok" (and "error" when ok is False). HackathonError means the
request did not get through at all (server not running, wrong URL, or a timeout). Full reference: API.md.
"""

import http.client
import json
import math
import secrets
import urllib.parse
from pathlib import Path

STATE_NAMES = ("x", "y", "z", "x_dot", "y_dot", "z_dot", "roll", "pitch", "yaw", "roll_dot", "pitch_dot", "yaw_dot")
INPUT_NAMES = ("x", "y", "z", "roll", "pitch", "yaw")
URL_FILE = Path(__file__).resolve().parent.parent / ".hackathon_url"


class HackathonError(Exception):
    """The request did not get through: the server is not running, the URL is wrong, or the request timed out."""


class Connection:
    """A request-reply link to the local simulator server. The connection stays open between requests."""

    def __init__(self, url, timeout_ms=10000):
        parts = urllib.parse.urlsplit(url.strip())
        if parts.scheme != "http" or not parts.hostname or not parts.path.startswith("/ap/"):
            raise ValueError("expected the autopilot URL printed by python -m hackathon.server, "
                             "like http://127.0.0.1:<port>/ap/<key>; got %r" % url)
        self.url = url.strip().rstrip("/")
        self._host, self._port = parts.hostname, parts.port
        self._path = parts.path.rstrip("/") + "/request"
        self.timeout_ms = timeout_ms
        self.client_id = secrets.token_hex(8)  # identifies this run of your program to the server
        self._http = None

    def request(self, message):
        """Send one request (a dict) and return the reply (a dict)."""
        data = json.dumps(dict(message, client=self.client_id)).encode()
        for attempt in (1, 2):
            reused = self._http is not None
            if not reused:
                self._http = http.client.HTTPConnection(self._host, self._port, timeout=self.timeout_ms / 1000.0)
            try:
                self._http.request("POST", self._path, data, {"Content-Type": "application/json"})
                response = self._http.getresponse()
                raw = response.read()
                break
            except (http.client.RemoteDisconnected, ConnectionResetError, BrokenPipeError) as e:
                self._drop()
                if reused and attempt == 1:
                    continue  # the server closed an idle connection before reading the request; send it again
                raise HackathonError("lost the connection to %s: %s" % (self.url, e)) from None
            except (OSError, http.client.HTTPException) as e:
                self._drop()
                raise HackathonError("could not reach %s (is python -m hackathon.server running?): %s" % (self.url, e or type(e).__name__)) from None
        try:
            reply = json.loads(raw.decode("utf-8"))
        except ValueError:
            reply = None
        if response.status != 200 or not isinstance(reply, dict) or "ok" not in reply:
            msg = reply.get("error") if isinstance(reply, dict) else None
            raise HackathonError(msg or "HTTP %d from %s" % (response.status, self.url))
        return reply

    def request_telemetry(self):
        """The latest telemetry. It never predates your last control inputs taking effect."""
        return self.request({"request": "telemetry"})

    def send_control_inputs(self, inputs):
        """Fire thrusters: inputs = [x, y, z, roll, pitch, yaw] pulses (lists, tuples, and numpy arrays all work)."""
        values = [float(v) for v in inputs]
        if len(values) != 6 or not all(math.isfinite(v) for v in values):
            raise ValueError("control inputs must be 6 finite numbers [x, y, z, roll, pitch, yaw]; got %r" % (inputs,))
        return self.request({"request": "control", "inputs": values})

    def _drop(self):
        if self._http is not None:
            self._http.close()
            self._http = None

    def close(self):
        self._drop()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def connect(url=None, timeout_ms=10000):
    """Connect to the local simulator server. Without a URL, use the one saved by python -m hackathon.server."""
    if url is None:
        try:
            url = URL_FILE.read_text(encoding="utf-8").strip()
        except OSError:
            raise HackathonError("no autopilot URL given and none saved; start python -m hackathon.server first") from None
    return Connection(url, timeout_ms)


def request_telemetry(connection):
    return connection.request_telemetry()


def send_control_inputs(connection, inputs):
    return connection.send_control_inputs(inputs)
