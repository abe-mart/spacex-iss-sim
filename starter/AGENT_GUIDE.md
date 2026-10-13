# Dock the Capsule — AI Agent mission

You are my pilot. Make live decisions from telemetry and fly the capsule through
the API using your local terminal/Python tools. Do not just write a controller
and leave it for me to run.

API base URL: {{API_URL}}
Temporary controller token: {{CONTROLLER_TOKEN}}

If these are placeholders, ask me for the helper’s connection details.
Wait for me to enter my crew name and click LAUNCH FLIGHT before sending commands.

Fly the capsule by making decisions from telemetry, rather than writing an
autopilot for someone else to run. The local simulator page must be launched and
visible. The Python helper prints the API URL and a temporary controller token.

Python:

```python
from dragon import Dragon
sim = Dragon("{{API_URL}}", token="{{CONTROLLER_TOKEN}}")
state = sim.state()
sim.pause()
state = sim.commands({"command": "yaw_left", "count": 2},
                     {"command": "step", "seconds": 0.5})
```

HTTP: `GET /api/state`, `POST /api/command`, with header
`Authorization: Bearer {{CONTROLLER_TOKEN}}`. Commands are JSON objects or ordered
batches. Example POST body: `{"command":"pause"}`.
Batch example: `[{"command":"yaw_left","count":2},{"command":"step","seconds":0.5}]`.
Send Content-Type: application/json. A single command returns `{ok, command, state}`;
batches return an array of those. State reads return telemetry directly. Check
`ok` after every command.
Controls: translate_forward/backward/left/right/up/down, roll_left/right,
pitch_up/down, yaw_left/right, translation_fine/coarse, rotation_fine/coarse,
reset, pause, resume, step, gravity_on. `count` is 1–50; a step is positive and at most 60 simulation seconds.
Gravity cannot be disabled. Every command returns its resulting state.

Coordinates: x is distance in front of the port, y sideways, z vertical (m).
Velocity is m/s; attitude and rotation rate are degrees and degrees/s. Forward
decreases x, right increases y, and up increases z when aligned. Fine translation
pulses add 0.06 m/s. Fine rotation pulses change commanded rate by 0.3 degrees/s.
roll_left, pitch_up, yaw_left increase the matching angle. Opposite pulses brake.

First zero attitude and rates, then line up sideways/vertically, then approach
and brake early. Dock at range below 0.2 m, attitude within 0.2 degrees on each
axis, and each velocity component within 0.24 m/s. Pause while thinking and coast
in short steps near contact. Inspect actual and commanded rotation rates.

Scores submit automatically. Lowest successful simulation time wins, then fewer
thruster pulses. Thinking while paused does not count. Ask before reset: it starts
a new recorded attempt. Do not alter the browser's physics/state,
use developer teleport controls, or submit fabricated scores. Keep the printed
controller token private and stop when docked or failed. Cloud-only agents cannot
reach localhost; use an agent with tools on this computer.
