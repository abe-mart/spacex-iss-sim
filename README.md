# Dock the Capsule

[![Netlify Status](https://api.netlify.com/api/v1/badges/1d0f9407-ecea-43f8-8980-3345411c0293/deploy-status)](https://app.netlify.com/projects/dock-the-capsule/deploys)

A hackathon challenge in which participants dock a capsule with the International Space Station: by hand with AI coaching, with an autopilot they write, or with an AI agent they build. A shared leaderboard ranks each challenge, and event staff manage the event from an admin page.

**Live website:** [dock-the-capsule.netlify.app](https://dock-the-capsule.netlify.app/) · [TV leaderboard](https://dock-the-capsule.netlify.app/leaderboard)

## The three challenges

| Level | Challenge | How it works |
|---|---|---|
| Beginner | Manual Piloting | The participant flies in the hosted browser simulator. AI CAPCOM (Claude Haiku by default) coaches them by radio, using the event's API key. They can choose another model or fly without AI. |
| Intermediate | Autopilot | The participant writes a control loop in Python, C, or C++ that requests telemetry and sends thruster inputs to a simulator server on their own computer. |
| Advanced | AI Agent | The participant builds an AI agent that flies through the same interface. The starter kit includes an example in which Claude flies the capsule. |

All flights run in real time. Participants can test autopilots and agents at 2×, 4×, or 8× speed, but those flights are not ranked. The site is protected by a single event password, so participants need no API key or account of their own for the beginner challenge.

## Start developing

Install **Node.js 22+** and **Python 3.9+**, then:

```sh
git clone --branch hackathon https://github.com/abe-mart/spacex-iss-sim.git
cd spacex-iss-sim
npm ci
npm run dev
```

Open **http://127.0.0.1:8888**. The dev server builds the website and starter kit, then serves the pages and event API. Restart it after editing source files. Development data is saved to the ignored `.dock-data/event.json`, and the development staff password is `mission-control` (at `/admin`). Preview the TV layout at `/leaderboard?demo=1`.

The dev server reads these optional environment variables:

| Variable | Effect |
|---|---|
| `SITE_PASSWORD` | Requires this event password to use the site (production uses `SITE_PASSWORD_HASH`). |
| `ANTHROPIC_API_KEY` | Enables AI CAPCOM through the server. |
| `DAILY_BUDGET_USD` | Daily AI CAPCOM spending limit (default 25). |

Before submitting changes, run `npm run check` and `npm run build`. If Python is named `python3`, run `npm run typecheck`, `npm test`, and `python3 -m unittest discover -s tests -p test_event_bridge.py` instead.

To test the Autopilot or AI Agent challenge locally, unzip `dist/downloads/dock-the-capsule-starter.zip` and follow its README, adding `--event http://127.0.0.1:8888` to the `python -m hackathon.server` command.

## Architecture

| Component | Where it runs |
|---|---|
| Simulator physics | The participant's browser, for every challenge. |
| Website pages and starter kit | Netlify CDN (static files). |
| Event API: login, crew sessions, runs, results, leaderboard, admin | A Netlify Function (`netlify/functions/api.mts` → `src/server/app.ts`), storing data in Neon Postgres. |
| AI CAPCOM | The same Netlify Function calls the Claude API with the event's key (`src/server/capcom.ts`). Browsers never see the key or contact Anthropic directly. |
| Simulator server for Autopilot and AI Agent | The participant's computer (`python -m hackathon.server`, built on `event_bridge.py`). It serves a local copy of the simulator and relays telemetry and thruster commands. Flight traffic never goes through Netlify. |
| Participant autopilots and agents | The participant's computer, using `hackathon.client` or the C/C++ headers. |

When a ranked flight ends, the browser submits the result to the event API, which checks it for consistency, including that the flight clock did not run ahead of real time.

| Path | Purpose |
|---|---|
| `web/`, `src/web/` | Pages, styles, login gate, flight panel, setup guides, leaderboard, and admin |
| `src/server/` | Event API, authentication, validation, AI CAPCOM, and storage |
| `netlify/functions/api.mts` | Netlify adapter for the event API |
| `db/migrations/` | Neon schema |
| `event_bridge.py`, `server.py`, `dragon.py` | Local simulator server and the low-level Python client |
| `starter/` | Participant kit: `hackathon` package, C/C++ headers, examples, and `API.md` |
| `iss-sim.spacex.com/` | Simulator, scene assets, and in-browser control API |
| `scripts/`, `tests/` | Build and development tools, and tests |

The participant API reference is [starter/API.md](starter/API.md), shipped as `API.md` in the starter kit. The root [API.md](API.md) and [LEGACY_SIMULATOR.md](LEGACY_SIMULATOR.md) describe the original standalone server, and the `hackathon/` folder holds an earlier version of the event app that is no longer deployed.

## Collaborating and deploying

The integration branch is `hackathon` in **abe-mart/spacex-iss-sim**. Create a feature branch, run the checks, and open a pull request into `hackathon`. Netlify builds and publishes every push to `hackathon` automatically, so merge reviewed changes deliberately. Other branches get branch deploys at `https://<branch-name>--dock-the-capsule.netlify.app`. Branch deploys currently share the production database and environment variables, so test flights on a branch deploy appear on the live leaderboard; archive and reset the event before it starts.

Production secrets live in Netlify's environment variables, never in Git. See [DEPLOYMENT.md](DEPLOYMENT.md) for configuration, event operations, and usage estimates.

The underlying simulator is SpaceX's work. This repository hosts and adapts an offline copy.
