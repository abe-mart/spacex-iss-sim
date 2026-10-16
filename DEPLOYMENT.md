# Dock the Capsule operations

The browser runs the simulation. A Netlify Function handles logins, crew sessions, results, the leaderboard, and AI CAPCOM, and stores event data in Neon Postgres. Autopilots and agents run on participants' computers and connect to a local simulator server from the starter kit.

## Local development

Install Node.js 22 or newer and Python 3.9 or newer. Run `npm ci`, then `npm run dev`, and open http://127.0.0.1:8888. Development data is kept in the ignored `.dock-data/event.json`, and the development staff password is `mission-control`. This fallback never runs in the deployed function. Set `SITE_PASSWORD` and `ANTHROPIC_API_KEY` in the environment to test the login and AI CAPCOM locally.

Run `npm run check` and `npm run build` before deploying. The build generates the hosted pages and the downloadable starter kit in `dist/downloads`.

## Configuration

All secrets are Netlify environment variables. None are stored in Git, and none are sent to browsers.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled Neon connection string. |
| `ADMIN_PASSWORD_HASH` | scrypt hash of the staff password for `/admin`. |
| `SITE_PASSWORD_HASH` | scrypt hash of the event password that participants enter. When it is set, the site requires a login. |
| `ANTHROPIC_KEY` (or `ANTHROPIC_API_KEY`) | The event's Claude API key, used only by the Netlify Function for AI CAPCOM. The production project stores it as `ANTHROPIC_KEY`. AI CAPCOM stays disabled unless `SITE_PASSWORD_HASH` is also set. |
| `DAILY_BUDGET_USD` | Optional daily AI CAPCOM spending limit in US dollars (default 25). |
| `SITE_URL` | Public site address, for example `https://dock-the-capsule.netlify.app`. |

### Setting the event password and Claude API key

1. **Create the API key.** In the [Claude Console](https://platform.claude.com), create a dedicated API key for the event. A separate workspace with a monthly spend limit adds a second safeguard alongside `DAILY_BUDGET_USD`.
2. **Hash the event password.** In the repository, run:
   ```sh
   printf '%s' 'your-event-password' | node scripts/password.mjs
   ```
   The password must be at least 12 characters. The command prints a value that starts with `scrypt$`. Only this hash is stored in Netlify; keep the password itself to share with participants at the event.
3. **Add the variables in Netlify.** Open the `dock-the-capsule` project, go to **Project configuration → Environment variables**, and choose **Add a variable** for each of `SITE_PASSWORD_HASH`, `ANTHROPIC_KEY`, and optionally `DAILY_BUDGET_USD`. For `ANTHROPIC_KEY`, select **Contains secret values**. Limit the scope to **Functions**, and set the value for the **Production** deploy context (and for any branch deploy you use for testing).

   With the Netlify CLI in a linked checkout, the equivalent is:
   ```sh
   netlify env:set SITE_PASSWORD_HASH 'scrypt$…' --context production
   netlify env:set ANTHROPIC_KEY 'sk-ant-…' --secret --context production
   netlify env:set DAILY_BUDGET_USD 25 --context production
   ```
4. **Redeploy.** Functions read environment variables at deploy time, so trigger a new deploy (**Deploys → Trigger deploy → Deploy project**) after changing them.
5. **Verify.** Open the site in a private window. It should ask for the event password. After logging in, open **Manual Piloting**: the AI CAPCOM menu should list the Claude models with Haiku selected, and CAPCOM should speak shortly after launch.

### Database

1. Reuse the existing Neon project for this site. Test migrations on an isolated Neon branch before applying them to production.
2. Run `npm run db:migrate` with a direct (non-pooled) `DATABASE_URL` in the environment. The migration is idempotent.
3. Generate the staff password hash the same way as the event password, and set `ADMIN_PASSWORD_HASH`.

## At the hackathon

- Share the site address and the event password. Participants log in once per browser; sessions last eight hours.
- Open `/admin`, sign in, and set the event name and enabled tracks.
- Put `/leaderboard` on the TV and click fullscreen. It shows Manual Piloting, Autopilot, and AI Agent in three columns. `/leaderboard?demo=1` shows labeled sample data.
- Beginners open Manual Piloting and fly with AI CAPCOM; no installation is needed. Autopilot and AI Agent participants download the starter kit from their setup page and run `python -m hackathon.server`.
- Successful real-time flights are ranked by simulation time, then pulse count. Staff can exclude or restore results and export CSV files. Results are reported by the browser and checked for consistency; review disputed attempts.
- If a score upload fails, participants can use **Retry score upload** or `retry_scores.py`.
- After the event, close the event in the admin page and monitor the Netlify, Neon, and Anthropic usage dashboards.

## AI CAPCOM

The flight panel calls `POST /api/capcom` about every 15 seconds during a manual flight, and whenever the participant sends a radio message. The Netlify Function checks the session, applies a per-session rate limit (30 calls per minute) and the daily spending limit, and calls the Claude API with a fixed system prompt. Participants can choose Claude Haiku 5.5 (default), Sonnet 5.5, or Opus 5.5, or fly without AI CAPCOM. A Haiku call costs well under a cent, so a typical event costs a few dollars. Each call is limited to 8 seconds so that it finishes within Netlify's function time limit.

## Flight timing and test speeds

All flights run in real time; the simulator never pauses for an autopilot or agent. Hidden simulator tabs pause and resume when they become visible again. In the Autopilot and AI Agent tracks, participants can choose 2×, 4×, or 8× speed for test flights. Test flights are never submitted, and the event API rejects any result whose flight clock is more than 30 seconds ahead of the wall-clock time since launch.

## Netlify usage

Checked October 12, 2026: the team is on Free Legacy, which lists 125K serverless invocations per site per month. The dashboard reported 724 MB of 100 GB bandwidth, 3 of 300 build minutes, and about 38K serverless requests across all projects that month.

Physics, thruster commands, and the local simulator server's traffic never reach Netlify. Logins, joins, run creation, results, leaderboard reads, and AI CAPCOM calls do. For an 8-hour event with 15 participants, 300 attempts, and one TV, expect fewer than 5K requests for event traffic, plus about 4 requests per minute for each manual flight with AI CAPCOM (roughly 10K for the event). The simulator assets total about 34 MB and the starter kit about 19 MB; allow 1–3 GB of bandwidth.

The leaderboard refreshes every 30 seconds, pauses while hidden, and stops after 12 hours until reloaded. Public standings are cached at Netlify's CDN for 30 seconds, so new results can take up to 60 seconds to appear on the TV.

## Archive and reset

Staff enter an archive label and type ARCHIVE AND RESET in the admin page. All current flights and settings are saved atomically before a new event starts with a new shared starting position. Results from flights launched in the archived event are rejected. Ask participants to stop flying before resetting.

## Starting positions and Challenge Mode

Each event has one seeded starting position shared by all ranked attempts in every track. The docking-axis distance stays at 200 m and the lateral offset at 32 m, while its direction varies. Test flights use a random start. Archive and reset generates a new seed.

Challenge Mode (noisy instruments, a broken thruster, or scrambled controls) is optional for the Autopilot and AI Agent tracks. Each mission has its own standings (`/leaderboard?challenge=noise`, `broken`, or `scrambled`), and docking is judged on the true state.

## Git continuous deployment

Repository: `https://github.com/abe-mart/spacex-iss-sim`, production branch `hackathon`. Netlify builds and publishes every push to `hackathon` using `netlify.toml` (`npm run build`, publish directory `dist`, functions in `netlify/functions`).

Use feature branches and pull requests into `hackathon`. Each pushed branch gets a branch deploy at `https://<branch-name>--dock-the-capsule.netlify.app`; test there before merging. Branch deploys currently share the production `DATABASE_URL` and other variables, so flights flown on a branch deploy are recorded in the live event. Archive and reset the event before it starts, and avoid testing on branch deploys during the event. To isolate them, create a Neon branch and set a different `DATABASE_URL` for the branch-deploy context. For an emergency manual release, run `npm run build`, then `netlify deploy --no-build --prod --dir dist --functions netlify/functions` from a linked checkout.
