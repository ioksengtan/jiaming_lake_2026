/* 戒茂斯線專注計時。
   測試可在網址加 ?seconds=20，把一段專注的實際等待縮成 20 秒。
   畫面上不顯示這個參數。進度仍以所選的 15、25 或 50 分鐘累積。 */
const STORE = "jiaming-focus-v1";
const NEAR_MIN = 10;
const FAST_MS = readFast();
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = load();
const geom = {};
let raf = 0;
let stepTimer = 0;

const $ = (id) => document.getElementById(id);

function readFast() {
  const n = Number(new URLSearchParams(location.search).get("seconds"));
  return Number.isFinite(n) && n > 0 ? n * 1000 : 0;
}

function taipei(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "numeric",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(ms));
  const bag = {};
  for (const part of parts) bag[part.type] = part.value;
  return {
    y: Number(bag.year),
    m: Number(bag.month),
    d: Number(bag.day),
    h: Number(bag.hour),
  };
}

function dayKey(ms) {
  const p = taipei(ms);
  return p.y * 10000 + p.m * 100 + p.d;
}

function formatDate(ms) {
  const p = taipei(ms);
  return `${p.y}年${p.m}月${p.d}日`;
}

function skyName(ms) {
  const h = taipei(ms).h;
  if (h >= 5 && h < 11) return "dawn";
  if (h >= 11 && h < 16) return "afternoon";
  if (h >= 16 && h < 19) return "dusk";
  return "night";
}

function zhCount(n) {
  const d = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n === 2) return "兩";
  if (n < 10) return d[n];
  if (n === 10) return "十";
  if (n < 20) return "十" + d[n - 10];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return d[tens] + "十" + (ones ? d[ones] : "");
}

function minText(n) {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function comma(n) {
  return Math.round(n).toLocaleString("zh-Hant");
}

function load() {
  const blank = {
    choice: 25,
    routeMin: 0,
    todayKey: dayKey(Date.now()),
    todayMin: 0,
    startedOn: 0,
    lastSeen: Date.now(),
    hideClock: false,
    milestone: null,
    votes: [],
    session: null,
    mood: "day",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (!saved || saved.v !== 1) return freshMood(blank);
    const state = { ...blank, ...saved, v: 1 };
    return freshMood(state);
  } catch {
    return freshMood(blank);
  }
}

function freshMood(state) {
  const gap = Date.now() - (state.lastSeen || Date.now());
  if (gap > 3 * 24 * 60 * 60 * 1000) state.mood = "fog";
  else if (gap > 12 * 60 * 60 * 1000 || (state.lastSeen && dayKey(state.lastSeen) !== dayKey(Date.now()))) {
    state.mood = "night";
  } else state.mood = "day";
  if (state.session && state.session.state === "running") settleIfOver(state);
  if (dayKey(Date.now()) !== state.todayKey) {
    state.todayKey = dayKey(Date.now());
    state.todayMin = 0;
  }
  return state;
}

function persist() {
  state.lastSeen = Date.now();
  const payload = {
    v: 1,
    choice: state.choice,
    routeMin: state.routeMin,
    todayKey: state.todayKey,
    todayMin: state.todayMin,
    startedOn: state.startedOn,
    lastSeen: state.lastSeen,
    hideClock: state.hideClock,
    milestone: state.milestone,
    votes: state.votes,
    session: state.session,
  };
  localStorage.setItem(STORE, JSON.stringify(payload));
}

function sessionElapsed(session, now = Date.now()) {
  if (!session) return 0;
  let elapsed = session.elapsedBefore || 0;
  if (session.state === "running" && session.runningSince) elapsed += now - session.runningSince;
  return elapsed;
}

function settleIfOver(target) {
  const session = target.session;
  if (!session || session.state !== "running") return;
  if (sessionElapsed(session) < session.realDurationMs) return;
  commitSession(target, 1);
}

function commitSession(target, frac) {
  const session = target.session;
  if (!session) return;
  const room = PROFILE.totalMin - session.routeAtStart;
  const gained = Math.min(session.choice * frac, Math.max(0, room));
  const next = Math.min(PROFILE.totalMin, session.routeAtStart + gained);
  const delta = Math.max(0, next - target.routeMin);
  target.routeMin = next;
  if (dayKey(Date.now()) !== target.todayKey) {
    target.todayKey = dayKey(Date.now());
    target.todayMin = 0;
  }
  target.todayMin += delta;
  target.session = null;
  if (!target.startedOn) target.startedOn = Date.now();
  if (target.routeMin >= PROFILE.totalMin - 0.001 && !target.milestone) {
    const earnedAt = Date.now();
    target.milestone = {
      earnedAt,
      startedOn: target.startedOn,
      totalMin: PROFILE.totalMin,
      outMin: PROFILE.outMin,
      backMin: PROFILE.backMin,
      gainRound: PROFILE.gainRound,
      gainOut: PROFILE.gainOut,
      gainBack: PROFILE.gainBack,
      sky: skyName(earnedAt),
    };
  }
}

function liveRouteMin() {
  if (!state.session) return state.routeMin;
  const elapsed = sessionElapsed(state.session);
  const frac = Math.min(1, elapsed / state.session.realDurationMs);
  const room = PROFILE.totalMin - state.session.routeAtStart;
  return Math.min(PROFILE.totalMin, state.session.routeAtStart + Math.min(state.session.choice * frac, room));
}

function finished() {
  return liveRouteMin() >= PROFILE.totalMin - 0.001;
}

function isStop(place) {
  return place.role === "shelter" || place.role === "lake" || place.role === "start";
}

function nextPlace(routeMin) {
  if (routeMin < PROFILE.outMin - 0.001) {
    return PROFILE.places.find((place) => isStop(place) && place.role !== "start" && place.out > routeMin + 0.02);
  }
  return PROFILE.places
    .filter((place) => isStop(place) && place.back > routeMin + 0.02)
    .sort((a, b) => a.back - b.back)[0];
}

function remainTo(place, routeMin) {
  if (!place) return 0;
  return (routeMin < PROFILE.outMin ? place.out : place.back) - routeMin;
}

function nearbyShelter(routeMin) {
  const shelters = PROFILE.places.filter((place) => place.role === "shelter");
  let best = null;
  for (const place of shelters) {
    const remain = remainTo(place, routeMin);
    if (remain > 0 && remain < NEAR_MIN && (!best || remain < best.remain)) best = { place, remain };
  }
  return best;
}

function forecast(routeMin) {
  if (routeMin >= PROFILE.totalMin - 0.001) return "已回到戒茂斯登山口";
  if (routeMin >= PROFILE.outMin && routeMin < PROFILE.outMin + 1) return "抵達嘉明湖";
  const place = nextPlace(routeMin);
  if (!place) return "已回到戒茂斯登山口";
  const times = Math.max(1, Math.ceil(remainTo(place, routeMin) / state.choice - 1e-9));
  return `再${zhCount(times)}次專注就到${place.name}`;
}

function statusText(routeMin) {
  if (finished()) return "已回到戒茂斯登山口";
  if (state.session && state.session.state === "interrupted") {
    const near = nearbyShelter(routeMin);
    if (near) return `在${near.place.name}休息`;
    return "坐在路邊喝水";
  }
  return forecast(routeMin);
}

function poseOf(routeMin) {
  if (finished()) return { kind: "done", d: 0, ele: PROFILE.startEle, dir: 1 };
  const at = pointAt(routeMin);
  if (state.session && state.session.state === "interrupted") {
    const near = nearbyShelter(routeMin);
    if (near) return { kind: "shelter", d: near.place.d, ele: near.place.ele, dir: at.dir };
    return { kind: "sit", d: at.d, ele: at.ele, dir: 1 };
  }
  return { kind: "walk", d: at.d, ele: at.ele, dir: at.dir };
}

function pointAt(routeMin) {
  const pts = PROFILE.points;
  const m = Math.max(0, Math.min(PROFILE.totalMin, routeMin));
  if (m <= 0.001) return { d: pts[0][0], ele: pts[0][1], dir: 1 };
  if (m >= PROFILE.totalMin - 0.001) return { d: pts[0][0], ele: pts[0][1], dir: 1 };
  if (m <= PROFILE.outMin) {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][2] >= m) {
        const a = pts[i - 1];
        const b = pts[i];
        const span = b[2] - a[2] || 1;
        const t = (m - a[2]) / span;
        return { d: a[0] + (b[0] - a[0]) * t, ele: a[1] + (b[1] - a[1]) * t, dir: 1 };
      }
    }
  }
  for (let i = pts.length - 2; i >= 0; i--) {
    if (pts[i][3] >= m) {
      const a = pts[i + 1];
      const b = pts[i];
      const span = b[3] - a[3] || 1;
      const t = (m - a[3]) / span;
      return { d: a[0] + (b[0] - a[0]) * t, ele: a[1] + (b[1] - a[1]) * t, dir: -1 };
    }
  }
  return { d: pts[0][0], ele: pts[0][1], dir: -1 };
}

function buildScene() {
  const svg = $("scene");
  const pts = PROFILE.points;
  const minE = Math.min(...pts.map((p) => p[1]));
  const maxE = Math.max(...pts.map((p) => p[1]));
  const x0 = 78;
  const x1 = 1122;
  const yTop = 118;
  const yBot = 548;
  const xy = (d, ele) => {
    const x = x0 + (d / PROFILE.lengthM) * (x1 - x0);
    const y = yTop + (1 - (ele - minE) / (maxE - minE)) * (yBot - yTop);
    return [x, y];
  };
  geom.xy = xy;
  const line = pts
    .map((p, i) => {
      const [x, y] = xy(p[0], p[1]);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const [xStart] = xy(pts[0][0], pts[0][1]);
  const [xEnd] = xy(pts.at(-1)[0], pts.at(-1)[1]);
  geom.line = line;

  svg.setAttribute("viewBox", "0 0 1200 680");
  svg.setAttribute("preserveAspectRatio", "xMidYMax meet");
  svg.innerHTML = `
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#d7e6f3"/>
        <stop offset="0.55" stop-color="#f6e6d2"/>
        <stop offset="1" stop-color="#f7f2e7"/>
      </linearGradient>
      <linearGradient id="ridge" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c5d7a4"/>
        <stop offset="0.45" stop-color="#7f9a62"/>
        <stop offset="1" stop-color="#355848"/>
      </linearGradient>
      <filter id="paper" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="3" result="n"/>
        <feColorMatrix type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.18  0 0 0 0.18 0" in="n"/>
      </filter>
    </defs>
    <rect width="1200" height="680" fill="url(#sky)"/>
    <g class="cloud" fill="#fffaf3" opacity="0.85">
      <ellipse cx="180" cy="120" rx="70" ry="22"/>
      <ellipse cx="230" cy="112" rx="46" ry="18"/>
    </g>
    <g class="cloud" fill="#fffaf3" opacity="0.7">
      <ellipse cx="860" cy="150" rx="84" ry="20"/>
      <ellipse cx="930" cy="142" rx="40" ry="16"/>
    </g>
    <circle cx="980" cy="96" r="28" fill="#f3d7a2" opacity="0.9"/>
    <path d="${line} L${xEnd.toFixed(1)} 640 L${xStart.toFixed(1)} 640 Z" fill="url(#ridge)"/>
    <path d="${line}" fill="none" stroke="#f4efe4" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" opacity="0.45"/>
    <path d="${line}" fill="none" stroke="#3a332c" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    <rect width="1200" height="680" filter="url(#paper)" opacity="0.35" style="pointer-events:none"/>
    <g id="night" visibility="hidden">
      <rect width="1200" height="250" fill="#243044" opacity="0.55"/>
      <g fill="#f7f1e4">
        <circle cx="120" cy="70" r="1.6"/><circle cx="210" cy="110" r="1.2"/>
        <circle cx="340" cy="54" r="1.4"/><circle cx="520" cy="88" r="1.1"/>
        <circle cx="690" cy="48" r="1.5"/><circle cx="810" cy="96" r="1.2"/>
      </g>
    </g>
    <rect id="fog" width="1200" height="680" fill="#f7f3ea" opacity="0" style="pointer-events:none"/>
    <g id="marks"></g>
    <ellipse id="lake" cx="0" cy="0" rx="16" ry="7" fill="#6aa4c4" stroke="#3a332c" stroke-width="1.4" opacity="0"/>
    <g id="sitter" visibility="hidden"></g>
    <g id="hiker" visibility="visible"><g id="hiker-pose"></g></g>
  `;

  const marks = svg.querySelector("#marks");
  for (const place of PROFILE.places) {
    const [x, y] = xy(place.d, place.ele);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.dataset.id = place.id;
    g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    g.innerHTML = markMarkup(place.role);
    marks.append(g);
  }
  const [lx, ly] = xy(PROFILE.lengthM, PROFILE.endEle);
  const lake = svg.querySelector("#lake");
  lake.setAttribute("cx", lx.toFixed(1));
  lake.setAttribute("cy", (ly + 8).toFixed(1));

  svg.querySelector("#hiker-pose").innerHTML = standingMarkup();
  svg.querySelector("#sitter").innerHTML = sittingMarkup();
  geom.hiker = svg.querySelector("#hiker");
  geom.sitter = svg.querySelector("#sitter");
  geom.lake = lake;
  geom.night = svg.querySelector("#night");
  geom.fog = svg.querySelector("#fog");
  geom.marks = marks;
}

function markMarkup(role) {
  if (role === "shelter") {
    return `<path d="M-8 2 V-8 H8 V2" fill="#f4efe4" stroke="#3a332c" stroke-width="1.6"/>
      <path d="M-11 -8 L0 -16 L11 -8" fill="none" stroke="#3a332c" stroke-width="1.6"/>
      <rect class="window" x="-2.2" y="-6" width="4.4" height="4" fill="#f4efe4"/>`;
  }
  if (role === "lake") return `<circle r="3.2" fill="none" stroke="#3a332c" stroke-width="1.5"/>`;
  if (role === "landscape") return `<path d="M0 2 V-9" stroke="#3a332c" stroke-width="1.5"/>`;
  return `<circle r="3.2" fill="#f4efe4" stroke="#3a332c" stroke-width="1.5"/>`;
}

function standingMarkup() {
  return `
    <ellipse cx="0" cy="2" rx="16" ry="3.5" fill="#3a332c" opacity="0.15"/>
    <path d="M-14 -34 h10 v16 h-8 z" fill="#c46a3a" stroke="#3a332c" stroke-width="1.6"/>
    <path d="M-8 -30 h20 l3 22 h-24 z" fill="#e07a3d" stroke="#3a332c" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="2" cy="-40" r="9" fill="#f3d7c4" stroke="#3a332c" stroke-width="1.6"/>
    <ellipse cx="2" cy="-48" rx="11" ry="3.2" fill="#355848" stroke="#3a332c" stroke-width="1.4"/>
    <path d="M-6 -48 h16 v-7 h-16 z" fill="#355848" stroke="#3a332c" stroke-width="1.4"/>
    <circle cx="-1" cy="-41" r="1" fill="#3a332c"/>
    <circle cx="5" cy="-41" r="1" fill="#3a332c"/>
    <path d="M-4 -8 L-8 2" stroke="#3a332c" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M6 -8 L9 2" stroke="#3a332c" stroke-width="2.2" stroke-linecap="round"/>
  `;
}

function sittingMarkup() {
  return `
    <ellipse cx="0" cy="2" rx="18" ry="3.5" fill="#3a332c" opacity="0.15"/>
    <path d="M-16 -20 h9 v12 h-8 z" fill="#c46a3a" stroke="#3a332c" stroke-width="1.6"/>
    <path d="M-6 -22 h18 l2 14 h-20 z" fill="#e07a3d" stroke="#3a332c" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M-2 -8 H16" stroke="#3a332c" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M14 -8 V2" stroke="#3a332c" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="4" cy="-30" r="8" fill="#f3d7c4" stroke="#3a332c" stroke-width="1.6"/>
    <ellipse cx="4" cy="-37" rx="10" ry="3" fill="#355848" stroke="#3a332c" stroke-width="1.4"/>
    <path d="M-4 -37 h16 v-6 h-16 z" fill="#355848" stroke="#3a332c" stroke-width="1.4"/>
    <circle cx="1" cy="-31" r="1" fill="#3a332c"/>
    <circle cx="7" cy="-31" r="1" fill="#3a332c"/>
    <path d="M16 -16 h8 v7 h-8 z" fill="#f7f3ea" stroke="#3a332c" stroke-width="1.4"/>
    <ellipse cx="20" cy="-16" rx="5" ry="1.6" fill="#6aa4c4" stroke="#3a332c" stroke-width="1"/>
  `;
}

function renderPeople(routeMin) {
  const pose = poseOf(routeMin);
  const [x, y] = geom.xy(pose.d, pose.ele);
  geom.hiker.setAttribute("visibility", pose.kind === "sit" ? "hidden" : "visible");
  geom.sitter.setAttribute("visibility", pose.kind === "sit" ? "visible" : "hidden");
  geom.hiker.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${pose.dir} 1)`);
  geom.sitter.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  const passedLake = routeMin >= PROFILE.outMin - 0.05;
  geom.lake.setAttribute("opacity", passedLake ? "1" : "0");
  geom.night.setAttribute("visibility", state.mood === "night" || state.mood === "fog" ? "visible" : "hidden");
  geom.fog.setAttribute("opacity", state.mood === "fog" ? "0.55" : "0");
  for (const node of geom.marks.children) {
    const place = PROFILE.places.find((item) => item.id === node.dataset.id);
    const reached = routeMin + 0.02 >= place.out || (routeMin >= place.back && place.role !== "lake");
    node.classList.toggle("reached", reached);
    const window = node.querySelector(".window");
    if (window) window.setAttribute("fill", node.classList.contains("reached") ? "#f3d7a2" : "#f4efe4");
  }
  const app = $("app");
  app.dataset.routeMin = liveRouteMin().toFixed(2);
  app.dataset.pose = pose.kind;
  app.dataset.state = finished() ? "done" : state.session?.state || "idle";
}

function renderChrome() {
  const routeMin = liveRouteMin();
  const session = state.session;
  $("status").textContent = statusText(routeMin);
  $("today").textContent = `今天累積 ${minText(displayToday())} 分鐘`;
  const time = $("time");
  time.hidden = state.hideClock;
  $("clock-toggle").textContent = state.hideClock ? "顯示時間" : "隱藏時間";
  if (!session) time.textContent = clockText(state.choice * 60);
  else {
    const left = session.realDurationMs * (1 - Math.min(1, sessionElapsed(session) / session.realDurationMs));
    const shown = session.choice * 60 * (left / session.realDurationMs);
    time.textContent = clockText(Math.max(0, shown));
  }
  for (const button of document.querySelectorAll(".lengths button")) {
    const on = Number(button.dataset.choice) === state.choice;
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.disabled = Boolean(session) || finished();
  }
  const go = $("go");
  const interrupt = $("interrupt");
  if (finished()) {
    go.disabled = true;
    interrupt.disabled = true;
    go.textContent = "開始專注";
  } else if (session?.state === "running") {
    go.disabled = true;
    interrupt.disabled = false;
    go.textContent = "開始專注";
  } else if (session?.state === "interrupted") {
    go.disabled = false;
    interrupt.disabled = true;
    go.textContent = "繼續走";
  } else {
    go.disabled = false;
    interrupt.disabled = true;
    go.textContent = "開始專注";
  }
  const place = nextPlace(routeMin);
  if (session?.state === "running") {
    const leftMin = Math.max(1, Math.ceil(session.choice * (1 - sessionElapsed(session) / session.realDurationMs) - 1e-9));
    const where = place ? place.name : "戒茂斯登山口";
    document.title = `剩${zhCount(leftMin)}分｜往${where}`;
  } else document.title = "嘉明湖";
  renderPeople(routeMin);
}

function displayToday() {
  const base = dayKey(Date.now()) === state.todayKey ? state.todayMin : 0;
  return base + Math.max(0, liveRouteMin() - state.routeMin);
}

function clockText(totalSeconds) {
  const whole = Math.max(0, Math.ceil(totalSeconds - 1e-6));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function render() {
  if (state.session?.state === "running" && sessionElapsed(state.session) >= state.session.realDurationMs) {
    commitSession(state, 1);
    persist();
  }
  renderChrome();
}

function loop() {
  cancelAnimationFrame(raf);
  render();
  if (state.session?.state === "running" && !document.hidden) raf = requestAnimationFrame(loop);
}

function kickStep() {
  clearTimeout(stepTimer);
  if (reduceMotion.matches || state.session?.state !== "running" || document.hidden) return;
  stepTimer = setTimeout(() => {
    const pose = $("hiker-pose");
    if (!pose || reduceMotion.matches) return;
    pose.classList.add("step");
    setTimeout(() => pose.classList.remove("step"), 420);
    kickStep();
  }, 12000);
}

function startOrResume() {
  if (finished()) return;
  if (!state.startedOn) state.startedOn = Date.now();
  state.mood = "day";
  if (state.session?.state === "interrupted") {
    state.session.state = "running";
    state.session.runningSince = Date.now();
  } else if (!state.session) {
    state.session = {
      state: "running",
      choice: state.choice,
      routeAtStart: state.routeMin,
      elapsedBefore: 0,
      runningSince: Date.now(),
      realDurationMs: FAST_MS || state.choice * 60 * 1000,
    };
  }
  persist();
  loop();
  kickStep();
}

function interrupt() {
  const session = state.session;
  if (!session || session.state !== "running") return;
  const elapsed = sessionElapsed(session);
  if (elapsed >= session.realDurationMs) {
    commitSession(state, 1);
  } else {
    session.elapsedBefore = elapsed;
    session.runningSince = null;
    session.state = "interrupted";
  }
  persist();
  cancelAnimationFrame(raf);
  render();
}

function choose(minutes) {
  if (state.session || finished()) return;
  state.choice = minutes;
  persist();
  render();
}

function restart() {
  state.choice = 25;
  state.routeMin = 0;
  state.todayKey = dayKey(Date.now());
  state.todayMin = 0;
  state.startedOn = 0;
  state.milestone = null;
  state.session = null;
  state.mood = "day";
  persist();
  closeSheet();
  render();
}

function openSheet(node) {
  const sheet = $("sheet");
  sheet.replaceChildren(node);
  $("shade").hidden = false;
  const close = sheet.querySelector("[data-close]");
  if (close) close.focus();
}

function closeSheet() {
  $("shade").hidden = true;
  $("sheet").replaceChildren();
}

function bookView() {
  const wrap = document.createElement("div");
  const title = document.createElement("h2");
  title.id = "sheet-title";
  title.textContent = "收集簿";
  const note = document.createElement("p");
  note.textContent = "卡片存在這台裝置的瀏覽器裡。清除瀏覽器資料後會消失。這份軌跡沒有山屋，也沒有登上三叉山，所以沒有那些小卡。";
  const thumb = document.createElement("button");
  thumb.type = "button";
  thumb.className = "thumb" + (state.milestone ? "" : " locked");
  thumb.innerHTML = `<svg viewBox="0 0 120 80" aria-hidden="true">${thumbRidge()}</svg><span><strong>回到戒茂斯登山口</strong><span>${state.milestone ? "里程碑卡" : "尚未取得"}</span></span>`;
  thumb.disabled = !state.milestone;
  thumb.addEventListener("click", () => openSheet(cardView()));
  const votes = voteRow();
  const row = document.createElement("div");
  row.className = "row";
  const close = document.createElement("button");
  close.type = "button";
  close.dataset.close = "1";
  close.textContent = "關閉";
  close.addEventListener("click", closeSheet);
  row.append(close);
  wrap.append(title, note, thumb, votes, row);
  return wrap;
}

function thumbRidge() {
  const pts = PROFILE.points.filter((_, i) => i % 4 === 0);
  const minE = PROFILE.startEle;
  const maxE = PROFILE.highEle;
  const d = pts
    .map((p, i) => {
      const x = 8 + (p[0] / PROFILE.lengthM) * 104;
      const y = 58 - ((p[1] - minE) / (maxE - minE)) * 40;
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return `<path d="${d} L112 70 L8 70 Z" fill="${state.milestone ? "#7f9a62" : "#cfc6b8"}" stroke="#3a332c" stroke-width="1.4"/>`;
}

function voteRow() {
  const box = document.createElement("div");
  const label = document.createElement("p");
  label.textContent = "下一座想爬哪裡";
  const votes = document.createElement("div");
  votes.className = "votes";
  for (const name of ["玉山主峰", "雪山主峰", "合歡山"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.setAttribute("aria-pressed", state.votes.at(-1)?.name === name ? "true" : "false");
    button.addEventListener("click", () => {
      state.votes.push({ name, at: Date.now() });
      persist();
      openSheet(bookView());
    });
    votes.append(button);
  }
  box.append(label, votes);
  return box;
}

function cardView() {
  const wrap = document.createElement("div");
  const title = document.createElement("h2");
  title.id = "sheet-title";
  title.textContent = "里程碑卡";
  const img = document.createElement("img");
  img.alt = "回到戒茂斯登山口的里程碑卡";
  const canvas = drawMilestone(state.milestone);
  img.src = canvas.toDataURL("image/png");
  const row = document.createElement("div");
  row.className = "row";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "儲存圖片";
  save.addEventListener("click", () => saveCanvas(canvas));
  const close = document.createElement("button");
  close.type = "button";
  close.dataset.close = "1";
  close.textContent = "關閉";
  close.addEventListener("click", () => openSheet(bookView()));
  row.append(save, close);
  wrap.append(title, img, row);
  return wrap;
}

function saveCanvas(canvas) {
  canvas.toBlob((blob) => {
    const link = document.createElement("a");
    const stamp = formatDate(state.milestone.earnedAt).replace(/年|月/g, "").replace("日", "");
    link.href = URL.createObjectURL(blob);
    link.download = `嘉明湖-${stamp}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, "image/png");
}

function drawMilestone(card) {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1125;
  const ctx = canvas.getContext("2d");
  const sky = card.sky;
  const night = sky === "night";
  const gradient = ctx.createLinearGradient(0, 0, 0, 760);
  const skies = {
    dawn: ["#f6d5c8", "#f7ebdd", "#d5e4f2"],
    afternoon: ["#f6e3c4", "#d9e7f4", "#f7f1e6"],
    dusk: ["#efb08a", "#f6d3b4", "#f3e2cf"],
    night: ["#1c2838", "#31445f", "#243246"],
  };
  const stops = skies[sky] || skies.afternoon;
  gradient.addColorStop(0, stops[0]);
  gradient.addColorStop(0.45, stops[1]);
  gradient.addColorStop(1, stops[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 900, 1125);
  if (night) {
    ctx.fillStyle = "#f7f1e4";
    for (const [x, y, r] of [[120, 90, 1.6], [210, 140, 1.2], [340, 70, 1.5], [520, 120, 1.1], [680, 80, 1.4], [790, 150, 1.2]]) {
      ctx.beginPath();
      ctx.arc(x, y, r * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = "rgba(243,215,162,0.95)";
    ctx.beginPath();
    ctx.arc(740, 150, 36, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = night ? "#d7e0ea" : "#355848";
  ridgePath(ctx, 70, 300, 760, 280, 720);
  ctx.fill();
  ctx.strokeStyle = night ? "#f4efe4" : "#3a332c";
  ctx.lineWidth = 3;
  ctx.stroke();
  const lakeX = 70 + 760;
  const lakeY = 300 + 280 - ((PROFILE.endEle - PROFILE.startEle) / (PROFILE.highEle - PROFILE.startEle)) * 280;
  ctx.fillStyle = "#6aa4c4";
  ctx.beginPath();
  ctx.ellipse(lakeX, lakeY + 10, 26, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#3a332c";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(0, 730, 900, 395);
  ctx.fillStyle = night ? "#f7f1e4" : "#3a332c";
  ctx.textAlign = "center";
  ctx.font = fontCss(64, 700, true);
  ctx.fillText("嘉明湖", 450, 120);
  ctx.font = fontCss(28, 500, false);
  ctx.fillText("戒茂斯線", 450, 168);
  ctx.font = fontCss(30, 600, true);
  wrapText(ctx, PROFILE.quote, 450, 230, 640, 44);

  const days = inclusiveDays(card.startedOn, card.earnedAt);
  const sameDay = dayKey(card.startedOn) === dayKey(card.earnedAt);
  const when = sameDay ? formatDate(card.earnedAt) : `${formatDate(card.startedOn)}至${formatDate(card.earnedAt)}`;
  const lines = [
    when,
    `共 ${days} 天`,
    `總專注 ${minText(card.totalMin)} 分鐘`,
    `去程 ${minText(card.outMin)} 分鐘，回程 ${minText(card.backMin)} 分鐘`,
    `累積爬升 ${comma(card.gainRound)} 公尺`,
    `去程 ${comma(card.gainOut)} 公尺，回程 ${comma(card.gainBack)} 公尺`,
  ];
  ctx.font = fontCss(28, 500, false);
  ctx.fillStyle = "#3a332c";
  lines.forEach((line, index) => ctx.fillText(line, 450, 800 + index * 44));
  ctx.font = fontCss(20, 400, false);
  ctx.fillStyle = "#74695c";
  ctx.fillText("回程是同一條剖面折返", 450, 1072);
  return canvas;
}

function ridgePath(ctx, x, y, w, h, base) {
  const pts = PROFILE.points;
  const minE = PROFILE.startEle;
  const maxE = PROFILE.highEle;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const px = x + (p[0] / PROFILE.lengthM) * w;
    const py = y + h - ((p[1] - minE) / (maxE - minE)) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.lineTo(x + w, base);
  ctx.lineTo(x, base);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  let line = "";
  let yy = y;
  for (const ch of text) {
    const trial = line + ch;
    if (ctx.measureText(trial).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = ch;
      yy += lineHeight;
    } else line = trial;
  }
  if (line) ctx.fillText(line, x, yy);
}

function fontCss(size, weight, serif) {
  const family = serif ? "Noto Serif TC" : "Noto Sans TC";
  if (document.fonts && document.fonts.check(`${weight} ${size}px "${family}"`)) {
    return `${weight} ${size}px "${family}", "WenQuanYi Micro Hei", sans-serif`;
  }
  return `${weight} ${size}px "WenQuanYi Micro Hei", sans-serif`;
}

function inclusiveDays(a, b) {
  return Math.abs(Math.round((dayStamp(b) - dayStamp(a)) / 86400000)) + 1;
}

function dayStamp(ms) {
  const p = taipei(ms);
  return Date.UTC(p.y, p.m - 1, p.d);
}

function confirmView() {
  const wrap = document.createElement("div");
  const title = document.createElement("h2");
  title.id = "sheet-title";
  title.textContent = "重新開始全程";
  const note = document.createElement("p");
  note.textContent = "這會清除目前的進度與里程碑卡。確定要重新開始嗎？";
  const row = document.createElement("div");
  row.className = "row";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.textContent = "確定清除";
  yes.addEventListener("click", restart);
  const no = document.createElement("button");
  no.type = "button";
  no.dataset.close = "1";
  no.textContent = "取消";
  no.addEventListener("click", closeSheet);
  row.append(yes, no);
  wrap.append(title, note, row);
  return wrap;
}

$("go").addEventListener("click", startOrResume);
$("interrupt").addEventListener("click", interrupt);
$("clock-toggle").addEventListener("click", () => {
  state.hideClock = !state.hideClock;
  persist();
  render();
});
$("book").addEventListener("click", () => openSheet(bookView()));
$("restart").addEventListener("click", () => openSheet(confirmView()));
for (const button of document.querySelectorAll(".lengths button")) {
  button.addEventListener("click", () => choose(Number(button.dataset.choice)));
}
$("shade").addEventListener("click", (event) => {
  if (event.target.id === "shade") closeSheet();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSheet();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    persist();
    cancelAnimationFrame(raf);
    return;
  }
  if (state.session?.state === "running" && sessionElapsed(state.session) >= state.session.realDurationMs + 15 * 60 * 1000) {
    commitSession(state, 1);
  }
  persist();
  loop();
});
window.addEventListener("pagehide", persist);

buildScene();
render();
if (state.session?.state === "running") {
  loop();
  kickStep();
}
