# Monthly Planner for Teamwork

A free, open-source tool that replaces spreadsheet-based monthly task planning for agencies using Teamwork.

Pulls your retainer tasks from Teamwork, lets you edit them in a meeting-friendly grid (per-client cards, editable hours / assignees / dates, team utilisation summary, bulk actions), then pushes next month's plan back as fresh tasks.

**Your data stays yours.** Your Teamwork API key lives in your browser. The deployed app's proxy doesn't store, log, or persist it.

---

## What you need

- A Teamwork account with API access
- A free [Vercel account](https://vercel.com/signup) (deploys the app)
- A free [GitHub account](https://github.com/signup) (hosts the code Vercel deploys)

That's it. No Cloudflare, no Supabase, no installs, no terminal commands.

---

## Setup (about 5 minutes)

### 1. Fork this repo to GitHub

Click the **Fork** button at the top right of this page. You get your own copy of the code on GitHub.

(If you don't have an account yet, sign up at https://github.com/signup first — takes 60 seconds.)

### 2. Deploy to Vercel

1. Go to **https://vercel.com/new**
2. Sign in with your GitHub account if prompted
3. Find your forked `monthly-planner` repo, click **Import**
4. **Important:** in the "Root Directory" field, click "Edit" and select the `web` folder
5. Click **Deploy**

Wait ~60 seconds. Vercel gives you a URL like `https://monthly-planner-yourname.vercel.app`.

### 3. Open the app and configure Teamwork

Open your Vercel URL. You'll see a Settings screen asking for two things:

1. **Teamwork site** — your Teamwork hostname (e.g. `yourcompany.teamwork.com`), without the `https://`
2. **Teamwork API key** — get this from Teamwork:
   - Click your avatar (top right in Teamwork) → **Edit my details**
   - Click **API & Mobile** on the left sidebar
   - Under **API Keys**, copy your existing key or click **Generate token**

Click **Test connection** to check it works (should show your name in green). Then **Save & continue**.

That's it. Bookmark the URL. Use it monthly.

---

## How to use

### Monthly planning meeting

1. Open the bookmarked URL
2. Pick the source month (defaults to current month)
3. Click **Load tasks** — pulls last month's tasks across every active project
4. In the meeting: edit hours, assignees, add/remove tasks per client
5. Click **Push to Teamwork** at the bottom — creates the tasks for next month

The grid edits save to your browser as you work, so a refresh won't lose progress.

### Features for the meeting

- **Search** — type in the search box to filter tasks or clients
- **Filter by person** — click a name in the utilisation bar to see only their tasks
- **Bulk actions** (appear when filters/search are active):
  - Reassign all visible tasks to one person (e.g. "Lauren's on holiday — reassign to Mel")
  - Add an assignee to all visible tasks
  - Shift all dates by ±N days
  - Remove zero-estimate tasks in bulk
  - Select / deselect all visible
- **Keyboard nav** — in the minutes field, hit Enter or ↓ to jump to the next row's minutes; ↑ for previous; text auto-selects so you can just type to replace
- **Add client mid-meeting** — "+ Add client" button picks any active project, even ones that weren't in last month's plan
- **Compare to previous month** — each client card shows the delta vs the month before source (green = down, amber = up >15%)
- **Custom target month** — tick "Custom target" to plan a non-adjacent month
- **Hide unselected** — quickly hide tasks you've already decided not to push
- **Recent pushes** — collapsible history with click-through to past results
- **Double-push protection** — warns if you've already pushed to this target month

### What gets pulled

Every task from every active project in the source month. Including tasks marked complete and tasks in completed tasklists (which Teamwork's default API filters out — we use the right magic flags).

### What gets pushed

Every selected task with a name. Dates shift forward by one month from source.

---

## Privacy

- Your Teamwork API key lives only in your browser's localStorage and the `x-tw-key` header on requests through your own `/api/proxy` endpoint
- The proxy is a stateless Vercel Edge Function — see `web/api/proxy.ts` (35 lines, no logging, no storage)
- No analytics, no telemetry, no cookies
- If you don't trust the proxy code, read the source — it's tiny

---

## Troubleshooting

### "Load tasks" fails

Most likely the Teamwork API key is wrong or your Teamwork site URL is wrong. Open Settings, click "Test connection". If it fails, regenerate the API key in Teamwork and try again.

### Pushing is slow

Each task takes ~200ms — 300 tasks ≈ 60 seconds. The progress bar at the bottom shows live status. Don't refresh during a push.

### A push fails partway through

Open the run results dialog (auto-appears, or from Recent Pushes panel). Successes already exist in Teamwork. Failures can be downloaded as CSV. The draft is preserved so you can manually re-tick the failed rows and push again.

### Some tasks are missing on load

The tool fetches up to ~5,000 tasks per month. If you genuinely have more, increase the page limit in `web/src/lib/teamwork.ts` (the `page <= 10` check).

### "I already pushed this month and now there are duplicates"

The tool warns you if you push to a month that already has a successful run on record. If you bypassed the warning, you'd need to manually delete duplicates in Teamwork.

---

## Licence

MIT. Do whatever.

## Credits

Built originally for [Hummingbird](https://hummingbird.agency), then extracted as a standalone tool because most agencies have the same problem.
