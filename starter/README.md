# Dock the Capsule — Python starter

Use Python 3.11+ and Chrome on Windows/macOS (Edge is another Windows target).
No pip packages or separate server command are needed. Unzip the full bundle;
keep its `site/`, `examples/`, and Python files together.

## Autopilot

From this folder run:

```
python autopilot.py --event https://dock-the-capsule.netlify.app
```

Use `py` on Windows or `python3` on macOS if that is your Python command. The
helper opens the simulator. Choose a callsign, enter the event code, and click
LAUNCH FLIGHT. The reference controller then flies. Edit `examples/autopilot.py`
with your AI coding assistant to make your own algorithm.

Keep the simulator tab visible. The autopilot flies in real time: the capsule keeps moving
between control updates. Pause/step is reserved for the AI Agent track. Stop the Python process to stop the helper.

## Local AI agent

Run `python agent_bridge.py --event https://dock-the-capsule.netlify.app` and launch the
flight in the browser. Click Copy agent briefing in the local simulator and paste it into your agent,
or give it the generated `AGENT_CONNECTION.md` file. The agent must run on this same computer. A cloud notebook
cannot reach this loopback API.

## Scores

Successful flights submit automatically to the shared event leaderboard. Failed
uploads have a Retry button in the browser and a receipt under `.dock-receipts/`.
Run `python retry_scores.py` to retry while the event session is valid (8 hours).
Receipts contain your participant token; keep them private. They contain no
Claude/provider key. Results are browser-reported and reviewed by staff.

The familiar `Dragon()` API still works with an explicitly started `server.py`.
For automatic event startup use `Dragon.start_event(event_url, track="autopilot")`.

## Full API reference

Open `API.md` in this folder for every Python method, HTTP endpoint, command option, telemetry field, coordinate/sign convention, and error code. Autopilot is real time; pause/step is AI Agent only.
