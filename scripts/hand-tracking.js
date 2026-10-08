/* ---------- HAND TRACKING MODULE ---------- */
const trk = (t) =>
  ($("#trk").textContent =
    "Tracking: " + t + ({ g: " 🟢", y: " 🟡", r: " 🔴" }[$("#trk").dataset.q] || ""));

const loadScript = (s) =>
  new Promise((ok, no) => {
    const e = document.createElement("script");
    e.src = s;
    e.crossOrigin = "anonymous";
    e.onload = ok;
    e.onerror = () => no(new Error("script"));
    document.head.appendChild(e);
  });

const to = (p, ms) =>
  Promise.race([
    p,
    new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms)),
  ]);

let pin = false,
  pinN = 0,
  relN = 0,
  lost = 0,
  lastRot = 0,
  cx = -100,
  cy = -100,
  rsm = null,
  hands,
  vid = $("#vid"),
  busy = false;

/* One Euro filter: halus saat diam, responsif saat tangan bergerak cepat */
class OE {
  constructor(mc = 1.4, b = 0.012, dc = 1) {
    this.mc = mc;
    this.b = b;
    this.dc = dc;
    this.x = null;
    this.dx = 0;
    this.t = 0;
  }
  al(c, dt) {
    return 1 / (1 + 1 / (2 * Math.PI * c) / dt);
  }
  f(x, t) {
    if (this.x === null) {
      this.x = x;
      this.t = t;
      return x;
    }
    let dt = (t - this.t) / 1000;
    if (dt <= 0) dt = 1 / 60;
    this.t = t;
    this.dx += this.al(this.dc, dt) * ((x - this.x) / dt - this.dx);
    this.x +=
      this.al(this.mc + this.b * Math.abs(this.dx), dt) * (x - this.x);
    return this.x;
  }
  reset() {
    this.x = null;
    this.dx = 0;
  }
}

const fxF = new OE(),
  fyF = new OE();

/* gain > 1: area tengah kamera dipetakan ke seluruh layar, jadi kursor sudah
   sampai tepi layar saat tangan masih di dalam frame kamera (tidak terpotong) */
const GAIN_X = 1.5;
/* vertikal: area aktif digeser ke bawah. Posisi cubit di 20% teratas frame = tepi atas layar,
   dan 85% = tepi bawah layar. Jadi untuk menjangkau bagian atas, tangan tidak perlu
   naik sampai jari-jarinya terpotong di tepi atas frame. */
const Y0 = 0.2,
  Y1 = 0.85;

async function startHand() {
  trk("Initializing...");
  try {
    const BASE =
      "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/";
    const st = await to(
      navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 960 },
          height: { ideal: 540 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: "user",
        },
      }),
      20000,
    );
    vid.srcObject = st;
    await vid.play();
    document.body.classList.add("live");
    await to(loadScript(BASE + "hands.js"), 15000);
    hands = new Hands({ locateFile: (f) => BASE + f });
    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.4,
    });
    hands.onResults(onRes);
    await to(hands.initialize(), 25000);
    handReady = true;
    setMode("hand");
    trk("Searching");
    let lastSend = 0;
    const loop = (t) => {
      if (
        handReady &&
        mode === "hand" &&
        !busy &&
        vid.readyState >= 2 &&
        t - lastSend >= 33
      ) {
        lastSend = t;
        busy = true;
        hands
          .send({ image: vid })
          .catch(() => {})
          .finally(() => (busy = false));
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (e) {
    setMode("none");
    $("#trk").dataset.q = "";
    trk("Kamera gagal");
    $("#retry").style.display = "";
    openMenu();
    handReady = false;
  }
}

function onRes(res) {
  if (mode !== "hand") return;
  const L = res.multiHandLandmarks && res.multiHandLandmarks[0];
  if (!L) {
    $("#trk").dataset.q = "r";
    trk("Searching");
    if (++lost > 20) {
      if (drag) cancel();
      pin = false;
      pinN = 0;
      rsm = null;
      fxF.reset();
      fyF.reset();
      cx = -100;
      cur.style.opacity = "0"; /* sembunyikan kursor, jangan nyangkut di posisi terakhir */
      cur.classList.remove("pinch");
    }
    return;
  }
  lost = 0;
  cur.style.opacity = "1";
  const hs = res.multiHandedness && res.multiHandedness[0],
    qs = hs ? hs.score : 1;
  $("#trk").dataset.q = qs > 0.9 ? "g" : qs > 0.75 ? "y" : "r";
  const now = performance.now(),
    d = (a, b) => Math.hypot(L[a].x - L[b].x, L[a].y - L[b].y);
  const vw = vid.videoWidth || 4,
    vh = vid.videoHeight || 3,
    k = Math.max(innerWidth / vw, innerHeight / vh),
    dw = vw * k,
    dh = vh * k;
  /* titik tengah jempol & telunjuk: hampir tidak bergeser saat mencubit, jadi tidak loncat */
  const px = (L[4].x + L[8].x) / 2,
    py = (L[4].y + L[8].y) / 2;
  const ux = ((1 - px) * dw - (dw - innerWidth) / 2) / innerWidth,
    uy = (py * dh - (dh - innerHeight) / 2) / innerHeight;
  const tx = (0.5 + (ux - 0.5) * GAIN_X) * innerWidth,
    ty = ((uy - Y0) / (Y1 - Y0)) * innerHeight;
  const raw = d(4, 8) / d(0, 9);
  rsm = rsm == null ? raw : rsm * 0.45 + raw * 0.55;
  const fist = [
    [8, 5],
    [12, 9],
    [16, 13],
    [20, 17],
  ].every(([t, m]) => d(t, 0) < d(m, 0) * 1.1);
  if (fist) {
    trk("Fist");
    if (drag && now - lastRot > 800) {
      lastRot = now;
      rotate();
    }
    return;
  }
  pinN = rsm < 0.24 ? pinN + 1 : 0;
  relN = rsm > 0.5 ? relN + 1 : 0;
  /* lepas: jatuhkan di posisi terakhir yang stabil, sebelum kursor ikut bergerak */
  if (pin && relN >= 3) {
    pin = false;
    pinN = 0;
    relN = 0;
    if (drag) drop();
  }
  if (!pin && pinN >= 2) {
    pin = true;
    /* cubit di atas tombol = klik (Undo, Restart, dll) */
    const scope = document.querySelector("#tut.show,#menu.show,#over.show") || document;
    let bt = null, bd = 40;
    scope.querySelectorAll("button").forEach((b) => {
      if (!b.getClientRects().length) return;
      const R = b.getBoundingClientRect(),
        d = Math.hypot(Math.max(R.left - cx, 0, cx - R.right), Math.max(R.top - cy, 0, cy - R.bottom));
      if (d < bd) { bd = d; bt = b; }
    });
    if (bt) { ac(); bt.click(); }
    slotEls.forEach((el, i) => {
      const R = el.getBoundingClientRect();
      if (
        !drag &&
        !bt &&
        cx > R.left - 50 &&
        cx < R.right + 50 &&
        cy > R.top - 50 &&
        cy < R.bottom + 50
      )
        grab(i, cx, cy);
    });
  }
  /* saat jari mulai membuka, bekukan kursor agar tidak melenceng */
  if (!(pin && rsm > 0.4)) {
    cx = fxF.f(Math.min(innerWidth, Math.max(0, tx)), now);
    cy = fyF.f(Math.min(innerHeight, Math.max(0, ty)), now);
  }
  cur.style.transform = `translate(${cx}px,${cy}px)`;
  if (drag) moveTo(cx, cy);
  cur.classList.toggle("pinch", pin);
  trk(pin ? "Pinching" : "Active");
  $("#hint").textContent = pin
    ? "RELEASE TO DROP · FIST TO ROTATE"
    : "PINCH TO GRAB BLOCK · FIST TO ROTATE";
}


/* hand tracking adalah satu-satunya kontrol: mulai otomatis */
startHand();