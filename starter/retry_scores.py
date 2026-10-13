"""Retry saved event result receipts after a temporary upload failure."""
import json
from pathlib import Path
import urllib.request
import urllib.error

if __name__ == "__main__":
    receipts = Path(__file__).resolve().parent / ".dock-receipts"
    for file in receipts.glob("*.json"):
        receipt = json.loads(file.read_text(encoding="utf-8"))
        req = urllib.request.Request(receipt["event_url"].rstrip("/") + "/api/runs/" + receipt["id"] + "/finish",
                                     data=json.dumps(receipt["body"]).encode(),
                                     headers={"Authorization": "Bearer " + receipt["token"], "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20):
                print("Recorded: " + receipt["id"])
            file.unlink()
        except urllib.error.URLError:
            print("Still waiting: " + receipt["id"] + " (check connectivity or expired event session)")
