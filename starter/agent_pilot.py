"""Example AI agent for the Advanced challenge: Claude flies the capsule live.

1. Install the Anthropic SDK and set your own API key:
       pip install anthropic
       export ANTHROPIC_API_KEY=sk-ant-...          (Windows PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-...")
2. Start the local simulator server:              python -m hackathon.server --track agent
3. Run the agent:                                 python agent_pilot.py
4. Launch the flight in the browser.

The simulator does not wait for the agent. Each decision is one Claude call: the agent receives the latest
telemetry and its recent decisions, then calls the fire_thrusters tool. While Claude thinks, the capsule keeps
moving, so the agent must plan for latency. Improving the prompt, the tools, or the division of work between
Claude and your own code is the challenge.

Options:  --model claude-haiku-5-5 (default; fastest)   --url <autopilot URL>   --max-decisions N
"""

import argparse
import json
import sys
import time

import hackathon.client as hackathon_client

try:
    import anthropic
except ImportError:
    sys.exit("This example needs the Anthropic SDK. Install it with: pip install anthropic")

SYSTEM = """You are the autonomous pilot of a capsule docking with the International Space Station in a real-time simulator.
Every turn you receive the latest telemetry and your recent decisions. Respond by calling fire_thrusters exactly once.
The simulation keeps running while you think (typically 1-3 seconds per turn), so plan for that delay.

Coordinates are relative to the docking port: x is the distance along the docking axis (it must reach 0),
y is the left/right offset, and z is the up/down offset. Attitude angles of 0 point straight at the port.

Thrusters: each pulse changes a velocity by 0.06 m/s or a rotation rate by 0.3 deg/s, and the change persists
(there is no friction). Positive x pulses increase x velocity (moving away from the station), so approaching
the station needs negative x velocity. Translations act along the vehicle's own axes, so they match x/y/z only
when the attitude is near zero.

Rotation: every rotation pulse changes the COMMANDED rate immediately by 0.3 deg/s, and the measured rate eases
toward the commanded rate over about one second. Always plan from commanded_rates, never from the measured
rates, or you will fire the same correction twice. To turn an angle toward zero, choose a commanded rate of
about -0.25 x angle (limited to 3 deg/s) and fire round((target - commanded) / 0.3) pulses on that axis.

Docking succeeds when range < 0.2 m with roll, pitch, and yaw each within 0.2 degrees and every velocity
component under 0.24 m/s. Touching the station anywhere else, or drifting beyond 500 m, fails the flight.

A reliable plan: (1) bring roll, pitch, and yaw to 0 and stop the rotation, (2) remove the y and z offsets and
stop the lateral drift, (3) close along x, slowing as you approach. A good closing speed is about 1% of the range,
between 0.1 and 1.5 m/s, and below 0.15 m/s in the last 5 m. Prefer small, deliberate corrections."""

TOOLS = [{
    "name": "fire_thrusters",
    "description": "Fire thruster pulses on each axis. Positive values increase that velocity or rotation rate; negative "
                   "values decrease it. Use 0 on axes that need no change. Values are whole pulses from -10 to 10.",
    "input_schema": {
        "type": "object",
        "properties": {
            **{axis: {"type": "integer", "minimum": -10, "maximum": 10} for axis in ("x", "y", "z", "roll", "pitch", "yaw")},
            "reason": {"type": "string", "description": "One short sentence explaining the decision."},
        },
        "required": ["x", "y", "z", "roll", "pitch", "yaw", "reason"],
        "additionalProperties": False,
    },
}]


def describe(data):
    """Telemetry as a compact, labelled summary for the model."""
    s = data["state"]
    names = hackathon_client.STATE_NAMES
    summary = {name: round(value, 3) for name, value in zip(names, s)}
    summary["range_m"] = round((s[0] ** 2 + s[1] ** 2 + s[2] ** 2) ** 0.5, 2)
    summary["commanded_rates"] = dict(zip(("roll", "pitch", "yaw"), data["commanded_rates"]))
    summary["sim_time_s"] = data["timestamp_ms"] / 1000.0
    return summary


def decide(client, model, telemetry, history):
    prompt = json.dumps({"telemetry": telemetry, "recent_decisions": history[-6:]}, separators=(",", ":"))
    response = client.messages.create(
        model=model, max_tokens=2048, system=SYSTEM, tools=TOOLS, tool_choice={"type": "auto"},
        # Decisions must be fast because the capsule keeps moving: no extended thinking, low effort.
        thinking={"type": "disabled"}, output_config={"effort": "low"}, messages=[{"role": "user", "content": prompt}])
    for block in response.content:
        if block.type == "tool_use" and block.name == "fire_thrusters":
            try:
                inputs = [max(-10, min(10, int(block.input[axis]))) for axis in ("x", "y", "z", "roll", "pitch", "yaw")]
            except (KeyError, TypeError, ValueError):
                return None, "invalid tool input"
            return inputs, str(block.input.get("reason", ""))[:200]
    return None, "no thruster command (stop reason: %s)" % response.stop_reason


def main():
    parser = argparse.ArgumentParser(description="Let Claude fly the capsule live.")
    parser.add_argument("--model", default="claude-haiku-5-5")
    parser.add_argument("--url", help="autopilot URL (default: the one saved by python -m hackathon.server)")
    parser.add_argument("--max-decisions", type=int, default=1000)
    args = parser.parse_args()

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
    connection = hackathon_client.connect(args.url)
    print("Connected. Launch the flight in the browser.")
    history, flight_id = [], None
    try:
        while len(history) < args.max_decisions:
            data = hackathon_client.request_telemetry(connection)
            if flight_id is None:
                if data["status"] == "flying" and data["state"]:
                    flight_id = data["flight_id"]
                    print("Flight started. Claude (%s) has control." % args.model)
                else:
                    time.sleep(0.2)
                continue
            if data["status"] != "flying" or data["flight_id"] != flight_id:
                print("Docked in %.1f s." % (data["timestamp_ms"] / 1000.0) if data["docked"]
                      else "Flight ended: %s" % (data["message"] or data["status"]))
                return

            telemetry = describe(data)
            started = time.time()
            try:
                inputs, reason = decide(client, args.model, telemetry, history)
            except anthropic.APIError as e:
                # A failed call (network, rate limit, overload) skips this decision; the next one uses fresh telemetry.
                print("Claude request failed (%s); retrying with new telemetry." % type(e).__name__)
                time.sleep(1)
                continue
            latency = time.time() - started
            if inputs and any(inputs):
                reply = hackathon_client.send_control_inputs(connection, inputs)
                if not reply["ok"]:
                    reason += " (not applied: %s)" % reply["error"]
            history.append({"sim_time_s": telemetry["sim_time_s"], "range_m": telemetry["range_m"], "fired": inputs, "reason": reason})
            print("t=%6.1fs range=%7.2fm  %.1fs  fired=%s  %s" % (telemetry["sim_time_s"], telemetry["range_m"], latency, inputs, reason))
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
