import route from '../data/route.json'
import photoList from '../data/photos.json'
import { chapters } from './story.js'

const photos = Object.fromEntries(photoList.map((p) => [p.id, p]))
const L = route.length_m
const TRIP = L * 2
const eles = route.points.map((p) => p[2])
const MIN_E = Math.min(...eles)
const MAX_E = Math.max(...eles)

// 單程距離 d（公尺）對應的海拔
function eleAt(d) {
  const pts = route.points
  let i = pts.findIndex((p) => p[3] >= d)
  if (i <= 0) return pts[i === 0 ? 0 : pts.length - 1][2]
  const [a, b] = [pts[i - 1], pts[i]]
  return a[2] + ((b[2] - a[2]) * (d - a[3])) / (b[3] - a[3])
}

// 整趟（去程＋回程）的累積距離
const tripDist = (s) => (s.leg === 'back' ? TRIP - s.d : s.d)
const routeDist = (t) => (t > L ? TRIP - t : t)

const steps = chapters.flatMap((c) => c.steps)
steps.forEach((s) => (s.trip = tripDist(s)))

const fmt = (n) => Math.round(n).toLocaleString('en-US')
const el = (tag, cls, html) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html != null) e.innerHTML = html
  return e
}

function photoFigure(id) {
  const p = photos[id]
  const base = `${import.meta.env.BASE_URL}photos/${id}`
  const fig = el('figure', p.w > p.h ? 'wide' : 'tall')
  fig.innerHTML = `<img src="${base}-800.webp" srcset="${base}-800.webp 800w, ${base}-1600.webp 1600w"
    sizes="(min-width: 1100px) 1100px, 100vw" width="${p.w}" height="${p.h}" loading="lazy" alt="">`
  return fig
}

function renderStory() {
  const root = document.querySelector('#story')
  let index = 0
  for (const c of chapters) {
    const sec = el('section', c.lake ? 'chapter lake' : 'chapter')
    sec.append(el('header', 'chapter-head', `<p class="kicker">${c.kicker}</p><h2>${c.title}</h2>`))
    for (const s of c.steps) {
      const art = el('article', 'step')
      art.dataset.index = index++
      const [date, clock] = s.time.split(' ')
      art.append(
        el('p', 'meta', `<span>${clock}</span><span>${s.place}</span><span>${fmt(eleAt(s.d))} m</span>`),
      )
      if (s.photos.length) {
        const g = el('div', `photos n${Math.min(s.photos.length, 4)}`)
        s.photos.forEach((id) => g.append(photoFigure(id)))
        art.append(g)
      }
      if (s.card) {
        const dl = el('dl', 'card')
        s.card.forEach(([k, v]) => dl.append(el('div', '', `<dt>${k}</dt><dd>${v}</dd>`)))
        art.append(dl)
      }
      const body = el('div', 'body')
      s.text.forEach((t) => body.append(el('p', '', t)))
      s.todo.forEach((t) => body.append(el('p', 'todo', t)))
      art.append(body)
      art.dataset.date = date
      sec.append(art)
    }
    root.append(sec)
  }
}

// 頂部的海拔剖面列：橫軸是整趟的累積距離，去程接回程
function renderProfile() {
  const W = 1000
  const H = 60
  const x = (t) => (t / TRIP) * W
  const y = (e) => H - 4 - ((e - MIN_E) / (MAX_E - MIN_E)) * (H - 12)
  const out = route.points.map((p) => [x(p[3]), y(p[2])])
  const back = route.points.map((p) => [x(TRIP - p[3]), y(p[2])]).reverse()
  const line = [...out, ...back].map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')
  const area = `${line}L${W},${H}L0,${H}Z`
  const svg = (cls, body) =>
    `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`
  const chart = document.querySelector('#profile-chart')
  chart.innerHTML =
    svg('base', `<path class="area" d="${area}"/><path class="line" d="${line}"/>`) +
    svg('done', `<path class="area" d="${area}"/><path class="line" d="${line}"/>`) +
    '<span class="dot"></span>'

  const marks = [
    ['新武呂溪', 3250],
    ['妹池', 8950],
    ['嘉明湖', L],
    ['妹池', TRIP - 8950],
    ['新武呂溪', TRIP - 3250],
  ]
  for (const [name, t] of marks) {
    const m = el('span', name === '嘉明湖' ? 'mark main' : 'mark', name)
    m.style.left = `${(t / TRIP) * 100}%`
    chart.append(m)
  }
  return { y, H }
}

function setupScroll({ y, H }) {
  const chart = document.querySelector('#profile-chart')
  const done = chart.querySelector('.done')
  const dot = chart.querySelector('.dot')
  const place = document.querySelector('#now-place')
  const time = document.querySelector('#now-time')
  const ele = document.querySelector('#now-ele')

  function setTrip(t) {
    const pct = (t / TRIP) * 100
    const e = eleAt(routeDist(t))
    done.style.clipPath = `inset(0 ${100 - pct}% 0 0)`
    dot.style.left = `${pct}%`
    dot.style.top = `${(y(e) / H) * 100}%`
    ele.textContent = `${fmt(e)} m`
  }

  function setStep(i) {
    const s = steps[i]
    const [date, clock] = s.time.split(' ')
    const [, m, d] = date.split('-')
    place.textContent = s.place
    time.textContent = `${Number(m)}/${Number(d)} ${clock}`
    document.querySelectorAll('.step.active').forEach((n) => n.classList.remove('active'))
    document.querySelector(`.step[data-index="${i}"]`).classList.add('active')
  }

  // 以畫面 60% 高度的那條線為準：線落在哪一步，就顯示那一步；
  // 並依照線在這一步與下一步之間的位置，讓圓點沿剖面前進
  const nodes = [...document.querySelectorAll('.step')]
  let current = -1
  let queued = false

  function update() {
    queued = false
    const line = window.innerHeight * 0.6
    const tops = nodes.map((n) => n.getBoundingClientRect().top)
    let i = tops.findLastIndex((t) => t <= line)
    if (i < 0) i = 0
    if (i !== current) setStep((current = i))
    const next = tops[i + 1]
    const progress = next == null ? 0 : Math.min(Math.max((line - tops[i]) / (next - tops[i]), 0), 1)
    const a = steps[i].trip
    const b = (steps[i + 1] ?? steps[i]).trip
    setTrip(a + (b - a) * progress)
  }

  const onScroll = () => {
    if (!queued) {
      queued = true
      requestAnimationFrame(update)
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
  update()
}

function renderSources() {
  document.querySelector('#sources').innerHTML = `
    <h2>資料來源</h2>
    <ul>
      <li>步道路線、山頭與湖的輪廓：${route.sources.route}</li>
      <li>海拔剖面：${route.sources.elevation}</li>
      <li>照片的時間與位置：拍攝時手機記錄的資料</li>
      <li>嘉明湖海拔 3,310 公尺：健行筆記〈戒茂斯上嘉明湖〉</li>
    </ul>`
}

renderStory()
renderSources()
setupScroll(renderProfile())
