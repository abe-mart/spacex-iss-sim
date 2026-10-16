// autopilot.cpp: a capsule autopilot in C++. Edit the Controller class below.
//
// Build (from the kit folder):
//     c++ -std=c++11 -I include examples/autopilot.cpp -o autopilot -lcurl                (macOS, Linux)
//     g++ -std=c++11 -I include examples/autopilot.cpp -o autopilot.exe -lwinhttp         (Windows, MinGW)
//     cl /EHsc /I include examples\autopilot.cpp                                           (Windows, Visual Studio)
// Start python -m hackathon.server first, then run this with the autopilot URL it prints:
//     ./autopilot http://127.0.0.1:<port>/ap/<key>
// Then launch the flight in the browser.
//
// State, control inputs and rules: see autopilot.py or API.md (the same for every language).
#include "hackathon_client.hpp"  // first: it sets up the system headers

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <string>

using namespace hackathon;

const long long STALE_MS = 2000;  // skip telemetry that arrives this long after the previous one
const double ROTATION_PULSE = 0.3;  // deg/s per rotation pulse

// This example only levels out the attitude, so the capsule ends up pointing at the station
// and then holds position. Making it dock is your task.
class Controller {
public:
    // Return the control inputs: x, y, z, roll, pitch, yaw thruster pulses.
    std::array<double, 6> update(const std::array<double, 12> &state, const std::array<double, 3> &commandedRates, long long dtMs) {
        std::array<double, 6> inputs{};
        sinceActionMs_ += dtMs;
        if (sinceActionMs_ < ACT_EVERY_MS) return inputs;
        sinceActionMs_ = 0;
        for (int i = 0; i < 3; i++) {
            // Aim for a rotation rate that brings the angle back toward 0, slowing as it gets close.
            double targetRate = std::max(-3.0, std::min(3.0, -0.25 * state[ROLL + i]));
            inputs[3 + i] = std::round((targetRate - commandedRates[i]) / ROTATION_PULSE);
        }
        return inputs;
    }

private:
    static const long long ACT_EVERY_MS = 500;  // act at most this often, so the effect of each burn is visible before the next
    long long sinceActionMs_ = ACT_EVERY_MS;
};

int main(int argc, char **argv) {
    try {
        if (argc < 2) {
            std::cerr << "Usage: autopilot <autopilot URL>   (printed by python -m hackathon.server)" << std::endl;
            return 1;
        }
        Client connection = connect(argv[1]);
        std::cout << "Waiting for a flight. Launch the flight in the browser." << std::endl;

        Controller controller;
        std::string flightId;
        long long timestampMs = 0, lastPrintMs = -1000000;
        for (;;) {
            Telemetry data = connection.requestTelemetry();
            if (flightId.empty()) {
                if (data.status == "offline") { std::cout << data.message << std::endl; sleepMs(2000); continue; }  // the simulator tab is not connected
                if (data.status != "flying") { sleepMs(50); continue; }
                flightId = data.flightId;
                timestampMs = data.timestampMs;
                std::cout << "Flight " << flightId << " started." << std::endl;
                continue;
            }

            // The flight is over: docked, failed, or replaced by a new one.
            if (data.status != "flying" || data.flightId != flightId) {
                if (data.docked) std::printf("Docked in %.1f s.\n", data.timestampMs / 1000.0);
                else std::cout << "Flight ended: " << (data.message.empty() ? data.status : data.message) << std::endl;
                break;
            }

            long long dt = data.timestampMs - timestampMs;
            if (dt == 0) { sleepMs(10); continue; }  // nothing new yet; wait briefly instead of flooding the server
            timestampMs = data.timestampMs;
            if (dt > STALE_MS) continue;

            const std::array<double, 12> &s = data.state;
            if (timestampMs - lastPrintMs >= 5000) {
                lastPrintMs = timestampMs;
                std::printf("t=%6.1fs  pos=(%6.1f,%5.1f,%5.1f) m  att=(%5.1f,%5.1f,%5.1f) deg\n", timestampMs / 1000.0,
                            s[X], s[Y], s[Z], s[ROLL], s[PITCH], s[YAW]);
            }
            std::array<double, 6> inputs = controller.update(s, data.commandedRates, dt);
            if (std::any_of(inputs.begin(), inputs.end(), [](double v) { return v != 0; })) {
                Reply reply = connection.sendControlInputs(inputs);
                if (!reply.ok) std::cout << "Control inputs were not applied: " << reply.error << std::endl;
            }
        }
    } catch (const Error &e) {
        std::cerr << e.what() << std::endl;
        return 1;
    }
    return 0;
}
