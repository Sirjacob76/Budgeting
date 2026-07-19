# Float — guilt-free budgeting

A local, private budgeting app. Tell it your **income** and **recurring bills**, and it
tells you whether you're over- or under-paying, what to cancel to get back in the black,
and whether your **car** is affordable (with real refinance/trade-down math). Then it turns
your leftover money into one number: **what you can guilt-free spend today.**

Pure Python standard library — no `pip install`, no Node, no accounts. Your data never
leaves your machine (it lives in `data.json` next to `server.py`).

## Run it

```
cd budget-app
python server.py
```

Then open **http://localhost:8000**. Press `Ctrl+C` to stop.

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

## Files

```
budget-app/
  server.py            # API + financial math (stdlib http.server)
  data.json            # your data (created on first save)
  static/
    index.html         # UI
    styles.css         # styling
    app.js             # front-end logic
```
