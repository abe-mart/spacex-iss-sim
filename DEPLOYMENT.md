# Dock the Capsule operations

The browser runs the simulation. Netlify Functions store event settings, sessions, and results in Neon. Python controllers run on participants' computers through the bundled loopback helper. Claude calls go directly from the browser to Anthropic with a participant's own key.

## Local development

Install Node.js 22 or newer and Python 3.11 or newer. Run `npm ci`, then `npm run dev`. Open http://127.0.0.1:8888. Development event data is kept in the ignored `.dock-data/event.json`; the development staff password defaults to `mission-control`. This fallback never runs in the deployed function.

Run `npm run check` and `npm run build` before deployment. The build generates the hosted pages and the downloadable Python starter ZIP in `dist/downloads`.

## Database and deployment

1. For this existing site, reuse its Neon project (Dock the Capsule); do not create another project. For a separate installation, create a free Neon Postgres project. Test `db/migrations/001_dock.sql` on an isolated branch before applying it to production.
2. Run `npm run db:migrate` with a **direct**, non-pooled `DATABASE_URL` injected into the process. The migration is idempotent. Keep connection strings out of Git and chat.
3. Generate a salted staff password hash with `node scripts/password.mjs`, supplying the password through standard input. Use a unique password of at least 12 characters.
4. In the Netlify project, configure server environment variables: pooled `DATABASE_URL`, `ADMIN_PASSWORD_HASH`, `SITE_URL`, and optional `EVENT_CODE`. Set them for the Functions runtime. The browser receives none of these secrets.
5. Link the checkout with `netlify link`, create a preview with `netlify deploy --build`, and verify the event API and staff login. Publish with `netlify deploy --build --prod` after verification.

## At the hackathon

- Open `/admin`, sign in, set the event name, event code, enabled tracks, and join URL. Share the site address and event code at the table.
- Put `/leaderboard` on the TV and click fullscreen. It displays Manual Piloting, Autopilot, and AI Agent in three columns on a wide screen. `/leaderboard?demo=1` is explicitly labeled sample data.
- New participants start at `/`. Manual practice needs no installation or API key. Python participants download and unzip the starter, open a terminal in its folder, and follow `/setup/autopilot/`.
- Successful flights rank by simulation time, then pulse count. Staff can exclude or restore results and export CSV. Results are client-reported with consistency checks; use staff review for disputed attempts.
- If a local score upload fails, use `retry_scores.py` from the starter bundle. Hosted attempts have a retry button and retain the pending result in the current tab.
- Close ranked entry in the admin panel after the event. Practice remains available. Monitor the Netlify and Neon usage dashboards during the event.

Windows loopback and browser flows have been exercised during development. macOS uses the same standard-library helper and `python3` commands, but still needs an actual device smoke test. Paid Claude requests require a participant key and are separate from the hosting setup.

## Netlify usage budget

Checked October 12, 2026: the team is on Free Legacy. The dashboard reported 724 MB of 100 GB bandwidth, 3 of 300 build minutes, and approximately 38K serverless requests across all projects this month. Official legacy documentation lists 125K serverless invocations per site/month. Other projects continue to consume their own allowances and shared bandwidth.

The simulator executes on the participant computer. Neither physics ticks, thruster commands, Python bridge polling, nor Claude calls consume Netlify function invocations. Hosted event joins, run creation, result submission, and standings reads do.

The leaderboard refreshes every 30 seconds, pauses when hidden, and stops after 12 hours until reloaded. Failures back off up to five minutes. Sample mode makes no API calls. Public standings are cached at Netlify's durable CDN for 30 seconds with separate assistance-filter and Origin keys. Private standings, admin data, credentials, write responses, and errors are not cached. Public score updates or changes to public visibility can take up to 60 seconds to appear on the display.

Planning estimate for an 8-hour event: 15 participants, 300 attempts, one TV, normal joins and retries = fewer than 5K function requests even without CDN savings. If all 15 participants also leave leaderboards open, budget fewer than 20K uncached function requests. Initial simulator assets total about 34 MB uncompressed and the starter ZIP is 19 MB. Allow 1–3 GB for the event including fresh loads and downloads; repeat attempts reset the simulation without redownloading assets. These are estimates, not guarantees against unexpected public traffic or unrelated team usage.

Use the Netlify team Usage & billing dashboard before the event. No paid plan, AI gateway, background jobs, scheduled functions, or automatic extra usage package was enabled for this app. Close the TV tab after the event. Free-plan hard limits can interrupt hosting, so review the team's current headroom if the event date is much later than this check.

AI Agent is the advanced local-agent track. Participants run `agent_bridge.py`, launch in the local simulator, and click Copy agent briefing. The briefing includes their actual loopback URL and temporary controller token; the helper also writes an ignored `AGENT_CONNECTION.md` file. Provider credentials belong to the participant’s agent. Hosted `/sim/?mode=agent` links redirect to the setup instructions. Manual CAPCOM retains optional browser BYOK coaching.

Flight timing: Manual Piloting and Autopilot run in real time. Event autopilots cannot issue pause/step, and the reference controller resumes the simulation and runs its feedback loop while physics continues. Only AI Agent uses pause/step. Hidden simulator tabs pause for reliability; keep the flight tab visible.

Participant navigation: Beginner opens Manual Piloting; Intermediate opens `/setup/autopilot/`; Advanced opens `/setup/agent/`. Python downloads live on the dedicated setup pages. `/docs` is a guide chooser, and legacy track hash links redirect to their dedicated page. The public TV leaderboard displays the event join code; staff changes update that display within its cache/refresh window.

Archive/reset: Staff enter an archive label and type ARCHIVE AND RESET in admin. All current flights and event settings are captured atomically before a new event ID is activated. Historic rows and immutable snapshots are retained. Late archived-event results cannot enter new standings. Settings and join code stay the same. Past event CSV downloads include excluded and unfinished attempts. Stop flying before resetting; TV caches can take 60 seconds to refresh.

## Git continuous deployment

Repository: `https://github.com/abe-mart/spacex-iss-sim`, production branch: `hackathon`.

Connection status: connected to the existing Netlify project `dock-the-capsule`. Production pushes/merges to `hackathon` build and publish automatically. Build command is `npm run build`, publish directory `dist`, functions directory `netlify/functions`; `netlify.toml` is authoritative. `.netlify/` remains ignored.

Use feature branches and pull requests into `hackathon`. Automatic Deploy Previews and branch deploys are disabled. Enable them only with an isolated Neon branch and separate credentials: a preview sharing production DATABASE_URL can change the live event. Local development needs no production credentials.
For an emergency manual release, run `npm run build`, then `netlify deploy --no-build --prod --dir dist --functions netlify/functions` from a linked checkout. After Git deployment is enabled, the next production-branch push replaces that manual release. Prefer fixing forward through Git.


Randomized starts: Each new event has one shared seeded starting position for all ranked attempts and all three tracks. Docking-axis distance stays 200 m; lateral offset stays 32 m while its direction varies. Attitude and initial velocity retain the standard conditions. Practice randomizes each launch. Existing events without a seed retain the old start so their scores stay comparable. Archive/reset generates a new seed and fresh standings. Participants must download the latest starter for seeded events; older clients are rejected. Scenarios are reproducible, not secret or cheat-proof.
