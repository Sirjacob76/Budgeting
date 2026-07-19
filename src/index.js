/*
 * Float — Cloudflare Worker backend.
 *
 * Ports the logic from server.py to the Workers runtime:
 *   - State lives in a KV namespace (binding: FLOAT_KV) as one JSON document.
 *   - Password login: set APP_PASSWORD as a Worker secret. Login mints a signed
 *     cookie (HMAC-SHA256 keyed by APP_PASSWORD); all /api routes require it.
 *   - Static frontend is served from the ASSETS binding (the ./static folder).
 *
 * The client sends its local date in the "X-Today" header so month math and the
 * daily allowance are correct in the user's timezone (Workers run in UTC).
 */

const DEFAULT_STATE = {
  income: { monthly: 0 },
  bills: [],
  car: null,
  savingsGoals: [],
  spending: [],
  microfunds: [],
  settings: { currency: "$" },
  streak: { current: 0, best: 0 },
};

const SESSION_COOKIE = "float_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* ----------------------------- storage ----------------------------- */
async function loadState(env) {
  const raw = await env.FLOAT_KV.get("state");
  if (!raw) return structuredClone(DEFAULT_STATE);
  let s;
  try { s = JSON.parse(raw); } catch { return structuredClone(DEFAULT_STATE); }
  for (const k of Object.keys(DEFAULT_STATE)) {
    if (!(k in s)) s[k] = structuredClone(DEFAULT_STATE[k]);
  }
  return s;
}
function saveState(env, state) {
  return env.FLOAT_KV.put("state", JSON.stringify(state));
}
function newId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/* ----------------------------- dates ----------------------------- */
function parseToday(t) {
  if (t && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return new Date().toISOString().slice(0, 10);
}
function daysInMonth(t) {
  const [y, m] = t.split("-").map(Number);
  return new Date(y, m, 0).getDate(); // day 0 of next month = last day of this month
}
function dayOfMonth(t) { return Number(t.split("-")[2]); }
function daysLeft(t) { return daysInMonth(t) - dayOfMonth(t) + 1; }
function inCurrentMonth(dateStr, t) {
  return typeof dateStr === "string" && dateStr.startsWith(t.slice(0, 7));
}
function addDays(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/* ----------------------------- formatting ----------------------------- */
function money(x) {
  const v = Number(x) || 0;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(x) { return `${Math.round(Number(x) * 100)}%`; }

/* ----------------------------- finance math ----------------------------- */
function monthlyPayment(principal, aprPercent, months) {
  principal = Number(principal); months = Number(months);
  if (months <= 0) return principal;
  const r = Number(aprPercent) / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}
const sum = (arr, f) => arr.reduce((a, b) => a + f(b), 0);
function totalBills(s) { return sum(s.bills, (b) => Number(b.amount)); }
function totalSavings(s) { return sum(s.savingsGoals, (g) => Number(g.monthly)); }
function carPayment(s) { return s.car ? Number(s.car.payment) : 0; }
function spentThisMonth(s, today) {
  return sum(s.spending.filter((x) => inCurrentMonth(x.date, today)), (x) => Number(x.amount));
}

function computeSummary(state, today) {
  const income = Number(state.income.monthly);
  const bills = totalBills(state);
  const car = carPayment(state);
  const savings = totalSavings(state);
  const fixed = bills + car + savings;
  const pool = income - fixed;
  const spent = spentThisMonth(state, today);
  const remaining = pool - spent;
  const dleft = daysLeft(today);
  const dim = daysInMonth(today);

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
    streak: computeStreak(state, baselineDaily, today),
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

  const cancellable = state.bills
    .filter((b) => b.cancellable)
    .sort((a, b) => Number(b.amount) - Number(a.amount));
  let covered = 0; const chosen = [];
  for (const b of cancellable) {
    if (covered >= deficit) break;
    chosen.push(b); covered += Number(b.amount);
  }
  if (chosen.length) {
    const names = chosen.map((b) => `${b.name} (${money(b.amount)})`).join(", ");
    recs.push({ type: "action", text:
      `Cancelling these would recover ${money(covered)}/mo and close the gap: ${names}.` });
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

function computeStreak(state, baselineDaily, today) {
  const prevBest = state.streak.best || 0;
  if (baselineDaily <= 0 || state.spending.length === 0) {
    return { current: state.streak.current || 0, best: prevBest, todayWin: true };
  }
  const byDay = {};
  for (const s of state.spending) byDay[s.date] = (byDay[s.date] || 0) + Number(s.amount);
  const firstDay = Object.keys(byDay).sort()[0];

  const todaySpend = byDay[today] || 0;
  const todayWin = todaySpend <= baselineDaily;
  let current = 0;
  if (todaySpend > 0 && todayWin) current += 1;

  let day = addDays(today, -1);
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

function sandboxResult(state, data, today) {
  const summary = computeSummary(state, today);
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
    monthlyPayment: pay,
    totalAdded: added,
    termMonths: term,
    totalCost,
    totalInterest: interest,
    currentDailyBaseline: summary.baselineDaily,
    newDailyBaseline: newDaily,
    dailyDrop: summary.baselineDaily - newDaily,
    newPool,
    affordable: newPool >= 0,
  };
}

/* ----------------------------- auth ----------------------------- */
const enc = new TextEncoder();
function b64url(bytes) {
  let bin = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
// constant-time-ish string compare
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function makeToken(env) {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const sig = await hmac(env.APP_PASSWORD, exp);
  return `${exp}.${sig}`;
}
async function isAuthed(request, env) {
  if (!env.APP_PASSWORD) return false; // not configured => fail closed
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  const expect = await hmac(env.APP_PASSWORD, exp);
  return safeEqual(sig, expect);
}

/* ----------------------------- responses ----------------------------- */
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
async function stateResponse(env, state, today) {
  await saveState(env, state);
  return json({ state, summary: computeSummary(state, today) });
}

/* ----------------------------- router ----------------------------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- auth endpoints (no session required) ----
    if (path === "/api/login" && request.method === "POST") {
      if (!env.APP_PASSWORD) {
        return json({ error: "Login isn't set up yet: add an APP_PASSWORD secret in the Cloudflare dashboard." }, 503);
      }
      const body = await readJson(request);
      if (typeof body.password === "string" && safeEqual(body.password, env.APP_PASSWORD)) {
        const token = await makeToken(env);
        return json({ ok: true }, 200, {
          "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
        });
      }
      return json({ error: "Wrong password" }, 401);
    }
    if (path === "/api/logout") {
      return json({ ok: true }, 200, {
        "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
      });
    }

    // ---- everything under /api needs a session ----
    if (path.startsWith("/api/")) {
      if (!(await isAuthed(request, env))) return json({ error: "auth" }, 401);
      return handleApi(request, env, url, path);
    }

    // ---- static assets (frontend) ----
    return env.ASSETS.fetch(request);
  },
};

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

/* Named exports for unit testing (unused by the Worker runtime itself). */
export { monthlyPayment, computeSummary, analyzeCar, sandboxResult, buildRecommendations, computeStreak };

async function handleApi(request, env, url, path) {
  const today = parseToday(request.headers.get("X-Today"));
  const method = request.method;

  if (path === "/api/state" && method === "GET") {
    const state = await loadState(env);
    return json({ state, summary: computeSummary(state, today) }); // read-only, no write
  }

  if (method === "DELETE") {
    const parts = path.replace(/^\/+|\/+$/g, "").split("/"); // api / kind / id
    if (parts.length === 3 && parts[0] === "api") {
      const key = { bills: "bills", savings: "savingsGoals", spending: "spending" }[parts[1]];
      if (key) {
        const state = await loadState(env);
        state[key] = state[key].filter((x) => x.id !== parts[2]);
        return stateResponse(env, state, today);
      }
    }
    return json({ error: "not found" }, 404);
  }

  if (method !== "POST") return json({ error: "not found" }, 404);

  const data = await readJson(request);
  const state = await loadState(env);

  switch (path) {
    case "/api/income":
      state.income.monthly = Number(data.monthly || 0);
      return stateResponse(env, state, today);

    case "/api/bills":
      state.bills.push({
        id: newId(),
        name: String(data.name || "Bill").trim() || "Bill",
        amount: Number(data.amount || 0),
        category: String(data.category || "Other").trim() || "Other",
        cancellable: Boolean(data.cancellable),
      });
      return stateResponse(env, state, today);

    case "/api/bills/toggle":
      for (const b of state.bills) if (b.id === data.id) b.cancellable = !b.cancellable;
      return stateResponse(env, state, today);

    case "/api/car":
      if (data.clear) state.car = null;
      else state.car = {
        payment: Number(data.payment || 0),
        apr: Number(data.apr || 0),
        balance: Number(data.balance || 0),
        termRemaining: Number(data.termRemaining || 0),
        value: Number(data.value || 0),
      };
      return stateResponse(env, state, today);

    case "/api/savings":
      state.savingsGoals.push({
        id: newId(),
        name: String(data.name || "Savings").trim() || "Savings",
        monthly: Number(data.monthly || 0),
      });
      return stateResponse(env, state, today);

    case "/api/spending": {
      const entries = data.entries && data.entries.length ? data.entries : [data];
      for (const e of entries) {
        state.spending.push({
          id: newId(),
          date: e.date || today,
          amount: Number(e.amount || 0),
          category: String(e.category || "General").trim() || "General",
          note: String(e.note || "").trim(),
          microfundId: e.microfundId || null,
        });
      }
      return stateResponse(env, state, today);
    }

    case "/api/microfunds":
      state.microfunds.push({
        id: newId(),
        name: String(data.name || "Event").trim() || "Event",
        target: Number(data.target || 0),
        saved: 0,
        archived: false,
        created: today,
      });
      return stateResponse(env, state, today);

    case "/api/microfunds/fund": {
      const amount = Number(data.amount || 0);
      for (const m of state.microfunds) {
        if (m.id === data.id) {
          m.saved = Number(m.saved) + amount;
          state.spending.push({
            id: newId(), date: today, amount,
            category: `Micro-fund: ${m.name}`, note: "Redirected to event fund", microfundId: m.id,
          });
        }
      }
      return stateResponse(env, state, today);
    }

    case "/api/microfunds/archive":
      for (const m of state.microfunds) if (m.id === data.id) m.archived = true;
      return stateResponse(env, state, today);

    case "/api/sandbox":
      return json(sandboxResult(state, data, today)); // no persistence

    case "/api/reset":
      await saveState(env, structuredClone(DEFAULT_STATE));
      return json({ ok: true });

    default:
      return json({ error: "not found" }, 404);
  }
}
