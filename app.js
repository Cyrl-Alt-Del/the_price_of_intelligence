/* The Price of Intelligence — rendering & interaction.
   Data arrives from dated snapshots under data/ (see scripts/update-data.mjs). */

(function () {
  "use strict";

  const state = {
    manifest: null,
    snap: null,      // current snapshot: { date, label, constants, sources, models, tasks, meta }
    D: null,         // derived constants
    history: null,
    taskId: null,
    modelId: null,
    scales: { energy: "log", history: "log" },
  };

  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  // Currency + FX live in the shared currency.js module (money, curSym,
  // fmtMoney, fmtBigMoney, perMTok, currency* helpers).

  /* ---------- Theme ---------- */

  function initTheme() {
    const btn = $("theme-toggle");
    const setGlyph = () =>
      (btn.textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "☀" : "☾");
    setGlyph();

    btn.onclick = () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      const system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      try {
        // Only store an override when the choice differs from the OS setting,
        // so users who return to their system default keep tracking it live.
        if (next === system) localStorage.removeItem("poi-theme");
        else localStorage.setItem("poi-theme", next);
      } catch (e) {}
      setGlyph();
      renderAll(); // charts re-resolve palette tokens
    };

    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      let stored = null;
      try { stored = localStorage.getItem("poi-theme"); } catch (err) {}
      if (stored !== "light" && stored !== "dark") {
        document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
        setGlyph();
        renderAll();
      }
    });
  }

  /* ---------- Formatting ----------
     Money formatting (fmtMoney, fmtBigMoney, perMTok, money, curSym) is
     provided by the shared currency.js module. */

  function fmtWh(wh) {
    if (wh >= 1e6) return (wh / 1e6).toLocaleString("en-GB", { maximumFractionDigits: 1 }) + " MWh";
    if (wh >= 1000) return (wh / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 }) + " kWh";
    if (wh >= 100) return Math.round(wh) + " Wh";
    if (wh >= 1) return wh.toFixed(1) + " Wh";
    return wh.toFixed(2) + " Wh";
  }

  function fmtRatio(r) {
    if (r == null) return "—";
    if (r >= 100) return "≈" + (Math.round(r / 10) * 10).toLocaleString("en-GB") + "×";
    if (r >= 10) return "≈" + Math.round(r) + "×";
    return "≈" + r.toFixed(1) + "×";
  }

  // Large ratios (the water gap runs to tens of thousands) — rounds to clean
  // bands so it matches the water page's headline exactly.
  function fmtRatioLarge(r) {
    if (r == null) return "—";
    if (r >= 1e6) return "≈" + (r / 1e6).toFixed(1) + " million×";
    if (r >= 1000) return "≈" + Math.round(r / 1000).toLocaleString("en-GB") + ",000×";
    if (r >= 100) return "≈" + (Math.round(r / 10) * 10).toLocaleString("en-GB") + "×";
    return "≈" + Math.round(r) + "×";
  }

  function fmtHours(h) {
    if (h >= 1) return h % 1 === 0 ? h + " h" : h.toFixed(1) + " h";
    return Math.round(h * 60) + " min";
  }

  function fmtMl(ml) {
    if (ml >= 1000) return (ml / 1000).toFixed(1) + " L";
    if (ml >= 10) return Math.round(ml) + " mL";
    return ml.toFixed(1) + " mL";
  }

  // Water spans mL → kL; matches the water page's fmtL.
  function fmtWater(litres) {
    if (litres >= 1000) return (litres / 1000).toFixed(1) + " kL";
    if (litres >= 10) return Math.round(litres).toLocaleString("en-GB") + " L";
    if (litres >= 1) return litres.toFixed(1) + " L";
    if (litres >= 0.001) return Math.round(litres * 1000) + " mL";
    return (litres * 1000).toFixed(1) + " mL";
  }

  function fmtPct(x) {
    if (x >= 0.1) return (x * 100).toFixed(1) + "%";
    if (x >= 0.001) return (x * 100).toFixed(2) + "%";
    return "<0.1%";
  }

  function fmtDate(iso) {
    return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
      year: "numeric", month: "short", day: "numeric",
    });
  }

  const CONF = {
    confirmed:   { glyph: "✓", label: "confirmed" },
    reported:    { glyph: "◐", label: "reported" },
    estimated:   { glyph: "≈", label: "estimated" },
    unavailable: { glyph: "—", label: "unavailable" },
  };

  const badgeHTML = (conf) =>
    `<span class="badge ${conf}"><span class="glyph">${CONF[conf].glyph}</span>${CONF[conf].label}</span>`;

  const model = () => state.snap.models.find((m) => m.id === state.modelId);
  const task = () => state.snap.tasks.find((t) => t.id === state.taskId);
  const C = () => state.snap.constants;

  /* ---------- Data loading ---------- */

  async function fetchJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function loadSnapshot(date) {
    state.snap = await fetchJSON(`data/${date}.json`);
    state.D = deriveConstants(state.snap.constants);
    if (!state.snap.tasks.some((t) => t.id === state.taskId)) state.taskId = state.snap.tasks[0].id;
    if (!state.snap.models.some((m) => m.id === state.modelId)) state.modelId = state.snap.models[0].id;
  }

  async function boot() {
    try {
      state.manifest = await fetchJSON("data/manifest.json");
      await loadSnapshot(state.manifest.latest);
      state.history = await fetchJSON("data/history.json");
    } catch (err) {
      (document.querySelector(".hero .deck") || document.querySelector(".hero .sub")).innerHTML =
        "Could not load data snapshots. If you opened this file directly, serve the folder over HTTP " +
        "(e.g. <code>python3 -m http.server</code>) — browsers block <code>file://</code> data loads.";
      console.error(err);
      return;
    }
    state.taskId = state.snap.tasks[0].id;
    state.modelId = state.snap.models[0].id;
    currencySet(currencyDetect());
    currencySetFromSnapshot(state.snap.constants);  // synchronous fallback so prices render immediately
    initTheme();
    renderSnapshotSelect();
    renderCurrencySelect();
    renderAll();
    buildRail();
    // Upgrade to live FX in the background, then re-render if it succeeded.
    currencyLoadLive().then((ok) => { updateFxNote(); if (ok) renderAll(); });
  }

  function renderCurrencySelect() {
    currencyMountSelect($("currency-select"), renderAll);
    updateFxNote();
  }

  function updateFxNote() {
    const info = currencyInfo();
    const wrap = $("currency-wrap");
    if (wrap) {
      wrap.title = info.code === "USD"
        ? "Prices in US dollars"
        : `Prices converted from USD at the ${info.source}${info.date ? " (" + info.date + ")" : ""}`;
    }
    const note = $("fx-note");
    if (note) {
      note.textContent = info.code === "USD"
        ? ""
        : `Prices shown in ${info.code}, converted from USD at the ${info.source}${info.date ? ", " + info.date : ""}.`;
    }
  }

  /* ---------- Controls ---------- */

  function renderSnapshotSelect() {
    const sel = $("snapshot-select");
    sel.innerHTML = "";
    const todayISO = new Date().toISOString().slice(0, 10);
    [...state.manifest.snapshots].sort().reverse().forEach((d) => {
      const o = document.createElement("option");
      o.value = d;
      o.textContent = fmtDate(d) + (d === todayISO ? " · today" : "");
      if (d === state.snap.date) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = async () => {
      await loadSnapshot(sel.value);
      renderAll();
    };
    // Freshness marker: warn subtly when the newest snapshot is aging
    const ageDays = Math.floor((Date.parse(todayISO) - Date.parse(state.manifest.latest)) / 86400e3);
    const mark = $("freshness");
    if (mark) {
      mark.textContent = ageDays <= 0 ? "●" : ageDays <= 7 ? "" : "⚠";
      mark.title = ageDays <= 0 ? "Data refreshed today"
        : ageDays <= 7 ? "" : `Latest snapshot is ${ageDays} days old — run scripts/update-data.mjs`;
      mark.className = "fresh-dot" + (ageDays <= 0 ? " today" : ageDays > 7 ? " stale" : "");
    }
  }

  function renderChips() {
    const row = $("task-chips");
    row.innerHTML = "";
    state.snap.tasks.forEach((t) => {
      const b = document.createElement("button");
      b.className = "chip" + (t.id === state.taskId ? " active" : "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", t.id === state.taskId);
      b.textContent = t.icon + " " + t.name;
      b.onclick = () => { state.taskId = t.id; renderAll(); };
      row.appendChild(b);
    });
  }

  function renderModelSelect() {
    const sel = $("model-select");
    sel.innerHTML = "";
    const groups = [
      { key: "frontier", label: "Frontier (proprietary)" },
      { key: "open", label: "Open weights (hosted)" },
      { key: "self", label: "Self-hosted" },
    ];
    groups.forEach((g) => {
      const models = state.snap.models.filter((m) => m.group === g.key);
      if (!models.length) return;
      const og = document.createElement("optgroup");
      og.label = g.label;
      models.forEach((m) => {
        const o = document.createElement("option");
        o.value = m.id;
        const price = m.inPerM != null ? ` — ${perMTok(m.inPerM)}/${perMTok(m.outPerM)}` : " — price varies";
        o.textContent = `${CONF[m.confidence].glyph} ${m.name}${price}`;
        if (m.id === state.modelId) o.selected = true;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.onchange = () => { state.modelId = sel.value; renderAll(); };
  }

  /* ---------- Hero ---------- */

  function renderHero() {
    const m = model();
    const r = computeTask(state.snap.tasks[0], m, C(), state.D);
    $("hero-ratio").textContent = fmtRatio(r.priceRatio);
    if (r.ai.price == null) {
      $("hero-caption").innerHTML =
        `A person charges <strong>${fmtMoney(r.human.price)}</strong> to write a 1,000-word article. ` +
        `For <strong>${m.name}</strong> no single price exists — but it burns ` +
        `<strong>${fmtRatio(r.energyRatio)}</strong> less energy. ` +
        `<a href="#ledger">Price your own task →</a>`;
    } else {
      $("hero-caption").innerHTML =
        `A person charges <strong>${fmtMoney(r.human.price)}</strong> to write a 1,000-word article. ` +
        `<strong>${m.name}</strong> charges about <strong>${fmtMoney(r.ai.price)}</strong> — and burns ` +
        `<strong>${fmtRatio(r.energyRatio)}</strong> less energy doing it. ` +
        `<a href="#ledger">Price your own task →</a>`;
    }
  }

  /* ---------- Ledger ---------- */

  function compLegendRow(color, label, usd, share) {
    return `<div class="row">
      <span class="swatch" style="background:${color}"></span>
      <span class="k">${label}</span>
      <span class="v">${fmtMoney(usd)}</span>
      <span class="pct">${fmtPct(share)}</span>
    </div>`;
  }

  function renderComp(barEl, legendEl, side, fuelLabel, trainLabel, otherLabel) {
    const total = side.price;
    const shares = [
      { cls: "seg-fuel", varName: "--layer-fuel", label: fuelLabel, usd: side.fuel },
      { cls: "seg-training", varName: "--layer-training", label: trainLabel, usd: side.training },
      { cls: "seg-other", varName: "--layer-other", label: otherLabel, usd: side.other },
    ];
    barEl.innerHTML = shares
      .map((s) => `<span class="${s.cls}" style="flex:${Math.max(s.usd / total, 0.004)}"></span>`)
      .join("");
    legendEl.innerHTML = shares
      .map((s) => compLegendRow(css(s.varName), s.label, s.usd, s.usd / total))
      .join("");
  }

  function renderLedger() {
    const t = task();
    const m = model();
    const r = computeTask(t, m, C(), state.D);

    // Water (litres), full chain for the AI side so it matches the water gap
    // and the water page's headline — human food-water vs AI full-chain water.
    const hWaterL = humanWaterL(t, C());
    const aWaterL = aiWaterFullL(t, C());

    $("h-price").textContent = fmtMoney(r.human.price);
    $("h-price-note").textContent = t.humanPriceNote;
    $("h-time").textContent = fmtHours(t.humanHours);
    $("h-energy").textContent = fmtWh(r.human.wh);
    $("h-water").textContent = fmtWater(hWaterL);
    renderComp($("h-comp"), $("h-comp-legend"), r.human,
      "Fuel (food, task share)", "Training (education, amortised)", "Everything else (housing, taxes, scarcity…)");

    $("ai-name").textContent = m.name;
    $("ai-badge").innerHTML = badgeHTML(m.confidence);
    $("a-energy").textContent = fmtWh(r.ai.wh);
    $("a-water").textContent = fmtWater(aWaterL);

    const priceEl = $("a-price");
    if (r.ai.price == null) {
      priceEl.textContent = "—";
      priceEl.classList.add("na");
      $("a-price-note").textContent = m.note;
      $("a-comp-wrap").style.display = "none";
    } else {
      priceEl.textContent = fmtMoney(r.ai.price);
      priceEl.classList.remove("na");
      $("a-price-note").textContent =
        `${(t.tokensIn / 1000).toLocaleString()}k tokens in, ${(t.tokensOut / 1000).toLocaleString()}k out — ` +
        `${t.tokenNote}. ${m.note}`;
      $("a-comp-wrap").style.display = "";
      renderComp($("a-comp"), $("a-comp-legend"), r.ai,
        "Fuel (electricity)", "Training run (amortised)", "Everything else (hardware, R&D, margin…)");
    }

    const rp = $("ratio-price");
    rp.textContent = fmtRatio(r.priceRatio);
    rp.classList.toggle("na", r.priceRatio == null);
    $("ratio-price-sub").textContent = r.priceRatio == null
      ? "no single price exists for self-hosted models"
      : "human market price ÷ AI API price";
    $("ratio-energy").textContent = fmtRatio(r.energyRatio);
    $("ratio-water").textContent = fmtRatioLarge(hWaterL / aWaterL);

    // Compact water teaser for the "Water & the live grid" section
    const wt = $("water-teaser");
    if (wt) {
      const glasses = Math.floor(0.25 / aiWaterFullL(state.snap.tasks[0], C()));
      const humanArticleWater = humanWaterL(state.snap.tasks[0], C());
      wt.innerHTML =
        `A glass of water (250 mL) covers about <strong>${glasses.toLocaleString("en-GB")}</strong> AI ` +
        `article drafts, full chain. The same task done by a person carries <strong>${fmtWater(humanArticleWater)}</strong> ` +
        `— in the food. See on-site vs full-chain accounting, closed-loop cooling, and why siting matters.`;
    }

    // Hybrid workflow: AI draft + human review at the median wage
    const hy = $("hybrid-line");
    if (r.ai.price != null && t.reviewMinutes) {
      const hybrid = r.ai.price + (t.reviewMinutes / 60) * state.D.medianHourlyWage;
      const hybridRatio = r.human.price / hybrid;
      hy.innerHTML = ` For this task, a realistic hybrid — AI draft plus <strong>${t.reviewMinutes} min` +
        ` of human review</strong> at the median wage — costs <strong>${fmtMoney(hybrid)}</strong>,` +
        ` still ${fmtRatio(hybridRatio)} cheaper than fully human.`;
    } else {
      hy.textContent = "";
    }
  }

  /* ---------- Chart helpers ---------- */

  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  const tooltip = $("tooltip");
  function bindTooltip(el, html) {
    el.addEventListener("mousemove", (e) => {
      tooltip.innerHTML = html;
      tooltip.classList.add("show");
      const pad = 14;
      let x = e.clientX + pad, y = e.clientY + pad;
      const r = tooltip.getBoundingClientRect();
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
      tooltip.style.left = x + "px";
      tooltip.style.top = y + "px";
    });
    el.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
  }

  /* ---------- Fuel price chart ---------- */

  function renderFuelChart() {
    const rows = [
      { label: "Human — food (USDA moderate plan)", value: state.D.humanFuelUsdPerKwh, color: css("--human") },
      { label: "AI — industrial electricity", value: C().ELEC_INDUSTRIAL, color: css("--ai") },
      { label: "Household electricity (reference)", value: C().ELEC_RESIDENTIAL, color: css("--layer-other") },
    ];
    const W = 960, rowH = 56, padL = 12, padR = 110, labelH = 20;
    const H = rows.length * rowH + 8;
    const max = Math.max(...rows.map((r) => r.value));
    const plotW = W - padL - padR;

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": "Bar chart of fuel price per kilowatt-hour: human food fuel versus grid electricity" });

    rows.forEach((r, i) => {
      const y = i * rowH;
      const barW = Math.max((r.value / max) * plotW, 3);
      const label = svgEl("text", { x: padL, y: y + labelH - 4, "font-size": 14, fill: css("--ink-2") });
      label.textContent = r.label;
      svg.appendChild(label);

      const bar = svgEl("rect", { x: padL, y: y + labelH + 2, width: barW, height: 16, rx: 4, fill: r.color });
      svg.appendChild(bar);

      const val = svgEl("text", {
        x: padL + barW + 10, y: y + labelH + 15, "font-size": 14, "font-weight": 600, fill: css("--ink"),
      });
      val.textContent = curSym() + money(r.value).toFixed(2) + " / kWh";
      svg.appendChild(val);

      bindTooltip(bar, `<strong>${r.label}</strong><br>${curSym()}${money(r.value).toFixed(4)} per kWh`);
    });

    const note = svgEl("text", { x: padL, y: H - 2, "font-size": 12.5, fill: css("--ink-muted") });
    note.textContent = `Human fuel costs ≈${Math.round(state.D.humanFuelUsdPerKwh / C().ELEC_INDUSTRIAL)}× more per kWh than the electricity a data centre buys.`;
    svg.appendChild(note);

    const host = $("fuel-chart");
    host.innerHTML = "";
    host.appendChild(svg);
  }

  /* ---------- Energy per task (log dumbbell) ---------- */

  function renderEnergyChart() {
    const mode = state.scales.energy;
    const m = model();
    const data = state.snap.tasks.map((t) => {
      const r = computeTask(t, m, C(), state.D);
      return { name: t.name, icon: t.icon, human: r.human.wh, ai: r.ai.wh, ratio: r.energyRatio };
    });

    const slot = $("energy-toggle");
    if (slot) slot.replaceChildren(scaleToggle(mode, (next) => {
      state.scales.energy = next;
      renderEnergyChart();
    }));

    const W = 960, rowH = 52, padL = 250, padR = 60, padT = 8, padB = 34;
    const H = padT + data.length * rowH + padB;
    const plotW = W - padL - padR;

    const axis = makeAxis(data.flatMap((d) => [d.human, d.ai]), mode);
    const x = (wh) => padL + axis.pos(wh) * plotW;

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `${mode === "log" ? "Log" : "Linear"}-scale dumbbell chart of watt-hours per task for human versus AI` });

    axis.lines.forEach((v) => {
      svg.appendChild(svgEl("line", {
        x1: x(v), x2: x(v), y1: padT, y2: H - padB, stroke: css("--grid"), "stroke-width": 1,
      }));
      const t = svgEl("text", { x: x(v), y: H - padB + 18, "font-size": 12.5, fill: css("--ink-muted"), "text-anchor": "middle" });
      t.textContent = v === 0 ? "0" : fmtWh(v);
      svg.appendChild(t);
    });

    data.forEach((d, i) => {
      const cy = padT + i * rowH + rowH / 2;

      const label = svgEl("text", { x: 12, y: cy + 5, "font-size": 14, fill: css("--ink-2") });
      label.textContent = d.icon + " " + d.name;
      svg.appendChild(label);

      svg.appendChild(svgEl("line", {
        x1: x(d.ai), x2: x(d.human), y1: cy, y2: cy, stroke: css("--baseline"), "stroke-width": 1.5,
      }));

      const mk = (val, color, who) => {
        const g = svgEl("g", {});
        const hit = svgEl("circle", { cx: x(val), cy, r: 14, fill: "transparent" });
        const dot = svgEl("circle", {
          cx: x(val), cy, r: 6, fill: color, stroke: css("--surface"), "stroke-width": 2,
        });
        g.appendChild(dot);
        g.appendChild(hit);
        bindTooltip(g, `<strong>${d.name}</strong><br>${who}: ${fmtWh(val)}<br>Gap: ${fmtRatio(d.ratio)}`);
        svg.appendChild(g);
      };
      mk(d.human, css("--human"), "Human");
      mk(d.ai, css("--ai"), "AI");
    });

    const host = $("energy-chart");
    host.innerHTML = "";
    host.appendChild(svg);
  }

  /* ---------- History: the falling price of intelligence ---------- */

  function renderHistoryChart() {
    if (!state.history) return;
    const mode = state.scales.history;
    const bt = state.history.benchmarkTask;
    const toPoint = (p) => ({
      ...p,
      t: (() => { const [y, mo] = p.date.split("-").map(Number); return y + (mo - 0.5) / 12; })(),
      cost: promptCost(bt.tokensIn, bt.tokensOut, p.inPerM, p.outPerM),
    });
    const seriesA = state.history.flagship.map(toPoint);
    const seriesB = state.history.gpt4class.map(toPoint);

    const slot = $("history-toggle");
    if (slot) slot.replaceChildren(scaleToggle(mode, (next) => {
      state.scales.history = next;
      renderHistoryChart();
    }));

    const W = 960, H = 380, padL = 72, padR = 170, padT = 16, padB = 40;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const t0 = 2023.0, t1 = 2026.8;
    const axis = makeAxis([...seriesA, ...seriesB].map((p) => p.cost), mode);
    const x = (t) => padL + ((t - t0) / (t1 - t0)) * plotW;
    const y = (c) => padT + (1 - axis.pos(c)) * plotH;

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `${mode === "log" ? "Log" : "Linear"}-scale line chart: list price for the benchmark article task, 2023 to 2026, frontier flagship versus cheapest GPT-4-class model` });

    const fmtTick = (usd) => {
      const v = money(usd);
      return v === 0 ? curSym() + "0" : v >= 0.01 ? curSym() + v.toFixed(2) : curSym() + v.toFixed(v >= 0.001 ? 3 : 4);
    };
    axis.lines.forEach((v) => {
      svg.appendChild(svgEl("line", {
        x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: css("--grid"), "stroke-width": 1,
      }));
      const t = svgEl("text", { x: padL - 8, y: y(v) + 4, "font-size": 12.5, fill: css("--ink-muted"), "text-anchor": "end" });
      t.textContent = fmtTick(v);
      svg.appendChild(t);
    });
    // x ticks per year
    [2023, 2024, 2025, 2026].forEach((yr) => {
      const t = svgEl("text", { x: x(yr + 0.5), y: H - padB + 20, "font-size": 12.5, fill: css("--ink-muted"), "text-anchor": "middle" });
      t.textContent = yr;
      svg.appendChild(t);
    });

    const drawSeries = (pts, color, name) => {
      const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.cost).toFixed(1)}`).join(" ");
      svg.appendChild(svgEl("path", {
        d: path, fill: "none", stroke: color, "stroke-width": 2,
        "stroke-linejoin": "round", "stroke-linecap": "round",
      }));
      pts.forEach((p) => {
        const est = p.confidence === "estimated";
        const g = svgEl("g", {});
        const dot = svgEl("circle", {
          cx: x(p.t), cy: y(p.cost), r: 5.5,
          fill: est ? css("--surface") : color,
          stroke: est ? color : css("--surface"),
          "stroke-width": 2,
        });
        const hit = svgEl("circle", { cx: x(p.t), cy: y(p.cost), r: 14, fill: "transparent" });
        g.appendChild(dot); g.appendChild(hit);
        bindTooltip(g,
          `<strong>${p.name}</strong> · ${p.date}<br>${perMTok(p.inPerM)}/${perMTok(p.outPerM)} per MTok<br>` +
          `${bt.label}: ${fmtMoney(p.cost)}<br>confidence: ${p.confidence}`);
        svg.appendChild(g);
      });
      // direct end-label
      const last = pts[pts.length - 1];
      const lbl = svgEl("text", {
        x: x(last.t) + 12, y: y(last.cost) + 4, "font-size": 13, "font-weight": 600, fill: css("--ink"),
      });
      lbl.textContent = `${name} ${fmtMoney(last.cost)}`;
      svg.appendChild(lbl);
    };

    drawSeries(seriesA, css("--hist-a"), "flagship");
    drawSeries(seriesB, css("--hist-b"), "GPT-4-class");

    const host = $("history-chart");
    host.innerHTML = "";
    host.appendChild(svg);
  }

  /* ---------- Training section ---------- */

  function renderTraining() {
    const D = state.D, K = C();
    $("t-human-total").textContent = fmtBigMoney(D.educationTotalUsd);
    $("t-human-hr").textContent = fmtMoney(D.trainingUsdPerWorkHr) + " per working hour";
    const eduDays = (K.K12_YEARS + K.COLLEGE_YEARS) * 365;
    const eduMWh = (eduDays * D.humanKwhPerDay) / 1000;
    $("t-human-energy").textContent = "≈" + Math.round(eduMWh) + " MWh (17 years of meals)";

    $("t-ai-total").textContent = fmtBigMoney(K.TRAINING_RUN_USD);
    $("t-ai-task").textContent = "≈" + fmtMoney(D.aiTrainingUsdPerBaseQuery) + " per median task";
    $("t-ai-energy").textContent = "≈" + Math.round(D.aiTrainingEnergyKwh / 1e6) + " GWh (estimated)";

    const eduEquiv = Math.round(D.aiTrainingEnergyKwh / 1000 / eduMWh / 100) * 100;
    $("train-punchline").innerHTML =
      `One frontier training run consumes roughly the metabolic energy of <strong>~${eduEquiv.toLocaleString()}` +
      ` complete human educations</strong> — but the result is copied to every user at once. Spread over its` +
      ` lifetime, the model's training adds <strong>~${fmtMoney(D.aiTrainingUsdPerBaseQuery)}</strong> to a typical task; a degree adds` +
      ` <strong>${fmtMoney(D.trainingUsdPerWorkHr)}</strong> to every hour a graduate works.`;
  }

  /* ---------- Data table ---------- */

  function renderTable() {
    const m = model();
    const head = `<thead><tr>
      <th>Task</th><th>Human price</th><th>AI price (${m.name})</th><th>Price gap</th>
      <th>Human time</th><th>Human energy</th><th>AI energy</th><th>Energy gap</th>
      <th>Human fuel $</th><th>Human training $</th><th>AI electricity $</th><th>AI training $</th>
    </tr></thead>`;
    const rows = state.snap.tasks.map((t) => {
      const r = computeTask(t, m, C(), state.D);
      return `<tr>
        <td>${t.icon} ${t.name}</td>
        <td>${fmtMoney(r.human.price)}</td>
        <td>${fmtMoney(r.ai.price)}</td>
        <td>${fmtRatio(r.priceRatio)}</td>
        <td>${fmtHours(t.humanHours)}</td>
        <td>${fmtWh(r.human.wh)}</td>
        <td>${fmtWh(r.ai.wh)}</td>
        <td>${fmtRatio(r.energyRatio)}</td>
        <td>${fmtMoney(r.human.fuel)}</td>
        <td>${fmtMoney(r.human.training)}</td>
        <td>${fmtMoney(r.ai.fuel)}</td>
        <td>${fmtMoney(r.ai.training)}</td>
      </tr>`;
    }).join("");
    $("data-table").innerHTML = head + "<tbody>" + rows + "</tbody>";
  }

  /* ---------- Sources & footer ---------- */

  function renderSources() {
    $("sources-list").innerHTML = Object.values(state.snap.sources)
      .map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.label}</a></li>`)
      .join("");
    const lv = state.snap.meta && state.snap.meta.lastVerified;
    if (lv) {
      $("verified-note").textContent =
        "Last verified — " +
        Object.entries(lv).map(([k, v]) => `${k}: ${fmtDate(v)}`).join(" · ");
    }
    const fs = $("footer-snapshot");
    if (fs) fs.textContent = `Data as of ${state.snap.label}`;
  }

  /* ---------- In-page progress rail ---------- */

  function buildRail() {
    const rail = $("rail");
    if (!rail) return;
    const sections = [...document.querySelectorAll("section[data-rail]")];
    rail.innerHTML = sections
      .map((s) => `<a href="#${s.id}" data-for="${s.id}" title="${s.dataset.rail}"><span class="txt">${s.dataset.rail}</span><span class="dot"></span></a>`)
      .join("");

    const links = new Map([...rail.querySelectorAll("a")].map((a) => [a.dataset.for, a]));
    const setActive = (id) => {
      links.forEach((a, key) => a.classList.toggle("active", key === id));
    };

    // The active section is the last one whose top has scrolled past a marker
    // ~35% down the viewport — i.e. the section you're currently reading.
    // Runs directly on scroll (8 cheap rect reads); deterministic everywhere.
    const update = () => {
      const marker = window.innerHeight * 0.35;
      let current = sections[0].id;
      for (const s of sections) {
        if (s.getBoundingClientRect().top <= marker) current = s.id;
        else break;
      }
      setActive(current);
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  /* ---------- Render all ---------- */

  function renderAll() {
    renderChips();
    renderModelSelect();
    renderHero();
    renderLedger();
    renderFuelChart();
    renderEnergyChart();
    renderHistoryChart();
    renderTraining();
    renderTable();
    renderSources();
  }

  boot();
})();
