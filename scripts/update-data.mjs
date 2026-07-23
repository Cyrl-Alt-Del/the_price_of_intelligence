#!/usr/bin/env node
/* ============================================================
   update-data.mjs — refresh the data snapshot.

   Usage:
     node scripts/update-data.mjs            # refresh, write today's snapshot
     node scripts/update-data.mjs --dry-run  # show what would change
     node scripts/update-data.mjs --add-new  # also add newly released models
                                             # from watched labs (as "reported")

   Environment (all optional):
     EIA_API_KEY   — refreshes US electricity prices from the EIA API.

   What it does:
   1. Loads the latest snapshot from data/.
   2. Pulls current model prices from the OpenRouter API (free, no key):
        - "reported"/"estimated" models are updated in place.
        - "confirmed" models are NOT overwritten (vendor list price wins),
          but a warning is printed when the marketplace disagrees.
        - watched labs are scanned for new releases (suggested, or added
          with --add-new).
   3. Refreshes EIA electricity prices when a key is provided.
   4. Attempts the public BLS API for median weekly earnings (no key,
      rate-limited; failures are non-fatal).
   5. Writes data/YYYY-MM-DD.json, updates data/manifest.json, and prints
      a report including which sections remain manual (food, education,
      AI energy anchors, FX) with their last-verified dates.

   Snapshots accumulate — the site's date picker exposes every one, so
   running this regularly builds the historical record for free.
   ============================================================ */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const DRY = process.argv.includes("--dry-run");
const ADD_NEW = process.argv.includes("--add-new");

const WATCHED_ORGS = [
  "anthropic", "openai", "google", "deepseek", "moonshotai",
  "qwen", "meta-llama", "mistralai", "thinkingmachines", "x-ai",
];
const NEW_MODEL_WINDOW_DAYS = 90;

const today = new Date().toISOString().slice(0, 10);
const log = (...a) => console.log(...a);
const changes = [];
const warnings = [];

function loadJSON(p) { return JSON.parse(readFileSync(p, "utf8")); }

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/* ---------- 1. Load latest snapshot ---------- */

const manifest = loadJSON(join(DATA, "manifest.json"));
const snap = loadJSON(join(DATA, `${manifest.latest}.json`));
log(`Loaded snapshot ${manifest.latest} (${snap.models.length} models)\n`);

/* ---------- 2. OpenRouter model prices ---------- */

let orModels = null;
try {
  const or = await fetchJSON("https://openrouter.ai/api/v1/models");
  orModels = new Map(or.data.map((m) => [m.id, m]));
  log(`OpenRouter: ${orModels.size} models listed`);
} catch (e) {
  warnings.push(`OpenRouter fetch failed (${e.message}) — model prices not refreshed.`);
}

if (orModels) {
  for (const m of snap.models) {
    if (!m.or) continue;
    const or = orModels.get(m.or);
    if (!or) { warnings.push(`${m.name}: "${m.or}" no longer on OpenRouter — check manually.`); continue; }
    const inPerM = Math.round(parseFloat(or.pricing.prompt) * 1e6 * 1000) / 1000;
    const outPerM = Math.round(parseFloat(or.pricing.completion) * 1e6 * 1000) / 1000;
    if (Number.isNaN(inPerM) || Number.isNaN(outPerM)) continue;

    if (m.confidence === "confirmed") {
      if (inPerM !== m.inPerM || outPerM !== m.outPerM) {
        warnings.push(
          `${m.name}: vendor list $${m.inPerM}/$${m.outPerM} but OpenRouter now shows ` +
          `$${inPerM}/$${outPerM} — verify the vendor page and update by hand if the list price moved.`
        );
      }
    } else if (inPerM !== m.inPerM || outPerM !== m.outPerM) {
      changes.push(`${m.name}: $${m.inPerM}/$${m.outPerM} → $${inPerM}/$${outPerM}`);
      m.inPerM = inPerM;
      m.outPerM = outPerM;
    }
  }
  snap.meta.lastVerified.models = today;

  /* New-model discovery from watched labs */
  const cutoff = Date.now() / 1000 - NEW_MODEL_WINDOW_DAYS * 86400;
  const known = new Set(snap.models.map((m) => m.or).filter(Boolean));
  const fresh = [...orModels.values()].filter((m) => {
    const org = m.id.split("/")[0];
    return WATCHED_ORGS.includes(org) && m.created > cutoff && !known.has(m.id)
      && !/preview|image|audio|video|-fast$|-pro$|distill|lite/.test(m.id);
  }).sort((a, b) => b.created - a.created).slice(0, 12);

  if (fresh.length) {
    log(`\nNew releases from watched labs (last ${NEW_MODEL_WINDOW_DAYS} days):`);
    for (const m of fresh) {
      const inP = (parseFloat(m.pricing.prompt) * 1e6).toFixed(3);
      const outP = (parseFloat(m.pricing.completion) * 1e6).toFixed(3);
      log(`  ${ADD_NEW ? "+ adding" : "  suggest"}: ${m.id}  $${inP}/$${outP}`);
      if (ADD_NEW) {
        const org = m.id.split("/")[0];
        snap.models.push({
          id: m.id.replace(/[^a-z0-9]/gi, "").slice(0, 12),
          or: m.id,
          name: m.name || m.id,
          group: ["deepseek", "moonshotai", "qwen", "meta-llama", "mistralai", "thinkingmachines"].includes(org) ? "open" : "frontier",
          inPerM: parseFloat(inP), outPerM: parseFloat(outP),
          confidence: "reported", source: "openrouter",
          note: `Auto-added from OpenRouter on ${today}; review grouping and note.`,
        });
        changes.push(`added ${m.id}`);
      }
    }
    if (!ADD_NEW) log("  (re-run with --add-new to add these as 'reported')");
  }
}

/* ---------- 3. EIA electricity prices (optional key) ---------- */

if (process.env.EIA_API_KEY) {
  try {
    const url =
      "https://api.eia.gov/v2/electricity/retail-sales/data/" +
      `?api_key=${process.env.EIA_API_KEY}&frequency=monthly&data[0]=price` +
      "&facets[stateid][]=US&sort[0][column]=period&sort[0][direction]=desc&length=12";
    const r = await fetchJSON(url);
    const bySector = {};
    for (const row of r.response.data) {
      if (!bySector[row.sectorid]) bySector[row.sectorid] = row; // first = latest
    }
    const map = { RES: "ELEC_RESIDENTIAL", COM: "ELEC_COMMERCIAL", IND: "ELEC_INDUSTRIAL" };
    for (const [sec, key] of Object.entries(map)) {
      if (bySector[sec]) {
        const usd = Math.round(bySector[sec].price * 10) / 1000; // ¢ → $, 4dp
        if (usd !== snap.constants[key]) {
          changes.push(`${key}: ${snap.constants[key]} → ${usd} (${bySector[sec].period})`);
          snap.constants[key] = usd;
        }
      }
    }
    snap.meta.lastVerified.electricity = today;
  } catch (e) {
    warnings.push(`EIA fetch failed (${e.message}).`);
  }
} else {
  log("\nEIA_API_KEY not set — electricity prices kept from previous snapshot.");
}

/* ---------- 4. BLS median weekly earnings (public, rate-limited) ---------- */

try {
  const r = await fetchJSON("https://api.bls.gov/publicAPI/v2/timeseries/data/LEU0252881500", {
    headers: { "Content-Type": "application/json" },
  });
  const series = r?.Results?.series?.[0]?.data;
  if (series && series.length) {
    const latest = series[0];
    const val = Math.round(parseFloat(latest.value));
    if (val > 500 && val < 5000 && val !== snap.constants.MEDIAN_WEEKLY_EARNINGS) {
      changes.push(`MEDIAN_WEEKLY_EARNINGS: ${snap.constants.MEDIAN_WEEKLY_EARNINGS} → ${val} (${latest.year} ${latest.periodName})`);
      snap.constants.MEDIAN_WEEKLY_EARNINGS = val;
    }
    snap.meta.lastVerified.wages = today;
  }
} catch (e) {
  warnings.push(`BLS public API failed (${e.message}) — wages kept.`);
}

/* ---------- 5. Write snapshot + manifest ---------- */

snap.date = today;
snap.label = new Date(today + "T12:00:00Z").toLocaleDateString("en-US", {
  year: "numeric", month: "long", day: "numeric",
});

log("\n================ REPORT ================");
log(changes.length ? "Changes:" : "No value changes.");
changes.forEach((c) => log("  • " + c));
if (warnings.length) {
  log("\nWarnings:");
  warnings.forEach((w) => log("  ⚠ " + w));
}

const manualSections = ["food", "education", "aiEnergy", "aiTraining", "fx"];
log("\nManual sections (verify against sources listed in the snapshot):");
manualSections.forEach((s) =>
  log(`  · ${s} — last verified ${snap.meta.lastVerified[s] || "never"}`));

if (DRY) {
  log("\n--dry-run: nothing written.");
} else {
  const outPath = join(DATA, `${today}.json`);
  const existed = existsSync(outPath);
  writeFileSync(outPath, JSON.stringify(snap, null, 2) + "\n");
  if (!manifest.snapshots.includes(today)) manifest.snapshots.push(today);
  manifest.latest = today;
  writeFileSync(join(DATA, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  log(`\nWrote ${outPath}${existed ? " (overwrote same-day snapshot)" : ""}`);
  log(`Manifest: ${manifest.snapshots.length} snapshot(s), latest ${manifest.latest}`);
}
