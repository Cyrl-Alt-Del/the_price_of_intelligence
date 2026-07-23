/* ============================================================
   currency.js — shared currency + FX, used by app.js and
   greenbench.js. Prices on the site are computed in USD; this
   module converts them to the user's currency (USD/GBP/EUR)
   at live ECB rates where available, else the snapshot's rate.
   Exposes global functions (like data.js / charts.js).
   ============================================================ */

const CURRENCIES = {
  USD: { symbol: "$", label: "USD" },
  GBP: { symbol: "£", label: "GBP" },
  EUR: { symbol: "€", label: "EUR" },
};

const _EUR_REGIONS = new Set([
  "DE","FR","ES","IT","NL","BE","AT","IE","PT","FI","GR","LU",
  "SK","SI","EE","LV","LT","MT","CY","HR",
]);

// Internal state: selected currency code + USD→X rates.
const _cur = { code: "USD", fx: { USD: 1, GBP: null, EUR: null, source: "—", date: "" } };

/* Default to the user's region; an explicit choice (localStorage) always wins. */
function currencyDetect() {
  try {
    const stored = localStorage.getItem("poi-currency");
    if (stored && CURRENCIES[stored]) return stored;
  } catch (e) {}
  const langs = navigator.languages && navigator.languages.length
    ? navigator.languages : [navigator.language || "en-GB"];
  const region = langs.map((l) => (l.split("-")[1] || "").toUpperCase()).find(Boolean) || "";
  if (region === "GB") return "GBP";
  if (_EUR_REGIONS.has(region)) return "EUR";
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (tz === "Europe/London") return "GBP";
    if (tz.indexOf("Europe/") === 0) return "EUR";
  } catch (e) {}
  return "USD";
}

function currencyGet() { return _cur.code; }
function currencySet(code) {
  if (!CURRENCIES[code]) return;
  _cur.code = code;
  try { localStorage.setItem("poi-currency", code); } catch (e) {}
}
function currencyInfo() { return { code: _cur.code, source: _cur.fx.source, date: _cur.fx.date }; }

/* Snapshot FX are quoted as GBP→USD / EUR→USD; invert for USD→target. */
function currencySetFromSnapshot(constants) {
  _cur.fx = {
    USD: 1,
    GBP: 1 / (constants.FX_GBPUSD || 1.29),
    EUR: 1 / (constants.FX_EURUSD || 1.09),
    source: "snapshot rate", date: "",
  };
}

/* Live ECB reference rates (frankfurter), then a second free source. */
async function currencyLoadLive() {
  const grab = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ": HTTP " + res.status);
    return res.json();
  };
  try {
    const r = await grab("https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP,EUR");
    if (r && r.rates && r.rates.GBP && r.rates.EUR) {
      _cur.fx = { USD: 1, GBP: r.rates.GBP, EUR: r.rates.EUR, source: "live ECB rate", date: r.date };
      return true;
    }
  } catch (e) {}
  try {
    const r = await grab("https://open.er-api.com/v6/latest/USD");
    if (r && r.rates && r.rates.GBP && r.rates.EUR) {
      _cur.fx = { USD: 1, GBP: r.rates.GBP, EUR: r.rates.EUR, source: "live rate", date: (r.time_last_update_utc || "").slice(5, 16) };
      return true;
    }
  } catch (e) {}
  return false;
}

/* Conversion + formatting (input is always USD). */
const money = (usd) => usd * (_cur.fx[_cur.code] || 1);
const curSym = () => CURRENCIES[_cur.code].symbol;

function fmtMoney(usd) {
  if (usd == null) return "—";
  const s = curSym();
  const v = money(usd);
  if (v >= 1000) return s + Math.round(v).toLocaleString("en-GB");
  if (v >= 100) return s + v.toFixed(0);
  if (v >= 0.01) return s + v.toFixed(2);
  if (v >= 0.0001) return s + v.toFixed(4);
  return "<" + s + "0.0001";
}

function fmtBigMoney(usd) {
  const s = curSym();
  const v = money(usd);
  if (v >= 1e9) return s + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return s + Math.round(v / 1e6) + "M";
  if (v >= 1e3) return s + Math.round(v / 1e3) + "k";
  return fmtMoney(usd);
}

/* Per-million-token list price in the selected currency (compact). */
const perMTok = (usd) => {
  const v = money(usd);
  return curSym() + (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3));
};

/* Populate a <select id="…"> with the currency options and wire onchange. */
function currencyMountSelect(selectEl, onChange) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  Object.keys(CURRENCIES).forEach((code) => {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = CURRENCIES[code].symbol + " " + code;
    if (code === _cur.code) o.selected = true;
    selectEl.appendChild(o);
  });
  selectEl.onchange = () => { currencySet(selectEl.value); onChange(); };
}
