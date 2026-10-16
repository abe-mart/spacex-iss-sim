"""Start the local simulator server for the Autopilot and AI Agent challenges.

    python -m hackathon.server                    # Autopilot challenge
    python -m hackathon.server --track agent      # AI Agent challenge

The server opens the simulator in your browser and prints your autopilot URL. Keep it running while you
develop: you can stop, edit, and restart your autopilot as often as you like without restarting the server.
Your autopilot connects with hackathon.client.connect(URL), or with connect() and no URL, which reads the URL
this server saved to .hackathon_url. Launch each flight from the browser. Press Ctrl+C to stop the server.
"""

import argparse
import sys
import time
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
URL_FILE = PACKAGE_ROOT / ".hackathon_url"
DEFAULT_EVENT = "https://dock-the-capsule.netlify.app"

# event_bridge.py sits next to this package in the starter kit, and at the repository root during development.
for folder in (PACKAGE_ROOT, PACKAGE_ROOT.parent):
    if (folder / "event_bridge.py").is_file():
        sys.path.insert(0, str(folder))
        break
from event_bridge import EventBridge  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m hackathon.server", description="Start the local Dock the Capsule simulator server.")
    parser.add_argument("--track", choices=("autopilot", "agent"), default="autopilot", help="challenge to fly (default: autopilot)")
    parser.add_argument("--event", default=DEFAULT_EVENT, help="event website that records scores (default: %(default)s)")
    parser.add_argument("--port", type=int, default=0, help="local port (default: any free port)")
    parser.add_argument("--no-browser", action="store_true", help="print the simulator address instead of opening it")
    args = parser.parse_args(argv)

    bridge = EventBridge(args.event, track=args.track, open_browser=not args.no_browser, port=args.port)
    URL_FILE.write_text(bridge.autopilot_url + "\n", encoding="utf-8")
    print("Simulator:     " + bridge.page_url)
    print("Autopilot URL: " + bridge.autopilot_url)
    print()
    print("1. In the browser, log in, enter your crew name, and press LAUNCH FLIGHT.")
    print("2. Run your %s, for example: python %s" % (
        "agent" if args.track == "agent" else "autopilot", "agent_pilot.py" if args.track == "agent" else "autopilot.py"))
    print("Keep this terminal and the simulator tab open. Press Ctrl+C to stop the server.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        bridge.close()
        try:
            if URL_FILE.read_text(encoding="utf-8").strip() == bridge.autopilot_url:
                URL_FILE.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    main()
