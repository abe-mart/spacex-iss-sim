"""Your capsule autopilot. Edit the Controller class below.

1. Start the local simulator server in another terminal:   python -m hackathon.server
2. Run this autopilot:                                      python autopilot.py
   (or pass the autopilot URL explicitly:                   python autopilot.py http://127.0.0.1:<port>/ap/<key>)
3. Launch the flight in the browser. The autopilot takes control once the capsule arrives.

The simulator runs in REAL TIME: the capsule keeps moving while your code thinks, and your inputs take a
moment to reach it. Telemetry never predates your last inputs taking effect, so the controller does not react
twice to the same situation. For faster testing, choose a faster simulation speed in the browser before
launching; those flights are not ranked.

STATE: data["state"], 12 numbers (metres, m/s, degrees, deg/s):
    [x, y, z, x_dot, y_dot, z_dot, roll, pitch, yaw, roll_dot, pitch_dot, yaw_dot]
    x, y, z    position relative to the docking port: x = distance along the docking axis (it must reach 0),
               y = left/right offset, z = up/down offset
    roll, pitch, yaw   0, 0, 0 means pointing straight at the port
    data["commanded_rates"]  [roll, pitch, yaw] rates the vehicle is easing toward (about 1 s lag)

CONTROL INPUTS: [x, y, z, roll, pitch, yaw], each a number of thruster pulses.
    +1 adds 0.06 m/s to that velocity (or 0.3 deg/s to that rotation rate); -1 subtracts it.
    Inputs are rounded to whole pulses, with at most 50 per axis per call. Velocities persist (no friction).
    Translations push along the vehicle's own axes, so they match x/y/z only when the attitude is near 0.

TO DOCK: range < 0.2 m, roll/pitch/yaw each within 0.2 deg, and each velocity component under 0.24 m/s.
Full details are in API.md.
"""

import sys
import time

import hackathon.client as hackathon_client

STALE_MS = 2000  # skip telemetry that arrives this long after the previous sample (the loop was stalled)

X, Y, Z, X_DOT, Y_DOT, Z_DOT, ROLL, PITCH, YAW, ROLL_DOT, PITCH_DOT, YAW_DOT = range(12)
ROTATION_PULSE = 0.3  # deg/s per rotation pulse
TRANSLATION_PULSE = 0.06  # m/s per translation pulse


class Controller:
    """This example only levels the attitude, so the capsule ends up pointing at the station and then holds
    position. Making it dock is your task."""

    ACT_EVERY_MS = 500  # act at most this often, so the effect of each burn is visible before the next

    def __init__(self):
        self.since_action_ms = self.ACT_EVERY_MS

    def update(self, state, commanded_rates, dt_ms):
        """Return the control inputs [x, y, z, roll, pitch, yaw] for this moment."""
        self.since_action_ms += dt_ms
        if self.since_action_ms < self.ACT_EVERY_MS:
            return [0, 0, 0, 0, 0, 0]
        self.since_action_ms = 0

        inputs = [0, 0, 0, 0, 0, 0]
        for i, angle in enumerate(state[ROLL:YAW + 1]):
            # Aim for a rotation rate that brings the angle back toward 0, slowing as it gets close.
            target_rate = max(-3.0, min(3.0, -0.25 * angle))
            inputs[3 + i] = round((target_rate - commanded_rates[i]) / ROTATION_PULSE)
        return inputs


def fly(connection):
    """Fly one flight from launch to its end. Returns the final telemetry."""
    controller = Controller()
    flight_id = None
    timestamp_ms = 0
    last_print_ms = -1e9
    while True:
        data = hackathon_client.request_telemetry(connection)
        if flight_id is None:
            if data["status"] == "offline":
                print(data["message"])
                time.sleep(2)
            elif data["status"] == "flying":
                flight_id, timestamp_ms = data["flight_id"], data["timestamp_ms"]
                print("Flight started (%s). Flying." % ("ranked" if data["ranked"] else "unranked test flight"))
            else:
                time.sleep(0.05)
            continue

        # The flight is over: docked, failed, or replaced by a new flight.
        if data["status"] != "flying" or data["flight_id"] != flight_id:
            return data

        new_timestamp_ms = data["timestamp_ms"]
        dt = new_timestamp_ms - timestamp_ms
        if dt == 0:  # nothing new yet; wait briefly instead of flooding the server with requests
            time.sleep(0.010)
            continue
        timestamp_ms = new_timestamp_ms
        if dt > STALE_MS:
            continue

        state = data["state"]
        if timestamp_ms - last_print_ms >= 5000:
            last_print_ms = timestamp_ms
            print("t=%6.1fs  pos=(%6.1f,%5.1f,%5.1f) m  vel=(%5.2f,%5.2f,%5.2f) m/s  att=(%5.1f,%5.1f,%5.1f) deg" % (
                (timestamp_ms / 1000.0,) + tuple(state[X:Z_DOT + 1]) + tuple(state[ROLL:YAW + 1])))

        inputs = controller.update(state, data["commanded_rates"], dt)
        if any(inputs):
            reply = hackathon_client.send_control_inputs(connection, inputs)
            if not reply["ok"]:
                print("Control inputs were not applied: %s" % reply["error"])


def main():
    connection = hackathon_client.connect(sys.argv[1] if len(sys.argv) > 1 else None)
    print("Connected to %s. Launch the flight in the browser." % connection.url)
    try:
        while True:
            data = fly(connection)
            if data["docked"]:
                print("Docked in %.1f s." % (data["timestamp_ms"] / 1000.0))
            else:
                print("Flight ended: %s" % (data["message"] or data["status"]))
            print("Waiting for the next flight. Press Ctrl+C to stop.")
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
