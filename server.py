"""
Float — a guilt-free budgeting app.

Pure Python standard library. No external dependencies.

Run:  python server.py
Then open http://localhost:8000 in your browser.

Data is stored in data.json next to this file.
"""

import json
import os
import calendar
import datetime
import uuid
import http.server
import socketserver
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(HERE, "static")
DATA_FILE = os.path.join(HERE, "data.json")
PORT = 8000

# --------------------------------------------------------------------------- #
# Storage
# --------------------------------------------------------------------------- #

DEFAULT_STATE = {
    "income": {"monthly": 0.0},
    "bills": [],           # {id, name, amount, category, cancellable}
    "car": None,           # {payment, apr, balance, termRemaining, value} or None
    "savingsGoals": [],    # {id, name, monthly}
    "spending": [],        # {id, date, amount, category, note, microfundId}
    "microfunds": [],      # {id, name, target, saved, archived, created}
    "settings": {"currency": "$"},
    "streak": {"current": 0, "best": 0},
}


def load_state():
    if not os.path.exists(DATA_FILE):
        return json.loads(json.dumps(DEFAULT_STATE))
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            state = json.load(f)
    except (json.JSONDecodeError, OSError):
        return json.loads(json.dumps(DEFAULT_STATE))
    # Backfill any missing top-level keys so upgrades never crash.
    for k, v in DEFAULT_STATE.items():
        state.setdefault(k, json.loads(json.dumps(v)))
    return state


def save_state(state):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, DATA_FILE)


def new_id():
    return uuid.uuid4().hex[:12]


# --------------------------------------------------------------------------- #
# Date helpers
# --------------------------------------------------------------------------- #

def today():
    return datetime.date.today()


def month_key(d=None):
    d = d or today()
    return f"{d.year:04d}-{d.month:02d}"


def days_in_current_month():
    d = today()
    return calendar.monthrange(d.year, d.month)[1]


def days_left_in_month():
    d = today()
    return days_in_current_month() - d.day + 1  # includes today


def in_current_month(date_str):
    try:
        return date_str.startswith(month_key())
    except AttributeError:
        return False


# --------------------------------------------------------------------------- #
# Core financial math
# --------------------------------------------------------------------------- #

def monthly_payment(principal, apr_percent, months):
    """Standard amortizing loan payment."""
    principal = float(principal)
    months = int(months)
    if months <= 0:
        return principal
    r = float(apr_percent) / 100.0 / 12.0
    if r == 0:
        return principal / months
    return principal * r / (1 - (1 + r) ** (-months))


def total_bills(state):
    return sum(float(b["amount"]) for b in state["bills"])


def total_savings(state):
    return sum(float(g["monthly"]) for g in state["savingsGoals"])


def car_payment(state):
    car = state.get("car")
    return float(car["payment"]) if car else 0.0


def spent_this_month(state):
    return sum(
        float(s["amount"]) for s in state["spending"] if in_current_month(s["date"])
    )


def compute_summary(state):
    income = float(state["income"]["monthly"])
    bills = total_bills(state)          # bills list already includes car if user added it
    car = car_payment(state)
    savings = total_savings(state)

    # Fixed outflow = every recurring bill + car payment + automated savings.
    fixed = bills + car + savings
    discretionary_pool = income - fixed          # money left for the month to spend freely
    spent = spent_this_month(state)
    remaining = discretionary_pool - spent
    dleft = days_left_in_month()

    daily_allowance = remaining / dleft if dleft > 0 else remaining
    baseline_daily = discretionary_pool / days_in_current_month() if income else 0.0

    status = "healthy"
    if discretionary_pool < 0:
        status = "overpaying"
    elif discretionary_pool < income * 0.05:
        status = "tight"

    return {
        "income": income,
        "bills": bills,
        "car": car,
        "savings": savings,
        "fixed": fixed,
        "discretionaryPool": discretionary_pool,
        "spentThisMonth": spent,
        "remainingThisMonth": remaining,
        "daysLeft": dleft,
        "daysInMonth": days_in_current_month(),
        "dailyAllowance": daily_allowance,
        "baselineDaily": baseline_daily,
        "status": status,
        "recommendations": build_recommendations(state, income, discretionary_pool),
        "car_analysis": analyze_car(state, income, discretionary_pool),
        "streak": compute_streak(state, baseline_daily),
    }


def build_recommendations(state, income, discretionary_pool):
    """If overpaying, suggest the smallest set of cancellable bills to get back to black."""
    recs = []
    if discretionary_pool >= 0:
        if income > 0 and discretionary_pool < income * 0.05:
            recs.append({
                "type": "warning",
                "text": "You're in the black, but barely. Less than 5% of your income is "
                        "left after fixed costs. One surprise bill could tip you over.",
            })
        return recs

    deficit = -discretionary_pool
    recs.append({
        "type": "alert",
        "text": f"You're overpaying by {money(deficit)} every month — your fixed bills, "
                f"car, and savings exceed your income.",
    })

    cancellable = sorted(
        [b for b in state["bills"] if b.get("cancellable")],
        key=lambda b: float(b["amount"]),
        reverse=True,
    )
    covered, chosen = 0.0, []
    for b in cancellable:
        if covered >= deficit:
            break
        chosen.append(b)
        covered += float(b["amount"])

    if chosen:
        names = ", ".join(f"{b['name']} ({money(b['amount'])})" for b in chosen)
        recs.append({
            "type": "action",
            "text": f"Cancelling these would recover {money(covered)}/mo and close the gap: {names}.",
        })
    if covered < deficit:
        recs.append({
            "type": "action",
            "text": f"Cancelling everything flagged as cancellable still leaves "
                    f"{money(deficit - covered)}/mo short. You'll need to raise income "
                    f"or cut a fixed cost (housing, car, insurance).",
        })
    return recs


def analyze_car(state, income, discretionary_pool):
    car = state.get("car")
    if not car:
        return None

    payment = float(car["payment"])
    apr = float(car.get("apr") or 0)
    balance = float(car.get("balance") or 0)
    term = int(car.get("termRemaining") or 0)
    value = float(car.get("value") or 0)

    share = (payment / income) if income > 0 else 0
    # Common guideline: car payment alone should stay under ~15% of gross monthly income.
    affordable_payment = income * 0.15
    affordable = payment <= affordable_payment and discretionary_pool >= 0

    options = []
    verdict = ""

    if affordable:
        verdict = (f"Your car payment is {money(payment)} — {pct(share)} of your income. "
                   f"That's within a healthy range (under 15%). You can afford this car.")
    else:
        if income > 0 and share > 0.15:
            verdict = (f"Your car payment is {money(payment)} — {pct(share)} of your income, "
                       f"above the ~15% comfort line. A payment around "
                       f"{money(affordable_payment)} would fit better.")
        else:
            verdict = (f"Your car payment is {money(payment)}, and your budget is already "
                       f"in the red, so this payment is a strain regardless of its size.")

        # Option 1: refinance to a lower rate (illustrative -2 points, same remaining term)
        if balance > 0 and term > 0:
            new_apr = max(apr - 2.0, 0.0)
            refi = monthly_payment(balance, new_apr, term)
            if refi < payment - 1:
                options.append(
                    f"Refinance: at {pct(new_apr/100)} APR over the remaining {term} months, "
                    f"your payment could drop to about {money(refi)} "
                    f"(saving {money(payment - refi)}/mo)."
                )
            # Option 2: extend the term to cut the monthly (costs more interest overall)
            longer = term + 24
            ext = monthly_payment(balance, apr, longer)
            if ext < payment - 1:
                options.append(
                    f"Extend the term: stretching to {longer} months lowers the payment to "
                    f"about {money(ext)}/mo — but you'll pay more interest over time."
                )

        # Option 3: sell / trade down, with underwater check
        if balance > 0 and value > 0:
            if value >= balance:
                equity = value - balance
                options.append(
                    f"Sell or trade down: the car is worth about {money(value)} vs. a "
                    f"{money(balance)} balance, so you have ~{money(equity)} of equity. "
                    f"Selling and buying a cheaper car (or going car-free) frees the payment."
                )
            else:
                gap = balance - value
                options.append(
                    f"Careful selling: you owe {money(balance)} but the car is worth about "
                    f"{money(value)} — you're roughly {money(gap)} underwater. Selling now "
                    f"means covering that gap, so refinancing or extending is usually better first."
                )
        options.append(
            "Other levers: shop your auto insurance, and avoid rolling this loan into a new "
            "car purchase (that's how people stay permanently underwater)."
        )

    return {
        "payment": payment,
        "share": share,
        "affordable": affordable,
        "affordablePayment": affordable_payment,
        "verdict": verdict,
        "options": options,
    }


def compute_streak(state, baseline_daily):
    """
    A day is a 'win' if that day's total spending <= the baseline daily target.
    Streak = consecutive win-days counting back from today. Today only counts
    once it has spending that stays under target (an as-yet-unspent today never
    breaks the streak, it just doesn't add to it). We only score days from the
    first-ever recorded expense onward, so a brand-new user isn't handed a fake
    streak of empty days.
    """
    prev_best = state["streak"].get("best", 0)
    if baseline_daily <= 0 or not state["spending"]:
        return {"current": state["streak"].get("current", 0),
                "best": prev_best, "todayWin": True}

    by_day = {}
    for s in state["spending"]:
        by_day[s["date"]] = by_day.get(s["date"], 0.0) + float(s["amount"])
    first_day = datetime.date.fromisoformat(min(by_day))

    d = today()
    today_spend = by_day.get(d.isoformat(), 0.0)
    today_win = today_spend <= baseline_daily

    current = 0
    # Today only contributes if it's already been "won" with real spending.
    if today_spend > 0 and today_win:
        current += 1

    # Walk backwards over completed days until a loss or before the first record.
    day = d - datetime.timedelta(days=1)
    while day >= first_day:
        spend = by_day.get(day.isoformat(), 0.0)  # no spend that day = a win
        if spend <= baseline_daily:
            current += 1
            day -= datetime.timedelta(days=1)
        else:
            break

    best = max(current, prev_best)
    state["streak"]["current"] = current
    state["streak"]["best"] = best
    return {"current": current, "best": best, "todayWin": today_win}


# --------------------------------------------------------------------------- #
# Formatting helpers (used in server-generated recommendation text)
# --------------------------------------------------------------------------- #

def money(x):
    try:
        return f"${float(x):,.2f}"
    except (TypeError, ValueError):
        return "$0.00"


def pct(x):
    return f"{float(x) * 100:.0f}%"


# --------------------------------------------------------------------------- #
# HTTP handler
# --------------------------------------------------------------------------- #

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def log_message(self, fmt, *args):
        pass  # keep the console quiet

    # ---- helpers ---- #
    def _json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _state_response(self, state):
        save_state(state)
        self._json({"state": state, "summary": compute_summary(state)})

    # ---- routing ---- #
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            state = load_state()
            summary = compute_summary(state)
            save_state(state)  # persist any streak update
            return self._json({"state": state, "summary": summary})
        if path.startswith("/api/"):
            return self._json({"error": "not found"}, 404)
        # static files
        if path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_DELETE(self):
        path = urlparse(self.path).path
        state = load_state()
        parts = path.strip("/").split("/")  # ['api', 'bills', '<id>']
        if len(parts) == 3 and parts[0] == "api":
            kind, item_id = parts[1], parts[2]
            key = {
                "bills": "bills",
                "savings": "savingsGoals",
                "spending": "spending",
            }.get(kind)
            if key:
                state[key] = [x for x in state[key] if x["id"] != item_id]
                return self._state_response(state)
        return self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        data = self._read_json()
        state = load_state()

        if path == "/api/income":
            state["income"]["monthly"] = float(data.get("monthly", 0) or 0)
            return self._state_response(state)

        if path == "/api/bills":
            state["bills"].append({
                "id": new_id(),
                "name": str(data.get("name", "Bill")).strip() or "Bill",
                "amount": float(data.get("amount", 0) or 0),
                "category": str(data.get("category", "Other")).strip() or "Other",
                "cancellable": bool(data.get("cancellable", False)),
            })
            return self._state_response(state)

        if path == "/api/bills/toggle":
            for b in state["bills"]:
                if b["id"] == data.get("id"):
                    b["cancellable"] = not b.get("cancellable", False)
            return self._state_response(state)

        if path == "/api/car":
            if data.get("clear"):
                state["car"] = None
            else:
                state["car"] = {
                    "payment": float(data.get("payment", 0) or 0),
                    "apr": float(data.get("apr", 0) or 0),
                    "balance": float(data.get("balance", 0) or 0),
                    "termRemaining": int(data.get("termRemaining", 0) or 0),
                    "value": float(data.get("value", 0) or 0),
                }
            return self._state_response(state)

        if path == "/api/savings":
            state["savingsGoals"].append({
                "id": new_id(),
                "name": str(data.get("name", "Savings")).strip() or "Savings",
                "monthly": float(data.get("monthly", 0) or 0),
            })
            return self._state_response(state)

        if path == "/api/spending":
            entries = data.get("entries")
            if not entries:  # single entry
                entries = [data]
            for e in entries:
                state["spending"].append({
                    "id": new_id(),
                    "date": e.get("date") or today().isoformat(),
                    "amount": float(e.get("amount", 0) or 0),
                    "category": str(e.get("category", "General")).strip() or "General",
                    "note": str(e.get("note", "")).strip(),
                    "microfundId": e.get("microfundId"),
                })
            return self._state_response(state)

        if path == "/api/microfunds":
            state["microfunds"].append({
                "id": new_id(),
                "name": str(data.get("name", "Event")).strip() or "Event",
                "target": float(data.get("target", 0) or 0),
                "saved": 0.0,
                "archived": False,
                "created": today().isoformat(),
            })
            return self._state_response(state)

        if path == "/api/microfunds/fund":
            amount = float(data.get("amount", 0) or 0)
            for m in state["microfunds"]:
                if m["id"] == data.get("id"):
                    m["saved"] = float(m["saved"]) + amount
                    # Funding an event redirects real money, so log it as spending —
                    # that's what makes the daily allowance actually feel the redirect.
                    state["spending"].append({
                        "id": new_id(),
                        "date": today().isoformat(),
                        "amount": amount,
                        "category": f"Micro-fund: {m['name']}",
                        "note": "Redirected to event fund",
                        "microfundId": m["id"],
                    })
            return self._state_response(state)

        if path == "/api/microfunds/archive":
            for m in state["microfunds"]:
                if m["id"] == data.get("id"):
                    m["archived"] = True
            return self._state_response(state)

        if path == "/api/sandbox":
            # Pure calculation, nothing persisted.
            return self._json(sandbox_result(state, data))

        if path == "/api/reset":
            save_state(json.loads(json.dumps(DEFAULT_STATE)))
            return self._json({"ok": True})

        return self._json({"error": "not found"}, 404)


def sandbox_result(state, data):
    """Simulate a hypothetical new loan/payment and its impact on the daily allowance."""
    summary = compute_summary(state)
    amount = float(data.get("amount", 0) or 0)
    apr = float(data.get("apr", 0) or 0)
    term = int(data.get("termMonths", 0) or 0)
    extra_monthly = float(data.get("extraMonthly", 0) or 0)  # optional flat add-on

    pay = monthly_payment(amount, apr, term) if amount and term else 0.0
    new_fixed_add = pay + extra_monthly
    new_pool = summary["discretionaryPool"] - new_fixed_add
    dim = summary["daysInMonth"]
    new_daily = new_pool / dim if dim else 0.0
    cur_daily = summary["baselineDaily"]

    total_cost = pay * term if term else 0.0
    interest = total_cost - amount if amount else 0.0

    return {
        "monthlyPayment": pay,
        "totalAdded": new_fixed_add,
        "termMonths": term,
        "totalCost": total_cost,
        "totalInterest": interest,
        "currentDailyBaseline": cur_daily,
        "newDailyBaseline": new_daily,
        "dailyDrop": cur_daily - new_daily,
        "newPool": new_pool,
        "affordable": new_pool >= 0,
    }


def main():
    os.chdir(STATIC_DIR)
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        httpd.allow_reuse_address = True
        print(f"Float is running at http://localhost:{PORT}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
