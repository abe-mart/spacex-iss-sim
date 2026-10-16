# Dock the Capsule: starter kit

This kit is for the Autopilot (intermediate) and AI Agent (advanced) challenges. It needs Python 3.9 or newer and Chrome or Edge on the same computer. No additional packages are required, except the Anthropic SDK for the example agent. Keep all of the unzipped files together.

## 1. Start the simulator server

Open a terminal in this folder and run:

```
python -m hackathon.server                  # Autopilot challenge
python -m hackathon.server --track agent    # AI Agent challenge
```

Use `py` on Windows or `python3` on macOS if `python` is not found. The server opens the simulator in your browser and prints your autopilot URL. Log in, enter a crew name, and press **LAUNCH FLIGHT**. Leave the server running while you work; press Ctrl+C to stop it.

## 2. Fly

**Autopilot.** In a second terminal, run `python autopilot.py`. The example levels the capsule's attitude but does not dock. Edit its `Controller` class, with help from your AI coding assistant, to make it dock. C and C++ versions are in `examples/`, with build instructions at the top of each file.

**AI Agent.** `agent_pilot.py` is an example in which Claude flies the capsule. It uses your own Anthropic API key:

```
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...      # Windows PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
python agent_pilot.py
```

To use another agent, such as Claude Code, click **Copy agent briefing** in the flight panel and give the briefing to your agent, or give it `AGENT_GUIDE.md` together with your autopilot URL.

The simulator runs in real time and does not wait for your program. To test faster, choose a simulation speed of 2×, 4×, or 8× in the flight panel before launching. Faster flights are not ranked.

## 3. Results

Successful real-time flights are submitted to the event leaderboard automatically. If an upload fails, use **Retry score upload** in the flight panel or run `python retry_scores.py`. Upload receipts in `.dock-receipts/` contain your event session token, so keep them private.

See `API.md` for the full reference: telemetry fields, control inputs, coordinates, and the HTTP protocol for other languages.
