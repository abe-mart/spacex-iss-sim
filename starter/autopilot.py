"""Run the reference controller; edit examples/autopilot.py to build your own."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent if (Path(__file__).resolve().parent / "dragon.py").exists() else Path(__file__).resolve().parent.parent))
from examples.autopilot import main

if __name__ == "__main__":
    raise SystemExit(main())
