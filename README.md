# Float — guilt-free budgeting

A private budgeting app. Tell it your **income** and **recurring bills**, and it tells you
whether you're over- or under-paying, what to cancel to get back in the black, and whether your
**car** is affordable (with real refinance/trade-down math). Then it turns your leftover money
into one number: **what you can guilt-free spend today.**

Float is a **native Android app**. It runs **fully on-device** — no account, no login, no
server, works offline. All your budget data stays in your phone's storage; nothing is uploaded
and no personal information is collected. (The only optional network call is receipt scanning,
which sends a photo to Google Gemini using *your* key — see below.)

## Get the app on your phone

The app is the web UI wrapped with **Capacitor** into a real Android package. You never build
anything locally — a **GitHub Actions** workflow builds the APK in the cloud:

1. Push to `main` (the auto-sync hook already does this), or trigger it manually:
   repo → **Actions** tab → **Build Android APK** → *Run workflow*.
2. When the run finishes (green check, ~3–5 min), open it and download the
   **`float-android-apk`** artifact (a `.zip` containing `app-debug.apk`).
3. Get the APK onto your phone (email/Drive/USB). Tap it to install — Android asks you to allow
   *install from unknown sources* the first time (normal for apps not from the Play Store).
4. Open **Float** from your app drawer. It's a real app now.

> This is a debug build, signed with a standard debug key — perfect for testing on your own
> device. A signed release build (for Play Store distribution, a one-time $25) is a later step.

## Preview on your PC (optional)

The whole app is client-side, so any static server works:

```
cd budget-app
python server.py     # then open http://localhost:8000
```

`server.py` is just a convenience file server for local preview; the app itself runs entirely
in the browser via [`static/engine.js`](static/engine.js).

## What's inside

| Tab | What it does |
|-----|--------------|
| **Today** | Your guilt-free daily allowance (income − bills − savings, split over the days left, with unspent money rolling into tomorrow). Budget verdict + cancel recommendations. A **"where your money goes" pie chart**. Streak tracker. Quick-log a purchase. |
| **Income & Bills** | Enter income, **fixed** recurring bills (with a **due day** and **autopay** flag), **variable** bills (electric, gas — a typical amount plus an optional low–high range), and automated savings goals. A **"Your plan" panel** shows exactly what's **left after bills**, how much to **put back (save)**, and what you're **free to spend** — plus recommendations based on the 50/30/20 rule (flags bills running over ~50% of income, nudges savings toward 20%). Mark a bill (a car loan, a credit card) **paid off** with the 🏁 button — Float **celebrates** with confetti and drops it from every total, so your free-to-spend jumps. |
| **Get out of debt** | List what you owe (balances, optional min payments + APR) and Float builds a payoff plan — ordered **smallest balance first** (the snowball method) so you know exactly what to attack first, rolling each cleared payment into the next. Add minimums to get a **debt-free date** and total interest, with a snowball-vs-avalanche comparison. Your car loan is folded in automatically. |
| **Can I afford it?** | Type in something you want to buy and its price — Float gives a straight **yes / tight / no** against the money you have free to spend this month, and can log the purchase if you go for it. |
| **Plan** | Set your **payday schedule** (weekly / biweekly / twice-a-month / monthly) and Float builds a **paycheck-by-paycheck plan** — which bills to cover from each check and what's left over. Plus **bill reminders**: on the phone it sends a notification the day before each non-autopay bill is due. |
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
- **Payment plan** finds your paydays for the month, then assigns each bill to the last paycheck
  that arrives before its due date (bills due before your first check are flagged as "cover from
  last paycheck"). Per-check net pay is derived from your monthly income and pay frequency.
- **Notifications** use Capacitor Local Notifications on Android — scheduled for 9am the day
  before each non-autopay bill's due date. In a desktop browser they fall back to the Web
  Notifications API for a preview.

The look is a **neumorphic (soft-UI) theme** — one background color with paired light/dark
shadows for a soft 3D feel — with a **light/dark mode slider** in the top bar (remembers your
choice, defaults to your device preference). The layout is **phone-first**: navigation lives in a **hamburger drawer**,
form controls go full-width, categories are picked from **icon chips**, and bills render as
reflowing cards (no cramped tables).

The **app icon** is generated by [`make_icons.py`](make_icons.py) (pure stdlib → `assets/*.png`),
which `@capacitor/assets` turns into Android launcher icons during the build.

## Receipt OCR (Google Gemini)

The Receipts tab reads photos with **Google Gemini's free tier**. Open the *AI reading* settings
on that tab, paste a free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey),
and Save. Then any receipt photo is auto-itemized into editable line items across categories.

- **Privacy:** the key and photo go **straight from your phone to Google** — nothing passes
  through any server of ours (there is no server), and the key is stored only on your device.
- **Fallback:** no key / no photo? Paste receipt text and hit *Itemize pasted text* — a built-in
  parser splits it up. The AI call lives in `readReceiptWithAI()` in `static/app.js`.

## Auto-sync to GitHub

This project auto-commits and pushes to **github.com/Sirjacob76/Budgeting** whenever a Claude
Code turn ends and there are changes — a `Stop` hook (in the parent `.claude/settings.local.json`)
that runs [`.claude/auto-push.sh`](.claude/auto-push.sh). Each push also kicks off the Android
build. Manage or disable it from the `/hooks` menu.

## Files

```
budget-app/
  static/
    index.html         # UI
    styles.css         # styling
    app.js             # front-end logic (calls the local engine)
    engine.js          # on-device budget engine: all logic + localStorage (the whole "backend")
  capacitor.config.json  # Capacitor app config (appId, name, webDir)
  package.json           # Capacitor dependencies
  .github/workflows/
    android.yml          # cloud build -> downloadable APK
  test-harness.html      # in-browser tests for the engine's math
  server.py              # optional local preview server (stdlib)
  data.json              # only used by server.py; gitignored
```

The app has **no backend** — `static/engine.js` runs all the budget math and stores state in the
device's `localStorage`. `test-harness.html` asserts that math against known values.
