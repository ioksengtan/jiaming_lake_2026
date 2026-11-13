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
  // 只決定真實剖面在這一屏裡的上下位置，點與點的高低仍是軌跡海拔。
  const base = sceneH * 0.8
  const top = sceneH * 0.28
  return base - (base - top) * ny
}
function penScale() {
  return Math.max(1, Math.min(sceneW, 780) / 390)
}

// 穩定的 0..1，畫面不隨每幀亂跳。
function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
function puddle(ctx, x, y, rx, ry, color) {
  const r = Math.max(rx, ry, 1)
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(x, y, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2)
  ctx.fill()
}

let grainTile = null
function getGrainTile() {
  if (grainTile) return grainTile
  grainTile = document.createElement('canvas')
  grainTile.width = 128
  grainTile.height = 128
  const g = grainTile.getContext('2d')
  const img = g.createImageData(128, 128)
  let s = 20261113
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  for (let i = 0; i < img.data.length; i += 4) {
    const n = rnd()
    const dark = n < 0.16
    const light = n > 0.9
    img.data[i] = light ? 255 : 70
    img.data[i + 1] = light ? 248 : 58
    img.data[i + 2] = light ? 230 : 42
    img.data[i + 3] = dark ? 34 : light ? 26 : 0
  }
  g.putImageData(img, 0, 0)
  return grainTile
}
function paintGrain(ctx, w, h) {
  ctx.save()
  ctx.globalAlpha = 0.55
  ctx.fillStyle = ctx.createPattern(getGrainTile(), 'repeat')
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

// 剖面點一律來自 routeData.profile（由 data/route.json 預先算出的戒茂斯線）。
function mapProfile(xOf, yOf) {
  return routeData.profile.map((p) => ({ x: xOf(p[0]), y: yOf(p[1]), nx: p[0], ny: p[1] }))
}

function strokePencilPath(ctx, pts, color, width, seed, yOffset = 0) {
  if (pts.length < 2) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let i = 0; i < pts.length - 1; i += 4) {
    ctx.globalAlpha = 0.5 + hash01(seed + i) * 0.5
    ctx.beginPath()
    const start = Math.max(0, i - 1)
    const end = Math.min(pts.length, i + 6)
    for (let k = start; k < end; k++) {
      const jx = (hash01(seed + k * 5.1) - 0.5) * 2.1
      const jy = (hash01(seed + k * 9.3) - 0.5) * 2.1
      const x = pts[k].x + jx
      const y = pts[k].y + yOffset + jy
      if (k === start) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

// 把真實剖面畫成淡水彩山體加鉛筆稜線。不平滑、不另加山頭。
function paintRidge(ctx, pts, fillBottom, pen) {
  if (pts.length < 2) return
  const left = pts[0].x
  const right = pts[pts.length - 1].x
  let top = pts[0].y
  for (const p of pts) if (p.y < top) top = p.y

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.lineTo(right, fillBottom)
  ctx.lineTo(left, fillBottom)
  ctx.closePath()
  ctx.clip()

  const wash = ctx.createLinearGradient(0, top, 0, fillBottom)
  wash.addColorStop(0, 'rgba(168, 158, 136, 0.34)')
  wash.addColorStop(0.28, 'rgba(138, 142, 104, 0.42)')
  wash.addColorStop(0.62, 'rgba(126, 120, 94, 0.32)')
  wash.addColorStop(1, 'rgba(164, 146, 114, 0.16)')
  ctx.fillStyle = wash
  ctx.fillRect(left - 8, top - 4, right - left + 16, fillBottom - top + 12)

  for (let i = 0; i < pts.length; i += 7) {
    const p = pts[i]
    const elev = p.ny
    const color =
      elev > 0.78
        ? 'rgba(128, 126, 114, 0.28)'
        : elev > 0.45
          ? 'rgba(126, 134, 96, 0.26)'
          : 'rgba(168, 146, 104, 0.22)'
    const below = 18 + (1 - elev) * 36
    puddle(ctx, p.x, p.y + below * pen, (26 + hash01(i) * 22) * pen, (18 + hash01(i + 2) * 16) * pen, color)
  }

  // 沿同一條剖面下移的淡等高線，仍是這條稜線，不是第二座山。
  ctx.lineCap = 'round'
  for (const off of [16, 34, 58]) {
    ctx.beginPath()
    ctx.strokeStyle = `rgba(96, 84, 66, ${off < 20 ? 0.2 : 0.12})`
    ctx.lineWidth = pen * 0.7
    let drawing = false
    for (let i = 0; i < pts.length; i++) {
      const on = hash01(i * 2 + off) > 0.22
      const x = pts[i].x
      const y = pts[i].y + off * pen
      if (!on) {
        drawing = false
        continue
      }
      if (!drawing) {
        ctx.moveTo(x, y)
        drawing = true
      } else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  ctx.lineCap = 'round'
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i]
    const nxt = pts[Math.min(pts.length - 1, i + 2)]
    const slope = Math.abs((nxt.y - p.y) / ((nxt.x - p.x) || 1))
    const marks = 1 + (slope > 0.85 ? 2 : slope > 0.4 ? 1 : 0)
    for (let k = 0; k < marks; k++) {
      const len = (8 + hash01(i * 5 + k) * (slope > 0.6 ? 22 : 12)) * pen
      const x = p.x + (hash01(i + k * 7) - 0.5) * 7 * pen
      const lean = (hash01(i + 11 + k) - 0.5) * 4 * pen
      ctx.beginPath()
      ctx.moveTo(x, p.y + 3 * pen)
      ctx.lineTo(x + lean, p.y + 3 * pen + len)
      ctx.strokeStyle = `rgba(72, 62, 48, ${0.22 + hash01(i + k) * 0.28})`
      ctx.lineWidth = pen * (slope > 0.85 ? 0.9 : 0.65)
      ctx.stroke()
    }
    if (slope > 0.7 && hash01(i + 19) > 0.55) {
      ctx.beginPath()
      ctx.moveTo(p.x - 4 * pen, p.y + 12 * pen)
      ctx.quadraticCurveTo(p.x + 6 * pen, p.y + 16 * pen, p.x + 14 * pen, p.y + 10 * pen)
      ctx.strokeStyle = 'rgba(68, 58, 46, 0.28)'
      ctx.lineWidth = pen * 0.7
      ctx.stroke()
    }
    if (p.ny < 0.48 && hash01(i + 21) > 0.42) {
      ctx.beginPath()
      ctx.moveTo(p.x, p.y + 15 * pen)
      ctx.quadraticCurveTo(p.x + 3 * pen, p.y + 6 * pen, p.x - pen, p.y + 2 * pen)
      ctx.strokeStyle = 'rgba(82, 96, 58, 0.38)'
      ctx.lineWidth = pen * 0.7
      ctx.stroke()
    }
  }

  // 低處幾叢鉛筆灌木，長在這條坡上。
  for (let i = 4; i < pts.length; i += 18) {
    const p = pts[i]
    if (p.ny > 0.42) continue
    sketchShrub(ctx, p.x + (hash01(i) - 0.4) * 8, p.y + 8 * pen, (8 + hash01(i + 3) * 7) * pen, pen)
  }
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = 'rgba(118, 122, 96, 0.16)'
  ctx.lineWidth = pen * 7
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
  ctx.restore()

  strokePencilPath(ctx, pts, 'rgba(62, 52, 42, 0.88)', pen * 1.15, 2)
  strokePencilPath(ctx, pts, 'rgba(112, 98, 80, 0.55)', pen * 0.65, 9, 0.6)

  // 步道：貼著同一條剖面，往坡下偏一點，近處粗、遠處細。
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const y = pts[i].y + (5 + (1 - pts[i].ny) * 3) * pen
    if (i === 0) ctx.moveTo(pts[i].x, y)
    else ctx.lineTo(pts[i].x, y)
  }
  ctx.strokeStyle = 'rgba(214, 198, 166, 0.55)'
  ctx.lineWidth = pen * 2.6
  ctx.stroke()
  ctx.setLineDash([pen * 3.2, pen * 2.6])
  ctx.strokeStyle = 'rgba(96, 78, 56, 0.4)'
  ctx.lineWidth = pen * 0.75
  ctx.stroke()
  ctx.restore()
}

function sketchShrub(ctx, x, y, s, pen) {
  puddle(ctx, x, y - s * 0.35, s * 0.9, s * 0.7, 'rgba(118, 128, 78, 0.28)')
  ctx.save()
  ctx.strokeStyle = 'rgba(68, 78, 48, 0.55)'
  ctx.lineWidth = Math.max(0.6, pen * 0.65)
  ctx.lineCap = 'round'
  for (let i = 0; i < 5; i++) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + (i - 2) * s * 0.38, y - s * 0.95, x + (i - 2) * s * 0.55, y - s * 0.15)
    ctx.stroke()
  }
  ctx.restore()
}

function sketchTent(ctx, x, y, lit, scale) {
  const s = scale
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.fillStyle = 'rgba(90, 74, 52, 0.18)'
  ctx.beginPath()
  ctx.ellipse(0, 1.2, 10, 2.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-9, 0)
  ctx.bezierCurveTo(-9.2, -8, -4, -13.2, 0, -13.6)
  ctx.bezierCurveTo(4.4, -13.2, 9.4, -8, 9, 0)
  ctx.quadraticCurveTo(0, 1.4, -9, 0)
  ctx.closePath()
  ctx.fillStyle = lit ? 'rgba(236, 224, 196, 0.96)' : 'rgba(214, 204, 184, 0.72)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(72, 60, 46, 0.85)'
  ctx.lineWidth = 1.05
  ctx.stroke()
  // 帳門與暖色內部，圓頂而不是三角。
  ctx.beginPath()
  ctx.moveTo(-2.4, 0)
  ctx.quadraticCurveTo(-2.6, -6.2, 0.2, -7.4)
  ctx.quadraticCurveTo(3, -6, 2.8, 0)
  ctx.closePath()
  ctx.fillStyle = lit ? 'rgba(196, 122, 64, 0.55)' : 'rgba(120, 100, 78, 0.28)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(72, 60, 46, 0.65)'
  ctx.lineWidth = 0.7
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-7, -5)
  ctx.lineTo(-12.5, 0.4)
  ctx.moveTo(7, -5)
  ctx.lineTo(12.5, 0.4)
  ctx.strokeStyle = 'rgba(72, 60, 46, 0.55)'
  ctx.lineWidth = 0.7
  ctx.stroke()
  ctx.restore()
}

function sketchCairn(ctx, x, y, pen, lit) {
  const stones = [
    [0, -1.5, 5.2, 2.3],
    [-0.4, -5, 3.6, 1.9],
    [0.3, -7.6, 2.3, 1.4],
  ]
  ctx.save()
  ctx.lineWidth = Math.max(0.7, pen * 0.7)
  for (const [ox, oy, rx, ry] of stones) {
    ctx.beginPath()
    ctx.ellipse(x + ox * pen, y + oy * pen, rx * pen, ry * pen, 0, 0, Math.PI * 2)
    ctx.fillStyle = lit ? 'rgba(196, 176, 142, 0.92)' : 'rgba(176, 166, 146, 0.75)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(72, 60, 46, 0.75)'
    ctx.stroke()
  }
  ctx.restore()
}

function sketchLake(ctx, x, y, pen) {
  // 水面完全落在稜線下方，貼著終點那一段稍降的坡，不浮到天上。
  ctx.save()
  const cy = y + 10 * pen
  ctx.beginPath()
  ctx.ellipse(x - 8 * pen, cy, 10 * pen, 3 * pen, -0.15, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(96, 146, 168, 0.62)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(58, 86, 102, 0.75)'
  ctx.lineWidth = Math.max(0.7, pen * 0.7)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - 16 * pen, cy)
  ctx.quadraticCurveTo(x - 8 * pen, cy - 2 * pen, x - pen, cy + pen)
  ctx.strokeStyle = 'rgba(236, 244, 246, 0.7)'
  ctx.lineWidth = Math.max(0.6, pen * 0.45)
  ctx.stroke()
  ctx.restore()
}

const INK = 'rgba(62, 50, 40, 0.92)'

function pencilStroke(ctx) {
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.15
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
}

function drawPack(ctx, x, y, w, h) {
  ctx.fillStyle = '#6e6246'
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.quadraticCurveTo(x - w * 0.15, y - h * 0.15, x - w * 0.05, y - h)
  ctx.quadraticCurveTo(x + w * 0.55, y - h * 1.08, x + w * 0.96, y - h * 0.78)
  ctx.quadraticCurveTo(x + w * 1.05, y - h * 0.4, x + w * 0.88, y - h * 0.06)
  ctx.quadraticCurveTo(x + w * 0.4, y + h * 0.06, x, y)
  ctx.closePath()
  ctx.fill()
  pencilStroke(ctx)
  ctx.fillStyle = '#57492f'
  ctx.beginPath()
  ctx.moveTo(x + w * 0.12, y - h * 0.62)
  ctx.lineTo(x + w * 0.78, y - h * 0.7)
  ctx.lineTo(x + w * 0.74, y - h * 0.38)
  ctx.lineTo(x + w * 0.14, y - h * 0.32)
  ctx.closePath()
  ctx.fill()
  pencilStroke(ctx)
  ctx.beginPath()
  ctx.moveTo(x + w * 0.48, y - h * 0.92)
  ctx.lineTo(x + w * 0.42, y - h * 0.12)
  ctx.strokeStyle = 'rgba(62, 50, 40, 0.7)'
  ctx.lineWidth = 1
  ctx.stroke()
}

function drawStanding(ctx, stepping) {
  const lift = stepping ? -2.2 : 0
  const foot = stepping ? 2.6 : 0

  ctx.fillStyle = '#6a645c'
  ctx.beginPath()
  ctx.moveTo(-3.2, -26)
  ctx.lineTo(-5.2, -8)
  ctx.lineTo(-0.6, -8)
  ctx.lineTo(-0.4, -26)
  ctx.closePath()
  ctx.fill()
  pencilStroke(ctx)
  ctx.beginPath()
  ctx.moveTo(2.2, -26)
  ctx.lineTo(3.2 + foot, -8 + lift)
  ctx.lineTo(7.6 + foot, -8 + lift)
  ctx.lineTo(6.2, -26)
  ctx.closePath()
  ctx.fill()
  pencilStroke(ctx)
  ctx.fillStyle = '#5b4634'
  ctx.beginPath()
  ctx.ellipse(-3, -5.2, 3.5, 2.15, 0, 0, Math.PI * 2)
  ctx.fill()
  pencilStroke(ctx)
  ctx.beginPath()
  ctx.ellipse(5.2 + foot, -5.2 + lift, 3.5, 2.15, 0, 0, Math.PI * 2)
  ctx.fill()
  pencilStroke(ctx)

  ctx.fillStyle = '#e0873c'
  ctx.beginPath()
  ctx.moveTo(-5.5, -48)
  ctx.quadraticCurveTo(-7.2, -36, -6.2, -26)
  ctx.lineTo(8, -25)
  ctx.quadraticCurveTo(9.4, -36, 7, -49)
  ctx.quadraticCurveTo(0.5, -45, -5.5, -48)
  ctx.closePath()
  ctx.fill()
  pencilStroke(ctx)
  ctx.beginPath()
  ctx.moveTo(5.5, -44)
  ctx.quadraticCurveTo(11, -36, 9.2, -27)
  ctx.lineTo(6.4, -26.5)
  ctx.quadraticCurveTo(7.2, -35, 4, -42)
  ctx.fillStyle = '#d9783a'
  ctx.fill()
  pencilStroke(ctx)

  // 大背包畫在外套外面，往身後突出，才不會被身體蓋住。
  drawPack(ctx, -16, -24, 14, 26)
  ctx.beginPath()
  ctx.moveTo(-6, -46)
  ctx.quadraticCurveTo(-2, -40, -1, -28)
  ctx.strokeStyle = 'rgba(90, 62, 36, 0.75)'
  ctx.lineWidth = 1.2
  ctx.stroke()

  ctx.fillStyle = '#f2d7be'
  ctx.beginPath()
  ctx.arc(1.4, -54.5, 4.3, 0, Math.PI * 2)
  ctx.fill()
  pencilStroke(ctx)
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.arc(2.45, -54.2, 0.95, 0, Math.PI * 2)
  ctx.arc(4.15, -54.2, 0.95, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#c9a15c'
  ctx.beginPath()
  ctx.arc(1.1, -57.4, 4.5, Math.PI * 1.04, Math.PI * 1.98)
  ctx.closePath()
  ctx.fill()
  pencilStroke(ctx)
  ctx.beginPath()
  ctx.ellipse(1.1, -56.2, 7.6, 1.9, -0.04, 0, Math.PI * 2)
  ctx.fill()
  pencilStroke(ctx)
}

function drawSitting(ctx) {
  ctx.fillStyle = 'rgba(176, 162, 136, 0.92)'
  ctx.beginPath()
  ctx.ellipse(0, 2.4, 8, 2.5, -0.05, 0, Math.PI * 2)
  ctx.fill()
  pencilStroke(ctx)

  // 屈膝：大腿往前、小腿向下，靴子落在坡上。
  ctx.fillStyle = '#6a645c'
  ctx.beginPath()
  ctx.moveTo(-1, -8)
  ctx.quadraticCurveTo(6, -6, 11, -1)
  ctx.lineTo(12.5, 7)
  ctx.lineTo(8.5, 7.5)
  ctx.lineTo(8, 1)
  ctx.quadraticCurveTo(4, -2, 0, -4)
  ctx.closePath()
  ctx.fill()
  pencilStroke(ctx)
  ctx.beginPath()
  ctx.moveTo(1, -6)
  ctx.quadraticCurveTo(5, -2, 7, 2)
  ctx.lineTo(5.2, 2.4)
  ctx.quadraticCurveTo(4, -1, 1.5, -4)
  ctx.fillStyle = '#5e584f'
  ctx.fill()
  pencilStroke(ctx)
  ctx.fillStyle = '#5b4634'
  ctx.beginPath()
  ctx.ellipse(11.2, 8.2, 3.6, 2, 0.3, 0, Math.PI * 2)
  ctx.fill()
  pencilStroke(ctx)

  ctx.fillStyle = '#e0873c'
  ctx.beginPath()
  ctx.moveTo(-4.5, -30)
  ctx.quadraticCurveTo(-6, -18, -4, -8)
  ctx.lineTo(6.5, -7)
  ctx.quadraticCurveTo(7.5, -18, 5.2, -31)
  ctx.quadraticCurveTo(0, -27, -4.5, -30)
  ctx.closePath()
  ctx.fill()
  pencilStroke(ctx)
  ctx.beginPath()
  ctx.moveTo(4, -20)
  ctx.quadraticCurveTo(9, -14, 10, -6)
  ctx.lineTo(7, -5.5)
  ctx.quadraticCurveTo(6.5, -12, 3, -16)
  ctx.fillStyle = '#d9783a'
  ctx.fill()
  pencilStroke(ctx)

  drawPack(ctx, -14, -10, 12, 20)

  ctx.fillStyle = '#f2d7be'
  ctx.beginPath()
  ctx.arc(1.2, -36, 4.2, 0, Math.PI * 2)
  ctx.fill()
  pencilStroke(ctx)
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.arc(2.2, -35.7, 0.9, 0, Math.PI * 2)
  ctx.arc(3.85, -35.7, 0.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#c9a15c'
  ctx.beginPath()
  ctx.arc(0.8, -38.8, 4.4, Math.PI * 1.04, Math.PI * 1.98)
  ctx.closePath()
  ctx.fill()
  pencilStroke(ctx)
  ctx.beginPath()
  ctx.ellipse(0.8, -37.6, 7.4, 1.85, -0.06, 0, Math.PI * 2)
  ctx.fill()
  pencilStroke(ctx)
}

function drawHiker(ctx, x, y, pose, facing, stepping, k) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(facing * k, k)
  if (pose === 'sit') drawSitting(ctx)
  else drawStanding(ctx, stepping)
  ctx.restore()
}

function drawScene(t) {
  const w = sceneW
  const h = sceneH
  const pen = penScale()
  sctx.clearRect(0, 0, w, h)
  sctx.fillStyle = '#f4efe4'
  sctx.fillRect(0, 0, w, h)

  // 天空是手繪淡彩，不跟電腦當時的時間連動。雲極慢地漂。
  const drift = prefersReduced ? 0 : (t * 0.0028) % (w + 280)
  const clouds = [
    [0.22, 0.2, 118, 46, '168, 196, 216'],
    [0.48, 0.12, 96, 40, '214, 186, 156'],
    [0.08, 0.1, 74, 32, '186, 206, 220'],
    [0.66, 0.16, 88, 34, '176, 198, 214'],
    [0.38, 0.26, 70, 26, '226, 206, 176'],
  ]
  for (const [fx, fy, rx, ry, rgb] of clouds) {
    let x = fx * w - drift
    x = ((x % (w + 280)) + (w + 280)) % (w + 280) - 80
    puddle(sctx, x, fy * h, rx * pen, ry * pen, `rgba(${rgb}, 0.30)`)
    puddle(sctx, x + rx * 0.45 * pen, fy * h + 6, rx * 0.62 * pen, ry * 0.7 * pen, `rgba(${rgb}, 0.16)`)
  }

  const pts = mapProfile(ridgeX, ridgeY)
  paintRidge(sctx, pts, h + 30, pen)

  const walked = currentWalked()
  const visited = (key) => walked >= nodeByKey(key).minF - 0.5

  const fp = nodeByKey('frontpeak')
  sketchCairn(sctx, ridgeX(fp.x), ridgeY(yForX(fp.x)), pen, visited('frontpeak'))

  for (const n of routeData.nodes) {
    if (!n.camp) continue
    sketchTent(sctx, ridgeX(n.x), ridgeY(yForX(n.x)), visited(n.key), pen)
  }
  if (walked >= FORWARD_TOTAL - 0.5) {
    sketchLake(sctx, ridgeX(1), ridgeY(yForX(1)), pen)
  }

  paintGrain(sctx, w, h)

  let hx
  let hy
  let pose = 'stand'
  let facing = 1
  if (state.interrupted) {
    pose = 'sit'
    const st = interruptState(walked)
    facing = positionAt(walked).leg === 'return' ? -1 : 1
    if (st.type === 'camp') {
      const seat = seatBesideCamp(st.node)
      hx = ridgeX(seat.xn)
      hy = ridgeY(seat.ny)
      facing = seat.px > 0 ? -1 : 1
    } else {
      const p = positionAt(walked)
      hx = ridgeX(p.x)
      hy = ridgeY(yForX(p.x))
    }
  } else {
    const p = positionAt(walked)
    facing = p.leg === 'return' ? -1 : 1
    hx = ridgeX(p.x)
    hy = ridgeY(yForX(p.x))
  }
  let bob = 0
  let stepping = false
  if (!prefersReduced && state.session) {
    const ph = (t % 12000) / 12000
    stepping = ph < 0.08
    bob = stepping ? -Math.sin((ph / 0.08) * Math.PI) * 2.2 : 0
  }
  const k = (Math.min(h, 900) / 844) * 1.32
  drawHiker(sctx, hx, hy + bob, pose, facing, stepping, k)
}

// 坐到營地旁邊時，挑稜線高度最接近營地的那一側，避免坐到旁邊的凸起上。
function seatBesideCamp(node) {
  const usable = sceneW * (1 - 2 * PAD)
  const campNy = yForX(node.x)
  let best = null
  for (const px of [18, 22, 26, -18, -22, -26]) {
    const xn = node.x + px / usable
    if (xn <= 0.02 || xn >= 0.98) continue
    const ny = yForX(xn)
    const score = Math.abs(ny - campNy)
    if (!best || score < best.score) best = { xn, ny, px, score }
  }
  return best || { xn: node.x, ny: campNy, px: 18 }
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
      const c = document.createElement('canvas')
      c.width = 320
      c.height = 400
      drawLockedSilhouette(c.getContext('2d'), slot)
      div.appendChild(c)
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
  g.addColorStop(night ? 1 : 0.5, sky.bot)
  if (!night) {
    g.addColorStop(0.72, '#f4efe4')
    g.addColorStop(1, '#f7f2e8')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  if (!night) {
    puddle(ctx, W * 0.28, H * 0.2, W * 0.26, H * 0.07, 'rgba(150, 182, 206, 0.28)')
    puddle(ctx, W * 0.72, H * 0.16, W * 0.2, H * 0.055, 'rgba(226, 196, 158, 0.24)')
  }
  paintGrain(ctx, W, H)
  // 鉛筆紙框，兩筆稍微錯開
  ctx.strokeStyle = soft
  ctx.lineWidth = Math.max(1, W * 0.008)
  ctx.strokeRect(W * 0.045, H * 0.038, W * 0.91, H * 0.924)
  ctx.globalAlpha = 0.45
  ctx.strokeRect(W * 0.052, H * 0.044, W * 0.896, H * 0.912)
  ctx.globalAlpha = 1

  const cx = W / 2
  const serif = "'Noto Serif TC', serif"
  ctx.textAlign = 'center'
  ctx.fillStyle = ink
  ctx.font = `900 ${W * 0.11}px ${serif}`
  ctx.fillText('山屋時光', cx, H * 0.13)
  ctx.font = `500 ${W * 0.05}px ${serif}`
  ctx.fillStyle = soft
  ctx.fillText('嘉明湖', cx, H * 0.185)

  // 手繪。里程碑是整段真實剖面；營地是帳篷手繪，遠稜仍用同一條剖面。
  if (spec.kind === 'milestone') {
    drawProfileSilhouette(ctx, W, H, ink)
  } else {
    drawNodeGlyph(ctx, W, H, spec.node, ink, night)
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
function drawNodeGlyph(ctx, W, H, node, ink, night) {
  const x0 = W * 0.1
  const x1 = W * 0.9
  const base = H * 0.4
  const top = H * 0.25
  const pts = mapProfile(
    (nx) => x0 + (x1 - x0) * nx,
    (ny) => base - (base - top) * ny,
  )
  const pen = Math.max(0.75, W / 640)
  paintRidge(ctx, pts, H * 0.5, pen)
  const at = pts.reduce((best, p) => (Math.abs(p.nx - node.x) < Math.abs(best.nx - node.x) ? p : best), pts[0])
  sketchTent(ctx, at.x, at.y, true, pen * 0.85)
  drawCampForeground(ctx, W, H, node, ink, night)
}
function drawCampForeground(ctx, W, H, node, ink, night) {
  const gy = H * 0.545
  const left = W * 0.1
  const right = W * 0.9
  const grass = ctx.createLinearGradient(0, gy - H * 0.08, 0, gy + H * 0.03)
  grass.addColorStop(0, 'rgba(168, 170, 120, 0)')
  grass.addColorStop(0.45, night ? 'rgba(90, 96, 78, 0.35)' : 'rgba(154, 156, 104, 0.38)')
  grass.addColorStop(1, 'rgba(120, 112, 80, 0.08)')
  ctx.fillStyle = grass
  ctx.fillRect(left, gy - H * 0.09, right - left, H * 0.12)

  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 0; i < 42; i++) {
    const x = left + ((right - left) * (i + hash01(i + 3) * 0.6)) / 42
    const hh = H * (0.012 + hash01(i * 7) * 0.02)
    ctx.beginPath()
    ctx.moveTo(x, gy)
    ctx.quadraticCurveTo(x + (hash01(i) * 8 - 4), gy - hh, x + (hash01(i + 1) * 10 - 5), gy - hh * 0.25)
    ctx.strokeStyle = night ? `rgba(230, 224, 206, ${0.25 + hash01(i) * 0.25})` : `rgba(70, 82, 48, ${0.32 + hash01(i) * 0.3})`
    ctx.lineWidth = Math.max(0.7, W * 0.0016)
    ctx.stroke()
  }
  ctx.restore()

  if (node.key === 'xinwulu') {
    // 這座是渡溪點，草地上加一小彎水。
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(W * 0.2, gy - H * 0.01, W * 0.07, H * 0.012, -0.3, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(130, 166, 182, 0.4)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(70, 104, 122, 0.55)'
    ctx.lineWidth = Math.max(0.7, W * 0.002)
    ctx.stroke()
    ctx.restore()
  }
  if (node.key === 'meichi') {
    ctx.save()
    ctx.fillStyle = night ? 'rgba(180, 176, 160, 0.45)' : 'rgba(168, 156, 136, 0.85)'
    ctx.strokeStyle = ink
    ctx.lineWidth = Math.max(0.7, W * 0.002)
    for (const [fx, fw] of [
      [0.72, 0.035],
      [0.78, 0.028],
      [0.68, 0.022],
    ]) {
      ctx.beginPath()
      ctx.ellipse(W * fx, gy - H * 0.008, W * fw, H * 0.01, 0.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  const flowerCount = node.key === 'football' ? 10 : node.key === 'meichi' ? 4 : 6
  const colors = ['#c9b4d4', '#f7f4ee', '#e4d08a', '#d7c2b0']
  for (let i = 0; i < flowerCount; i++) {
    const x = left + (right - left) * (0.08 + hash01(i + 40) * 0.84)
    if (x > W * 0.28 && x < W * 0.62) continue
    const stem = H * (0.02 + hash01(i + 8) * 0.018)
    ctx.beginPath()
    ctx.moveTo(x, gy)
    ctx.quadraticCurveTo(x + 3, gy - stem * 0.6, x - 1, gy - stem)
    ctx.strokeStyle = night ? 'rgba(220, 216, 200, 0.55)' : 'rgba(70, 90, 52, 0.65)'
    ctx.lineWidth = Math.max(0.6, W * 0.0015)
    ctx.stroke()
    ctx.fillStyle = colors[i % colors.length]
    ctx.beginPath()
    ctx.arc(x - 1, gy - stem, Math.max(2.2, W * 0.008), 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(80, 68, 54, 0.35)'
    ctx.stroke()
  }

  drawBigTent(ctx, W * 0.36, gy, W, H, night)
  drawBigPack(ctx, W * 0.55, gy, W, H)
  drawPoles(ctx, W * 0.64, gy, W, H, ink)
}
function drawBigTent(ctx, x, y, W, H, night) {
  const dw = W * 0.2
  const dh = H * 0.115
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = 'rgba(90, 70, 48, 0.15)'
  ctx.beginPath()
  ctx.ellipse(0, 2, dw * 0.55, dh * 0.08, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-dw * 0.5, 0)
  ctx.bezierCurveTo(-dw * 0.52, -dh * 0.72, -dw * 0.2, -dh, 0, -dh * 1.02)
  ctx.bezierCurveTo(dw * 0.22, -dh, dw * 0.52, -dh * 0.7, dw * 0.5, 0)
  ctx.quadraticCurveTo(0, dh * 0.08, -dw * 0.5, 0)
  ctx.closePath()
  ctx.fillStyle = night ? 'rgba(214, 206, 188, 0.88)' : 'rgba(240, 232, 210, 0.95)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(62, 50, 40, 0.88)'
  ctx.lineWidth = Math.max(1, W * 0.003)
  ctx.stroke()
  // 打開的帳門，看得到暖色內部
  ctx.beginPath()
  ctx.moveTo(-dw * 0.08, 0)
  ctx.quadraticCurveTo(-dw * 0.1, -dh * 0.55, dw * 0.02, -dh * 0.62)
  ctx.quadraticCurveTo(dw * 0.16, -dh * 0.48, dw * 0.14, 0)
  ctx.closePath()
  ctx.fillStyle = 'rgba(214, 140, 72, 0.72)'
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(dw * 0.14, 0)
  ctx.quadraticCurveTo(dw * 0.28, -dh * 0.35, dw * 0.22, -dh * 0.08)
  ctx.strokeStyle = 'rgba(62, 50, 40, 0.7)'
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-dw * 0.36, -dh * 0.35)
  ctx.lineTo(-dw * 0.62, 1)
  ctx.moveTo(dw * 0.36, -dh * 0.35)
  ctx.lineTo(dw * 0.62, 1)
  ctx.lineWidth = Math.max(0.7, W * 0.002)
  ctx.stroke()
  ctx.restore()
}
function drawBigPack(ctx, x, y, W, H) {
  const w = W * 0.09
  const h = H * 0.078
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = '#b08958'
  ctx.beginPath()
  ctx.moveTo(-w * 0.45, -h * 0.15)
  ctx.quadraticCurveTo(-w * 0.7, -h * 0.75, -w * 0.2, -h)
  ctx.quadraticCurveTo(w * 0.35, -h * 1.05, w * 0.45, -h * 0.45)
  ctx.lineTo(w * 0.4, -h * 0.05)
  ctx.quadraticCurveTo(0, h * 0.08, -w * 0.45, -h * 0.15)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(62, 50, 40, 0.88)'
  ctx.lineWidth = Math.max(1, W * 0.0026)
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.fillStyle = '#8d6a3e'
  ctx.beginPath()
  ctx.moveTo(-w * 0.3, -h * 0.72)
  ctx.quadraticCurveTo(0, -h * 0.85, w * 0.28, -h * 0.62)
  ctx.lineTo(w * 0.22, -h * 0.42)
  ctx.lineTo(-w * 0.28, -h * 0.48)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-w * 0.1, -h * 0.95)
  ctx.lineTo(-w * 0.15, -h * 0.2)
  ctx.stroke()
  ctx.restore()
}
function drawPoles(ctx, x, y, W, H, ink) {
  ctx.save()
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1, W * 0.003)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - W * 0.03, y)
  ctx.lineTo(x + W * 0.05, y - H * 0.07)
  ctx.moveTo(x, y)
  ctx.lineTo(x + W * 0.07, y - H * 0.055)
  ctx.stroke()
  ctx.restore()
}
function drawProfileSilhouette(ctx, W, H, ink) {
  const x0 = W * 0.1
  const x1 = W * 0.9
  const base = H * 0.5
  const top = H * 0.25
  const pts = mapProfile(
    (nx) => x0 + (x1 - x0) * nx,
    (ny) => base - (base - top) * ny,
  )
  const pen = Math.max(0.8, W / 560)
  paintRidge(ctx, pts, base + H * 0.02, pen)
  const last = pts[pts.length - 1]
  sketchLake(ctx, last.x, last.y, pen)
  // 終點那一筆用傳入的墨色再描一次，夜裡才看得清楚，形狀仍是剖面。
  ctx.save()
  ctx.strokeStyle = ink
  ctx.globalAlpha = 0.35
  ctx.lineWidth = Math.max(0.8, W * 0.004)
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
  ctx.restore()
}
function drawLockedSilhouette(ctx, slot) {
  const W = 320
  const H = 400
  ctx.fillStyle = '#e5ddd0'
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.filter = 'grayscale(1) contrast(0.9)'
  ctx.globalAlpha = 0.5
  if (slot.kind === 'milestone') drawProfileSilhouette(ctx, W, H, '#5c5348')
  else drawNodeGlyph(ctx, W, H, nodeByKey(slot.key), '#5c5348', false)
  ctx.restore()
  ctx.fillStyle = 'rgba(90, 78, 64, 0.8)'
  ctx.font = "500 15px 'Noto Serif TC', serif"
  ctx.textAlign = 'center'
  ctx.fillText(slot.kind === 'milestone' ? '里程碑' : '營地小卡', W / 2, H * 0.9)
  ctx.font = "500 13px 'Noto Serif TC', serif"
  ctx.fillText('尚未取得', W / 2, H * 0.945)
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
  document.fonts.ready.then(() => refreshBook())
}
init()

// 給瀏覽器端驗收用（不顯示在介面）
window.__hut = { get state() { return state }, currentWalked, routeData }
