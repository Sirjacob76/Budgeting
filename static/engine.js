/*
 * Float local engine — runs entirely on-device. No server, no network, no login.
 *
 * The UI calls FloatEngine.handle(path, method, body) exactly as if it were hitting
 * an API; this module fulfils it against state kept in localStorage. All the budget
 * math is the same logic verified against the Python/Worker backends.
 */
(function () {
  const STORE_KEY = "float.state.v1";

  const DEFAULT_STATE = {
    income: { monthly: 0 },
    bills: [],            // {id, name, amount, category, cancellable, dueDay, autopay}
    car: null,
    savingsGoals: [],
    spending: [],
    microfunds: [],
    paySchedule: { frequency: "none", anchor: null }, // weekly|biweekly|semimonthly|monthly
    settings: { currency: "$" },
    streak: { current: 0, best: 0 },
  };

  /* ------------------------- storage ------------------------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);
      const s = JSON.parse(raw);
      for (const k of Object.keys(DEFAULT_STATE)) {
        if (!(k in s)) s[k] = structuredClone(DEFAULT_STATE[k]);
      }
      return s;
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }
  function save(state) { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  function newId() { return crypto.randomUUID().replace(/-/g, "").slice(0, 12); }
  function today() { return new Date().toLocaleDateString("en-CA"); } // YYYY-MM-DD local

  /* ------------------------- dates ------------------------- */
  function daysInMonth(t) { const [y, m] = t.split("-").map(Number); return new Date(y, m, 0).getDate(); }
  function dayOfMonth(t) { return Number(t.split("-")[2]); }
  function daysLeft(t) { return daysInMonth(t) - dayOfMonth(t) + 1; }
  function inCurrentMonth(dateStr, t) { return typeof dateStr === "string" && dateStr.startsWith(t.slice(0, 7)); }
  function addDays(dateStr, delta) {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }
  function dateDiffDays(a, b) {
    return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
  }
  const pad2 = (n) => String(n).padStart(2, "0");

  /* ------------------------- formatting ------------------------- */
  function money(x) {
    const v = Number(x) || 0;
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(x) { return `${Math.round(Number(x) * 100)}%`; }

  /* ------------------------- finance math ------------------------- */
  function monthlyPayment(principal, aprPercent, months) {
    principal = Number(principal); months = Number(months);
    if (months <= 0) return principal;
    const r = Number(aprPercent) / 100 / 12;
    if (r === 0) return principal / months;
    return (principal * r) / (1 - Math.pow(1 + r, -months));
  }
  const sum = (arr, f) => arr.reduce((a, b) => a + f(b), 0);
  const totalBills = (s) => sum(s.bills, (b) => Number(b.amount));
  const totalSavings = (s) => sum(s.savingsGoals, (g) => Number(g.monthly));
  const carPayment = (s) => (s.car ? Number(s.car.payment) : 0);
  const spentThisMonth = (s, t) => sum(s.spending.filter((x) => inCurrentMonth(x.date, t)), (x) => Number(x.amount));

  /* ------------------------- pie: where the money goes ------------------------- */
  function outflowBreakdown(state) {
    const income = Number(state.income.monthly);
    const map = {};
    for (const b of state.bills) {
      const c = (b.category || "Other").trim() || "Other";
      map[c] = (map[c] || 0) + Number(b.amount);
    }
    if (state.car) map["Car"] = (map["Car"] || 0) + Number(state.car.payment);
    const savings = totalSavings(state);
    if (savings > 0) map["Savings"] = (map["Savings"] || 0) + savings;
    const fixed = totalBills(state) + carPayment(state) + savings;
    const free = income - fixed;
    if (free > 0) map["Free to spend"] = free;

    let items = Object.entries(map)
      .filter(([, v]) => v > 0)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    // Fold the long tail into "Other" so the pie stays legible.
    const MAX = 7;
    if (items.length > MAX + 1) {
      const head = items.slice(0, MAX);
      const otherAmt = items.slice(MAX).reduce((a, b) => a + b.amount, 0);
      head.push({ category: "Other", amount: otherAmt });
      items = head;
    }
    const total = items.reduce((a, b) => a + b.amount, 0) || 1;
    items.forEach((it) => { it.pct = it.amount / total; });
    return { total, items };
  }

  /* ------------------------- pay schedule + payment plan ------------------------- */
  function perCheckAmount(income, freq) {
    switch (freq) {
      case "weekly": return income * 12 / 52;
      case "biweekly": return income * 12 / 26;
      case "semimonthly": return income / 2;
      case "monthly": return income;
      default: return 0;
    }
  }
  const freqLabel = { weekly: "Weekly", biweekly: "Every 2 weeks", semimonthly: "Twice a month", monthly: "Monthly" };

  function paydaysInMonth(schedule, t) {
    const freq = schedule && schedule.frequency;
    if (!freq || freq === "none") return [];
    const [y, m] = t.split("-").map(Number);
    const dim = daysInMonth(t);
    const ms = `${y}-${pad2(m)}-01`;
    const me = `${y}-${pad2(m)}-${pad2(dim)}`;
    const out = [];

    if (freq === "monthly") {
      const aDay = schedule.anchor ? Number(schedule.anchor.split("-")[2]) : 1;
      out.push(`${y}-${pad2(m)}-${pad2(Math.min(aDay, dim))}`);
    } else if (freq === "semimonthly") {
      out.push(`${y}-${pad2(m)}-15`, me);
    } else {
      const step = freq === "weekly" ? 7 : 14;
      const anchor = schedule.anchor || ms;
      const k = Math.ceil(dateDiffDays(anchor, ms) / step); // first aligned payday >= month start
      let d = addDays(anchor, k * step);
      while (d <= me) { if (d >= ms) out.push(d); d = addDays(d, step); }
    }
    return out.filter((d) => d >= ms && d <= me).sort();
  }

  function billLite(b) {
    return { id: b.id, name: b.name, amount: Number(b.amount), dueDay: b.dueDay || null, autopay: !!b.autopay, category: b.category };
  }

  function computePayPlan(state, t) {
    const freq = (state.paySchedule && state.paySchedule.frequency) || "none";
    if (freq === "none") return { configured: false };
    const income = Number(state.income.monthly);
    const perCheck = perCheckAmount(income, freq);
    const paydays = paydaysInMonth(state.paySchedule, t);
    const dim = daysInMonth(t);

    const dated = state.bills.filter((b) => b.dueDay);
    const undated = state.bills.filter((b) => !b.dueDay).map(billLite);
    const checks = paydays.map((d, i) => ({
      date: d, day: Number(d.split("-")[2]), perCheck, bills: [], billsTotal: 0,
      nextDay: i + 1 < paydays.length ? Number(paydays[i + 1].split("-")[2]) : dim + 1,
    }));
    const carryover = [];

    for (const b of dated) {
      let idx = -1;
      for (let i = 0; i < checks.length; i++) if (checks[i].day <= b.dueDay) idx = i;
      if (idx === -1) carryover.push(billLite(b));
      else { checks[idx].bills.push(billLite(b)); checks[idx].billsTotal += Number(b.amount); }
    }
    checks.forEach((c) => { c.leftover = c.perCheck - c.billsTotal; c.bills.sort((a, b) => a.dueDay - b.dueDay); });
    return { configured: true, frequency: freq, freqLabel: freqLabel[freq], perCheck, checks, carryover, undated };
  }

  function upcomingBills(state, t) {
    const todayDay = Number(t.split("-")[2]);
    const dim = daysInMonth(t);
    const list = [];
    for (const b of state.bills) {
      if (!b.dueDay) continue;
      const daysUntil = b.dueDay >= todayDay ? Math.min(b.dueDay, dim) - todayDay : (dim - todayDay) + b.dueDay;
      list.push({ id: b.id, name: b.name, amount: Number(b.amount), dueDay: b.dueDay, autopay: !!b.autopay, category: b.category, daysUntil });
    }
    return list.sort((a, b) => a.daysUntil - b.daysUntil);
  }

  function computeSummary(state, t) {
    const income = Number(state.income.monthly);
    const bills = totalBills(state);
    const car = carPayment(state);
    const savings = totalSavings(state);
    const fixed = bills + car + savings;
    const pool = income - fixed;
    const spent = spentThisMonth(state, t);
    const remaining = pool - spent;
    const dleft = daysLeft(t);
    const dim = daysInMonth(t);
    const dailyAllowance = dleft > 0 ? remaining / dleft : remaining;
    const baselineDaily = income ? pool / dim : 0;

    let status = "healthy";
    if (pool < 0) status = "overpaying";
    else if (pool < income * 0.05) status = "tight";

    return {
      income, bills, car, savings, fixed,
      discretionaryPool: pool,
      spentThisMonth: spent,
      remainingThisMonth: remaining,
      daysLeft: dleft,
      daysInMonth: dim,
      dailyAllowance,
      baselineDaily,
      status,
      recommendations: buildRecommendations(state, income, pool),
      car_analysis: analyzeCar(state, income, pool),
      streak: computeStreak(state, baselineDaily, t),
      outflow: outflowBreakdown(state),
      payPlan: computePayPlan(state, t),
      upcoming: upcomingBills(state, t),
    };
  }

  function buildRecommendations(state, income, pool) {
    const recs = [];
    if (pool >= 0) {
      if (income > 0 && pool < income * 0.05) {
        recs.push({ type: "warning", text:
          "You're in the black, but barely. Less than 5% of your income is left after " +
          "fixed costs. One surprise bill could tip you over." });
      }
      return recs;
    }
    const deficit = -pool;
    recs.push({ type: "alert", text:
      `You're overpaying by ${money(deficit)} every month — your fixed bills, car, and ` +
      `savings exceed your income.` });

    const cancellable = state.bills.filter((b) => b.cancellable).sort((a, b) => Number(b.amount) - Number(a.amount));
    let covered = 0; const chosen = [];
    for (const b of cancellable) { if (covered >= deficit) break; chosen.push(b); covered += Number(b.amount); }
    if (chosen.length) {
      const names = chosen.map((b) => `${b.name} (${money(b.amount)})`).join(", ");
      recs.push({ type: "action", text: `Cancelling these would recover ${money(covered)}/mo and close the gap: ${names}.` });
    }
    if (covered < deficit) {
      recs.push({ type: "action", text:
        `Cancelling everything flagged as cancellable still leaves ${money(deficit - covered)}/mo ` +
        `short. You'll need to raise income or cut a fixed cost (housing, car, insurance).` });
    }
    return recs;
  }

  function analyzeCar(state, income, pool) {
    const car = state.car;
    if (!car) return null;
    const payment = Number(car.payment);
    const apr = Number(car.apr || 0);
    const balance = Number(car.balance || 0);
    const term = Number(car.termRemaining || 0);
    const value = Number(car.value || 0);

    const share = income > 0 ? payment / income : 0;
    const affordablePayment = income * 0.15;
    const affordable = payment <= affordablePayment && pool >= 0;
    const options = [];
    let verdict = "";

    if (affordable) {
      verdict = `Your car payment is ${money(payment)} — ${pct(share)} of your income. ` +
        `That's within a healthy range (under 15%). You can afford this car.`;
    } else {
      if (income > 0 && share > 0.15) {
        verdict = `Your car payment is ${money(payment)} — ${pct(share)} of your income, above the ` +
          `~15% comfort line. A payment around ${money(affordablePayment)} would fit better.`;
      } else {
        verdict = `Your car payment is ${money(payment)}, and your budget is already in the red, ` +
          `so this payment is a strain regardless of its size.`;
      }
      if (balance > 0 && term > 0) {
        const newApr = Math.max(apr - 2, 0);
        const refi = monthlyPayment(balance, newApr, term);
        if (refi < payment - 1) {
          options.push(`Refinance: at ${pct(newApr / 100)} APR over the remaining ${term} months, ` +
            `your payment could drop to about ${money(refi)} (saving ${money(payment - refi)}/mo).`);
        }
        const longer = term + 24;
        const ext = monthlyPayment(balance, apr, longer);
        if (ext < payment - 1) {
          options.push(`Extend the term: stretching to ${longer} months lowers the payment to about ` +
            `${money(ext)}/mo — but you'll pay more interest over time.`);
        }
      }
      if (balance > 0 && value > 0) {
        if (value >= balance) {
          const equity = value - balance;
          options.push(`Sell or trade down: the car is worth about ${money(value)} vs. a ` +
            `${money(balance)} balance, so you have ~${money(equity)} of equity. Selling and buying ` +
            `a cheaper car (or going car-free) frees the payment.`);
        } else {
          const gap = balance - value;
          options.push(`Careful selling: you owe ${money(balance)} but the car is worth about ` +
            `${money(value)} — you're roughly ${money(gap)} underwater. Selling now means covering ` +
            `that gap, so refinancing or extending is usually better first.`);
        }
      }
      options.push("Other levers: shop your auto insurance, and avoid rolling this loan into a new " +
        "car purchase (that's how people stay permanently underwater).");
    }
    return { payment, share, affordable, affordablePayment, verdict, options };
  }

  function computeStreak(state, baselineDaily, t) {
    const prevBest = state.streak.best || 0;
    if (baselineDaily <= 0 || state.spending.length === 0) {
      return { current: state.streak.current || 0, best: prevBest, todayWin: true };
    }
    const byDay = {};
    for (const s of state.spending) byDay[s.date] = (byDay[s.date] || 0) + Number(s.amount);
    const firstDay = Object.keys(byDay).sort()[0];

    const todaySpend = byDay[t] || 0;
    const todayWin = todaySpend <= baselineDaily;
    let current = 0;
    if (todaySpend > 0 && todayWin) current += 1;

    let day = addDays(t, -1);
    while (day >= firstDay) {
      const spend = byDay[day] || 0;
      if (spend <= baselineDaily) { current += 1; day = addDays(day, -1); }
      else break;
    }
    const best = Math.max(current, prevBest);
    state.streak.current = current;
    state.streak.best = best;
    return { current, best, todayWin };
  }

  function sandboxResult(state, data, t) {
    const summary = computeSummary(state, t);
    const amount = Number(data.amount || 0);
    const apr = Number(data.apr || 0);
    const term = Number(data.termMonths || 0);
    const extraMonthly = Number(data.extraMonthly || 0);
    const pay = amount && term ? monthlyPayment(amount, apr, term) : 0;
    const added = pay + extraMonthly;
    const newPool = summary.discretionaryPool - added;
    const dim = summary.daysInMonth;
    const newDaily = dim ? newPool / dim : 0;
    const totalCost = term ? pay * term : 0;
    const interest = amount ? totalCost - amount : 0;
    return {
      monthlyPayment: pay, totalAdded: added, termMonths: term, totalCost, totalInterest: interest,
      currentDailyBaseline: summary.baselineDaily, newDailyBaseline: newDaily,
      dailyDrop: summary.baselineDaily - newDaily, newPool, affordable: newPool >= 0,
    };
  }

  /* ------------------------- request dispatcher ------------------------- */
  function stateResult(state, t) { save(state); return { state, summary: computeSummary(state, t) }; }

  function handle(path, method, body) {
    body = body || {};
    const t = today();
    const state = load();

    if (path === "/api/state" && method === "GET") return { state, summary: computeSummary(state, t) };

    if (method === "DELETE") {
      const parts = path.replace(/^\/+|\/+$/g, "").split("/");
      if (parts.length === 3 && parts[0] === "api") {
        const key = { bills: "bills", savings: "savingsGoals", spending: "spending" }[parts[1]];
        if (key) { state[key] = state[key].filter((x) => x.id !== parts[2]); return stateResult(state, t); }
      }
      return { error: "not found" };
    }

    switch (path) {
      case "/api/income":
        state.income.monthly = Number(body.monthly || 0);
        return stateResult(state, t);
      case "/api/bills": {
        let dueDay = parseInt(body.dueDay, 10);
        dueDay = dueDay >= 1 && dueDay <= 31 ? dueDay : null;
        state.bills.push({
          id: newId(),
          name: String(body.name || "Bill").trim() || "Bill",
          amount: Number(body.amount || 0),
          category: String(body.category || "Other").trim() || "Other",
          cancellable: Boolean(body.cancellable),
          dueDay,
          autopay: Boolean(body.autopay),
        });
        return stateResult(state, t);
      }
      case "/api/bills/toggle":
        for (const b of state.bills) if (b.id === body.id) b.cancellable = !b.cancellable;
        return stateResult(state, t);
      case "/api/bills/autopay":
        for (const b of state.bills) if (b.id === body.id) b.autopay = !b.autopay;
        return stateResult(state, t);
      case "/api/payschedule":
        state.paySchedule = {
          frequency: ["weekly", "biweekly", "semimonthly", "monthly"].includes(body.frequency) ? body.frequency : "none",
          anchor: /^\d{4}-\d{2}-\d{2}$/.test(body.anchor || "") ? body.anchor : null,
        };
        return stateResult(state, t);
      case "/api/car":
        if (body.clear) state.car = null;
        else state.car = {
          payment: Number(body.payment || 0), apr: Number(body.apr || 0), balance: Number(body.balance || 0),
          termRemaining: Number(body.termRemaining || 0), value: Number(body.value || 0),
        };
        return stateResult(state, t);
      case "/api/savings":
        state.savingsGoals.push({ id: newId(), name: String(body.name || "Savings").trim() || "Savings", monthly: Number(body.monthly || 0) });
        return stateResult(state, t);
      case "/api/spending": {
        const entries = body.entries && body.entries.length ? body.entries : [body];
        for (const e of entries) {
          state.spending.push({
            id: newId(), date: e.date || t, amount: Number(e.amount || 0),
            category: String(e.category || "General").trim() || "General",
            note: String(e.note || "").trim(), microfundId: e.microfundId || null,
          });
        }
        return stateResult(state, t);
      }
      case "/api/microfunds":
        state.microfunds.push({ id: newId(), name: String(body.name || "Event").trim() || "Event", target: Number(body.target || 0), saved: 0, archived: false, created: t });
        return stateResult(state, t);
      case "/api/microfunds/fund": {
        const amount = Number(body.amount || 0);
        for (const m of state.microfunds) {
          if (m.id === body.id) {
            m.saved = Number(m.saved) + amount;
            state.spending.push({ id: newId(), date: t, amount, category: `Micro-fund: ${m.name}`, note: "Redirected to event fund", microfundId: m.id });
          }
        }
        return stateResult(state, t);
      }
      case "/api/microfunds/archive":
        for (const m of state.microfunds) if (m.id === body.id) m.archived = true;
        return stateResult(state, t);
      case "/api/sandbox":
        return sandboxResult(state, body, t);
      case "/api/reset":
        save(structuredClone(DEFAULT_STATE));
        return { ok: true };
      default:
        return { error: "not found" };
    }
  }

  window.FloatEngine = { handle };
  // exposed for the test harness
  window.FloatEngine._test = { monthlyPayment, computeSummary, analyzeCar, sandboxResult };
})();
