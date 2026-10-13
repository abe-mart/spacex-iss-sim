# Dock the Capsule — event API reference

This reference ships as `API.md` in the starter ZIP. Use the local Python/HTTP
interface for flight control. Netlify only stores event sessions and results;
never send thruster commands to the hosted website.

## Start an Autopilot flight

Run `python autopilot.py --event https://dock-the-capsule.netlify.app` from the
unzipped starter folder. The helper opens the simulator automatically. Enter
your crew name and event code and click LAUNCH FLIGHT. No separate server command
or pip packages are needed. Use `py` on Windows or `python3` on macOS if necessary.

For your own controller:

```python
import time
from dragon import Dragon, DragonError

with Dragon.start_event("https://dock-the-capsule.netlify.app", track="autopilot") as sim:
    state = sim.state()  # start_event waits for Launch in the browser
    while state["status"] == "flying":
        # Read state, calculate a correction, then send pulses.
        if state["attitude"]["pitch"] < -0.5:
            state = sim.pitch_up()
        time.sleep(0.2)
        state = sim.state()
    print(state["status"], state["message"])
```

This small example illustrates the API; it is not a complete docking controller.
See `examples/autopilot.py` for the reference feedback controller.

**Autopilot runs in real time.** The capsule keeps moving between requests.
Pause/step commands and `--slow` are rejected in the event Autopilot track.
Only the advanced AI Agent track uses pause/step. Keep the simulator tab visible.

## Connect to an existing helper

The local helper uses an available loopback port and a temporary controller token.
Use the values printed by the helper; do not assume port 5555.

```python
sim = Dragon("http://127.0.0.1:PORT", token="CONTROLLER-TOKEN")
state = sim.state()
```

For HTTP, every API request needs the header
`Authorization: Bearer CONTROLLER-TOKEN`. Send JSON command bodies with
`Content-Type: application/json`. Only clients on this same computer can connect.
The controller token is separate from the event code and any provider API key.

## The task

You start 200 m from the ISS, slightly off-axis and tilted. To dock, reach the docking port with **all** of these true at the moment of contact:

| Condition | Limit |
|---|---|
| `range` | < 0.2 m (this is what triggers the check) |
| `attitude.roll`, `.pitch`, `.yaw` | each within ±0.2° |
| `velocity.x`, `.y`, `.z` | each within ±0.24 m/s |

You **fail** if you arrive outside those limits, touch the station anywhere else, or drift more than 500 m away. Scored flights accept up to 7,200 simulation seconds.

## Coordinates

Everything is measured relative to the ISS docking port, using the same axes as the on-screen HUD:

- **x**: distance along the docking axis. Starts at 200 m and must reach 0.
- **y**: left/right offset. Starts at 12 m.
- **z**: up/down offset. Starts at 30 m.

`attitude` is in degrees. All zeros means pointing straight at the port, which is where you need to be.

**Translation commands push along the vehicle's own axes, not the x/y/z above.** Once attitude is near zero the two line up:

| Command | Effect when aligned |
|---|---|
| `translate_forward` / `translate_backward` | x decreases / increases |
| `translate_right` / `translate_left` | y increases / decreases |
| `translate_up` / `translate_down` | z increases / decreases |

If you're still tilted, a "forward" pulse will push partly sideways too. Fix attitude first.

## How the controls behave

Like the real thing, thrusters fire in **pulses** and there is no friction or drag:

- **Translation pulse:** changes velocity by 0.06 m/s (fine, default) or 0.30 m/s (coarse). The vehicle keeps drifting until you fire the opposite way.
- **Rotation pulse:** changes rotation rate by 0.3°/s (fine) or 0.6°/s (coarse). Rotation also keeps going until countered. The actual rate eases toward the new value over about 1 s; `rotation_rate_commanded` shows where it is heading.

Rotation pulses increase or decrease the matching attitude angle:

| Increases | Decreases |
|---|---|
| `roll_left` | `roll_right` |
| `pitch_up` | `pitch_down` |
| `yaw_left` | `yaw_right` |

The three rotations interact: turning about one axis while tilted on another shifts the other angles a little. Keep watching and correcting.

**Gravity** (on by default) makes you sink slowly, at 0.006 m/s in z. This drift is *not* included in `velocity`, and it doesn't count toward the docking speed limit.

## State reference

`GET /api/state` (or `sim.state()`). Values are rounded to a few decimals.

```json
{
  "status": "flying",
  "message": "",
  "paused": false,
  "time_s": 12.5,
  "position": {"x": 200.0, "y": 12.0, "z": 30.0},
  "velocity": {"x": 0.0, "y": 0.0, "z": 0.0},
  "range": 202.593,
  "range_rate": 0.0,
  "attitude": {"roll": 15.0, "pitch": -20.0, "yaw": -10.0},
  "rotation_rate": {"roll": 0.0, "pitch": 0.0, "yaw": 0.0},
  "rotation_rate_commanded": {"roll": 0.0, "pitch": 0.0, "yaw": 0.0},
  "precision": {"translation": "fine", "rotation": "fine"},
  "gravity": true,
  "connected": true,
  "ready": true
}
```

| Field | Meaning |
|---|---|
| `status` | `loading` → `intro` → `arriving` → `flying` → `success` or `fail`. Only `flying` accepts thruster commands. |
| `message` | Why the attempt ended, e.g. `"The following errors occurred: SPEED"`. |
| `paused` | True while in pause/step mode. |
| `time_s` | Sim seconds since this attempt began. Stops counting when the attempt ends, so after `success` it is the docking time. |
| `position` | Metres from the docking port (see Coordinates). |
| `velocity` | m/s, same axes. Excludes gravity drift. |
| `range` | Straight-line distance to the port, in metres. |
| `range_rate` | m/s. Negative means closing. |
| `attitude` | Degrees. Target is 0 on all three. |
| `rotation_rate` | Current rotation rate, deg/s. |
| `rotation_rate_commanded` | The rate each axis is easing toward, deg/s. |
| `precision` | Current pulse size for each control group. |
| `gravity` | Whether gravity drift is on. |
| `connected` | The local helper is receiving browser synchronization. |
| `ready` | True after you launch in the flight panel. |

Before the vehicle has arrived (`loading`, `intro`, and the first part of `arriving`), only `status`, `message`, `paused`, and `time_s` are present.

## HTTP endpoints and commands

| Endpoint | Response |
|---|---|
| `GET /api` | Available command names and whether the participant has launched (`ready`). |
| `GET /api/state` | State object above; 503 if the browser is disconnected. |
| `POST /api/command` | One command result, or an ordered array of results for a batch. |

Single JSON body:
```json
{"command":"yaw_left","count":2}
```
Ordered batch (1–50 commands):
```json
[{"command":"yaw_left","count":2},{"command":"translate_forward","count":1}]
```
Single response:
```json
{"ok":true,"command":"yaw_left","state":{"status":"flying","time_s":12.5}}
```
The actual `state` includes the full telemetry shown above. Failed browser
commands return `ok:false`, an `error` message, and the resulting `state`.
A batch returns an array of these result objects. Check every `ok` field.
Physics continues between commands in the Autopilot track; a batch is ordered,
not an atomic physics snapshot.

| Command | Options | Meaning |
|---|---|---|
| `roll_left`, `roll_right`, `pitch_up`, `pitch_down`, `yaw_left`, `yaw_right` | integer `count`: 1–50, default 1 | Apply rotation pulses. |
| `translate_forward`, `translate_backward`, `translate_left`, `translate_right`, `translate_up`, `translate_down` | integer `count`: 1–50, default 1 | Apply translation pulses. |
| `translation_fine`, `translation_coarse` | none | Select 0.06 or 0.30 m/s translation pulses. |
| `rotation_fine`, `rotation_coarse` | none | Select 0.3 or 0.6 degrees/s rotation pulses. |
| `gravity_on` | none | Keep gravity enabled. `gravity_off` is rejected for event flights. |
| `reset` | none | Start a new recorded attempt and wait for the capsule to arrive; may take about 15 seconds. Event Autopilot resumes real time; AI Agent pauses. |
| `resume` | none | Resume real-time physics. Useful after returning to a hidden/paused Autopilot tab. |
| `pause` | none | AI Agent only: freeze simulation time while thinking. |
| `step` | finite `seconds`: >0 and <=60, default 1 | AI Agent only: advance while paused, then freeze. Stops early on docking/failure. |

Do not send control commands until you have joined and launched in the browser.
Reset creates another ranked attempt; it is not just a local repositioning tool.

## Python client

`dragon.py` uses only the Python standard library.

| Method | Returns / behavior |
|---|---|
| `Dragon.start_event(event_url, track="autopilot", wait=True, open_browser=True)` | Starts and owns the local helper. Opens the browser and waits for Launch by default. `track` is `autopilot` or `agent`. |
| `Dragon(url, token=...)` | Connects to an already-running helper; does not own or stop that helper. |
| `state()` | Current telemetry dictionary. |
| `command(name, **options)` | State after one acknowledged command, e.g. `command("translation_fine")`. |
| `commands(*commands)` | State after the last acknowledged command. Items can be names or dictionaries. At least one command is required. |
| `reset()` | New recorded attempt; returns state once flying. |
| `resume()` | Resume real-time flight. |
| `pause()`, `step(seconds=1.0)` | AI Agent only. |
| `roll_left(count=1)`, `roll_right`, `pitch_up`, `pitch_down`, `yaw_left`, `yaw_right` | Rotation helpers; each returns state. |
| `translate_forward(count=1)`, `translate_backward`, `translate_left`, `translate_right`, `translate_up`, `translate_down` | Translation helpers; each returns state. |
| `close()` | Stops only the helper started by this client. A `with` block closes it automatically. |

The Python client unwraps HTTP results and raises `DragonError` on a failed
command, malformed request, missing launch, rejected token, or disconnected tab.
Catch it, inspect the message, and stop issuing pulses until the problem is fixed.

## Errors, timing, and results

- HTTP 200: read the `ok` fields for commands; state reads return telemetry directly.
- HTTP 400: invalid command/options, including Autopilot pause/step or gravity_off.
- HTTP 401: missing/incorrect temporary controller token.
- HTTP 403: non-loopback host or mismatched browser Origin.
- HTTP 409: join and launch in the browser first.
- HTTP 413: request exceeds the helper's 32 KB body limit.
- HTTP 503: browser disconnected. Keep exactly one paired simulator tab visible.
- HTTP 504: browser stopped responding while a command was pending.

Do not blindly retry pulses after a timeout: a pulse may already have executed.
Re-read telemetry first. Closed helpers invalidate their temporary token.

A successful flight automatically submits to the leaderboard. If the upload
fails, use Retry score upload in the flight panel or `python retry_scores.py`.
Participant event sessions last eight hours. Keep `.dock-receipts` private.
Only use the documented API for control; do not alter browser physics or scores.
