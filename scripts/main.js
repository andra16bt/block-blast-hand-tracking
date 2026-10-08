const $ = (s) => document.querySelector(s);
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
};
const GM = ["classic", "daily", "time", "zen"],
  GL = { classic: "♾️ Classic", daily: "📅 Daily", time: "⏱️ Time 90", zen: "🧘 Zen" };
const mulberry = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const dateSeed = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
const COL = ["", "#00f0ff", "#ff2bd6", "#b6ff00", "#ffb000", "#8a5cff"];
const SH = [
  [[0, 0]],
  [
    [0, 0],
    [0, 1],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ],
  [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 1],
  ],
  [
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
  ],
  [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 2],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
];
const boardEl = $("#board"),
  slotEls = [...document.querySelectorAll(".slot")],
  cur = $("#cur");
let grid,
  slots,
  drag = null,
  fl = null,
  score = 0,
  combo = 0,
  mode = "none",
  handReady = false,
  dead = false,
  muted = ls.get("cbb_mute") === "1",
  gm = "classic",
  started = false,
  best = 0,
  hist = [],
  flash = new Map(),
  RNG = Math.random,
  tleft = 90,
  tint = null;

/* ---------- AUDIO ---------- */
let A;
function ac() {
  try {
    if (!A) A = new (window.AudioContext || window.webkitAudioContext)();
    if (A.state === "suspended") A.resume();
  } catch (e) {}
  return A;
}
const vib = (p) => { if (!muted && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} };
function beep(f, d = 0.08, t = "square", v = 0.05, when = 0) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const o = a.createOscillator(),
    g = a.createGain(),
    s = a.currentTime + when;
  o.type = t;
  o.frequency.value = f;
  g.gain.setValueAtTime(v, s);
  g.gain.exponentialRampToValueAtTime(0.0001, s + d);
  o.connect(g);
  g.connect(a.destination);
  o.start(s);
  o.stop(s + d);
}
document.addEventListener("pointerdown", ac);
document.addEventListener("keydown", ac);

/* ---------- LOGIC ---------- */
const rnd = (n) => Math.floor(RNG() * n);
const rot = (c) => {
  const m = Math.max(...c.map((x) => x[0]));
  return c.map(([r, k]) => [k, m - r]);
};
function dims(p) {
  p.h = Math.max(...p.cells.map((x) => x[0])) + 1;
  p.w = Math.max(...p.cells.map((x) => x[1])) + 1;
  return p;
}
const SW = [3, 3, 2, 1, 2, 3, 2, 2, 2, 2, 1, 0.7],
  SMALL = [0, 1, 5],
  BIG = [3, 10, 11];
function mk() {
  let f = 0;
  grid.forEach((r) => r.forEach((v) => v && f++));
  f /= 64;
  const w = SW.map((x, i) =>
    f > 0.55 && SMALL.includes(i) ? x * 2.5
    : f > 0.55 && BIG.includes(i) ? x * 0.3
    : f < 0.2 && BIG.includes(i) ? x * 1.8 : x);
  let t = RNG() * w.reduce((a, b) => a + b), k = 0;
  while (k < w.length - 1 && (t -= w[k]) > 0) k++;
  let c = SH[k];
  for (let n = rnd(4); n > 0; n--) c = rot(c);
  return dims({ cells: c, col: 1 + rnd(5) });
}
const fits = (p, r, c) =>
  p.cells.every(([a, b]) => {
    const y = r + a,
      x = c + b;
    return y >= 0 && y < 8 && x >= 0 && x < 8 && !grid[y][x];
  });
function anyFit(p) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) if (fits(p, r, c)) return true;
  return false;
}
const cs = () => boardEl.getBoundingClientRect().width / 8;
function tgt() {
  const R = boardEl.getBoundingClientRect(),
    s = R.width / 8,
    p = slots[drag.i],
    fr = (drag.y - drag.lift - (p.h * s) / 2 - R.top) / s,
    fc = (drag.x - (p.w * s) / 2 - R.left) / s,
    r = Math.round(fr),
    c = Math.round(fc);
  /* snap-assist (hand mode): tempel ke posisi valid terdekat */
  if (mode === "hand" && !fits(p, r, c)) {
    let b = null, bd = 1.6;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (fits(p, r + dr, c + dc)) {
          const d = Math.hypot(r + dr - fr, c + dc - fc);
          if (d < bd) { bd = d; b = { r: r + dr, c: c + dc }; }
        }
    if (b) return b;
  }
  return { r, c };
}

/* ---------- GLASS TILE PAINTER ---------- */
function paintTile(el, color) {
  // jelly glass tile with colored light inside
  if (el._k === color) return;
  el._k = color;
  el.style.background = `radial-gradient(120% 90% at 30% 0%,rgba(255,255,255,.55) 0%,rgba(255,255,255,0) 45%),linear-gradient(150deg,${color}f2 0%,${color}9a 100%)`;
  el.style.boxShadow = `inset 0 1.5px 1px rgba(255,255,255,.85),inset 0 -3px 5px rgba(0,0,0,.22),inset 0 0 8px ${color}88,0 0 14px ${color}77`;
}
function paintEmpty(el) {
  if (el._k === "") return;
  el._k = "";
  el.style.background = "";
  el.style.boxShadow = "";
}
function paintFlash(el) {
  if (el._k === "fl") return;
  el._k = "fl";
  el.style.background = "radial-gradient(circle,#fff,#ffffffcc)";
  el.style.boxShadow = "0 0 22px #fff,inset 0 0 10px #fff";
}
function paintPreview(el, ok) {
  const kk = ok ? "pv1" : "pv0";
  if (el._k === kk) return;
  el._k = kk;
  const c = ok ? "#5ef2ff" : "#ff4d6d";
  el.style.background = `radial-gradient(120% 90% at 30% 0%,rgba(255,255,255,.5),rgba(255,255,255,0) 50%),${c}66`;
  el.style.boxShadow = `inset 0 1px 1px rgba(255,255,255,.8),inset 0 0 10px ${c}aa,0 0 16px ${c}99`;
}

/* ---------- RENDER ---------- */
const cells = [];
for (let i = 0; i < 64; i++) {
  const d = document.createElement("div");
  d.className = "c";
  d.innerHTML = "<i></i>";
  boardEl.appendChild(d);
  cells.push(d.firstChild);
}
function render() {
  let pv = null;
  if (drag) {
    const t = tgt(),
      p = slots[drag.i],
      ok = fits(p, t.r, t.c);
    pv = new Map();
    p.cells.forEach(([a, b]) => {
      const y = t.r + a,
        x = t.c + b;
      if (y >= 0 && y < 8 && x >= 0 && x < 8)
        pv.set(y * 8 + x, ok ? 1 : 2);
    });
  }
  cells.forEach((el, k) => {
    const v = grid[k >> 3][k & 7],
      q = pv && pv.get(k);
    if (q) paintPreview(el, q === 1);
    else if (flash.has(k)) paintFlash(el);
    else if (v) paintTile(el, COL[v]);
    else paintEmpty(el);
  });
}
function pieceEl(p, sz) {
  const d = document.createElement("div");
  d.style.cssText = `display:grid;grid-template-columns:repeat(${p.w},${sz}px);grid-auto-rows:${sz}px;filter:drop-shadow(0 6px 10px rgba(0,0,0,.35))`;
  const set = new Set(p.cells.map((x) => x[0] * 10 + x[1]));
  for (let r = 0; r < p.h; r++)
    for (let c = 0; c < p.w; c++) {
      const e = document.createElement("div");
      e.className = "c";
      if (set.has(r * 10 + c)) {
        e.innerHTML = "<i></i>";
        paintTile(e.firstChild, COL[p.col]);
      }
      d.appendChild(e);
    }
  return d;
}
function renderSlots() {
  slotEls.forEach((el, i) => {
    el.innerHTML = "";
    el.classList.toggle("dim", !!drag && drag.i === i);
    if (slots[i])
      el.appendChild(pieceEl(slots[i], Math.min(cs() * 0.62, 36)));
  });
}
function hud() {
  $("#sc").textContent = String(score).padStart(5, "0");
  $("#cb").textContent = "x" + combo;
  $("#bs").textContent = String(Math.max(best, score)).padStart(5, "0");
}

/* ---------- FX ---------- */
const fx = $("#fx"),
  g = fx.getContext("2d");
let P = [],
  fr = 0,
  ft = performance.now();
function sz() {
  fx.width = innerWidth;
  fx.height = innerHeight;
}
sz();
function burst(x, y, c) {
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * 6.28,
      s = 1 + Math.random() * 4;
    P.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 2,
      l: 1,
      c,
    });
  }
}
function frame(t) {
  g.clearRect(0, 0, fx.width, fx.height);
  g.globalCompositeOperation = "lighter";
  P = P.filter((p) => p.l > 0);
  for (const p of P) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;
    p.l -= 0.02;
    g.globalAlpha = Math.max(0, p.l);
    g.fillStyle = p.c;
    g.beginPath();
    g.arc(p.x, p.y, 2 + p.l * 3, 0, 6.283);
    g.fill();
  }
  g.globalAlpha = 1;
  fr++;
  if (t - ft > 500) {
    $("#fps").textContent = Math.round((fr * 1000) / (t - ft));
    fr = 0;
    ft = t;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
function popup(txt) {
  const d = document.createElement("div");
  d.className = "pop";
  d.textContent = txt;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1000);
}

/* ---------- GAME FLOW ---------- */
function spawn() {
  let s;
  for (let t = 0; t < 40; t++) {
    s = [mk(), mk(), mk()];
    if (s.some(anyFit)) break; /* minimal satu blok pasti muat */
  }
  slots = s;
}
function newGame() {
  grid = Array.from({ length: 8 }, () => Array(8).fill(0));
  score = 0;
  combo = 0;
  dead = false;
  if (fl) { fl.remove(); fl = null; }
  drag = null;
  hist = [];
  flash.clear();
  best = +ls.get("cbb_best_" + gm) || 0;
  RNG = gm === "daily" ? mulberry(dateSeed()) : Math.random;
  clearInterval(tint);
  tleft = 90;
  $("#tm").textContent = tleft;
  $("#tmWrap").style.display = gm === "time" ? "" : "none";
  if (gm === "time") tint = setInterval(tick, 1000);
  spawn();
  $("#over").classList.remove("show");
  hud();
  render();
  renderSlots();
}
function clearLines() {
  const rows = [],
    cols = [];
  for (let i = 0; i < 8; i++) {
    if (grid[i].every(Boolean)) rows.push(i);
    if (grid.every((r) => r[i])) cols.push(i);
  }
  const set = new Set();
  rows.forEach((r) => {
    for (let c = 0; c < 8; c++) set.add(r * 8 + c);
  });
  cols.forEach((c) => {
    for (let r = 0; r < 8; r++) set.add(r * 8 + c);
  });
  const R = boardEl.getBoundingClientRect(),
    s = R.width / 8;
  set.forEach((k) => {
    const r = k >> 3,
      c = k & 7;
    burst(R.left + (c + 0.5) * s, R.top + (r + 0.5) * s, COL[grid[r][c]]);
    flash.set(k, 1);
    grid[r][c] = 0;
  });
  if (set.size) setTimeout(() => { flash.clear(); render(); }, 200);
  return rows.length + cols.length;
}
function place(i, r, c) {
  const p = slots[i];
  hist = [{ g: grid.map((x) => x.slice()), s: slots.map((x) => x && { ...x, cells: x.cells.map((y) => y.slice()) }), sc: score, cb: combo }];
  p.cells.forEach(([a, b]) => (grid[r + a][c + b] = p.col));
  score += p.cells.length;
  slots[i] = null;
  beep(300, 0.08);
  vib(15);
  beep(500, 0.08, "square", 0.05, 0.07);
  const n = clearLines();
  if (n) {
    combo++;
    vib([25, 30, 45]);
    if (n > 1 || combo > 2) shake();
    score += n * n * 10 + combo * 5;
    for (let k = 0; k < 3 + n; k++)
      beep(500 + k * 140, 0.12, "triangle", 0.07, k * 0.06);
    if (n > 1 || combo > 1)
      popup("COMBO x" + combo + (n > 1 ? "  ·  " + n + " LINES" : ""));
  } else combo = 0;
  if (slots.every((x) => !x)) spawn();
  hud();
  render();
  renderSlots();
  if (!slots.some((p) => p && anyFit(p))) {
    if (gm === "zen") { spawn(); popup("ZEN · NEW BLOCKS"); renderSlots(); }
    else endGame("GAME OVER");
  }
}
function endGame(t) {
  dead = true;
  clearInterval(tint);
  const nb = score > best;
  if (nb) { best = score; ls.set("cbb_best_" + gm, best); }
  $("#gt").textContent = t;
  $("#fs").textContent = score;
  $("#nb").style.visibility = nb ? "visible" : "hidden";
  hud();
  $("#over").classList.add("show");
  vib([80, 40, 80]);
  [440, 330, 220, 110].forEach((f, k) => beep(f, 0.25, "sawtooth", 0.06, k * 0.2));
}
function tick() {
  if (dead) return clearInterval(tint);
  if (modal()) return;
  $("#tm").textContent = --tleft;
  if (tleft <= 0) { if (drag) cancel(); endGame("TIME UP"); }
}
function undo() {
  if (dead || drag || !hist.length) return;
  const h = hist.pop();
  grid = h.g; slots = h.s; score = h.sc; combo = h.cb;
  flash.clear(); hud(); render(); renderSlots();
  beep(400, 0.08, "triangle", 0.06);
  popup("UNDO");
}
function shake() {
  const a = $(".app");
  a.classList.remove("shake");
  void a.offsetWidth;
  a.classList.add("shake");
}

/* ---------- DRAG ---------- */
function flPos() {
  const p = slots[drag.i],
    s = cs();
  fl.style.left = drag.x - (p.w * s) / 2 + "px";
  fl.style.top = drag.y - drag.lift - (p.h * s) / 2 + "px";
}
function mkFl() {
  if (fl) fl.remove();
  fl = pieceEl(slots[drag.i], cs());
  fl.style.cssText +=
    ";position:fixed;pointer-events:none;z-index:30;opacity:.92;transform:scale(1.04)";
  document.body.appendChild(fl);
  flPos();
}
function modal() {
  return document.querySelector("#tut.show,#menu.show,#over.show");
}
function grab(i, x, y, lift = 0) {
  if (dead || drag || !slots[i] || modal()) return;
  drag = { i, x, y, lift };
  beep(900, 0.05, "square", 0.05);
  mkFl();
  renderSlots();
  render();
}
function moveTo(x, y) {
  if (!drag) return;
  drag.x = x;
  drag.y = y;
  flPos();
  const t = tgt(),
    kk = t.r + "," + t.c;
  if (kk !== drag.k) {
    drag.k = kk;
    render();
  }
}
function cancel() {
  drag = null;
  if (fl) {
    fl.remove();
    fl = null;
  }
  renderSlots();
  render();
}
function drop() {
  const t = tgt(),
    i = drag.i,
    ok = fits(slots[i], t.r, t.c);
  drag = null;
  fl.remove();
  fl = null;
  if (ok) place(i, t.r, t.c);
  else {
    beep(150, 0.15, "sawtooth", 0.06);
    renderSlots();
    render();
  }
}
function rotate() {
  const p = slots[drag.i];
  p.cells = rot(p.cells);
  dims(p);
  mkFl();
  render();
  beep(700, 0.06, "triangle", 0.06);
}

addEventListener("resize", () => {
  sz();
  renderSlots();
});
$("#rs").onclick = newGame;
function setSnd() { $("#snd").textContent = muted ? "🔇" : "🔊"; }
$("#snd").onclick = () => { muted = !muted; ls.set("cbb_mute", muted ? "1" : "0"); setSnd(); ac(); };
$("#undo").onclick = undo;
function openMenu() {
  if (drag) cancel();
  $("#over").classList.remove("show");
  $("#resume").style.display = started && !dead ? "" : "none";
  $("#menu").classList.add("show");
}
document.querySelectorAll(".mb[data-m]").forEach((b) => (b.onclick = () => {
  ac();
  gm = b.dataset.m;
  started = true;
  $("#menu").classList.remove("show");
  newGame();
}));
$("#resume").onclick = () => $("#menu").classList.remove("show");
$("#menubtn").onclick = openMenu;
$("#omenu").onclick = openMenu;
$("#retry").onclick = () => { $("#retry").style.display = "none"; startHand(); };
$("#tutok").onclick = () => { ls.set("cbb_tut", "1"); $("#tut").classList.remove("show"); };

/* ---------- MODE SWITCH ---------- */
function setMode(m) {
  mode = m;
  if (drag) cancel();
  cur.style.display = m === "hand" ? "block" : "none";
  $("#hint").textContent =
    m === "hand" ? "PINCH TO GRAB BLOCK · FIST TO ROTATE" : "WAITING FOR CAMERA...";
  if (m === "hand" && !ls.get("cbb_tut")) $("#tut").classList.add("show");
}

setSnd();
newGame();
setMode("none");
openMenu();
if ("serviceWorker" in navigator)
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));