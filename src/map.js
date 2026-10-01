import route from '../data/route.json'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

const TILES = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}'
const ATTRIBUTION =
  '底圖 <a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心</a>｜' +
  '路線 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 貢獻者'
const LOCALE = {
  'CooperativeGesturesHandler.WindowsHelpText': '按住 Ctrl 再捲動，可以縮放地圖',
  'CooperativeGesturesHandler.MacHelpText': '按住 ⌘ 再捲動，可以縮放地圖',
  'CooperativeGesturesHandler.MobileHelpText': '用兩指移動地圖',
  'NavigationControl.ZoomIn': '放大',
  'NavigationControl.ZoomOut': '縮小',
}

const coords = route.points.map((p) => [p[0], p[1]])
const entries = []
let current = 0
let lib

// 單程距離 d（公尺）對應的經緯度
function lngLatAt(d) {
  const pts = route.points
  const i = pts.findIndex((p) => p[3] >= d)
  if (i <= 0) return coords[i === 0 ? 0 : coords.length - 1]
  const [a, b] = [pts[i - 1], pts[i]]
  const t = (d - a[3]) / (b[3] - a[3])
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

const line = (c) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c } })

function labelMarker(name, main) {
  const e = document.createElement('div')
  e.className = main ? 'map-label main' : 'map-label'
  e.textContent = name
  return e
}

async function init(entry) {
  lib ??= Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then((m) => m[0])
  const { Map, Marker, NavigationControl, LngLatBounds, setWorkerUrl } = await lib
  setWorkerUrl(workerUrl)
  const { el, lo, hi, lake } = entry

  const seg = route.points.filter((p) => p[3] >= lo && p[3] <= hi).map((p) => [p[0], p[1]])
  const bounds = new LngLatBounds()
  seg.forEach((c) => bounds.extend(c))
  if (lake) {
    route.lake.forEach((c) => bounds.extend(c))
    route.peaks.filter((p) => p.name === '三叉山').forEach((p) => bounds.extend([p.lon, p.lat]))
  }

  const map = new Map({
    container: el,
    style: {
      version: 8,
      sources: { base: { type: 'raster', tiles: [TILES], tileSize: 256, attribution: ATTRIBUTION } },
      layers: [{ id: 'base', type: 'raster', source: 'base', paint: { 'raster-saturation': -0.35 } }],
    },
    bounds,
    fitBoundsOptions: { padding: 56 },
    minZoom: 10,
    maxZoom: 17,
    cooperativeGestures: true,
    dragRotate: false,
    pitchWithRotate: false,
    locale: LOCALE,
  })
  map.touchZoomRotate.disableRotation()
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

  map.on('load', () => {
    map.addSource('all', { type: 'geojson', data: line(coords) })
    map.addSource('seg', { type: 'geojson', data: line(seg) })
    map.addSource('lake', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [route.lake] } },
    })
    const round = { 'line-cap': 'round', 'line-join': 'round' }
    map.addLayer({ id: 'lake', type: 'fill', source: 'lake', paint: { 'fill-color': '#1d6b8c' } })
    map.addLayer({ id: 'all', type: 'line', source: 'all', layout: round,
      paint: { 'line-color': '#20302a', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.6 } })
    map.addLayer({ id: 'seg-case', type: 'line', source: 'seg', layout: round,
      paint: { 'line-color': '#fff', 'line-width': 6 } })
    map.addLayer({ id: 'seg', type: 'line', source: 'seg', layout: round,
      paint: { 'line-color': '#c8472b', 'line-width': 3 } })
  })

  for (const w of route.waypoints) {
    if (w.dist < lo - 60 || w.dist > hi + 60) continue
    new Marker({ element: labelMarker(w.name, w.name === '嘉明湖'), anchor: 'left', offset: [8, 0] })
      .setLngLat([w.lon, w.lat])
      .addTo(map)
  }
  if (lake) {
    for (const p of route.peaks.filter((p) => p.name === '三叉山')) {
      new Marker({ element: labelMarker(`▲ ${p.name} ${p.ele.toLocaleString('en-US')} m`), anchor: 'left' })
        .setLngLat([p.lon, p.lat])
        .addTo(map)
    }
  }

  const here = document.createElement('div')
  here.className = 'map-here'
  entry.here = new Marker({ element: here }).setLngLat(lngLatAt(current)).addTo(map)
  place(entry)
}

function place(entry) {
  if (!entry.here) return
  entry.here.setLngLat(lngLatAt(current))
  entry.here.getElement().hidden = current < entry.lo || current > entry.hi
}

const observer = new IntersectionObserver(
  (items) => {
    for (const item of items) {
      if (!item.isIntersecting) continue
      observer.unobserve(item.target)
      init(entries.find((e) => e.el === item.target))
    }
  },
  { rootMargin: '600px 0px' },
)

// 在 el 裡建立一張地圖，標出單程距離 from 到 to 之間的路段；捲到附近才載入
export function addMap(el, { from, to, lake = false }) {
  entries.push({ el, lo: Math.min(from, to), hi: Math.max(from, to), lake })
  observer.observe(el)
}

// 更新所有地圖上「目前位置」的圓點
export function setMapPosition(d) {
  current = d
  entries.forEach(place)
}
