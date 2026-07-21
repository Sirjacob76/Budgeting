/* Float — front-end logic. Pure vanilla JS, talks to the Python API. */

let STATE = null;
let SUMMARY = null;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const fmt = (n) => {
  const v = Number(n) || 0;
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
};
const fmt0 = (n) => {
  const v = Number(n) || 0;
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
};

/* -------------------- Engine bridge -------------------- */
// All budget logic runs on-device via FloatEngine (static/engine.js); nothing
// touches the network. Kept async so the calling UI code is unchanged.
async function api(path, method = "GET", body = null) {
  const data = window.FloatEngine.handle(path, method, body);
  if (data.state) { STATE = data.state; SUMMARY = data.summary; render(); }
  return data;
}

function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 1800);
}

/* -------------------- Paid-off celebration -------------------- */
function celebratePaidOff(bill) {
  $("#celebrate-text").innerHTML =
    `<b>${escapeHtml(bill.name)}</b> is paid off — that's <b>${fmt(bill.amount)}/mo</b> ` +
    `back in your pocket, freed up to save or spend.`;
  $("#celebrate").classList.add("show");
  launchConfetti();
}
function launchConfetti() {
  const box = $("#confetti");
  const colors = ["#1fb877", "#2a78d6", "#eda100", "#e34948", "#e87ba4", "#4a3aa7", "#eb6834"];
  box.innerHTML = "";
  for (let i = 0; i < 46; i++) {
    const p = document.createElement("div");
    p.className = "confetti";
    p.style.left = Math.random() * 100 + "%";
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.4).toFixed(2) + "s";
    p.style.animationDuration = (1.7 + Math.random() * 1.3).toFixed(2) + "s";
    box.appendChild(p);
  }
  setTimeout(() => { box.innerHTML = ""; }, 3400);
}
function closeCelebrate() { $("#celebrate").classList.remove("show"); $("#confetti").innerHTML = ""; }
$("#celebrate-close").addEventListener("click", closeCelebrate);
$("#celebrate").addEventListener("click", (e) => { if (e.target.id === "celebrate") closeCelebrate(); });

/* -------------------- Navigation (hamburger drawer) -------------------- */
function openDrawer() { $("#drawer").classList.add("show"); }
function closeDrawer() { $("#drawer").classList.remove("show"); }
function switchTab(name) {
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.tab === name));
  $$(".view").forEach((v) => v.classList.remove("active"));
  const view = $("#view-" + name);
  if (view) view.classList.add("active");
  const item = $(`.nav-item[data-tab="${name}"]`);
  if (item) $("#section-title").textContent = item.dataset.title;
  closeDrawer();
  window.scrollTo(0, 0);
}
$$(".nav-item").forEach((item) => item.addEventListener("click", () => { if (item.dataset.tab) switchTab(item.dataset.tab); }));
$("#menu-btn").addEventListener("click", openDrawer);
$("#drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") closeDrawer(); });
// Keep tabs in sync if the data changes in another tab of the same browser.
window.addEventListener("storage", (e) => { if (e.key === "float.state.v1") load(); });

/* -------------------- Pull-to-refresh -------------------- */
(function () {
  const ind = $("#pull-indicator");
  const THRESHOLD = 72;
  let startY = 0, dist = 0, pulling = false, refreshing = false;
  window.addEventListener("touchstart", (e) => {
    if (refreshing || window.scrollY > 0 || e.touches.length !== 1) { pulling = false; return; }
    startY = e.touches[0].clientY; pulling = true; dist = 0;
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    dist = e.touches[0].clientY - startY;
    if (dist > 0 && window.scrollY <= 0) {
      const pull = Math.min(dist * 0.5, 90);
      ind.style.transform = `translateX(-50%) translateY(${pull}px)`;
      ind.style.opacity = Math.min(dist / THRESHOLD, 1);
      ind.classList.toggle("ready", dist > THRESHOLD);
      if (dist > 6 && e.cancelable) e.preventDefault(); // stop the page from scrolling while we pull
    } else { pulling = false; }
  }, { passive: false });
  function endPull() {
    if (!pulling) return;
    pulling = false;
    if (dist > THRESHOLD) {
      refreshing = true;
      ind.classList.add("spin");
      ind.style.transform = "translateX(-50%) translateY(46px)";
      ind.style.opacity = "1";
      load();
      setTimeout(() => {
        ind.classList.remove("spin", "ready");
        ind.style.transform = ""; ind.style.opacity = "";
        refreshing = false;
        toast("Refreshed");
      }, 550);
    } else {
      ind.style.transform = ""; ind.style.opacity = ""; ind.classList.remove("ready");
    }
    dist = 0;
  }
  window.addEventListener("touchend", endPull, { passive: true });
  window.addEventListener("touchcancel", endPull, { passive: true });
})();

/* -------------------- Category chip pickers -------------------- */
const CATEGORIES = [
  ["Housing", "🏠"], ["Utilities", "💡"], ["Insurance", "🛡️"], ["Subscriptions", "📺"],
  ["Phone", "📱"], ["Groceries", "🛒"], ["Transport", "🚗"], ["Dining", "🍽️"],
  ["Debt", "💳"], ["Health", "🏥"], ["Other", "📦"],
];
function initCatPickers() {
  $$("[data-catpicker]").forEach((picker) => {
    picker.innerHTML = `<input type="hidden" name="category" value="">` +
      CATEGORIES.map(([c, i]) => `<button type="button" class="cat-chip" data-cat="${c}">${i} ${c}</button>`).join("");
  });
}
function resetCatPicker(form) {
  const picker = form.querySelector("[data-catpicker]");
  if (!picker) return;
  picker.querySelectorAll(".cat-chip.active").forEach((c) => c.classList.remove("active"));
  const hidden = picker.querySelector("input[name=category]");
  if (hidden) hidden.value = "";
}
// Edit bill: open a modal pre-filled with the bill's fields.
function openBillEdit(id) {
  const b = STATE.bills.find((x) => x.id === id);
  if (!b) return;
  const f = $("#bill-edit-form");
  f.id.value = b.id;
  f.name.value = b.name;
  f.amount.value = b.amount;
  f.amount.placeholder = b.variable ? "Typical amount" : "Amount";
  f.dueDay.value = b.dueDay || "";
  f.autopay.checked = !!b.autopay;
  f.cancellable.checked = !!b.cancellable;
  const picker = f.querySelector("[data-catpicker]");
  picker.querySelector("input[name=category]").value = b.category || "";
  picker.querySelectorAll(".cat-chip").forEach((c) => c.classList.toggle("active", c.dataset.cat === b.category));
  $("#edit-range").style.display = b.variable ? "flex" : "none";
  f.low.value = b.variable && b.low != null ? b.low : "";
  f.high.value = b.variable && b.high != null ? b.high : "";
  $("#bill-edit").classList.add("show");
  f.name.focus();
}
$("#bill-edit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  api("/api/bills/update", "POST", {
    id: f.id.value, name: f.name.value, amount: f.amount.value,
    category: f.querySelector("input[name=category]").value,
    dueDay: f.dueDay.value, autopay: f.autopay.checked, cancellable: f.cancellable.checked,
    low: f.low.value, high: f.high.value,
  });
  $("#bill-edit").classList.remove("show");
  toast("Bill updated");
});
$("#bill-edit-cancel").addEventListener("click", () => $("#bill-edit").classList.remove("show"));
$("#bill-edit").addEventListener("click", (e) => { if (e.target.id === "bill-edit") $("#bill-edit").classList.remove("show"); });

document.addEventListener("click", (e) => {
  const chip = e.target.closest(".cat-chip");
  if (!chip) return;
  const picker = chip.closest("[data-catpicker]");
  picker.querySelectorAll(".cat-chip").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  picker.querySelector("input[name=category]").value = chip.dataset.cat;
});

/* -------------------- Render -------------------- */
function render() {
  if (!STATE) return;
  renderDashboard();
  renderPie();
  renderSetup();
  renderPlan();
  renderDebt();
  renderCar();
  renderMicrofunds();
}

/* -------------------- Debt payoff planner -------------------- */
function freeIn(months) {
  if (months == null) return "—";
  const y = Math.floor(months / 12), m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}
function monthsToDate(months) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + months, 1);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function renderDebt() {
  const p = SUMMARY.debtPlan;
  const card = $("#debt-plan-card");
  if (!p || !p.hasDebts) { card.style.display = "none"; return; }
  card.style.display = "block";

  $$("#debt-method .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.method === p.method));

  const extraInp = $("#debt-extra");
  if (document.activeElement !== extraInp && !extraInp.value && p.extra > 0) extraInp.value = Math.round(p.extra);
  const free = SUMMARY.guidance && SUMMARY.guidance.ready ? SUMMARY.guidance.recommendedSpend : 0;
  $("#debt-extra-hint").textContent = free > 0
    ? `You have about ${fmt(free)}/mo free to spend — even part of it here speeds this up a lot.` : "";

  $("#debt-summary").innerHTML = `
    <div class="stat"><div class="stat-label">Total you owe</div><div class="stat-value danger">${fmt0(p.totalOwed)}</div></div>
    <div class="stat"><div class="stat-label">Paying / month</div><div class="stat-value">${fmt0(p.monthlyTotal)}</div></div>
    <div class="stat"><div class="stat-label">Debt-free in</div><div class="stat-value accent">${p.feasible ? freeIn(p.months) : "—"}</div></div>`;

  const instr = $("#debt-instruction");
  if (!p.feasible) {
    instr.innerHTML = `<div class="rec alert">Right now your payments barely cover the interest, so this never quite gets paid off. Add minimum payments to each debt, or raise the extra amount above, to build a real plan.</div>`;
  } else {
    const f = p.focus;
    instr.innerHTML = `<div class="rec good"><b>Attack ${escapeHtml(f.name)} first</b> (${fmt(f.balance)}). Pay the minimum on everything else and throw every spare dollar at it. When it's gone, roll that whole payment into the next debt — you'll be debt-free around <b>${monthsToDate(p.months)}</b>${p.totalInterest > 0 ? `, paying about ${fmt(p.totalInterest)} in interest` : ""}.</div>`;
  }

  $("#debt-list").innerHTML = p.ordered.map((d) => {
    const when = d.paidMonth ? `paid ~${monthsToDate(d.paidMonth)}` : "";
    const aprTag = d.apr > 0 ? `<span class="tag">${d.apr}% APR</span>` : "";
    const carTag = d.fromCar ? `<span class="tag">from Car tab</span>` : "";
    const del = d.fromCar ? "" : `<button class="icon-btn" data-del-debt="${d.id}">✕</button>`;
    return `<div class="bill-item">
      <div class="bi-name"><span class="debt-rank ${d.rank === 1 ? "first" : ""}">${d.rank}</span>${escapeHtml(d.name)}</div>
      <div class="bi-amt">${fmt(d.balance)}</div>
      <div class="bi-actions">${del}</div>
      <div class="bi-tags">${aprTag}${carTag}${when ? `<span class="tag ${d.rank === 1 ? "auto" : ""}">${when}</span>` : ""}</div>
    </div>`;
  }).join("");

  const cmp = $("#debt-compare");
  if (p.anyApr && p.snowMonths && p.avaMonths) {
    const saves = (p.snowInterest || 0) - (p.avaInterest || 0);
    cmp.innerHTML = `<p class="muted small">💡 <b>Smallest-first</b> gives you quick early wins to stay motivated. <b>Highest-APR first</b> would ${saves > 1 ? `save about ${fmt(saves)} in interest` : "finish about the same"} — tap the toggle above to compare.</p>`;
  } else {
    cmp.innerHTML = "";
  }
}

/* -------------------- Pie chart (SVG donut) -------------------- */
// Validated categorical palette (dataviz skill), fixed order — never cycled.
// Light and dark are the same eight hues, each stepped for its surface.
const PIE_COLORS_LIGHT = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
const PIE_COLORS_DARK = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"];
const OTHER_COLOR = "#8b98a9";
function pieColors() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? PIE_COLORS_DARK : PIE_COLORS_LIGHT;
}

function polar(cx, cy, r, frac) {
  const a = 2 * Math.PI * frac - Math.PI / 2;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function renderPie() {
  const chart = $("#pie-chart");
  const legend = $("#pie-legend");
  const items = (SUMMARY.outflow && SUMMARY.outflow.items) || [];
  if (!items.length || SUMMARY.income === 0) {
    chart.innerHTML = "";
    legend.innerHTML = `<div class="empty">Add income and bills to see where your money goes.</div>`;
    return;
  }
  const COLORS = pieColors();
  const size = 200, cx = size / 2, cy = size / 2, r = 92, inner = 56;
  let acc = 0;
  const segs = items.map((it, i) => {
    const start = acc; acc += it.pct; const end = acc;
    const color = it.category === "Other" ? OTHER_COLOR : COLORS[i % COLORS.length];
    if (it.pct >= 0.999) { // single full slice -> ring, avoids degenerate arc
      return `<circle cx="${cx}" cy="${cy}" r="${(r + inner) / 2}" fill="none" stroke="${color}" stroke-width="${r - inner}"/>`;
    }
    const [x1, y1] = polar(cx, cy, r, start);
    const [x2, y2] = polar(cx, cy, r, end);
    const [x3, y3] = polar(cx, cy, inner, end);
    const [x4, y4] = polar(cx, cy, inner, start);
    const large = end - start > 0.5 ? 1 : 0;
    return `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z" fill="${color}"/>`;
  }).join("");

  chart.innerHTML =
    `<svg viewBox="0 0 ${size} ${size}" width="200" height="200" role="img" aria-label="Monthly money breakdown">
      ${segs}
      <text x="${cx}" y="${cy - 6}" text-anchor="middle" class="pie-center-top">Income</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="pie-center-val">${fmt0(SUMMARY.outflow.total)}</text>
    </svg>`;

  legend.innerHTML = items.map((it, i) => {
    const color = it.category === "Other" ? OTHER_COLOR : COLORS[i % COLORS.length];
    return `<div class="legend-row">
      <span class="legend-dot" style="background:${color}"></span>
      <span class="legend-name">${escapeHtml(it.category)}</span>
      <span class="legend-pct">${Math.round(it.pct * 100)}%</span>
      <span class="legend-amt">${fmt0(it.amount)}</span>
    </div>`;
  }).join("");
}

function renderDashboard() {
  const s = SUMMARY;
  const daily = s.dailyAllowance;
  const el = $("#daily-allowance");
  el.textContent = fmt0(daily);
  el.style.color = daily < 0 ? "var(--danger)" : "var(--accent)";

  $("#daily-sub").textContent = s.income === 0
    ? "Add your income to get started →"
    : `${fmt(s.remainingThisMonth)} left across ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} this month`;

  $("#rollover-note").textContent = daily >= 0 && s.income > 0
    ? "Don't spend it all? It rolls into tomorrow."
    : "";

  $("#stat-income").textContent = fmt0(s.income);
  $("#stat-fixed").textContent = fmt0(s.fixed);
  const pool = $("#stat-pool");
  pool.textContent = fmt0(s.discretionaryPool);
  pool.className = "stat-value" + (s.discretionaryPool < 0 ? " danger" : "");

  // status pill
  const pill = $("#status-pill");
  const labels = { healthy: "On track", tight: "Cutting it close", overpaying: "Overpaying" };
  pill.textContent = labels[s.status] || "—";
  pill.className = "pill " + s.status;

  // recommendations
  const recBox = $("#recommendations");
  recBox.innerHTML = "";
  if (s.recommendations.length === 0 && s.income > 0) {
    recBox.innerHTML = `<div class="rec good">You're living within your means. ${fmt(s.discretionaryPool)}/mo is free after every fixed cost and savings goal.</div>`;
  }
  s.recommendations.forEach((r) => {
    const cls = r.type === "alert" ? "alert" : r.type === "warning" ? "warning" : "action";
    const div = document.createElement("div");
    div.className = "rec " + cls;
    div.textContent = r.text;
    recBox.appendChild(div);
  });
  if (s.income === 0) {
    recBox.innerHTML = `<div class="rec action">Head to <b>Income &amp; Bills</b> to add your monthly income and recurring bills — then this page comes alive.</div>`;
  }

  // streak
  const st = s.streak;
  $("#streak-current").textContent = st.current;
  $("#streak-best").textContent = st.best;
  const flames = "🔥".repeat(Math.min(st.current, 10));
  $("#streak-flames").textContent = flames;
  const msg = $("#streak-msg");
  if (st.current >= 7) { msg.textContent = `${st.current} days strong — you're building a real habit. Keep floating. 🌱`; msg.className = "muted streak-msg"; }
  else if (st.current >= 3) { msg.textContent = `Nice — ${st.current} days under in a row. Momentum's building.`; msg.className = "muted streak-msg"; }
  else if (st.current > 0) { msg.textContent = `${st.current} day down. Stay under tomorrow to grow the streak.`; msg.className = "muted"; }
  else { msg.textContent = "Log a day under your allowance to start a streak. No guilt if you don't — we only count the wins."; msg.className = "muted"; }

  // today's spending
  const today = new Date().toISOString().slice(0, 10);
  const todays = STATE.spending.filter((x) => x.date === today);
  const list = $("#today-spend-list");
  list.innerHTML = "";
  if (todays.length) {
    todays.slice().reverse().forEach((x) => {
      const d = document.createElement("div");
      d.className = "mini-item";
      d.innerHTML = `<span>${escapeHtml(x.category)}${x.note ? ` · ${escapeHtml(x.note)}` : ""}</span>
        <span>${fmt(x.amount)} <button class="icon-btn" data-del-spend="${x.id}">✕</button></span>`;
      list.appendChild(d);
    });
    const total = todays.reduce((a, b) => a + Number(b.amount), 0);
    const tot = document.createElement("div");
    tot.className = "totals";
    tot.textContent = "Spent today: " + fmt(total);
    list.appendChild(tot);
  }
}

function renderSetup() {
  $("#income-input").value = STATE.income.monthly || "";

  // "Your plan" guidance card
  const g = SUMMARY.guidance;
  const gCard = $("#guidance-card");
  if (g && g.ready) {
    gCard.style.display = "block";
    $("#plan-breakdown").innerHTML = `
      <div class="stat"><div class="stat-label">Left after bills</div>
        <div class="stat-value ${g.leftAfterBills < 0 ? "danger" : ""}">${fmt0(g.leftAfterBills)}</div></div>
      <div class="stat"><div class="stat-label">Put back (save)</div>
        <div class="stat-value">${fmt0(g.recommendedSavings)}</div></div>
      <div class="stat"><div class="stat-label">Free to spend</div>
        <div class="stat-value accent">${fmt0(g.recommendedSpend)}</div></div>`;
    $("#guidance-notes").innerHTML = g.notes.map((n) => {
      const cls = n.type === "alert" ? "alert" : n.type === "good" ? "good" : n.type === "warning" ? "warning" : "action";
      return `<div class="rec ${cls}">${escapeHtml(n.text)}</div>`;
    }).join("");
    renderPayoffOrder(g);
  } else {
    gCard.style.display = "none";
  }

  // Pre-fill the savings goal with the recommended "put back" amount, so there's less to type.
  const savMonthly = $("#savings-form [name=monthly]");
  const savName = $("#savings-form [name=name]");
  if (g && g.ready && g.recommendedSavings > 0) {
    if (savMonthly && !savMonthly.value && document.activeElement !== savMonthly)
      savMonthly.value = Math.round(g.recommendedSavings);
    if (savName && !savName.value && document.activeElement !== savName)
      savName.value = "Savings";
  }

  // bills — split into fixed and variable
  const fixedBills = STATE.bills.filter((b) => !b.variable);
  const varBills = STATE.bills.filter((b) => b.variable);

  const bt = $("#bills-table");
  bt.innerHTML = fixedBills.length
    ? fixedBills.map(billCardHtml).join("")
    : `<div class="empty">No fixed bills yet. Add rent, phone, subscriptions…</div>`;
  const fixedTotal = fixedBills.filter((b) => !b.paidOff).reduce((a, b) => a + Number(b.amount), 0);
  $("#bills-total").textContent = fixedBills.length ? "Total fixed bills: " + fmt(fixedTotal) : "";

  const vt = $("#variable-table");
  vt.innerHTML = varBills.length
    ? varBills.map(billCardHtml).join("")
    : `<div class="empty">No variable bills yet. Add electric, gas, water…</div>`;
  const varTotal = varBills.reduce((a, b) => a + Number(b.amount), 0);
  $("#variable-total").textContent = varBills.length ? "Typical total: " + fmt(varTotal) + "/mo" : "";

  // savings
  const st = $("#savings-table");
  st.innerHTML = "";
  if (!STATE.savingsGoals.length) {
    st.innerHTML = `<tr><td class="empty">No savings goals yet.</td></tr>`;
  }
  STATE.savingsGoals.forEach((g) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(g.name)}</td>
      <td class="amt">${fmt(g.monthly)}/mo</td>
      <td><button class="icon-btn" data-del-savings="${g.id}">✕</button></td>`;
    st.appendChild(tr);
  });
}

function renderCar() {
  const car = STATE.car;
  if (car) {
    $("[name=payment]", $("#car-form")).value = car.payment || "";
    $("[name=apr]", $("#car-form")).value = car.apr || "";
    $("[name=balance]", $("#car-form")).value = car.balance || "";
    $("[name=termRemaining]", $("#car-form")).value = car.termRemaining || "";
    $("[name=value]", $("#car-form")).value = car.value || "";
  }
  const ca = SUMMARY.car_analysis;
  const cardEl = $("#car-analysis-card");
  if (!ca) { cardEl.style.display = "none"; return; }
  cardEl.style.display = "block";

  const pill = $("#car-pill");
  pill.textContent = ca.affordable ? "Affordable" : "Strained";
  pill.className = "pill " + (ca.affordable ? "healthy" : "overpaying");

  $("#car-verdict").textContent = ca.verdict;

  // meter: share of income, mark at 15%
  const pctShare = Math.min(ca.share * 100, 100);
  const fill = $("#car-meter");
  fill.style.width = pctShare + "%";
  fill.style.background = ca.affordable ? "var(--accent)" : "var(--danger)";
  $("#car-share-note").textContent =
    `Payment is ${(ca.share * 100).toFixed(0)}% of income. The marker is the ~15% comfort line; a payment near ${fmt(ca.affordablePayment)} would sit right on it.`;

  const opts = $("#car-options");
  opts.innerHTML = "";
  ca.options.forEach((o) => {
    const li = document.createElement("li");
    li.textContent = o;
    opts.appendChild(li);
  });
}

function renderMicrofunds() {
  const active = STATE.microfunds.filter((m) => !m.archived);
  const archived = STATE.microfunds.filter((m) => m.archived);
  const wrap = $("#microfunds-list");
  wrap.innerHTML = "";
  if (!active.length) {
    wrap.innerHTML = `<div class="card"><p class="empty">No active micro-funds. Create one above for your next event.</p></div>`;
  }
  active.forEach((m) => {
    const pct = m.target > 0 ? Math.min(100, (m.saved / m.target) * 100) : 0;
    const done = m.saved >= m.target && m.target > 0;
    const card = document.createElement("div");
    card.className = "card mf" + (done ? " mf-done" : "");
    card.innerHTML = `
      <div class="card-head"><h2>${escapeHtml(m.name)}</h2>
        <span class="pill ${done ? "healthy" : "tight"}">${done ? "Funded" : "Saving"}</span></div>
      <div>${fmt(m.saved)} <span class="muted">of ${fmt(m.target)}</span></div>
      <div class="mf-bar"><div style="width:${pct}%"></div></div>
      <div class="row">
        <input type="number" step="0.01" placeholder="Add amount" data-fund-input="${m.id}">
        <button class="btn" data-fund="${m.id}">Fund</button>
        <button class="btn ghost" data-archive="${m.id}">Archive</button>
      </div>
      <p class="muted small">Funding redirects from your daily allowance today.</p>`;
    wrap.appendChild(card);
  });

  const archCard = $("#archived-card");
  const archList = $("#archived-list");
  if (archived.length) {
    archCard.style.display = "block";
    archList.innerHTML = "";
    archived.forEach((m) => {
      const d = document.createElement("div");
      d.className = "mini-item";
      d.innerHTML = `<span>${escapeHtml(m.name)}</span><span class="muted">${fmt(m.saved)} saved · closed</span>`;
      archList.appendChild(d);
    });
  } else {
    archCard.style.display = "none";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// "Pay these off first" — your bills ordered smallest payment to largest.
function renderPayoffOrder(g) {
  const box = $("#payoff-order");
  const po = g.payoffOrder || [];
  if (!po.length) { box.innerHTML = ""; return; }

  const first = po[0];
  const next = po[1];
  let html = `<div class="payoff-head">Pay these off first <span class="muted small">smallest to largest</span></div>
    <p class="muted small">Knocking out the smallest bills first frees up their payment the fastest — then you roll that money into the next one.</p>`;

  if (g.clearedCount) {
    html += `<div class="rec good">You've already cleared ${g.clearedCount} bill${g.clearedCount > 1 ? "s" : ""}, freeing up ${fmt(g.clearedFreed)}/mo. Keep going!</div>`;
  }
  html += `<div class="rec action"><b>Start with ${escapeHtml(first.name)}</b> (${fmt(first.amount)}/mo).` +
    (next ? ` Once it's gone, put that ${fmt(first.amount)} straight toward ${escapeHtml(next.name)}.` : ` That's your last one — clear it and you're free.`) +
    `</div>`;

  // How much extra to throw at it, out of the money left over
  if (g.spare > 0) {
    const extra = g.suggestedExtra;
    const total = first.amount + extra;
    const mult = first.amount > 0 ? total / first.amount : 0;
    if (first.cancellable) {
      html += `<div class="rec warning"><b>${escapeHtml(first.name)} is marked cancellable</b> — the fastest win is just cancelling it and freeing ${fmt(first.amount)}/mo instantly. If you'd rather keep it, you have ${fmt(g.spare)}/mo spare to put toward it.</div>`;
    } else {
      html += `<div class="rec good">You have <b>${fmt(g.spare)}/mo</b> spare after bills and savings. Put an extra <b>${fmt(extra)}</b> toward ${escapeHtml(first.name)} — that's <b>${fmt(total)}/mo</b> hitting it instead of ${fmt(first.amount)}${mult >= 1.2 ? `, roughly ${mult.toFixed(1)}× faster` : ""}. Throwing the whole ${fmt(g.spare)} at it clears it quicker still.</div>`;
    }
  } else {
    html += `<div class="rec warning">There's nothing spare after bills and savings right now, so extra payments aren't realistic yet — cancelling something or trimming a variable bill is the fastest way to free money up.</div>`;
  }

  html += `<div class="bill-list">` + po.map((b) => `
    <div class="bill-item">
      <div class="bi-name"><span class="debt-rank ${b.rank === 1 ? "first" : ""}">${b.rank}</span>${escapeHtml(b.name)}</div>
      <div class="bi-amt">${fmt(b.amount)}</div>
      <div class="bi-actions"><button class="icon-btn paidoff-btn" data-paidoff="${b.id}" title="Mark paid off">🏁</button></div>
      <div class="bi-tags"><span class="tag">${escapeHtml(b.category)}</span>${
        b.rank === 1 && g.suggestedExtra > 0 && !b.cancellable
          ? `<span class="tag auto">pay ${fmt(b.amount + g.suggestedExtra)}/mo</span>` : ""
      }${b.cancellable ? `<span class="tag can">cancellable</span>` : ""}</div>
    </div>`).join("") + `</div>`;

  html += `<p class="muted small" style="margin-top:12px">Owe balances on loans or cards? The
    <button class="btn ghost tiny" data-goto="debt">Get out of debt →</button> tab plans by what you owe.</p>`;
  box.innerHTML = html;
}

// One card builder for both the fixed and variable bill lists — reflows on mobile.
function billCardHtml(b) {
  const due = b.dueDay ? `due ${ordinal(b.dueDay)}` : "no date";
  const paidBadge = b.paidOff ? ` <span class="tag paid">🎉 paid off</span>` : "";
  const range = (b.low != null || b.high != null)
    ? ` <span class="muted small">(${b.low != null ? fmt0(b.low) : "?"}–${b.high != null ? fmt0(b.high) : "?"})</span>` : "";
  const amt = b.variable ? `~${fmt(b.amount)}${range}` : fmt(b.amount);
  // "Paid off" doesn't apply to a utility that recurs forever, so hide it on variable bills.
  const paidBtn = b.variable ? "" :
    `<button class="icon-btn paidoff-btn ${b.paidOff ? "is-paid" : ""}" data-paidoff="${b.id}"
       title="${b.paidOff ? "Paid off — tap to undo" : "Mark this bill paid off"}">${b.paidOff ? "↩" : "🏁"}</button>`;
  return `<div class="bill-item ${b.paidOff ? "paid-off" : ""}">
    <div class="bi-name">${escapeHtml(b.name)}${paidBadge}</div>
    <div class="bi-amt">${amt}</div>
    <div class="bi-actions"><button class="icon-btn" data-editbill="${b.id}" title="Edit bill">✎</button>${paidBtn}<button class="icon-btn" data-del-bill="${b.id}">✕</button></div>
    <div class="bi-tags">
      <span class="tag">${escapeHtml(b.category)}</span>
      <span class="tag">${due}</span>
      <span class="tag ${b.autopay ? "auto" : ""}" data-autopay="${b.id}" style="cursor:pointer">${b.autopay ? "⟳ autopay" : "manual"}</span>
      <span class="tag ${b.cancellable ? "can" : ""}" data-toggle="${b.id}" style="cursor:pointer">${b.cancellable ? "✓ cancellable" : "fixed"}</span>
    </div>
  </div>`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${ordinal(d)}`;
}

/* -------------------- Plan tab -------------------- */
function renderPlan() {
  // reflect saved schedule in the form
  const sched = STATE.paySchedule || { frequency: "none", anchor: null };
  const freqSel = $("#pay-frequency");
  if (freqSel && document.activeElement !== freqSel) freqSel.value = sched.frequency || "none";
  const anchorInp = $("#pay-anchor");
  if (anchorInp && document.activeElement !== anchorInp && sched.anchor) anchorInp.value = sched.anchor;

  // Upcoming reminders
  const up = SUMMARY.upcoming || [];
  const list = $("#upcoming-list");
  if (!up.length) {
    list.innerHTML = `<div class="empty">Add a due day to your bills (Income &amp; Bills tab) and they'll show up here.</div>`;
  } else {
    list.innerHTML = up.map((u) => {
      const when = u.daysUntil === 0 ? "today" : u.daysUntil === 1 ? "tomorrow" : `in ${u.daysUntil} days`;
      const soon = u.daysUntil <= 3;
      return `<div class="mini-item">
        <span><b class="${soon ? "due-soon" : ""}">${escapeHtml(u.name)}</b>
          <span class="muted small">${u.autopay ? "· autopays" : ""}</span></span>
        <span>${fmt(u.amount)} <span class="muted small">${when}</span></span>
      </div>`;
    }).join("");
  }

  // Paycheck-by-paycheck plan
  const plan = SUMMARY.payPlan;
  const box = $("#payplan");
  if (!plan || !plan.configured) {
    box.innerHTML = `<div class="empty">Set your pay schedule above to get a paycheck-by-paycheck plan for the month.</div>`;
    return;
  }
  let html = `<p class="muted small">Paid ${plan.freqLabel.toLowerCase()} · about ${fmt(plan.perCheck)} per paycheck. Here's what to set aside from each one this month:</p>`;
  if (plan.carryover.length) {
    const names = plan.carryover.map((b) => `${escapeHtml(b.name)} (${fmt(b.amount)}, due ${ordinal(b.dueDay)})`).join(", ");
    html += `<div class="rec warning">Due before your first paycheck this month — cover from your last check: ${names}.</div>`;
  }
  html += plan.checks.map((c) => {
    const bills = c.bills.length
      ? c.bills.map((b) => `<div class="pc-bill"><span>${escapeHtml(b.name)} <span class="muted small">due ${ordinal(b.dueDay)}${b.autopay ? " · auto" : ""}</span></span><span>${fmt(b.amount)}</span></div>`).join("")
      : `<div class="muted small">No bills due before your next paycheck — this one's yours.</div>`;
    return `<div class="paycheck">
      <div class="pc-head">
        <div><b>${prettyDate(c.date)}</b> <span class="muted small">paycheck</span></div>
        <div class="pc-amt">${fmt(c.perCheck)}</div>
      </div>
      <div class="pc-bills">${bills}</div>
      <div class="pc-foot">
        <span>Set aside <b>${fmt(c.billsTotal)}</b></span>
        <span class="${c.leftover < 0 ? "danger" : ""}">Leftover <b>${fmt(c.leftover)}</b></span>
      </div>
    </div>`;
  }).join("");
  if (plan.undated.length) {
    const total = plan.undated.reduce((a, b) => a + Number(b.amount), 0);
    const rows = plan.undated.map((b) => `<div class="pc-bill"><span>${escapeHtml(b.name)}</span><span>${fmt(b.amount)}</span></div>`).join("");
    html += `<div class="paycheck undated-block">
      <div class="pc-head">
        <div><b>Not scheduled yet</b> <span class="muted small">${plan.undated.length} bill${plan.undated.length > 1 ? "s" : ""}</span></div>
        <div class="pc-amt">${fmt(total)}</div>
      </div>
      <div class="pc-bills">${rows}</div>
      <div class="undated-note">
        <span class="muted small">These don't have a due date, so Float can't slot them into a paycheck yet.</span>
        <button class="btn ghost tiny" data-goto="setup">Add due dates →</button>
      </div>
    </div>`;
  }
  box.innerHTML = html;
}

/* -------------------- Event wiring -------------------- */

// Income
$("#income-form").addEventListener("submit", (e) => {
  e.preventDefault();
  api("/api/income", "POST", { monthly: $("#income-input").value });
  toast("Income saved");
});

// Bills
$("#bill-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  api("/api/bills", "POST", {
    name: f.name.value, amount: f.amount.value,
    category: f.category.value || "Other", cancellable: f.cancellable.checked,
    dueDay: f.dueDay.value, autopay: f.autopay.checked,
  });
  f.reset();
  resetCatPicker(f);
  toast("Bill added");
});

// Variable bills (electric, gas, water…)
$("#varbill-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  api("/api/bills", "POST", {
    name: f.name.value, amount: f.amount.value, category: f.category.value || "Utilities",
    variable: true, low: f.low.value, high: f.high.value,
    dueDay: f.dueDay.value, autopay: f.autopay.checked,
  });
  f.reset();
  resetCatPicker(f);
  toast("Variable bill added");
});

// Savings
$("#savings-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  api("/api/savings", "POST", { name: f.name.value, monthly: f.monthly.value });
  f.reset();
  toast("Savings goal added");
});

// Car
$("#car-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  api("/api/car", "POST", {
    payment: f.payment.value, apr: f.apr.value, balance: f.balance.value,
    termRemaining: f.termRemaining.value, value: f.value.value,
  });
  toast("Car analyzed");
});
$("#car-clear").addEventListener("click", () => {
  api("/api/car", "POST", { clear: true });
  $("#car-form").reset();
  toast("Car removed");
});

// Quick spend
$("#quick-spend").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.amount.value) return;
  api("/api/spending", "POST", { amount: f.amount.value, category: f.category.value || "General", note: f.note.value });
  f.reset();
  toast("Logged");
});

// Micro-funds
$("#microfund-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  api("/api/microfunds", "POST", { name: f.name.value, target: f.target.value });
  f.reset();
  toast("Micro-fund created");
});

// Debt payoff
$("#debt-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  api("/api/debts", "POST", {
    name: f.name.value, balance: f.balance.value, minPayment: f.minPayment.value, apr: f.apr.value,
  });
  f.reset();
  toast("Debt added");
});
$("#debt-extra").addEventListener("change", (e) => {
  api("/api/debtextra", "POST", { amount: e.target.value });
});
$("#debt-method").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (btn) api("/api/debtmethod", "POST", { method: btn.dataset.method });
});

// Pay schedule
$("#payday-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  api("/api/payschedule", "POST", { frequency: f.frequency.value, anchor: f.anchor.value });
  toast("Pay schedule saved");
});

/* -------------------- Notifications (Capacitor on device, web fallback) -------------------- */
function hasCapacitorNotifs() {
  return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications);
}
async function enableNotifications() {
  const status = $("#notif-status");
  const upcoming = (SUMMARY.upcoming || []).filter((u) => !u.autopay); // autopay bills don't need a nudge

  if (hasCapacitorNotifs()) {
    const LN = window.Capacitor.Plugins.LocalNotifications;
    try {
      const perm = await LN.requestPermissions();
      if (perm.display !== "granted") { status.textContent = "Notifications are turned off in your phone settings."; return; }
      // Clear any we scheduled before, then schedule a 9am reminder the day before each due date.
      const notifications = upcoming.map((u, i) => {
        const at = dueReminderDate(u.dueDay);
        return {
          id: 1000 + i,
          title: `${u.name} is due soon`,
          body: `${u.name} (${fmt(u.amount)}) is due ${ordinal(u.dueDay)}. Tap to review in Float.`,
          schedule: { at },
        };
      });
      if (notifications.length) await LN.schedule({ notifications });
      status.textContent = `On — you'll get a reminder the day before each of your ${notifications.length} manual bills.`;
      toast("Reminders on");
    } catch (err) {
      status.textContent = "Couldn't set up notifications: " + err.message;
    }
    return;
  }

  // Web fallback (preview in a browser): request permission and demo the next reminder.
  if (!("Notification" in window)) { status.textContent = "This browser can't show notifications — the phone app can."; return; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { status.textContent = "Notifications blocked. You can enable them in your browser settings."; return; }
  if (upcoming.length) {
    const u = upcoming[0];
    new Notification("Float reminder", { body: `${u.name} (${fmt(u.amount)}) is due ${ordinal(u.dueDay)}.` });
    status.textContent = `On (preview). On your phone these fire automatically the day before each bill. Next up: ${u.name}.`;
  } else {
    status.textContent = "On. Add bills with due days and you'll be reminded before each one.";
  }
  toast("Reminders on");
}
// Next occurrence of a due day, at 9am, one day early.
function dueReminderDate(dueDay) {
  const now = new Date();
  let d = new Date(now.getFullYear(), now.getMonth(), dueDay, 9, 0, 0);
  d.setDate(d.getDate() - 1); // day before
  if (d < now) d = new Date(now.getFullYear(), now.getMonth() + 1, dueDay - 1, 9, 0, 0);
  return d;
}
$("#enable-notifs").addEventListener("click", enableNotifications);

// Reset
$("#reset-btn").addEventListener("click", () => {
  if (confirm("Erase all your data and start fresh?")) {
    api("/api/reset", "POST").then(load);
    toast("Reset");
  }
});

// Delegated clicks (delete / toggle / fund / archive)
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset.delBill) api("/api/bills/" + t.dataset.delBill, "DELETE");
  else if (t.dataset.delSavings) api("/api/savings/" + t.dataset.delSavings, "DELETE");
  else if (t.dataset.delSpend) api("/api/spending/" + t.dataset.delSpend, "DELETE");
  else if (t.dataset.delDebt) api("/api/debts/" + t.dataset.delDebt, "DELETE");
  else if (t.dataset.editbill) openBillEdit(t.dataset.editbill);
  else if (t.dataset.goto) switchTab(t.dataset.goto);
  else if (t.dataset.toggle) api("/api/bills/toggle", "POST", { id: t.dataset.toggle });
  else if (t.dataset.autopay) api("/api/bills/autopay", "POST", { id: t.dataset.autopay });
  else if (t.dataset.paidoff) {
    const bill = STATE.bills.find((b) => b.id === t.dataset.paidoff);
    const wasPaid = bill && bill.paidOff;
    api("/api/bills/paidoff", "POST", { id: t.dataset.paidoff }).then(() => {
      if (bill && !wasPaid) celebratePaidOff(bill);
      else toast("Back to owing");
    });
  }
  else if (t.dataset.archive) { api("/api/microfunds/archive", "POST", { id: t.dataset.archive }); toast("Archived"); }
  else if (t.dataset.fund) {
    const input = $(`[data-fund-input="${t.dataset.fund}"]`);
    const amt = Number(input.value);
    if (amt > 0) { api("/api/microfunds/fund", "POST", { id: t.dataset.fund, amount: amt }); toast("Funded " + fmt(amt)); }
  }
});

/* -------------------- Receipts: AI key management -------------------- */
const KEY_STORE = "float.gemini.key";
const MODEL_STORE = "float.gemini.model";

function loadKey() {
  const key = localStorage.getItem(KEY_STORE) || "";
  const model = localStorage.getItem(MODEL_STORE) || "gemini-flash-latest";
  $("#gemini-key").value = key;
  const sel = $("#gemini-model");
  if ([...sel.options].some((o) => o.value === model)) sel.value = model;
  const status = $("#ai-key-status");
  if (key) { status.textContent = "key saved ✓"; status.className = "set"; }
  else { status.textContent = "no key set"; status.className = ""; }
  return key;
}
$("#save-key").addEventListener("click", () => {
  localStorage.setItem(KEY_STORE, $("#gemini-key").value.trim());
  localStorage.setItem(MODEL_STORE, $("#gemini-model").value);
  loadKey();
  toast($("#gemini-key").value.trim() ? "Key saved" : "Key cleared");
});

/* -------------------- Receipts: photo upload -------------------- */
let receiptB64 = null;      // base64 payload (no data-url prefix)
let receiptMime = null;

const uploadZone = $("#upload-zone");
const fileInput = $("#receipt-file");
uploadZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    const img = $("#receipt-preview");
    img.src = dataUrl;
    img.style.display = "block";
    receiptMime = file.type || "image/jpeg";
    receiptB64 = String(dataUrl).split(",")[1];
    $("#ai-read-row").style.display = "flex";
    $("#ocr-note").textContent = localStorage.getItem(KEY_STORE)
      ? ""
      : "Add a free Gemini key above to auto-read it — or type items into the table below.";
  };
  reader.readAsDataURL(file);
});

/* -------------------- Receipts: Gemini OCR -------------------- */
const RECEIPT_CATEGORIES = [
  "Groceries", "Dining", "Household", "Clothing", "Gifts", "Health",
  "Transport", "Entertainment", "Electronics", "Personal Care", "Pets", "Tax", "Other",
];

const RECEIPT_SYS =
  "You are a receipt-reading assistant for a budgeting app. Read the receipt in the image and " +
  "return STRICT JSON only, no prose, in this exact shape:\n" +
  '{ "merchant": string, "items": [ { "name": string, "amount": number, "category": string } ] }\n' +
  "Rules:\n" +
  "- One object per purchased line item. Combine obvious duplicates only if the receipt already does.\n" +
  "- amount is a positive number in dollars (e.g. 4.99), no currency symbol.\n" +
  "- Include sales tax as its own item named \"Sales Tax\" with category \"Tax\" if the receipt shows one.\n" +
  "- Do NOT include subtotal, total, balance, change, tender, card, or payment lines.\n" +
  "- category MUST be exactly one of: " + RECEIPT_CATEGORIES.join(", ") + ".\n" +
  "- Pick the best-fitting category per item (e.g. a birthday card => Gifts, milk => Groceries, a t-shirt => Clothing).\n" +
  "- If the image is not a readable receipt, return { \"merchant\": \"\", \"items\": [] }.";

async function readReceiptWithAI() {
  const key = localStorage.getItem(KEY_STORE);
  if (!key) {
    $("#ai-settings").open = true;
    $("#ocr-note").textContent = "Add your free Gemini key first (settings above).";
    return;
  }
  if (!receiptB64) { $("#ocr-note").textContent = "Add a receipt photo first."; return; }

  const model = localStorage.getItem(MODEL_STORE) || "gemini-flash-latest";
  const btn = $("#read-ai");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Reading…";
  $("#ocr-note").textContent = "Sending to Gemini…";

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
  const body = {
    systemInstruction: { parts: [{ text: RECEIPT_SYS }] },
    contents: [{ role: "user", parts: [
      { text: "Itemize this receipt into the JSON schema. Split across categories as needed." },
      { inline_data: { mime_type: receiptMime, data: receiptB64 } },
    ] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.error?.message || ""; } catch (e) {}
      if (res.status === 400 && /api key/i.test(detail)) detail = "That key was rejected — double-check it.";
      throw new Error(detail || ("Gemini returned " + res.status));
    }

    const data = await res.json();
    const cand = (data.candidates || [])[0];
    const txt = (((cand || {}).content || {}).parts || []).map((p) => p.text || "").join("");
    if (!txt) {
      const reason = data?.promptFeedback?.blockReason || cand?.finishReason || "";
      throw new Error("Couldn't read the photo" + (reason ? " (" + String(reason).toLowerCase() + ")" : "") + ". Try a clearer, flatter shot.");
    }

    const parsed = JSON.parse(txt);
    const items = (parsed.items || [])
      .filter((it) => Number(it.amount) > 0)
      .map((it) => ({
        name: String(it.name || "Item"),
        amount: Number(it.amount),
        category: RECEIPT_CATEGORIES.includes(it.category) ? it.category : "Other",
      }));

    if (!items.length) {
      $("#ocr-note").textContent = "No line items found — try a clearer photo, or type them below.";
      return;
    }
    renderItemsTable(items);
    $("#items-card").style.display = "block";
    $("#items-card").scrollIntoView({ behavior: "smooth", block: "start" });
    const total = items.reduce((a, b) => a + b.amount, 0);
    $("#ocr-note").textContent =
      `Read ${items.length} items${parsed.merchant ? " from " + parsed.merchant : ""} · ${fmt(total)}. Review and save.`;
    toast("Receipt read ✨");
  } catch (err) {
    const msg = err.name === "AbortError" ? "Timed out — check your connection and retry." : err.message;
    $("#ocr-note").textContent = "⚠️ " + msg;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
$("#read-ai").addEventListener("click", readReceiptWithAI);

$("#parse-receipt").addEventListener("click", () => {
  const text = $("#receipt-text").value.trim();
  const items = parseReceiptText(text);
  if (!items.length) {
    // still open an empty editable table so people can enter manually
    items.push({ name: "", amount: "", category: "General" });
  }
  renderItemsTable(items);
  $("#items-card").style.display = "block";
});

// Very small "OCR-style" parser: pulls a trailing price off each line and guesses a category.
function parseReceiptText(text) {
  if (!text) return [];
  const cats = [
    [/milk|bread|egg|grocer|produce|meat|banana|coffee bean|cereal/i, "Groceries"],
    [/card|gift|present|flower/i, "Gifts"],
    [/shirt|shoe|jean|dress|cloth|apparel|sock/i, "Clothing"],
    [/gas|fuel|diesel/i, "Transport"],
    [/beer|wine|liquor|bar/i, "Dining"],
    [/pharm|drug|vitamin|med/i, "Health"],
  ];
  const lines = text.split(/\n+/);
  const items = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/(-?\$?\d+(?:[.,]\d{1,2})?)\s*$/);
    if (!m) continue;
    const amount = parseFloat(m[1].replace(/[$,]/g, ""));
    if (isNaN(amount)) continue;
    const name = line.slice(0, m.index).replace(/[.\s-]+$/, "").trim() || "Item";
    if (/subtotal|total|tax|balance|change|cash|visa|card|debit|amount due/i.test(name)) continue;
    let category = "General";
    for (const [re, c] of cats) { if (re.test(name)) { category = c; break; } }
    items.push({ name, amount, category });
  }
  return items;
}

function renderItemsTable(items) {
  const tbl = $("#items-table");
  tbl.innerHTML = "";
  items.forEach((it, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" value="${escapeHtml(it.name)}" data-i="${i}" data-k="name" placeholder="Item"></td>
      <td><input type="text" value="${escapeHtml(it.category)}" data-i="${i}" data-k="category" list="cat-list" style="width:130px"></td>
      <td><input type="number" step="0.01" value="${it.amount}" data-i="${i}" data-k="amount" style="width:90px" class="amt"></td>
      <td><button class="icon-btn" data-rm-item="${i}">✕</button></td>`;
    tbl.appendChild(tr);
  });
  updateItemsTotal();
  tbl._items = items;
}

function readItemsFromTable() {
  const tbl = $("#items-table");
  const rows = $$("tr", tbl);
  const items = [];
  rows.forEach((tr) => {
    const name = $('[data-k="name"]', tr)?.value || "";
    const category = $('[data-k="category"]', tr)?.value || "General";
    const amount = parseFloat($('[data-k="amount"]', tr)?.value || "0");
    if (name || amount) items.push({ name, category, amount: isNaN(amount) ? 0 : amount });
  });
  return items;
}

function updateItemsTotal() {
  const total = readItemsFromTable().reduce((a, b) => a + b.amount, 0);
  $("#items-total").textContent = "Receipt total: " + fmt(total);
}

$("#items-table").addEventListener("input", updateItemsTotal);
$("#items-table").addEventListener("click", (e) => {
  if (e.target.dataset.rmItem !== undefined) {
    const items = readItemsFromTable();
    items.splice(Number(e.target.dataset.rmItem), 1);
    renderItemsTable(items.length ? items : [{ name: "", amount: "", category: "General" }]);
  }
});
$("#add-item-row").addEventListener("click", () => {
  const items = readItemsFromTable();
  items.push({ name: "", amount: "", category: "General" });
  renderItemsTable(items);
});

$("#save-receipt").addEventListener("click", () => {
  const items = readItemsFromTable().filter((it) => it.amount > 0);
  if (!items.length) { toast("Add at least one priced item"); return; }
  const entries = items.map((it) => ({
    amount: it.amount, category: it.category || "General", note: it.name,
  }));
  api("/api/spending", "POST", { entries });
  $("#items-card").style.display = "none";
  $("#receipt-text").value = "";
  $("#receipt-preview").style.display = "none";
  $("#ocr-note").textContent = "";
  toast(items.length + " items saved to spending");
});

/* -------------------- Sandbox -------------------- */
function runSandbox() {
  const amount = Number($("#sb-amount").value);
  const apr = Number($("#sb-apr").value);
  const term = Number($("#sb-term").value);
  if (!amount || !term) { $("#sandbox-result").style.display = "none"; return; }
  api("/api/sandbox", "POST", { amount, apr, termMonths: term }).then((r) => {
    $("#sandbox-result").style.display = "block";
    $("#sb-payment").textContent = fmt(r.monthlyPayment);
    $("#sb-interest").textContent = fmt(r.totalInterest);
    $("#sb-total").textContent = fmt(r.totalCost);
    $("#sb-daily-now").textContent = fmt(r.currentDailyBaseline) + " / day";
    $("#sb-daily-new").textContent = fmt(r.newDailyBaseline) + " / day";
    $("#sb-daily-new").style.color = r.newDailyBaseline < 0 ? "var(--danger)" : "";
    $("#sb-drop").textContent = `That's ${fmt(r.dailyDrop)} less to spend every single day for ${term} months.`;
    const yrs = (term / 12).toFixed(term % 12 ? 1 : 0);
    $("#sb-verdict").textContent = r.affordable
      ? `You could absorb this — you'd still have ${fmt(r.newDailyBaseline)}/day free after the payment. Over ${yrs} years you'd pay ${fmt(r.totalInterest)} in interest.`
      : `This pushes your everyday budget into the red by ${fmt(-r.newPool)}/mo. You'd be borrowing from essentials to make the payment — not affordable at your current income.`;
    $("#sb-verdict").style.color = r.affordable ? "" : "var(--danger)";
  });
}
["#sb-amount", "#sb-apr", "#sb-term"].forEach((id) => $(id).addEventListener("input", runSandbox));
$$(".preset").forEach((btn) => btn.addEventListener("click", () => {
  $("#sb-amount").value = btn.dataset.amount;
  $("#sb-apr").value = btn.dataset.apr;
  $("#sb-term").value = btn.dataset.term;
  runSandbox();
}));

/* -------------------- Boot -------------------- */
async function load() {
  const data = await api("/api/state");
  STATE = data.state; SUMMARY = data.summary;
  render();
}
/* -------------------- Can I afford it? -------------------- */
let affordPending = null;
function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
$("#afford-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const price = Number(f.price.value);
  if (!price || price <= 0) return;
  renderAfford(f.item.value.trim(), price);
});
function renderAfford(itemRaw, price) {
  const s = SUMMARY;
  const item = itemRaw || "that";
  const available = s.remainingThisMonth;   // free-to-spend still left this month
  const daily = s.dailyAllowance;
  $("#afford-result").style.display = "block";
  const vEl = $("#afford-verdict"), dEl = $("#afford-detail"), logBtn = $("#afford-log");
  let cls, head, detail, canLog = false;

  if (s.income === 0) {
    cls = "afford-no"; head = "Add your income first";
    detail = "Head to Income & Bills so Float knows your budget, then check back.";
  } else if (available <= 0) {
    cls = "afford-no"; head = "⛔ Not right now";
    detail = "You've used up your free-to-spend for this month." +
      (daily > 0 ? ` About ${fmt(daily)} frees up each day as the month rolls on.` : "");
  } else if (price <= available) {
    canLog = true;
    if (price <= daily) {
      cls = "afford-yes"; head = "✅ Easy yes";
      detail = `${capFirst(item)} fits inside today's ${fmt(daily)} allowance. You'd still have ${fmt(available - price)} free this month.`;
    } else if (price <= available * 0.5) {
      cls = "afford-yes"; head = "✅ Yes — go for it";
      detail = `After buying ${item} you'd still have ${fmt(available - price)} of your ${fmt(available)} free-to-spend left this month.`;
    } else {
      cls = "afford-tight"; head = "⚠️ Yes, but it's a big chunk";
      detail = `${capFirst(item)} is ${fmt(price)} of the ${fmt(available)} you have free this month — you'd have ${fmt(available - price)} left. Doable, but a lean rest of the month.`;
    }
  } else {
    const shortfall = price - available;
    const days = daily > 0 ? Math.ceil(shortfall / daily) : null;
    cls = "afford-no"; head = "⛔ Not this month";
    detail = `${capFirst(item)} is ${fmt(price)} — that's ${fmt(shortfall)} more than the ${fmt(available)} you have free this month.` +
      (days ? ` Setting aside your ${fmt(daily)}/day allowance, you could cover it in about ${days} day${days > 1 ? "s" : ""}.` : "");
  }
  vEl.className = "afford-verdict " + cls;
  vEl.textContent = head;
  dEl.textContent = detail;
  logBtn.style.display = canLog ? "" : "none";
  affordPending = canLog ? { item, price } : null;
}
$("#afford-log").addEventListener("click", () => {
  if (!affordPending) return;
  api("/api/spending", "POST", { amount: affordPending.price, category: "Purchase", note: affordPending.item });
  toast("Logged — enjoy it!");
  $("#afford-result").style.display = "none";
  $("#afford-form").reset();
  affordPending = null;
});

// Light/dark toggle (initial theme is set by the inline script in <head>)
$("#theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("float.theme", next); } catch (e) {}
  if (SUMMARY) renderPie(); // recolor the chart for the new surface
});

initCatPickers();
loadKey();
load();
