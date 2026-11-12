// 山屋時光計時頁。純前端、相對路徑、進度存在 localStorage。
// 專注時間不暫停，依這一段的開始時刻計算。
import {
  routeData,
  positionAt,
  yForX,
  interruptState,
  nextLandmark,
  nextRest,
  cardsCrossed,
  milestoneCrossed,
  reachedLake,
  completed,
  sessionTarget,
  sessionWalked,
  sessionDone,
  nodeByKey,
  FORWARD_TOTAL,
  GRAND_TOTAL,
} from './engine.js'

const STORE_KEY = 'hutTime.v1'
const params = new URLSearchParams(location.search)
// 測試參數：把一段專注的實際等待縮短（不出現在介面上）。speed=1 為正常。
const SPEED = Math.max(1, Number(params.get('speed')) || 1)

const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches

// ---------- 狀態 ----------
function freshState() {
  return {
    walked: 0, // 全程分鐘 0..500
    focusCount: 0,
    cards: {}, // key -> {minutes, cumMin, ts}
    milestone: null, // {minutes, ts, startTs, days}
    journeyStartTs: null,
    session: null, // {startTs, startWalked, length}
    interrupted: false,
    length: 25,
  }
}
function loadState() {
  let s
  try {
    s = JSON.parse(localStorage.getItem(STORE_KEY))
  } catch {
    s = null
  }
  const base = freshState()
  const st = s && typeof s === 'object' ? { ...base, ...s } : base
  st.cards = st.cards || {}
  return st
}
function loadMountains() {
  try {
    return JSON.parse(localStorage.getItem('hutTime.peaks')) || { yushan: 0, xueshan: 0, hehuan: 0 }
  } catch {
    return { yushan: 0, xueshan: 0, hehuan: 0 }
  }
}
let state = loadState()
let mountains = loadMountains()
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state))
}
function saveMountains() {
  localStorage.setItem('hutTime.peaks', JSON.stringify(mountains))
}

// ---------- 中文數字與台北時間 ----------
const DIG = '零一二三四五六七八九'
function cnNum(n) {
  n = Math.round(n)
  if (n < 0) n = 0
  if (n < 10) return DIG[n]
  if (n < 20) return '十' + (n % 10 ? DIG[n % 10] : '')
  if (n < 100) {
    const t = Math.floor(n / 10)
    const o = n % 10
    return DIG[t] + '十' + (o ? DIG[o] : '')
  }
  const h = Math.floor(n / 100)
  const r = n % 100
  let s = DIG[h] + '百'
  if (r === 0) return s
  if (r < 10) return s + '零' + DIG[r]
  if (r < 20) return s + '一十' + (r % 10 ? DIG[r % 10] : '')
  return s + cnNum(r)
}
const cnCount = (n) => (n === 2 ? '兩' : cnNum(n))

function taipei(ts) {
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(ts))
  const g = (t) => Number(parts.find((p) => p.type === t).value)
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour') % 24 }
}
const dateStr = (ts) => {
  const t = taipei(ts)
  return `${t.y} 年 ${t.m} 月 ${t.d} 日`
}
const dayIndex = (ts) => {
  const t = taipei(ts)
  return Math.floor(Date.UTC(t.y, t.m - 1, t.d) / 86400000)
}
// 天色依抵達的台北時間，界線寫死。
function skyOf(ts) {
  const h = taipei(ts).h
  if (h >= 5 && h <= 10) return { name: '清晨', top: '#cfe3ef', bot: '#f6ecd6' }
  if (h >= 11 && h <= 16) return { name: '午後', top: '#bcd9ea', bot: '#f3ead1' }
  if (h >= 17 && h <= 18) return { name: '黃昏', top: '#e9b27a', bot: '#f3d9a6' }
  return { name: '夜晚', top: '#3a4663', bot: '#7d7392' }
}

// ---------- 即時進度 ----------
function currentWalked() {
  if (!state.session) return state.walked
  const elapsedMin = ((Date.now() - state.session.startTs) / 60000) * SPEED
  return sessionWalked(state.session.startWalked, state.session.length, elapsedMin)
}
function sessionElapsedMin() {
  if (!state.session) return 0
  return ((Date.now() - state.session.startTs) / 60000) * SPEED
}

function finalizeSession() {
  const s = state.session
  if (!s) return
  const target = sessionTarget(s.startWalked, s.length)
  const newWalked = s.startWalked + target
  const ts = Date.now()
  // 發去程營地小卡（走到才發）
  for (const key of cardsCrossed(s.startWalked, newWalked)) {
    if (!state.cards[key]) state.cards[key] = { minutes: target, cumMin: nodeByKey(key).minF, ts }
  }
  // 里程碑：走滿 500、回到登山口才給
  if (milestoneCrossed(s.startWalked, newWalked) && !state.milestone) {
    const startTs = state.journeyStartTs || ts
    state.milestone = { minutes: GRAND_TOTAL, ts, startTs, days: dayIndex(ts) - dayIndex(startTs) + 1 }
  }
  state.walked = newWalked
  state.focusCount += 1
  state.session = null
  state.interrupted = false
  save()
}

// ---------- 畫面元素 ----------
const $ = (id) => document.getElementById(id)
const scene = $('scene')
const sctx = scene.getContext('2d')
const statusLine = $('status-line')
const statusHint = $('status-hint')
const countdown = $('countdown')
const primary = $('primary')
const lengths = $('lengths')
const cdToggle = $('cd-toggle')
const nextPeaks = $('next-peaks')
const controls = $('controls')

let showCountdown = true

// ---------- 場景繪製 ----------
let sceneW = 0
let sceneH = 0
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  sceneW = window.innerWidth
  sceneH = window.innerHeight
  scene.width = Math.round(sceneW * dpr)
  scene.height = Math.round(sceneH * dpr)
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
window.addEventListener('resize', resize)

const PAD = 0.06
function ridgeX(nx) {
  return sceneW * PAD + sceneW * (1 - 2 * PAD) * nx
}
function ridgeY(ny) {
  const base = sceneH * 0.82
  const top = sceneH * 0.34
  return base - (base - top) * ny
}

function drawScene(t) {
  const w = sceneW
  const h = sceneH
  sctx.clearRect(0, 0, w, h)
  // 溫暖淡水彩天空（固定，不跟電腦當下時間連動）
  const g = sctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#dbe7ec')
  g.addColorStop(0.55, '#f0e7d2')
  g.addColorStop(1, '#ead9b8')
  sctx.fillStyle = g
  sctx.fillRect(0, 0, w, h)

  // 極慢的雲
  if (!prefersReduced) {
    const drift = (t * 0.004) % (w + 200)
    cloud(w - drift + 0, h * 0.16, 70)
    cloud(w - ((drift + w * 0.6) % (w + 200)) + 0, h * 0.1, 50)
  } else {
    cloud(w * 0.7, h * 0.14, 64)
  }

  // 剖面：鉛筆稜線＋淡水彩山體
  const prof = routeData.profile
  sctx.beginPath()
  sctx.moveTo(ridgeX(0), ridgeY(prof[0][1]))
  for (const p of prof) sctx.lineTo(ridgeX(p[0]), ridgeY(p[1]))
  sctx.lineTo(ridgeX(1), h)
  sctx.lineTo(ridgeX(0), h)
  sctx.closePath()
  const mg = sctx.createLinearGradient(0, ridgeY(1), 0, h)
  mg.addColorStop(0, 'rgba(150,163,138,0.55)')
  mg.addColorStop(1, 'rgba(120,135,110,0.7)')
  sctx.fillStyle = mg
  sctx.fill()
  // 稜線
  sctx.beginPath()
  sctx.moveTo(ridgeX(prof[0][0]), ridgeY(prof[0][1]))
  for (const p of prof) sctx.lineTo(ridgeX(p[0]), ridgeY(p[1]))
  sctx.strokeStyle = 'rgba(75,63,51,0.75)'
  sctx.lineWidth = 1.6
  sctx.stroke()

  const walked = currentWalked()
  const visited = (key) => {
    const n = nodeByKey(key)
    return walked >= n.minF - 0.5
  }

  // 嘉明湖小水面（經過後亮起）
  if (walked >= FORWARD_TOTAL - 0.5) {
    const lx = ridgeX(1)
    const ly = ridgeY(yForX(1))
    sctx.fillStyle = 'rgba(70,120,160,0.75)'
    sctx.beginPath()
    sctx.ellipse(lx, ly + 6, 16, 5, 0, 0, Math.PI * 2)
    sctx.fill()
  }

  // 營地記號
  for (const n of routeData.nodes) {
    if (!n.camp) continue
    const cx = ridgeX(n.x)
    const cy = ridgeY(yForX(n.x))
    const lit = visited(n.key)
    tentMark(cx, cy, lit)
  }
  // 前峰小地景（不發卡）
  const fp = nodeByKey('frontpeak')
  sctx.fillStyle = 'rgba(75,63,51,0.5)'
  sctx.fillRect(ridgeX(fp.x) - 1, ridgeY(yForX(fp.x)) - 7, 2, 7)

  // 小登山者
  let hx
  let hy
  if (state.interrupted) {
    const st = interruptState(walked)
    if (st.type === 'camp') {
      hx = ridgeX(st.node.x)
      hy = ridgeY(yForX(st.node.x))
    } else {
      const p = positionAt(walked)
      hx = ridgeX(p.x)
      hy = ridgeY(yForX(p.x))
    }
  } else {
    const p = positionAt(walked)
    hx = ridgeX(p.x)
    hy = ridgeY(yForX(p.x))
  }
  // 每十幾秒輕踏一步
  let bob = 0
  if (!prefersReduced && state.session) {
    const ph = (t % 12000) / 12000
    bob = ph < 0.08 ? -Math.sin((ph / 0.08) * Math.PI) * 3 : 0
  }
  drawHiker(hx, hy + bob)
}

function cloud(x, y, r) {
  sctx.fillStyle = 'rgba(255,255,255,0.55)'
  sctx.beginPath()
  sctx.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2)
  sctx.ellipse(x + r * 0.6, y + 4, r * 0.7, r * 0.38, 0, 0, Math.PI * 2)
  sctx.ellipse(x - r * 0.6, y + 5, r * 0.6, r * 0.33, 0, 0, Math.PI * 2)
  sctx.fill()
}
function tentMark(x, y, lit) {
  sctx.beginPath()
  sctx.moveTo(x, y - 11)
  sctx.lineTo(x + 8, y)
  sctx.lineTo(x - 8, y)
  sctx.closePath()
  sctx.fillStyle = lit ? 'rgba(224,138,60,0.92)' : 'rgba(120,108,90,0.4)'
  sctx.fill()
  sctx.strokeStyle = 'rgba(75,63,51,0.7)'
  sctx.lineWidth = 1.2
  sctx.stroke()
}
function drawHiker(x, y) {
  sctx.save()
  sctx.translate(x, y)
  // 大背包
  sctx.fillStyle = '#9a6b3e'
  sctx.beginPath()
  sctx.roundRect(-11, -24, 8, 16, 3)
  sctx.fill()
  // 暖橘外套（身體）
  sctx.fillStyle = '#e08a3c'
  sctx.beginPath()
  sctx.roundRect(-6, -24, 11, 17, 4)
  sctx.fill()
  // 腿
  sctx.strokeStyle = '#4b3f33'
  sctx.lineWidth = 2.4
  sctx.beginPath()
  sctx.moveTo(-3, -8)
  sctx.lineTo(-3, -1)
  sctx.moveTo(2, -8)
  sctx.lineTo(2, -1)
  sctx.stroke()
  // 圓帽與頭
  sctx.fillStyle = '#f2e3c8'
  sctx.beginPath()
  sctx.arc(0, -29, 5, 0, Math.PI * 2)
  sctx.fill()
  sctx.fillStyle = '#c56b2c'
  sctx.beginPath()
  sctx.arc(0, -31, 5.4, Math.PI, Math.PI * 2)
  sctx.fill()
  sctx.fillRect(-6.5, -31.5, 13, 2)
  // 兩個小點當臉
  sctx.fillStyle = '#4b3f33'
  sctx.beginPath()
  sctx.arc(-1.6, -29, 0.8, 0, Math.PI * 2)
  sctx.arc(1.6, -29, 0.8, 0, Math.PI * 2)
  sctx.fill()
  sctx.restore()
}

// ---------- 文字狀態 ----------
function updateTexts() {
  const walked = currentWalked()
  const inSession = !!state.session
  // 分頁標題
  if (inSession) {
    const remainReal = Math.max(0, (sessionTarget(state.session.startWalked, state.session.length) - (walked - state.session.startWalked)) / SPEED)
    const nl = nextLandmark(walked)
    const dest = nl ? nl.node.name : '戒茂斯登山口'
    document.title = `剩${cnNum(Math.ceil(remainReal))}分｜往${dest}`
  } else {
    document.title = '山屋時光｜嘉明湖'
  }

  // 主句
  let line = ''
  let hint = ''
  if (completed(walked)) {
    line = '已走完全程，回到戒茂斯登山口。'
    hint = '里程碑卡已收進收集簿。'
  } else if (inSession) {
    line = '專注中，沿戒茂斯線前進。'
    const nl = nextLandmark(walked)
    if (nl) {
      const times = Math.max(1, Math.ceil((nl.arrive - walked) / state.session.length))
      hint = `再${cnCount(times)}次專注就到${nl.node.name}。`
    }
  } else if (state.interrupted) {
    const st = interruptState(walked)
    if (st.type === 'camp') {
      line = `被打斷了，在${st.node.name}等候，喝口水休息。`
    } else {
      line = '被打斷了，坐在路邊喝水休息。'
    }
    hint = '回來後按「開始專注」從停下的地方接著走。'
  } else if (reachedLake(walked)) {
    line = '抵達嘉明湖，準備沿原路折返戒茂斯登山口。'
    const nl = nextLandmark(walked)
    if (nl) hint = `再${cnCount(Math.max(1, Math.ceil((nl.arrive - walked) / state.length)))}次專注就到${nl.node.name}。`
  } else if (walked <= 0) {
    line = '準備從戒茂斯登山口出發。'
    hint = '選一段專注長度，按「開始專注」。'
  } else {
    line = '在戒茂斯線途中，準備接著走。'
    const nl = nextLandmark(walked)
    if (nl) hint = `再${cnCount(Math.max(1, Math.ceil((nl.arrive - walked) / state.length)))}次專注就到${nl.node.name}。`
  }
  statusLine.textContent = line
  statusHint.textContent = hint

  // 按鈕
  primary.textContent = inSession ? '我被打斷了' : '開始專注'
  primary.classList.toggle('interrupt', inSession)
  primary.hidden = completed(walked) && !inSession

  // 倒數（小字，可關；標題仍更新）
  if (inSession && showCountdown) {
    const remainRealSec = Math.max(0, (sessionTarget(state.session.startWalked, state.session.length) - (walked - state.session.startWalked)) / SPEED) * 60
    const mm = String(Math.floor(remainRealSec / 60)).padStart(2, '0')
    const ss = String(Math.floor(remainRealSec % 60)).padStart(2, '0')
    countdown.textContent = `${mm}:${ss}`
    countdown.hidden = false
  } else {
    countdown.hidden = true
  }

  // 走完後顯示「下一座想爬哪裡」，收起控制
  const done = completed(walked) && !inSession
  nextPeaks.hidden = !done
  lengths.style.visibility = done ? 'hidden' : 'visible'
}

// ---------- 迴圈 ----------
function frame(t) {
  if (state.session && sessionDone(state.session.startWalked, state.session.length, sessionElapsedMin())) {
    finalizeSession()
    refreshBook()
  }
  drawScene(t)
  updateTexts()
  requestAnimationFrame(frame)
}

// ---------- 互動 ----------
lengths.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-len]')
  if (!b || state.session) return
  state.length = Number(b.dataset.len)
  ;[...lengths.children].forEach((c) => c.classList.toggle('on', c === b))
  save()
  updateTexts()
})

primary.addEventListener('click', () => {
  const walked = currentWalked()
  if (state.session) {
    // 我被打斷了：進度留下、不倒退、不扣
    state.walked = currentWalked()
    state.session = null
    state.interrupted = true
    save()
  } else {
    if (completed(walked)) return
    if (state.journeyStartTs == null) state.journeyStartTs = Date.now()
    state.session = { startTs: Date.now(), startWalked: state.walked, length: state.length }
    state.interrupted = false
    save()
  }
  updateTexts()
})

cdToggle.addEventListener('change', () => {
  showCountdown = cdToggle.checked
  updateTexts()
})

$('reset').addEventListener('click', () => {
  if (!confirm('重新開始全程？已走的分鐘、專注次數與卡片都會清除（三座山的點擊紀錄保留）。')) return
  const length = state.length
  state = freshState()
  state.length = length
  save()
  ;[...lengths.children].forEach((c) => c.classList.toggle('on', Number(c.dataset.len) === length))
  refreshBook()
  updateTexts()
})

$('open-book').addEventListener('click', () => {
  refreshBook()
  $('book').hidden = false
})
document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => {
    $(b.dataset.close).hidden = true
  }),
)
nextPeaks.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-peak]')
  if (!b) return
  mountains[b.dataset.peak] = (mountains[b.dataset.peak] || 0) + 1
  saveMountains()
  b.textContent = b.textContent.replace(/（.*）$/, '') + `（${mountains[b.dataset.peak]}）`
})

// ---------- 收集簿 ----------
const BOOK_SLOTS = [
  { key: 'xinwulu', kind: 'camp' },
  { key: 'football', kind: 'camp' },
  { key: 'meichi', kind: 'camp' },
  { key: 'milestone', kind: 'milestone' },
]
function cardSpec(slot) {
  if (slot.kind === 'milestone') {
    return state.milestone ? { kind: 'milestone', ...state.milestone } : null
  }
  const c = state.cards[slot.key]
  return c ? { kind: 'camp', node: nodeByKey(slot.key), ...c } : null
}
function refreshBook() {
  const grid = $('book-grid')
  grid.innerHTML = ''
  for (const slot of BOOK_SLOTS) {
    const spec = cardSpec(slot)
    const div = document.createElement('div')
    div.className = 'slot'
    if (spec) {
      const c = document.createElement('canvas')
      c.width = 320
      c.height = 400
      drawCard(c.getContext('2d'), 320, 400, spec)
      div.appendChild(c)
      div.addEventListener('click', () => openCard(spec))
    } else {
      const label = slot.kind === 'milestone' ? '里程碑' : '營地小卡'
      div.innerHTML = `<div class="locked">${label}<br>尚未取得</div>`
    }
    grid.appendChild(div)
  }
}
function openCard(spec) {
  const c = $('card-canvas')
  c.width = 800
  c.height = 1000
  drawCard(c.getContext('2d'), 800, 1000, spec)
  $('card-title').textContent = spec.kind === 'milestone' ? '里程碑卡' : spec.node.name
  $('save-png').onclick = () => {
    const a = document.createElement('a')
    a.download = (spec.kind === 'milestone' ? '山屋時光-里程碑' : '山屋時光-' + spec.node.name) + '.png'
    a.href = c.toDataURL('image/png')
    a.click()
  }
  $('card-view').hidden = false
}

// ---------- 卡片繪製（直式 4:5） ----------
function drawCard(ctx, W, H, spec) {
  const sky = skyOf(spec.ts)
  const night = sky.name === '夜晚'
  const ink = night ? '#f0ead8' : '#4b3f33'
  const soft = night ? 'rgba(240,234,216,0.7)' : 'rgba(75,63,51,0.65)'
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, sky.top)
  g.addColorStop(1, sky.bot)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 紙框
  ctx.strokeStyle = soft
  ctx.lineWidth = W * 0.012
  ctx.strokeRect(W * 0.04, H * 0.035, W * 0.92, H * 0.93)

  const cx = W / 2
  const serif = "'Noto Serif TC', serif"
  ctx.textAlign = 'center'
  ctx.fillStyle = ink
  ctx.font = `900 ${W * 0.11}px ${serif}`
  ctx.fillText('山屋時光', cx, H * 0.13)
  ctx.font = `500 ${W * 0.05}px ${serif}`
  ctx.fillStyle = soft
  ctx.fillText('嘉明湖', cx, H * 0.185)

  // 手繪
  if (spec.kind === 'milestone') {
    drawProfileSilhouette(ctx, W, H, ink)
  } else {
    drawNodeGlyph(ctx, W, H, spec.node, ink)
  }

  const lines = []
  if (spec.kind === 'milestone') {
    lines.push({ t: '戒茂斯線', big: true })
    lines.push({ t: '回到戒茂斯登山口', big: false })
    lines.push({ t: '先抵達嘉明湖，再原路折返', small: true })
    lines.push({ t: `${dateStr(spec.startTs)} － ${dateStr(spec.ts)}`, small: true })
    lines.push({ t: `共 ${spec.days} 天｜天色 ${sky.name}｜總專注 500 分鐘`, small: true })
    lines.push({ t: '去程爬升 2,105 公尺（路線檔）', small: true })
    lines.push({ t: '來回爬升 2,806 公尺（原路折返推算）', small: true })
  } else {
    const n = spec.node
    lines.push({ t: n.name, big: true })
    if (n.printEle != null) lines.push({ t: `海拔 ${n.printEle.toLocaleString('en-US')} 公尺`, small: true })
    lines.push({ t: `抵達 ${dateStr(spec.ts)}｜天色 ${sky.name}`, small: true })
    lines.push({ t: `這段專注 ${spec.minutes} 分鐘｜累積 ${Math.round(spec.cumMin)} 分鐘`, small: true })
    if (n.main) lines.push({ t: n.main, wrap: true })
  }

  let y = spec.kind === 'milestone' ? H * 0.58 : H * 0.62
  for (const l of lines) {
    if (l.big) {
      ctx.fillStyle = ink
      ctx.font = `700 ${W * 0.072}px ${serif}`
      ctx.fillText(l.t, cx, y)
      y += H * 0.058
    } else if (l.small) {
      ctx.fillStyle = soft
      ctx.font = `500 ${W * 0.042}px ${serif}`
      ctx.fillText(l.t, cx, y)
      y += H * 0.046
    } else if (l.wrap) {
      ctx.fillStyle = soft
      ctx.font = `500 ${W * 0.04}px ${serif}`
      wrapText(ctx, l.t, cx, y, W * 0.82, H * 0.042)
      y += H * 0.09
    } else {
      ctx.fillStyle = ink
      ctx.font = `500 ${W * 0.052}px ${serif}`
      ctx.fillText(l.t, cx, y)
      y += H * 0.05
    }
  }

  // 小字：累積專注次數
  ctx.fillStyle = soft
  ctx.font = `500 ${W * 0.038}px ${serif}`
  ctx.fillText(`累積專注 ${state.focusCount} 次`, cx, H * 0.945)
}
function drawNodeGlyph(ctx, W, H, node, ink) {
  const cx = W / 2
  const cy = H * 0.37
  ctx.strokeStyle = ink
  ctx.lineWidth = W * 0.01
  // 小山與帳篷
  ctx.beginPath()
  ctx.moveTo(cx - W * 0.22, cy + H * 0.06)
  ctx.lineTo(cx - W * 0.05, cy - H * 0.05)
  ctx.lineTo(cx + W * 0.1, cy + H * 0.06)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx + W * 0.04, cy + H * 0.06)
  ctx.lineTo(cx + W * 0.16, cy - H * 0.04)
  ctx.lineTo(cx + W * 0.26, cy + H * 0.06)
  ctx.closePath()
  ctx.fillStyle = 'rgba(224,138,60,0.85)'
  ctx.fill()
  ctx.stroke()
  if (node.key === 'xinwulu') {
    // 渡溪的水波
    ctx.strokeStyle = 'rgba(70,120,160,0.8)'
    ctx.beginPath()
    for (let i = 0; i < 3; i++) {
      const yy = cy + H * 0.08 + i * H * 0.016
      ctx.moveTo(cx - W * 0.2, yy)
      ctx.quadraticCurveTo(cx - W * 0.1, yy - 6, cx, yy)
      ctx.quadraticCurveTo(cx + W * 0.1, yy + 6, cx + W * 0.2, yy)
    }
    ctx.stroke()
  }
}
function drawProfileSilhouette(ctx, W, H, ink) {
  const prof = routeData.profile
  const x0 = W * 0.1
  const x1 = W * 0.9
  const base = H * 0.45
  const top = H * 0.27
  ctx.beginPath()
  ctx.moveTo(x0, base)
  for (const p of prof) ctx.lineTo(x0 + (x1 - x0) * p[0], base - (base - top) * p[1])
  ctx.lineTo(x1, base)
  ctx.closePath()
  ctx.fillStyle = 'rgba(120,135,110,0.75)'
  ctx.fill()
  ctx.strokeStyle = ink
  ctx.lineWidth = W * 0.006
  ctx.beginPath()
  ctx.moveTo(x0, base - (base - top) * prof[0][1])
  for (const p of prof) ctx.lineTo(x0 + (x1 - x0) * p[0], base - (base - top) * p[1])
  ctx.stroke()
}
function wrapText(ctx, text, x, y, maxW, lh) {
  const chars = [...text]
  let line = ''
  let yy = y
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      ctx.fillText(line, x, yy)
      line = ch
      yy += lh
    } else {
      line += ch
    }
  }
  if (line) ctx.fillText(line, x, yy)
}

// ---------- 啟動 ----------
function init() {
  resize()
  // 還原已選長度
  ;[...lengths.children].forEach((c) => c.classList.toggle('on', Number(c.dataset.len) === state.length))
  // 載入時若有已結束的 session，直接結算
  if (state.session && sessionDone(state.session.startWalked, state.session.length, sessionElapsedMin())) {
    finalizeSession()
  }
  refreshBook()
  updateTexts()
  requestAnimationFrame(frame)
}
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {})
}
init()

// 給瀏覽器端驗收用（不顯示在介面）
window.__hut = { get state() { return state }, currentWalked, routeData }
