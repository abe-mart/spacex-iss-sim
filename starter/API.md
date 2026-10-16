# Dock the Capsule: autopilot API reference

This reference ships as `API.md` in the starter kit. It applies to the Autopilot (intermediate) and AI Agent (advanced) challenges.

## How the pieces fit together

- The **simulator** runs in your browser and computes the physics in real time.
- The **simulator server** (`python -m hackathon.server`) runs on your computer. It serves the simulator page and relays telemetry and thruster commands between the page and your program.
- Your **autopilot or agent** connects to the simulator server and exchanges messages with it in a request-reply pattern. It requests the latest telemetry, decides what to do, and sends control inputs.
- When a ranked flight ends, the browser submits the result to the event website. Your program never talks to the event website directly.

## Quick start

```
python -m hackathon.server           # terminal 1 (add --track agent for the AI Agent challenge)
python autopilot.py                  # terminal 2
```

The server opens the simulator in your browser and prints an **autopilot URL** such as `http://127.0.0.1:52817/ap/3f9c…`. It also saves that URL in `.hackathon_url`, so Python programs can call `connect()` without arguments. In the browser, log in, enter a crew name, and press **LAUNCH FLIGHT**. Your autopilot takes control once the capsule arrives.

Keep the server and the simulator tab open while you work. You can restart your autopilot as often as you like. Each flight is launched from the browser. Use `py` on Windows or `python3` on macOS if `python` is not found.

## Python client

```python
import hackathon.client as hackathon_client

connection = hackathon_client.connect()            # or connect("http://127.0.0.1:<port>/ap/<key>")

while True:
    data = hackathon_client.request_telemetry(connection)
    if data["status"] != "flying":
        ...                                        # waiting, docked, failed, or offline
    state = data["state"]                          # 12 numbers; see "Telemetry"
    inputs = my_controller.update(state)           # 6 numbers; see "Control inputs"
    hackathon_client.send_control_inputs(connection, inputs)
```

| Function | Description |
|---|---|
| `connect(url=None, timeout_ms=10000)` | Connects to the simulator server. Without a URL, it reads `.hackathon_url`. |
| `request_telemetry(connection)` | Returns the latest telemetry as a dict. Also available as `connection.request_telemetry()`. |
| `send_control_inputs(connection, inputs)` | Fires thruster pulses. Returns once the simulator has applied them. Also available as `connection.send_control_inputs(inputs)`. |
| `connection.close()` | Closes the connection. A `with` block closes it automatically. |

Every reply is a dict with `ok`, plus `error` when `ok` is false (for example, when no flight is in progress). `hackathon_client.HackathonError` is raised when a request does not get through at all: the server is not running, the URL is wrong, or the request timed out. The client uses only the Python standard library.

`autopilot.py` is a complete template: it waits for a flight, runs a control loop that skips repeated and stale telemetry, and prints progress. Its example controller only levels the attitude. Making the capsule dock is your task.

## C and C++ clients

The header-only clients in `include/` provide the same functions:

| C (`hackathon_client.h`) | C++ (`hackathon_client.hpp`) |
|---|---|
| `hk_connect(url, timeout_ms)` | `hackathon::Client client(url)` |
| `hk_request_telemetry(c, &telemetry)` | `client.requestTelemetry()` |
| `hk_send_control_inputs(c, inputs, &reply)` | `client.sendControlInputs({x, y, z, roll, pitch, yaw})` |
| `hk_close(c)` | (destructor) |

They use libcurl on macOS and Linux and WinHTTP on Windows. Build commands are at the top of `examples/autopilot.c` and `examples/autopilot.cpp`. Pass the autopilot URL printed by the server as the first argument.

## Other languages: the HTTP protocol

Any language that can send HTTP requests can fly. Send `POST <autopilot URL>/request` with a JSON body and `Content-Type: application/json`. The URL contains a secret key, so no other header is needed. Include a `"client"` field with any short identifier that stays the same for the life of your program.

```
{"request": "telemetry", "client": "a1b2c3"}
{"request": "control", "inputs": [0, 0, -2, 0, 1, 0], "client": "a1b2c3"}
```

Replies have HTTP status 200 and the JSON fields described below. Status 400 means the request was malformed, and status 404 means the autopilot URL is wrong (for example, from an earlier server run).

## Telemetry

| Field | Description |
|---|---|
| `status` | `"flying"` while you have control; `"waiting"` before a flight is launched; `"docked"` or `"failed"` after your flight ends; `"offline"` when the simulator tab is not connected. |
| `docked` | `true` once your flight has docked. |
| `flight_id` | Identifier of the current flight. It changes with every launch. |
| `ranked` | `true` for real-time leaderboard flights; `false` for faster-than-real-time test flights. |
| `simulation_speed` | 1 for real time; 2, 4, or 8 for test flights. |
| `timestamp_ms` | Simulation time in this flight, in milliseconds. If it has not changed since your last request, there is nothing new yet. |
| `state` | 12 numbers, or `null` when there is no flight: `[x, y, z, x_dot, y_dot, z_dot, roll, pitch, yaw, roll_dot, pitch_dot, yaw_dot]`. Units are metres, m/s, degrees, and deg/s. |
| `commanded_rates` | `[roll, pitch, yaw]`: the rotation rates in deg/s that the capsule is easing toward. |
| `message` | Why a flight ended, or why the simulator is unavailable. |

Telemetry is the newest state the browser has reported (it reports about every 30 ms). It never predates your last control inputs taking effect, so your controller does not react twice to the same situation. A finished flight is reported only to the program that flew it; a program started afterwards sees `"waiting"` until the next launch.

## Control inputs

Control inputs are 6 numbers, `[x, y, z, roll, pitch, yaw]`, each a number of thruster pulses. A positive pulse increases that velocity or rotation rate, and a negative pulse decreases it. Inputs are rounded to whole pulses and limited to ±50 per axis per request. The reply contains `timestamp_ms` (the simulation time when the inputs took effect) and `pulses` (the whole pulses fired on each axis).

- **Translation pulse:** changes velocity by 0.06 m/s. There is no friction, so the capsule keeps drifting until you fire the opposite way.
- **Rotation pulse:** changes the commanded rotation rate by 0.3 deg/s. The measured rate eases toward the commanded rate over about one second.

Translations push along the capsule's own axes. They match x, y, and z only when roll, pitch, and yaw are near zero, so correct the attitude first.

## Coordinates and docking

Position is measured from the ISS docking port, using the same axes as the on-screen display:

- **x:** distance along the docking axis. It starts near 200 m and must reach 0. Approaching the station means negative x velocity.
- **y:** left/right offset.
- **z:** up/down offset.
- **roll, pitch, yaw:** all zero means pointing straight at the port.

The starting position is the same for every ranked flight in the event. Read it from telemetry rather than assuming fixed values. The capsule docks when all of these are true at the moment the range drops below 0.2 m:

| Condition | Limit |
|---|---|
| Range | < 0.2 m |
| Roll, pitch, yaw | each within ±0.2° |
| Each velocity component | within ±0.24 m/s |

A flight fails if the capsule arrives outside those limits, touches the station anywhere else, or drifts more than 500 m away. Gravity causes a slow downward drift of 0.006 m/s in z, which is not included in the velocity telemetry and does not count toward the docking speed limit.

## Real time and test flights

Ranked flights run in real time. The capsule keeps moving while your program computes, and the simulator does not pause for it. To test faster, choose a simulation speed of 2×, 4×, or 8× in the flight panel before launching. Faster flights are never submitted to the leaderboard, and the event server rejects results whose flight clock runs ahead of real time. Use `timestamp_ms` rather than the wall clock for controller timing.

Keep the simulator tab visible. Browsers slow down hidden tabs, so a flight pauses while its tab is hidden and resumes when the tab is visible again.

## Results

When a ranked flight docks, the browser submits the result to the event leaderboard. The lowest simulation time wins, and fewer thruster pulses break ties. If the upload fails, use **Retry score upload** in the flight panel or run `python retry_scores.py`. Upload receipts in `.dock-receipts/` contain your event session token, so keep them private.

## Challenge Mode

Challenge Mode is optional. Choose a mission in the local flight panel before launching:

- **Noisy instruments:** position measurements vary by up to ±0.5 m per axis and velocity by ±0.03 m/s. Attitude is unaffected.
- **Broken thruster:** the left translation thruster (negative y input) produces no force.
- **Scrambled controls:** the six translation directions are mapped to different thrusters. Rotation is unaffected.

Each mission has separate standings. Docking is judged on the true state, not the noisy measurements.

## Low-level command API

The simulator server also offers the original command interface, used by `dragon.py`. Most participants do not need it. Requests require the header `X-Dock-Bridge: <key>`, where `<key>` is the last part of the autopilot URL.

| Endpoint | Description |
|---|---|
| `GET /api/state` | Full simulator telemetry as named fields (`position`, `velocity`, `attitude`, `rotation_rate`, `rotation_rate_commanded`, `range`, `range_rate`, `status`, `time_s`, and more). |
| `POST /api/command` | One command such as `{"command": "yaw_left", "count": 2}`, or an ordered list of 1–50 commands. Returns the resulting state. |
| `GET /api` | The list of available commands. |

Commands: `roll_left`, `roll_right`, `pitch_up`, `pitch_down`, `yaw_left`, `yaw_right`, `translate_forward`, `translate_backward`, `translate_left`, `translate_right`, `translate_up`, `translate_down` (each with an optional `count` of 1–50), `translation_fine`, `translation_coarse`, `rotation_fine`, `rotation_coarse`, `resume`, and `reset` (starts a new recorded attempt). `pause`, `step`, and `gravity_off` are not available during the event.

```python
from dragon import Dragon
sim = Dragon("http://127.0.0.1:<port>", token="<key>")
state = sim.state()
sim.yaw_left(2)
```
