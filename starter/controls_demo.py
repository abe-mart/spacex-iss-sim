"""Controls and sensors tour. Deliberately not a docking controller."""
import argparse
import time
from dragon import Dragon


def show(sim, label):
    state = sim.state()
    print(label, {key: state.get(key) for key in
                 ("time_s", "position", "velocity", "attitude", "rotation_rate", "challenge")})
    return state


def wait_sim_seconds(sim, seconds):
    """Use simulation time so the example behaves consistently at 1x–8x."""
    start = sim.state()["time_s"]
    while True:
        state = sim.state()
        if state["status"] != "flying" or state["time_s"] - start >= seconds:
            return
        time.sleep(.02)


def exercise_controls(sim):
    state = show(sim, "Initial sensors:")
    if not state.get("practice"):
        print("This controls tour is for practice. Click Stop / abort, then Fly unranked practice.")
        return
    # A small sideways movement, followed by an opposing pulse.
    # No approach commands, target alignment, feedback loop, or docking solution.
    sim.translate_right()
    wait_sim_seconds(sim, 2)
    show(sim, "After right pulse:")
    sim.translate_left()
    # Demonstrate batching rotation pulses and reading the resulting state.
    sim.commands({"command": "yaw_left"}, {"command": "roll_right"})
    wait_sim_seconds(sim, 1)
    sim.commands({"command": "yaw_right"}, {"command": "roll_left"})
    show(sim, "Final sensors:")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", default="https://dock-the-capsule.netlify.app")
    args = parser.parse_args()
    print("Choose Fly unranked practice in the browser. For faster tests, first choose a practice speed.")
    with Dragon.start_event(args.event, track="autopilot") as sim:
        exercise_controls(sim)
        print("Tour complete. This example does not dock. Build your controller here.")
        print("Opposing pulses may not cancel in fault scenarios. Read telemetry to see what happened.")
        input("Keep this terminal and flight tab open. Press Enter to stop the local helper. ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
