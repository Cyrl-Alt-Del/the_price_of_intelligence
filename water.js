/* The Water Lens — third page: litres per completed task, human vs AI.
   Shares the dated snapshot and token-scaling model with the main site. */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const state = { snap: null, D: null, scale: "log" };

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
      renderAll();
    };
  }

  /* ---------- Water model ---------- */

  // Water math lives in the shared engine (data.js) so the ledger and this
  // page can't disagree. Bind the snapshot constants into local shims.
  const aiWaterL = (task) => aiWaterOnsiteL(task, state.snap.constants);
  const aiWaterFull = (task) => aiWaterFullL(task, state.snap.constants);
  const humanWater = (task) => humanWaterL(task, state.snap.constants);

  /* ---------- Formatting ---------- */

  function fmtL(l) {
    if (l >= 1000) return (l / 1000).toFixed(1) + " kL";
    if (l >= 10) return Math.round(l).toLocaleString("en-US") + " L";
    if (l >= 1) return l.toFixed(1) + " L";
    if (l >= 0.001) return Math.round(l * 1000) + " mL";
    return (l * 1000).toFixed(1) + " mL";
  }

  function fmtRatio(r) {
    if (r >= 1e6) return "≈" + (r / 1e6).toFixed(1) + " million×";
    if (r >= 1000) return "≈" + Math.round(r / 1000).toLocaleString("en-US") + ",000×";
    if (r >= 100) return "≈" + (Math.round(r / 10) * 10).toLocaleString("en-US") + "×";
    return "≈" + Math.round(r) + "×";
  }

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
      document.querySelector(".hero .sub").textContent =
        "Could not load the data snapshot — serve this folder over HTTP.";
      console.error(err);
      return;
    }
    setFooterSnap(manifest);
    renderAll();
  }

  /* ---------- Rendering ---------- */

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

  function renderHero() {
    const article = state.snap.tasks[0];
    const onsite = aiWaterL(article);
    const full = aiWaterFull(article);
    const human = humanWater(article);
    $("hero-water").textContent = fmtRatio(human / full);
    $("hero-water-caption").innerHTML =
      `Drafting a 1,000-word article: the data centre sips <strong>${fmtL(onsite)}</strong> of cooling water ` +
      `(<strong>${fmtL(full)}</strong> counting the power plant's water too); the food powering four human ` +
      `hours carries <strong>${fmtL(human)}</strong>.`;
  }

  function renderChart() {
    const mode = state.scale;
    const data = state.snap.tasks.map((t) => ({
      name: t.name, icon: t.icon,
      human: humanWater(t), full: aiWaterFull(t), onsite: aiWaterL(t),
    }));

    const slot = $("water-toggle");
    if (slot) slot.replaceChildren(scaleToggle(mode, (next) => {
      state.scale = next;
      renderChart();
    }));

    const W = 960, rowH = 52, padL = 250, padR = 60, padT = 8, padB = 34;
    const H = padT + data.length * rowH + padB;
    const plotW = W - padL - padR;

    const axis = makeAxis(data.flatMap((d) => [d.human, d.full, d.onsite]), mode);
    const x = (l) => padL + axis.pos(l) * plotW;

    const NS = "http://www.w3.org/2000/svg";
    const svgEl = (tag, attrs) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    };

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `${mode === "log" ? "Log" : "Linear"}-scale dumbbell chart of litres of water per task: human food footprint versus AI full-chain and on-site cooling water` });

    axis.lines.forEach((v) => {
      svg.appendChild(svgEl("line", {
        x1: x(v), x2: x(v), y1: padT, y2: H - padB, stroke: css("--grid"), "stroke-width": 1,
      }));
      const t = svgEl("text", { x: x(v), y: H - padB + 18, "font-size": 12.5, fill: css("--ink-muted"), "text-anchor": "middle" });
      t.textContent = v === 0 ? "0" : fmtL(v);
      svg.appendChild(t);
    });

    data.forEach((d, i) => {
      const cy = padT + i * rowH + rowH / 2;

      const label = svgEl("text", { x: 12, y: cy + 5, "font-size": 14, fill: css("--ink-2") });
      label.textContent = d.icon + " " + d.name;
      svg.appendChild(label);

      svg.appendChild(svgEl("line", {
        x1: x(d.onsite), x2: x(d.human), y1: cy, y2: cy, stroke: css("--baseline"), "stroke-width": 1.5,
      }));

      const mk = (val, who, hollow) => {
        const g = svgEl("g", {});
        const dot = svgEl("circle", {
          cx: x(val), cy, r: hollow ? 5 : 6,
          fill: hollow ? css("--surface") : (who === "human" ? css("--human") : css("--ai")),
          stroke: hollow ? css("--ai") : css("--surface"), "stroke-width": 2,
        });
        const hit = svgEl("circle", { cx: x(val), cy, r: 14, fill: "transparent" });
        g.appendChild(dot); g.appendChild(hit);
        const label = who === "human" ? "Human (food footprint)"
          : hollow ? "AI, on-site cooling only" : "AI, full chain (cooling + power plant)";
        bindTooltip(g, `<strong>${d.name}</strong><br>${label}: ${fmtL(val)}<br>` +
          `Gap vs full chain: ${fmtRatio(d.human / d.full)}`);
        svg.appendChild(g);
      };
      mk(d.human, "human", false);
      mk(d.full, "ai", false);
      mk(d.onsite, "ai", true);
    });

    const host = $("water-chart");
    host.innerHTML = "";
    host.appendChild(svg);
  }

  function renderTiles() {
    const article = state.snap.tasks[0];
    const full = aiWaterFull(article);
    const human = humanWater(article);
    const glasses = Math.floor(0.25 / full);
    $("tile-glass").textContent = "~" + glasses.toLocaleString("en-US");
    $("tile-glass-sub").textContent = "AI article drafts, full chain — cooling and power-plant water included";
    $("tile-human").textContent = fmtL(human);
    $("tile-human-sub").textContent = "≈" + Math.round(human / 180) + " bathtubs, embedded in food";
    $("tile-ratio").textContent = fmtRatio(human / full);

    const mult = $("chain-mult");
    if (mult) mult.textContent = "≈" + Math.round(full / aiWaterL(article)) + "×";
  }

  function renderTraining() {
    const D = state.D;
    const litres = D.aiTrainingEnergyKwh * 1.1; // ~1.1 L/kWh typical on-site WUE
    $("training-water").textContent = Math.round(litres / 1e6).toLocaleString("en-US") + " million litres (estimated)";
    $("training-pools").textContent = Math.round(litres / 2.5e6); // 2.5 ML per Olympic pool
  }

  function renderSources() {
    const want = ["google", "mit", "masley", "fao", "wfn", "epochTrain"];
    $("water-sources").innerHTML = want
      .filter((k) => state.snap.sources[k])
      .map((k) => {
        const s = state.snap.sources[k];
        return `<li><a href="${s.url}" target="_blank" rel="noopener">${s.label}</a></li>`;
      })
      .join("");
  }

  function renderAll() {
    renderHero();
    renderChart();
    renderTiles();
    renderTraining();
    renderSources();
  }

  boot();
})();
