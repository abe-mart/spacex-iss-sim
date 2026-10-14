# Dock the Capsule

[![Netlify Status](https://api.netlify.com/api/v1/badges/1d0f9407-ecea-43f8-8980-3345411c0293/deploy-status)](https://app.netlify.com/projects/dock-the-capsule/deploys)

A laptop hackathon challenge: dock a capsule with manual controls, a Python autopilot, or your own AI agent. Participants share a three-column leaderboard; staff manage the event, review results, and archive finished events.

**Live website:** [dock-the-capsule.netlify.app](https://dock-the-capsule.netlify.app/) · [TV leaderboard](https://dock-the-capsule.netlify.app/leaderboard)

## The three tracks

| Level | Track | How it runs |
|---|---|---|
| Beginner | Manual Piloting | Hosted browser simulator, real time. Optional CAPCOM coaching uses the participant's own Claude key. |
| Intermediate | Build Your Autopilot | Python controller and bundled simulator on the participant's computer, real time. Pause/step is disabled. |
| Advanced | AI Agent | Participant's own local agent controls the bundled simulator over HTTP, with pause/step for turn-based flying. |

Participants choose a track on the website. Each has dedicated instructions: [Manual](https://dock-the-capsule.netlify.app/setup/manual/), [Autopilot](https://dock-the-capsule.netlify.app/setup/autopilot/), and [AI Agent](https://dock-the-capsule.netlify.app/setup/agent/). The latter two provide the complete starter ZIP and API reference. No pip dependencies are required. Copy the agent briefing from the local flight screen after launch.

## Start developing

Install **Node.js 22+** and **Python 3.11+**. Clone the event branch from our fork:

```sh
git clone --branch hackathon https://github.com/abe-mart/spacex-iss-sim.git
cd spacex-iss-sim
npm ci
npm run dev
```

Open **http://127.0.0.1:8888**. This builds the website and starter ZIP, then serves the pages and event API. Restart after source edits; there is no hot reload.

No cloud credentials are needed. Development event data is saved to ignored `.dock-data/event.json`. The **local development only** staff password is `mission-control`, at `/admin`. Preview the TV layout at `/leaderboard?demo=1` with labeled sample data.

Before submitting changes:

```sh
npm run check
npm run build
```

If Python is named `python3` on your Mac, replace `npm run check` with:

```sh
npm run typecheck
npm test
python3 -m unittest discover -s tests -p test_event_bridge.py
```

The build generates `dist/`, including the downloadable starter. Do not edit or commit generated files. To test a Python track locally, unzip the generated starter from `dist/downloads/` and follow its README, substituting `http://127.0.0.1:8888` for the hosted event URL. Windows can use `py`; macOS can use `python3`. Keep the simulator tab visible while flying.

## Architecture

Physics runs in the participant's **browser**, including hosted manual flights. Netlify serves static assets and handles event joins, sessions, run creation, score submission, and standings. Neon Postgres persists shared event data. Physics ticks and thruster commands never go through Netlify Functions.

For Autopilot and AI Agent, the Python helper serves a local copy of the website and relays commands/state over a paired, token-protected loopback API. The controller and simulator run on the same computer. Results upload to the hosted event leaderboard. Remote cloud agents cannot directly reach this loopback address.

Optional manual CAPCOM requests go directly from the browser to Anthropic using the participant's key, held in memory. Advanced participants supply their own agent and provider configuration.

| Path | Purpose |
|---|---|
| `web/`, `src/web/` | Pages, styling, browser flight integration, setup guides, leaderboard and admin |
| `src/server/` | Event API, authentication, validation and storage |
| `netlify/functions/api.mts` | Netlify adapter for the event API |
| `db/migrations/` | Neon schema migrations |
| `event_bridge.py`, `dragon.py` | Local helper and Python simulator client |
| `starter/` | Participant launchers, agent guide and current API reference |
| `iss-sim.spacex.com/` | Simulator, scene assets and in-browser control API |
| `scripts/`, `tests/` | Build/development tools and regression tests |

**Current participant API: [starter/API.md](starter/API.md)**, included as `API.md` in the ZIP. The root [API.md](API.md) and [LEGACY_SIMULATOR.md](LEGACY_SIMULATOR.md) describe the older standalone server. The old `hackathon/` challenges are historical and are not the current hosted app.

## Collaborating and deploying

Use `hackathon` as the integration branch in **abe-mart/spacex-iss-sim**. Create a feature branch, make changes, run checks/build, and open a pull request into `hackathon`. The original upstream repository is separate from this event fork.

Netlify's connected production target is this fork's `hackathon` branch: `npm run build`, publish directory `dist`, functions in `netlify/functions`, configured in [netlify.toml](netlify.toml). Pushes and merges to `hackathon` automatically build and publish. Automatic PR previews and branch deploys are disabled to keep preview code away from the live event database. See [DEPLOYMENT.md](DEPLOYMENT.md) for operations. Production pushes affect the live event, so merge reviewed changes deliberately.

GitHub access is enough to develop locally. Netlify and Neon access is only needed for production administration. Keep database URLs, staff credentials, provider keys, bridge tokens and score receipts out of Git. `.netlify/`, `.env` files, `.dock-data/` and participant receipts are ignored. Production secrets stay in Netlify's server environment; request access from the project owner instead of copying credentials into documentation.

Test database changes on an isolated Neon branch. Never use the live event for destructive tests. Staff archive/reset preserves a snapshot and starts fresh standings; late archived-event results are rejected.

See [DEPLOYMENT.md](DEPLOYMENT.md) for migrations, runtime variables, event operations, archive/reset and hosting usage estimates. Scores are client-reported with consistency checks; staff review disputed results. Windows has been exercised; an actual macOS smoke test remains useful before the event.

The underlying simulator is SpaceX's work. This repository hosts and adapts an offline copy.


Ranked starting positions are shared within an event, generated when the event is created or archived/reset. Practice starts vary on each launch. Read telemetry rather than hardcoding the original starting coordinates; see [DEPLOYMENT.md](DEPLOYMENT.md) for compatibility with existing events.

Optional [Challenge Mode](https://dock-the-capsule.netlify.app/challenges/) extends local Autopilot and AI Agent with noisy measurements, a broken thruster, or scrambled translation inputs. Players choose the scenario before launch. Each scenario has separate standings, a shared event seed, and documented telemetry behavior in the starter API reference.

Faster testing is available under Practice & testing speed in the flight panel (1×, 2×, 4×, 8×). It affects unranked practice only; ranked physics stays at 1×. The hackathon ZIP includes a runnable controls/sensors tour in `examples/autopilot.py`, not the maintainer's complete docking controller. It opens the local flight deck, waits for practice launch, prints telemetry, makes small visible lateral/rotation movements, and keeps the helper alive after the tour. Build your own controller in that file.
