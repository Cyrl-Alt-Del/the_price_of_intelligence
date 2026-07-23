/* GreenBench — three-gate permission standard, run client-side.
   Gate 2 reuses the site's cost engine: the human-work baseline comes from
   the same dated snapshot as the benchmark ledger. */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = { snap: null, D: null };

  /* ---------- Theme (same behaviour as the other pages) ---------- */

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
    };
  }

  /* ---------- Formatting ----------
     Money formatting (fmtMoney) comes from the shared currency.js module. */

  const fmtWh = (wh) => (wh >= 1000 ? (wh / 1000).toFixed(2) + " kWh" : wh.toFixed(1) + " Wh");
  const fmtX = (r) => (r >= 100 ? "≈" + Math.round(r / 10) * 10 : r >= 10 ? "≈" + Math.round(r) : "≈" + r.toFixed(1)) + "×";

  const gateBadge = (pass, label) => {
    const cls = pass === true ? "confirmed" : pass === false ? "unavailable" : "reported";
    const glyph = pass === true ? "✓" : pass === false ? "✕" : "…";
    return `<span class="badge ${cls}"><span class="glyph">${glyph}</span>${label}</span>`;
  };

  /* ---------- Loading ---------- */

  async function fetchJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(path + ": HTTP " + res.status);
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
      $("g2-result").textContent = "Could not load the data snapshot — serve this folder over HTTP.";
      console.error(err);
      return;
    }
    currencySet(currencyDetect());
    currencySetFromSnapshot(state.snap.constants);
    setFooterSnap(manifest);
    fillSelectors();
    currencyMountSelect($("currency-select"), update);
    wire();
    update();
    currencyLoadLive().then((ok) => { if (ok) update(); });
  }

  function fillSelectors() {
    const ts = $("g2-task");
    state.snap.tasks.forEach((t) => {
      const o = document.createElement("option");
      o.value = t.id; o.textContent = t.icon + " " + t.name;
      ts.appendChild(o);
    });
    const ms = $("g2-model");
    state.snap.models.filter((m) => m.inPerM != null).forEach((m) => {
      const o = document.createElement("option");
      o.value = m.id; o.textContent = m.name;
      ms.appendChild(o);
    });
  }

  function wire() {
    document.querySelectorAll("input, select").forEach((el) => {
      el.addEventListener("input", update);
      el.addEventListener("change", update);
    });
  }

  /* ---------- Gate evaluation ---------- */

  function evalGate1() {
    const boxes = [...document.querySelectorAll("input[data-g1]")];
    const done = boxes.filter((b) => b.checked).length;
    const pass = done === boxes.length;
    $("g1-status").innerHTML = gateBadge(pass, pass ? "pass" : `${done}/${boxes.length} disclosed`);
    return { pass, done, total: boxes.length };
  }

  function evalGate2() {
    const demand = $("g2-demand").value;
    const software = $("g2-software").value;
    const retries = parseFloat($("g2-retries").value);
    const oversightMin = parseFloat($("g2-oversight").value);
    $("g2-retries-val").textContent = retries + "×";
    $("g2-oversight-val").textContent = oversightMin;

    const task = state.snap.tasks.find((t) => t.id === $("g2-task").value) || state.snap.tasks[0];
    const model = state.snap.models.find((m) => m.id === $("g2-model").value) ||
      state.snap.models.find((m) => m.inPerM != null);
    const C = state.snap.constants;
    const r = computeTask(task, model, C, state.D);

    // True cost of usable output: retries on the model side, plus human oversight
    const aiTrue = r.ai.price * retries + (oversightMin / 60) * state.D.medianHourlyWage;
    const aiTrueWh = r.ai.wh * retries + (oversightMin / 60) * state.D.humanWhPerWorkHr;
    const priceX = r.human.price / aiTrue;
    const energyX = r.human.wh / aiTrueWh;

    let verdictLine, pass;
    if (software === "yes") {
      pass = false;
      verdictLine = "<strong>Fails the conventional-software baseline.</strong> If deterministic software " +
        "meets the quality bar, it beats both the human and the model on cost and energy — use the cheaper tool.";
    } else if (demand === "induce") {
      pass = "conditional";
      verdictLine = "<strong>The credible baseline is no action.</strong> Efficiency against human work is " +
        "irrelevant if the work would not otherwise exist — the burden of justification shifts to the deployer " +
        "and rests on Gate 3's public-value test.";
    } else if (priceX > 1 && energyX > 1) {
      pass = true;
      verdictLine = `<strong>Beats the human-work baseline with oversight included.</strong>`;
    } else {
      pass = "conditional";
      verdictLine = "<strong>Marginal against the human baseline once retries and oversight are counted.</strong> " +
        "Approval should turn on quality evidence and Gate 3.";
    }

    $("g2-result").innerHTML =
      `${verdictLine}<br>` +
      `Usable output (${retries}× retries + ${oversightMin} min oversight): ` +
      `<strong>${fmtMoney(aiTrue)}</strong> and <strong>${fmtWh(aiTrueWh)}</strong> vs human ` +
      `<strong>${fmtMoney(r.human.price)}</strong> and <strong>${fmtWh(r.human.wh)}</strong> — ` +
      `${fmtX(priceX)} on price, ${fmtX(energyX)} on energy.` +
      (demand === "induce" ? " <em>(Numbers shown against human work for scale only — the no-action baseline costs nothing.)</em>" : "");

    $("g2-status").innerHTML = gateBadge(pass === true ? true : pass === false ? false : null,
      pass === true ? "pass" : pass === false ? "fail" : "conditional");
    return { pass, demand, software, priceX, energyX };
  }

  function evalGate3() {
    const water = $("g3-water").value;
    const grid = $("g3-grid").value;
    const value = $("g3-value").value;
    const participation = $("g3-participation").value;

    const constrained = water === "yes" || grid === "yes";
    const unknown = water === "unknown" || grid === "unknown";
    const highValue = value === "legal" || value === "safety";

    let pass;
    if (constrained && value === "marginal") pass = false;
    else if (constrained && participation === "no" && !highValue) pass = false;
    else if (constrained || unknown) pass = "conditional";
    else pass = true;

    $("g3-status").innerHTML = gateBadge(pass === true ? true : pass === false ? false : null,
      pass === true ? "pass" : pass === false ? "fail" : "conditional");
    return { pass, water, grid, value, participation, constrained, unknown, highValue };
  }

  /* ---------- Verdict ---------- */

  function update() {
    if (!state.snap) return;
    const g1 = evalGate1();
    const g2 = evalGate2();
    const g3 = evalGate3();

    const reasons = [];
    const conditions = [];

    if (!g1.pass) reasons.push(`<strong>Integrity:</strong> only ${g1.done}/${g1.total} disclosure items met — sustainability claims used to win procurement or planning consent must be auditable. No approval on sustainability grounds until reporting is complete.`);
    else reasons.push("<strong>Integrity:</strong> disclosure is complete and auditable.");

    if (g2.software === "yes") reasons.push("<strong>Counterfactual:</strong> conventional software meets the quality bar — the deployment fails its cheapest baseline.");
    else if (g2.demand === "induce") {
      reasons.push("<strong>Counterfactual:</strong> primarily induced demand — the credible baseline is no action, so efficiency comparisons cannot justify it alone.");
      if (g3.highValue) conditions.push("Demonstrate that the induced activity itself serves the claimed public value, not just that it is efficient.");
    } else if (g2.pass === true) reasons.push(`<strong>Counterfactual:</strong> beats human work ${fmtX(g2.priceX)} on price and ${fmtX(g2.energyX)} on energy with retries and oversight counted.`);
    else reasons.push("<strong>Counterfactual:</strong> marginal once true costs are counted — approval depends on quality evidence.");

    if (g3.pass === false) reasons.push("<strong>Justice:</strong> material local burdens with " + (g3.value === "marginal" ? "only marginal commercial value" : "no meaningful community participation") + " — some burdens are hard limits, not compensable inconveniences.");
    else if (g3.constrained) {
      reasons.push("<strong>Justice:</strong> real local constraints are present — approval must carry binding mitigation.");
      if (g3.water === "yes") conditions.push("Closed-loop or dry cooling, with consumptive water capped and reported monthly.");
      if (g3.grid === "yes") conditions.push("Peak-period curtailment or flexible scheduling agreed with the grid operator.");
      if (g3.participation === "no") conditions.push("Establish meaningful community participation before operation.");
    } else if (g3.unknown) {
      reasons.push("<strong>Justice:</strong> local constraints not assessed — assess before approval; unknown is not a pass.");
      conditions.push("Complete a water-stress and grid-impact assessment for the specific site.");
    } else reasons.push("<strong>Justice:</strong> no material local constraint identified.");

    const anyFail = !g1.pass || g2.pass === false || g3.pass === false;
    const allClean = g1.pass && g2.pass === true && g3.pass === true;

    conditions.push("Approval is provisional: a post-deployment rebound audit tests whether projected savings materialised — rebound is the expected outcome when private marginal cost falls while ecological costs stay external.");

    const v = $("verdict");
    v.classList.remove("approve", "conditions", "refuse");
    if (anyFail) {
      v.classList.add("refuse");
      $("verdict-icon").textContent = "⛔";
      $("verdict-label").textContent = "Refuse — as specified";
    } else if (allClean) {
      v.classList.add("approve");
      $("verdict-icon").textContent = "✅";
      $("verdict-label").textContent = "Approve, provisionally";
    } else {
      v.classList.add("conditions");
      $("verdict-icon").textContent = "⚠️";
      $("verdict-label").textContent = "Approve with conditions";
    }

    $("verdict-reasons").innerHTML =
      reasons.map((r) => `<li>${r}</li>`).join("") +
      (!anyFail ? conditions.map((c) => `<li><strong>Condition:</strong> ${c}</li>`).join("") : "");
    $("verdict-note").textContent =
      "The verdict asks whether this deployment — here, now, for this purpose — may justifiably " +
      "appropriate shared ecological capacity while leaving enough, and as good, for others, now and later.";
  }

  boot();
})();
