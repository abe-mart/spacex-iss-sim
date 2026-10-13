"""Expose the simulator to an AI agent on the same computer, with one command."""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent if (Path(__file__).resolve().parent / "dragon.py").exists() else Path(__file__).resolve().parent.parent))
from dragon import Dragon

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", required=True)
    parser.add_argument("--no-browser", action="store_true", help="Print the flight URL without opening it automatically")
    args = parser.parse_args()
    with Dragon.start_event(args.event, track="agent", wait=False, open_browser=not args.no_browser) as sim:
        print("LOCAL AGENT API: " + sim.url)
        print("TEMPORARY CONTROLLER TOKEN: " + sim.token)
        here = Path(__file__).resolve().parent
        guide = here / "AGENT_GUIDE.md"
        briefing = guide.read_text(encoding="utf-8").replace("{{API_URL}}", sim.url).replace("{{CONTROLLER_TOKEN}}", sim.token)
        connection = here / "AGENT_CONNECTION.md"
        connection.write_text(briefing, encoding="utf-8")
        print("AGENT BRIEFING: " + str(connection))
        print("Launch the flight, then use Copy agent briefing in the simulator or give this file to your agent.")
        print("Keep this terminal and simulator tab open. Ctrl+C stops the helper.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
