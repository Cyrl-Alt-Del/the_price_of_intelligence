/* ============================================================
   The Price of Intelligence — cost engine (pure functions)
   All data lives in dated snapshots under data/ — this file
   contains only the arithmetic, so the methodology is auditable
   in one place.
   ============================================================ */

/* Derive the secondary constants a snapshot implies. */
function deriveConstants(C) {
  const educationTotalUsd =
    C.K12_PER_PUPIL_YEAR * C.K12_YEARS + C.COLLEGE_PER_PUPIL_YEAR * C.COLLEGE_YEARS;
  const careerHours = C.CAREER_YEARS * C.WORK_HOURS_PER_YEAR;
  return {
    humanKwhPerDay: (C.HUMAN_KCAL_PER_DAY * C.WH_PER_KCAL) / 1000,
    humanWhPerWorkHr: (C.HUMAN_KCAL_PER_DAY * C.WH_PER_KCAL) / C.WORK_HOURS_PER_DAY,
    fuelUsdPerWorkHr: C.FOOD_USD_PER_DAY / C.WORK_HOURS_PER_DAY,
    humanFuelUsdPerKwh: C.FOOD_USD_PER_DAY / ((C.HUMAN_KCAL_PER_DAY * C.WH_PER_KCAL) / 1000),
    medianHourlyWage: C.MEDIAN_WEEKLY_EARNINGS / 40,
    educationTotalUsd,
    careerHours,
    trainingUsdPerWorkHr: educationTotalUsd / careerHours,
    aiTrainingUsdPerBaseQuery: C.TRAINING_RUN_USD / C.LIFETIME_QUERIES,
    aiTrainingEnergyKwh: (C.TRAINING_RUN_USD * C.TRAINING_ENERGY_SHARE) / C.ELEC_INDUSTRIAL,
  };
}

/* Watt-hours of inference for a task, given snapshot constants. */
function aiEnergyWh(task, C) {
  return C.BASE_QUERY_WH * ((task.tokensIn + task.tokensOut) / C.BASE_QUERY_TOKENS);
}

/* Full comparison for one task on one model.
   The three layers are lenses inside the market price, never summed:
   a wage already repays food and education; an API price already
   covers electricity and amortises the training run.
   Models with null pricing (e.g. self-hosted) yield ai.price = null. */
function computeTask(task, model, C, D) {
  const totalTokens = task.tokensIn + task.tokensOut;
  const scale = totalTokens / C.BASE_QUERY_TOKENS;

  const hasPrice = model.inPerM != null && model.outPerM != null;
  const aiPrice = hasPrice
    ? (task.tokensIn / 1e6) * model.inPerM + (task.tokensOut / 1e6) * model.outPerM
    : null;
  const aiWh = C.BASE_QUERY_WH * scale;
  const aiElecUsd = (aiWh / 1000) * C.ELEC_INDUSTRIAL;
  const aiTrainUsd = D.aiTrainingUsdPerBaseQuery * scale;
  const aiOtherUsd = hasPrice ? Math.max(aiPrice - aiElecUsd - aiTrainUsd, 0) : null;

  const hPrice = task.humanPrice;
  const hWh = task.humanHours * D.humanWhPerWorkHr;
  const hFuelUsd = task.humanHours * D.fuelUsdPerWorkHr;
  const hTrainUsd = task.humanHours * D.trainingUsdPerWorkHr;
  const hOtherUsd = Math.max(hPrice - hFuelUsd - hTrainUsd, 0);

  return {
    task, model,
    ai: { price: aiPrice, wh: aiWh, fuel: aiElecUsd, training: aiTrainUsd, other: aiOtherUsd },
    human: { price: hPrice, wh: hWh, fuel: hFuelUsd, training: hTrainUsd, other: hOtherUsd },
    priceRatio: hasPrice ? hPrice / aiPrice : null,
    energyRatio: hWh / aiWh,
  };
}

/* Cost of a benchmark prompt at arbitrary per-MTok pricing —
   used for the historical "falling price of intelligence" series. */
function promptCost(tokensIn, tokensOut, inPerM, outPerM) {
  return (tokensIn / 1e6) * inPerM + (tokensOut / 1e6) * outPerM;
}

/* --- Water: consumptive litres per completed task -----------------
   Single source of truth for the water lens, shared by the ledger
   (app.js) and the water page (water.js) so the numbers can't drift. */

/* AI on-site: data centre cooling, scaled from Google's 0.26 mL / 0.24 Wh
   median prompt via the same token model as energy. */
function aiWaterOnsiteL(task, C) {
  return (aiEnergyWh(task, C) * (C.WATER_ML_PER_WH || 1.08)) / 1000;
}

/* AI full chain: on-site cooling + the water consumed generating the
   electricity (~4.35 L/kWh US average — LBNL, via Andy Masley). Matches
   the human number's upstream, consumptive accounting boundary. */
function aiWaterFullL(task, C) {
  return (
    aiWaterOnsiteL(task, C) +
    (aiEnergyWh(task, C) / 1000) * (C.WATER_L_PER_KWH_GENERATION || 4.35)
  );
}

/* Human: consumptive water embedded in food (~1 L/kcal, FAO) + drinking,
   allocated across the workday like the energy convention. */
function humanWaterL(task, C) {
  const perWorkHour =
    (C.HUMAN_KCAL_PER_DAY * (C.HUMAN_WATER_L_PER_KCAL || 1.0) +
      (C.HUMAN_DRINKING_L_PER_DAY || 3)) /
    C.WORK_HOURS_PER_DAY;
  return task.humanHours * perWorkHour;
}
