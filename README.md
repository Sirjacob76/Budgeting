# Float — guilt-free budgeting

A local, private budgeting app. Tell it your **income** and **recurring bills**, and it
tells you whether you're over- or under-paying, what to cancel to get back in the black,
and whether your **car** is affordable (with real refinance/trade-down math). Then it turns
your leftover money into one number: **what you can guilt-free spend today.**

It runs two ways:

- **On your phone, always-on** — hosted free on **Cloudflare Workers** (see *Deploy to Cloudflare* below).
- **Locally on your PC** — a zero-dependency Python server for offline/dev use.

## Run it locally

```
cd budget-app
python server.py
```

Then open **http://localhost:8000**. Press `Ctrl+C` to stop. Local mode stores data in
`data.json` next to `server.py` and needs no login.

## Deploy to Cloudflare (always-on, on your phone)

The same app runs as a Cloudflare Worker: the backend is [`src/index.js`](src/index.js), your
data lives in a Cloudflare **KV** namespace, and the frontend is served from `static/`. It's
free, always-on (no sleep), and auto-deploys every time we push to GitHub. Your Gemini receipt
key still lives only in your phone's browser.

**One-time setup (all in the Cloudflare dashboard — no installs on your machine):**

1. **Create a free Cloudflare account** at dash.cloudflare.com (no credit card for the free tier).
2. **Create the storage:** Storage & Databases → **KV** → *Create namespace* → name it `float-state`.
   Copy the **Namespace ID** it gives you and paste it into [`wrangler.toml`](wrangler.toml)
   (replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`).
3. **Connect the repo:** Workers & Pages → **Create** → *Import a repository* → pick
   `Sirjacob76/Budgeting`. Cloudflare reads `wrangler.toml` and deploys.
4. **Set your password:** on the new Worker → Settings → **Variables and secrets** → add a
   **Secret** named `APP_PASSWORD` with the password you want → redeploy. (It's write-only —
   nobody, including this project, can read it back.)
5. Open your `*.workers.dev` URL, log in, and you're live. On your phone, add the app to your
   home screen for an app-like icon.

After this, every `git push` (including the auto-sync hook) redeploys automatically.

> **Security:** all `/api` routes require the password; the login mints a signed, HttpOnly
> session cookie. Without `APP_PASSWORD` set, the app stays locked. `data.json` is only used by
> the local Python server and is gitignored — it's never uploaded.

## What's inside

| Tab | What it does |
|-----|--------------|
| **Today** | Your guilt-free daily allowance (income − bills − savings, split over the days left, with unspent money rolling into tomorrow). Budget verdict + cancel recommendations. Streak tracker. Quick-log a purchase. |
| **Income & Bills** | Enter income, recurring bills (flag the cancellable ones), and automated savings goals. |
| **Car** | Affordability verdict vs. the ~15%-of-income guideline, plus tailored options: refinance, extend the term, or sell/trade — with an underwater warning if you owe more than it's worth. |
| **Receipts** | Snap/upload a receipt photo and **Google Gemini reads it automatically** — splitting one purchase into editable line items across categories — or paste text as a fallback. Save them all to spending in one shot. |
| **Micro-funds** | Spin up a one-off event fund ("Sarah's Bachelorette"), fund it by redirecting from your daily allowance, archive it when it's over so your core budget stays clean. |
| **Sandbox** | Model a hypothetical loan ("$30k car @ 7% for 5 years") and *feel* how much it shrinks your daily allowance — every day — before you sign. |

## How the numbers work

- **Fixed costs** = recurring bills + car payment + automated savings.
- **Free to spend / month** = income − fixed costs. If negative → you're overpaying, and Float
  suggests the smallest set of *cancellable* bills that closes the gap.
- **Daily allowance** = money still unspent this month ÷ days left in the month. Skip a day and
  the leftover rolls forward, so tomorrow's number goes up.
- **Streak** counts consecutive days you stayed under a flat daily target. Float praises streaks
  and stays quiet on overspend days — building, not nagging.
- **Car** uses standard loan amortization to model refinance/extend scenarios.

## Receipt OCR (Google Gemini)

The Receipts tab reads photos with **Google Gemini's free tier**. Open the *AI reading* settings
on that tab, paste a free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey),
and Save. Then any receipt photo is auto-itemized into editable line items across categories.

- **Privacy:** the key and the photo go **straight from your browser to Google** — they never
  pass through the Python server, and the key is stored only in your browser's `localStorage`.
  **No API key is ever written to a file or committed to this repo.**
- **Fallback:** no key / no photo? Paste receipt text and hit *Itemize pasted text* — a built-in
  parser splits it up. The AI call lives in `readReceiptWithAI()` in `static/app.js`.
- Email-receipt import (IMAP/OAuth) is still on the roadmap; photo + paste cover the day-to-day.

## Auto-sync to GitHub

This project auto-commits and pushes to **github.com/Sirjacob76/Budgeting** whenever a Claude
Code turn ends and there are changes. It's a `Stop` hook (in the parent
`.claude/settings.local.json`) that runs [`.claude/auto-push.sh`](.claude/auto-push.sh):

- Only commits when `budget-app` actually has changes — no empty commits, and turns that touch
  other projects are ignored.
- `data.json` stays gitignored, so personal financial data is never pushed.
- If you're offline, it commits locally and pushes on the next change.

Manage or disable it anytime from the `/hooks` menu in Claude Code.

## Files

```
budget-app/
  src/
    index.js           # Cloudflare Worker: API, auth, budget math (production backend)
  wrangler.toml        # Cloudflare config (KV binding, static assets)
  package.json         # deploy metadata
  server.py            # local dev backend (stdlib http.server, file storage)
  data.json            # local-only data (gitignored)
  test-harness.html    # in-browser parity tests: JS Worker vs Python backend
  static/
    index.html         # UI (shared by both backends)
    styles.css         # styling
    app.js             # front-end logic
```

The Worker (`src/index.js`) and the local server (`server.py`) implement the identical API and
budget math; `test-harness.html` asserts they produce the same numbers.
