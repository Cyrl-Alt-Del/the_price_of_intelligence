/* Your Grid, Live — localised energy lens with a regional GB dashboard.
   Kept separate from app.js on purpose: this page owns the external API
   dependencies; the main site stays fully static and snapshot-driven.

   Concept adapted from Kate Morley's National Grid: Live (grid.iamkate.com),
   released under CC0 — data plumbing here is client-side against the
   NESO/Oxford Carbon Intensity API and Octopus/aWATTar tariff APIs. */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const state = {
    snap: null, D: null,
    region: "uk",
    ukRegionId: 13,          // Carbon Intensity API region id (default London)
    ukRegions: null,         // [{regionid, shortname, intensity, generationmix}]
    national: null,          // { mix, intensity }
    taskId: null, modelId: null,
    price: null,             // { usdPerKwh, display, badge, note }
    green: null,             // { renewPct, lowCarbonPct, intensity, label, forecast }
  };

  /* Carbon Intensity API regionid → Octopus GSP letter (for Agile tariffs) */
  const REGION_GSP = {
    1: "P", 2: "N", 3: "G", 4: "F", 5: "M", 6: "D", 7: "K",
    8: "E", 9: "B", 10: "A", 11: "L", 12: "H", 13: "C", 14: "J",
  };

  const REGIONS = [
    { id: "uk", label: "🇬🇧 United Kingdom" },
    { id: "deat", label: "🇩🇪🇦🇹 Germany / Austria" },
    { id: "us", label: "🇺🇸 United States" },
    { id: "custom", label: "✏️ Custom rate" },
  ];

  /* Fuel display groups for the generation-mix bar (≤6 classes).
     "other" bundles hydro, biomass, coal and the API's own "other". */
  const FUEL_GROUPS = [
    { key: "wind",    label: "Wind",    varName: "--fuel-wind",    fuels: ["wind"] },
    { key: "solar",   label: "Solar",   varName: "--fuel-solar",   fuels: ["solar"] },
    { key: "nuclear", label: "Nuclear", varName: "--fuel-nuclear", fuels: ["nuclear"] },
    { key: "gas",     label: "Gas",     varName: "--fuel-gas",     fuels: ["gas"] },
    { key: "imports", label: "Imports", varName: "--fuel-imports", fuels: ["imports"] },
    { key: "other",   label: "Other",   varName: "--fuel-other",   fuels: ["hydro", "biomass", "coal", "other"] },
  ];

  /* ---------- Theme (same behaviour as the main page) ---------- */

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
        if (next === system) localStorage.removeItem("poi-theme");
        else localStorage.setItem("poi-theme", next);
      } catch (e) {}
      setGlyph();
      renderNational();
      renderRegionStrip();
    };
  }

  /* ---------- Formatting ---------- */

  const fmtWh = (wh) => (wh >= 1000 ? (wh / 1000).toFixed(2) + " kWh" : wh >= 1 ? wh.toFixed(1) + " Wh" : wh.toFixed(2) + " Wh");
  const fmtCents = (usd) => {
    if (usd == null) return "—";
    if (usd >= 1) return "$" + usd.toFixed(2);
    if (usd >= 0.01) return (usd * 100).toFixed(1) + "¢";
    if (usd >= 0.0001) return (usd * 100).toFixed(3) + "¢";
    return "<0.01¢";
  };
  const badge = (kind, text) => {
    const cls = { live: "confirmed", static: "reported", estimated: "estimated", error: "unavailable" }[kind];
    const glyph = { live: "●", static: "▪", estimated: "≈", error: "—" }[kind];
    return `<span class="badge ${cls}"><span class="glyph">${glyph}</span>${text}</span>`;
  };

  /* ---------- Data loading ---------- */

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ": HTTP " + res.status);
    return res.json();
  }

  function setFooterSnap(manifest) {
    const el = $("footer-snap");
    if (!el) return;
    const fresh = manifest.latest === new Date().toISOString().slice(0, 10);
    el.innerHTML =
      `<span class="fresh-dot ${fresh ? "today" : ""}">${fresh ? "● " : ""}</span>Data as of ${state.snap.label}`;
  }

  async function boot() {
    initTheme();
    let manifest;
    try {
      manifest = await fetchJSON("data/manifest.json");
      state.snap = await fetchJSON(`data/${manifest.latest}.json`);
      state.D = deriveConstants(state.snap.constants);
    } catch (err) {
      $("grid-sub").textContent = "Could not load the data snapshot — serve this folder over HTTP.";
      console.error(err);
      return;
    }
    state.taskId = state.snap.tasks[0].id;
    state.modelId = state.snap.models[0].id;
    setFooterSnap(manifest);
    renderRegionChips();
    renderSelectors();
    await refreshRegion();
  }

  /* ---------- Region data ---------- */

  async function fetchUK() {
    const C = state.snap.constants;

    // One call returns every region's live mix + intensity forecast,
    // plus national actuals from the dedicated endpoints.
    const [regional, gen, inten] = await Promise.all([
      fetchJSON("https://api.carbonintensity.org.uk/regional"),
      fetchJSON("https://api.carbonintensity.org.uk/generation"),
      fetchJSON("https://api.carbonintensity.org.uk/intensity"),
    ]);

    state.ukRegions = regional.data[0].regions.filter((r) => r.regionid <= 14);
    state.national = {
      mix: gen.data.generationmix,
      intensity: inten.data[0].intensity.actual ?? inten.data[0].intensity.forecast,
    };

    const reg = state.ukRegions.find((r) => r.regionid === state.ukRegionId);
    const pct = (fuel) => (reg.generationmix.find((m) => m.fuel === fuel) || {}).perc || 0;
    const renew = pct("wind") + pct("solar") + pct("hydro") + pct("biomass");
    state.green = {
      renewPct: renew,
      lowCarbonPct: renew + pct("nuclear"),
      intensity: reg.intensity.forecast,
      label: reg.shortname,
      forecast: true,
    };

    // Live half-hourly retail price for the same region (Octopus Agile)
    const gsp = REGION_GSP[state.ukRegionId];
    try {
      const products = await fetchJSON("https://api.octopus.energy/v1/products/?is_variable=true&brand=OCTOPUS_ENERGY");
      const agile = products.results.find((p) => p.code.startsWith("AGILE") && p.direction === "IMPORT");
      if (!agile) throw new Error("no AGILE product");
      const tariff = `E-1R-${agile.code}-${gsp}`;
      const from = new Date(Date.now() - 45 * 60e3).toISOString();
      const to = new Date(Date.now() + 45 * 60e3).toISOString();
      const rates = await fetchJSON(
        `https://api.octopus.energy/v1/products/${agile.code}/electricity-tariffs/${tariff}/standard-unit-rates/?period_from=${from}&period_to=${to}`
      );
      const now = Date.now();
      const cur = rates.results.find((r) => Date.parse(r.valid_from) <= now && now < Date.parse(r.valid_to))
        || rates.results[rates.results.length - 1];
      const pPerKwh = cur.value_inc_vat;
      const usd = (pPerKwh / 100) * C.FX_GBPUSD;
      state.price = {
        usdPerKwh: usd,
        display: pPerKwh.toFixed(1) + "p/kWh (≈$" + usd.toFixed(2) + ")",
        badge: badge("live", "live · Octopus Agile + NESO"),
        note: `Half-hourly Agile rate for ${reg.shortname}, incl. VAT; carbon values are NESO 30-min regional forecasts. FX ≈ $${C.FX_GBPUSD}/£ (snapshot estimate).`,
      };
    } catch (e) {
      console.warn("Octopus fetch failed", e);
      state.price = {
        usdPerKwh: C.ELEC_RESIDENTIAL,
        display: "$" + C.ELEC_RESIDENTIAL.toFixed(2) + "/kWh",
        badge: badge("error", "price fetch failed — US average shown"),
        note: "Octopus Agile could not be reached; regional carbon data above is still live.",
      };
    }
  }

  async function fetchDEAT() {
    const C = state.snap.constants;
    state.green = null; state.national = null; state.ukRegions = null;
    const md = await fetchJSON("https://api.awattar.de/v1/marketdata");
    const now = Date.now();
    const cur = md.data.find((d) => d.start_timestamp <= now && now < d.end_timestamp) || md.data[0];
    const eurPerKwh = cur.marketprice / 1000;
    const usd = eurPerKwh * C.FX_EURUSD;
    state.price = {
      usdPerKwh: usd,
      display: (eurPerKwh * 100).toFixed(1) + " €c/kWh wholesale (≈$" + usd.toFixed(3) + ")",
      badge: badge("live", "live · EPEX spot via aWATTar"),
      note: `Wholesale day-ahead price this hour. Retail adds taxes and network fees (typically 2–3×). ` +
        `Live German grid-mix data has no free browser-accessible API — see energy-charts.info. FX ≈ $${C.FX_EURUSD}/€.`,
    };
  }

  function fetchUS() {
    const C = state.snap.constants;
    state.green = null; state.national = null; state.ukRegions = null;
    state.price = {
      usdPerKwh: C.ELEC_RESIDENTIAL,
      display: "$" + C.ELEC_RESIDENTIAL.toFixed(3) + "/kWh residential avg",
      badge: badge("static", "static · EIA monthly average"),
      note: "No free live nationwide price API without keys. Averages from the dated snapshot " +
        `(industrial: $${C.ELEC_INDUSTRIAL.toFixed(3)}, commercial: $${C.ELEC_COMMERCIAL.toFixed(3)}). ` +
        "Run scripts/update-data.mjs with an EIA_API_KEY to refresh.",
    };
  }

  function fetchCustom() {
    state.green = null; state.national = null; state.ukRegions = null;
    const cents = parseFloat($("custom-rate").value) || 18.8;
    state.price = {
      usdPerKwh: cents / 100,
      display: cents.toFixed(1) + "¢/kWh (yours)",
      badge: badge("estimated", "your rate"),
      note: "Enter the unit rate from your latest bill.",
    };
  }

  async function refreshRegion() {
    $("grid-sub").textContent = "Fetching…";
    $("grid-rows").innerHTML = "";
    $("green-meter").style.display = "none";
    $("custom-rate-row").style.display = state.region === "custom" ? "flex" : "none";
    try {
      if (state.region === "uk") await fetchUK();
      else if (state.region === "deat") await fetchDEAT();
      else if (state.region === "us") fetchUS();
      else fetchCustom();
    } catch (err) {
      console.error(err);
      state.green = null; state.national = null; state.ukRegions = null;
      fetchUS();
      state.price.badge = badge("error", "live fetch failed — static fallback");
    }
    renderRegionChips(); // region names arrive with the first UK fetch
    renderNational();
    renderGrid();
    renderTaskCost();
    renderRegionStrip();
  }

  /* ---------- Rendering ---------- */

  function renderRegionChips() {
    const row = $("region-chips");
    row.innerHTML = "";
    REGIONS.forEach((r) => {
      const b = document.createElement("button");
      b.className = "chip" + (r.id === state.region ? " active" : "");
      b.textContent = r.label;
      b.onclick = () => { state.region = r.id; renderRegionChips(); refreshRegion(); };
      row.appendChild(b);
    });
    if (state.region === "uk") {
      const sel = document.createElement("select");
      sel.className = "mini";
      sel.setAttribute("aria-label", "UK grid region");
      const names = state.ukRegions
        ? state.ukRegions.map((r) => [r.regionid, r.shortname])
        : Object.entries(REGION_GSP).map(([id]) => [id, "Region " + id]);
      names.forEach(([id, name]) => {
        const o = document.createElement("option");
        o.value = id; o.textContent = name; o.selected = Number(id) === state.ukRegionId;
        sel.appendChild(o);
      });
      sel.onchange = () => { state.ukRegionId = Number(sel.value); refreshRegion(); };
      row.appendChild(sel);
    }
  }

  /* National generation mix — 100% stacked bar with 2px surface gaps */
  function renderNational() {
    const card = $("national-card");
    if (!state.national) { card.style.display = "none"; return; }
    card.style.display = "";

    const mix = state.national.mix;
    const val = (fuels) => fuels.reduce((s, f) => s + ((mix.find((m) => m.fuel === f) || {}).perc || 0), 0);
    const groups = FUEL_GROUPS.map((g) => ({ ...g, perc: val(g.fuels) })).filter((g) => g.perc > 0);

    $("national-sub").textContent =
      `Great Britain generation mix · ${state.national.intensity} gCO₂/kWh · ` +
      new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    const bar = $("national-bar");
    bar.innerHTML = groups
      .map((g) => `<span style="flex:${Math.max(g.perc, 0.4)};background:${css(g.varName)}"></span>`)
      .join("");

    $("national-legend").innerHTML = groups
      .map((g) => {
        const detail = g.key === "other"
          ? g.fuels.map((f) => `${f} ${((mix.find((m) => m.fuel === f) || {}).perc || 0).toFixed(1)}%`).join(", ")
          : "";
        return `<div class="row" ${detail ? `title="${detail}"` : ""}>
          <span class="swatch" style="background:${css(g.varName)}"></span>
          <span class="k">${g.label}</span>
          <span class="v">${g.perc.toFixed(1)}%</span>
        </div>`;
      })
      .join("");
  }

  function renderGrid() {
    const p = state.price, g = state.green;
    $("grid-badge").innerHTML = p.badge;
    $("grid-sub").textContent = (g ? g.label + " · " : "") + new Date().toLocaleString(undefined, {
      weekday: "short", hour: "2-digit", minute: "2-digit",
    });

    let rows = `<div class="live-row"><span class="k">Electricity price</span><span class="v">${p.display}</span></div>`;
    if (g) {
      rows += `<div class="live-row"><span class="k">Low-carbon (incl. nuclear)</span><span class="v">${g.lowCarbonPct.toFixed(1)}%</span></div>`;
      rows += `<div class="live-row"><span class="k">Carbon intensity${g.forecast ? " (forecast)" : ""}</span><span class="v">${g.intensity} gCO₂/kWh</span></div>`;
    }
    $("grid-rows").innerHTML = rows;

    if (g) {
      $("green-meter").style.display = "";
      $("green-fill").style.width = Math.min(g.renewPct, 100) + "%";
      $("green-pct").textContent = g.renewPct.toFixed(1) + "%";
    }
    $("grid-note").textContent = p.note;

    if (state.region === "custom") {
      $("custom-rate").oninput = () => { fetchCustom(); renderGrid(); renderTaskCost(); };
    }
  }

  function renderSelectors() {
    const ts = $("task-select");
    ts.innerHTML = "";
    state.snap.tasks.forEach((t) => {
      const o = document.createElement("option");
      o.value = t.id; o.textContent = t.icon + " " + t.name;
      ts.appendChild(o);
    });
    ts.onchange = () => { state.taskId = ts.value; renderTaskCost(); renderRegionStrip(); };

    const ms = $("model-select");
    ms.innerHTML = "";
    state.snap.models.filter((m) => m.inPerM != null).forEach((m) => {
      const o = document.createElement("option");
      o.value = m.id; o.textContent = m.name;
      ms.appendChild(o);
    });
    ms.onchange = () => { state.modelId = ms.value; renderTaskCost(); };
  }

  function currentTaskEnergy() {
    const task = state.snap.tasks.find((t) => t.id === state.taskId);
    return { task, wh: aiEnergyWh(task, state.snap.constants) };
  }

  function renderTaskCost() {
    const { task } = currentTaskEnergy();
    const mdl = state.snap.models.find((m) => m.id === state.modelId) || state.snap.models[0];
    const C = state.snap.constants;
    const r = computeTask(task, mdl, C, state.D);
    const elecUsd = (r.ai.wh / 1000) * state.price.usdPerKwh;

    $("task-cost").textContent = fmtCents(elecUsd);

    let rows = `<div class="live-row"><span class="k">Task energy (inference)</span><span class="v">${fmtWh(r.ai.wh)}</span></div>`;
    if (state.green && state.green.intensity != null) {
      const g = (r.ai.wh / 1000) * state.green.intensity;
      rows += `<div class="live-row"><span class="k">Carbon, right now (${state.green.label})</span><span class="v">${g < 1 ? g.toFixed(2) : g.toFixed(1)} gCO₂</span></div>`;
    }
    if (r.ai.price != null) {
      rows += `<div class="live-row"><span class="k">API bill (for scale)</span><span class="v">$${r.ai.price.toFixed(r.ai.price < 0.1 ? 3 : 2)}</span></div>`;
    }
    const humanFood = task.humanHours * state.D.fuelUsdPerWorkHr;
    rows += `<div class="live-row"><span class="k">Human metabolic energy for same task</span><span class="v">${fmtWh(r.human.wh)} · ≈$${humanFood.toFixed(2)} of food</span></div>`;
    $("task-rows").innerHTML = rows;

    $("task-note").textContent =
      `The electricity behind “${task.name}” costs ${fmtCents(elecUsd)} at your current rate — ` +
      `${Math.round(state.price.usdPerKwh / C.ELEC_INDUSTRIAL * 100) / 100}× the US industrial rate the main site assumes.`;
  }

  /* "This task across regions" — carbon per task per region, emphasis on selection */
  function renderRegionStrip() {
    const card = $("regions-card");
    if (!state.ukRegions) { card.style.display = "none"; return; }
    card.style.display = "";

    const { task, wh } = currentTaskEnergy();
    $("regions-sub").textContent =
      `Grams of CO₂ to run “${task.name}” (${fmtWh(wh)}) in each region, at this half-hour's forecast intensity`;

    const rows = state.ukRegions
      .map((r) => ({ id: r.regionid, name: r.shortname, g: (wh / 1000) * r.intensity.forecast }))
      .sort((a, b) => a.g - b.g);

    const W = 960, rowH = 34, padL = 210, padR = 90, padT = 4;
    const H = padT + rows.length * rowH + 8;
    const maxG = Math.max(...rows.map((r) => r.g), 0.001);
    const plotW = W - padL - padR;

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Carbon per task across UK regions, lowest first, selected region highlighted");

    rows.forEach((r, i) => {
      const y = padT + i * rowH;
      const sel = r.id === state.ukRegionId;
      const mk = (tag, attrs, text) => {
        const el = document.createElementNS(NS, tag);
        for (const k in attrs) el.setAttribute(k, attrs[k]);
        if (text != null) el.textContent = text;
        svg.appendChild(el);
        return el;
      };
      mk("text", {
        x: padL - 10, y: y + rowH / 2 + 4, "font-size": 13, "text-anchor": "end",
        fill: sel ? css("--ink") : css("--ink-2"), "font-weight": sel ? 650 : 400,
      }, r.name + (sel ? " ◀" : ""));
      const barW = Math.max((r.g / maxG) * plotW, 2);
      mk("rect", {
        x: padL, y: y + rowH / 2 - 7, width: barW, height: 14, rx: 4,
        fill: sel ? css("--human") : css("--layer-other"),
      });
      mk("text", {
        x: padL + barW + 8, y: y + rowH / 2 + 4, "font-size": 13,
        "font-weight": sel ? 650 : 400, fill: css("--ink"),
      }, (r.g < 1 ? r.g.toFixed(2) : r.g.toFixed(1)) + " g");
    });

    const host = $("regions-chart");
    host.innerHTML = "";
    host.appendChild(svg);

    const best = rows[0], worst = rows[rows.length - 1];
    $("regions-note").textContent = worst.g > 0
      ? `Same task, same minute: ${worst.name} emits ${(worst.g / Math.max(best.g, 0.001)).toFixed(0)}× the carbon of ${best.name}` +
        (best.g < 0.005 ? ` (which is effectively zero right now)` : "") + `. Carbon-aware scheduling is free.`
      : "";
  }

  boot();
})();
