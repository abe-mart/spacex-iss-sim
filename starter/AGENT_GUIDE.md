# Dock the Capsule: AI Agent briefing

You are the pilot of a capsule docking with the International Space Station in a real-time simulator. Fly the capsule yourself by reading telemetry and firing thrusters through the local API, using the tools on this computer. The simulator does not pause while you think, so keep each decision short and account for the time between reading telemetry and acting.

Autopilot URL: {{AUTOPILOT_URL}}

If the URL above is a placeholder, ask me for the autopilot URL printed by `python -m hackathon.server`. Wait until I have launched the flight in the browser (telemetry `status` is `"flying"`) before firing thrusters.

## Interface

Python, from the `dock-the-capsule` folder:

```python
import hackathon.client as hackathon_client
connection = hackathon_client.connect("{{AUTOPILOT_URL}}")
data = hackathon_client.request_telemetry(connection)
hackathon_client.send_control_inputs(connection, [0, 0, 0, 0, 1, 0])
```

HTTP: `POST {{AUTOPILOT_URL}}/request` with `Content-Type: application/json` and a body of `{"request": "telemetry"}` or `{"request": "control", "inputs": [x, y, z, roll, pitch, yaw]}`.

Telemetry fields: `status`, `docked`, `timestamp_ms`, `state` = `[x, y, z, x_dot, y_dot, z_dot, roll, pitch, yaw, roll_dot, pitch_dot, yaw_dot]` (metres, m/s, degrees, deg/s), `commanded_rates` = `[roll, pitch, yaw]`, and `message`.

Control inputs are thruster pulses per axis, `[x, y, z, roll, pitch, yaw]`, at most ±50 per axis. A positive pulse increases that velocity by 0.06 m/s or that commanded rotation rate by 0.3 deg/s; a negative pulse decreases it. Velocities persist because there is no friction. The measured rotation rate eases toward the commanded rate over about one second, so plan rotation from `commanded_rates`.

## Flying

- x is the distance along the docking axis and must reach 0; approaching means negative x velocity. y and z are the sideways and vertical offsets.
- Translations push along the capsule's own axes, so bring roll, pitch, and yaw to zero first.
- Then remove the y and z offsets, and then approach along x, slowing as the range decreases.
- Docking requires range < 0.2 m, roll, pitch, and yaw each within 0.2°, and each velocity component within 0.24 m/s. Touching the station elsewhere or drifting beyond 500 m fails the flight.

## Rules

The leaderboard ranks successful real-time flights by simulation time, then by thruster pulses. Results are submitted automatically by the browser. Use only this API to control the capsule. Do not modify the simulator or submit results by other means. Stop when the flight docks or fails. The agent must run on this computer, because the simulator server only accepts local connections.

If Challenge Mode is active, the flight panel describes the mission: noisy position and velocity measurements, a broken left thruster, or scrambled translation controls. Diagnose or compensate before the final approach.
