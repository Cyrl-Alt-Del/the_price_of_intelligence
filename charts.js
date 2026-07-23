/* Shared chart-scale utilities: padded axes and the log/linear toggle.
   Used by app.js and water.js — no data logic here, geometry only. */

function pow10(k) { return Math.pow(10, k); }

/* Decade gridlines extended one order of magnitude beyond the data on both
   ends, so the extreme points sit inside labelled context, never on the edge. */
function logAxis(min, max) {
  let loD = Math.floor(Math.log10(min));
  if (pow10(loD) >= min) loD -= 1;
  let hiD = Math.ceil(Math.log10(max));
  if (pow10(hiD) <= max) hiD += 1;
  const lines = [];
  for (let k = loD; k <= hiD; k++) lines.push(pow10(k));
  // slight extra domain padding so dots clear the outermost gridlines
  return { mode: "log", lo: pow10(loD - 0.2), hi: pow10(hiD + 0.2), lines };
}

/* Zero-based linear axis with 1/2/5 "nice" steps and one step of headroom
   above the maximum, every gridline labelled. */
function linearAxis(max) {
  const raw = max / 4;
  const k = Math.floor(Math.log10(raw));
  const base = raw / pow10(k);
  const step = (base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10) * pow10(k);
  const top = (Math.floor(max / step) + 1) * step;
  const lines = [];
  for (let v = 0; v <= top + step / 1e6; v += step) lines.push(v);
  return { mode: "linear", lo: 0, hi: top, lines };
}

/* Build an axis from data values; returns { mode, lo, hi, lines, pos }
   where pos(v) maps a value to [0,1] along the axis. */
function makeAxis(values, mode) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const axis = mode === "log" ? logAxis(min, max) : linearAxis(max);
  axis.pos = (v) =>
    axis.mode === "log"
      ? (Math.log10(v) - Math.log10(axis.lo)) / (Math.log10(axis.hi) - Math.log10(axis.lo))
      : (v - axis.lo) / (axis.hi - axis.lo);
  return axis;
}

/* Segmented Log/Linear control. Returns an element; caller re-renders on change. */
function scaleToggle(current, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "scale-toggle";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Axis scale");
  [["log", "Log"], ["linear", "Linear"]].forEach(([mode, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = mode === current ? "on" : "";
    b.setAttribute("aria-pressed", mode === current);
    b.onclick = () => { if (mode !== current) onChange(mode); };
    wrap.appendChild(b);
  });
  return wrap;
}
