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

/* -------------------- Tabs -------------------- */
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    $("#view-" + tab.dataset.tab).classList.add("active");
  });
});

/* -------------------- Render -------------------- */
function render() {
  if (!STATE) return;
  renderDashboard();
  renderSetup();
  renderCar();
  renderMicrofunds();
}

function renderDashboard() {
  const s = SUMMARY;
  const daily = s.dailyAllowance;
  const el = $("#daily-allowance");
  el.textContent = fmt0(daily);
  el.style.color = daily < 0 ? "var(--danger)" : "#eafff2";

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

  // bills
  const bt = $("#bills-table");
  bt.innerHTML = "";
  if (!STATE.bills.length) {
    bt.innerHTML = `<tr><td class="empty">No bills yet. Add rent, utilities, subscriptions…</td></tr>`;
  }
  STATE.bills.forEach((b) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(b.name)}</td>
      <td><span class="tag">${escapeHtml(b.category)}</span></td>
      <td><span class="tag ${b.cancellable ? "can" : ""}" data-toggle="${b.id}" style="cursor:pointer">
        ${b.cancellable ? "✓ cancellable" : "fixed"}</span></td>
      <td class="amt">${fmt(b.amount)}</td>
      <td><button class="icon-btn" data-del-bill="${b.id}">✕</button></td>`;
    bt.appendChild(tr);
  });
  $("#bills-total").textContent = STATE.bills.length ? "Total bills: " + fmt(SUMMARY.bills) : "";

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
  });
  f.reset();
  toast("Bill added");
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
  else if (t.dataset.toggle) api("/api/bills/toggle", "POST", { id: t.dataset.toggle });
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
loadKey();
load();
