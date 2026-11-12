// 山屋時光的純邏輯：位置換算、節點分鐘、中斷判定、發卡與專注段計算。
// 不碰 DOM、不碰 localStorage，方便以 node --test 覆蓋。
import { routeData } from './route-data.js'

export { routeData }

export const FORWARD_TOTAL = routeData.forwardTotal // 400
export const RETURN_TOTAL = routeData.returnTotal // 100
export const GRAND_TOTAL = routeData.grandTotal // 500
export const FOCUS_LENGTHS = [15, 25, 50]
export const DEFAULT_FOCUS = 25
export const CAMP_WAIT_MINUTES = 10 // 離下一座營地不到十分鐘才進營地等候

const PROFILE = routeData.profile // 每點 [x, y, mF, mR]
const NODES = routeData.nodes

export function nodeByKey(key) {
  return NODES.find((n) => n.key === key)
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo, lo), hi)

// 在 profile 的某一欄（col）找出 value 對應的 x（沿路線距離 0..1）。
// 不假設單調方向：逐段看 value 是否落在兩端之間。
function xForValue(col, value) {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const a = PROFILE[i][col]
    const b = PROFILE[i + 1][col]
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    if (value >= lo && value <= hi) {
      const t = b === a ? 0 : (value - a) / (b - a)
      return PROFILE[i][0] + t * (PROFILE[i + 1][0] - PROFILE[i][0])
    }
  }
  return value <= PROFILE[0][col] && col === 2 ? PROFILE[0][0] : PROFILE[PROFILE.length - 1][0]
}

// y（正規化海拔 0..1）對應某個沿線距離 x。
export function yForX(x) {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    if (x >= PROFILE[i][0] && x <= PROFILE[i + 1][0]) {
      const span = PROFILE[i + 1][0] - PROFILE[i][0]
      const t = span === 0 ? 0 : (x - PROFILE[i][0]) / span
      return PROFILE[i][1] + t * (PROFILE[i + 1][1] - PROFILE[i][1])
    }
  }
  return PROFILE[PROFILE.length - 1][1]
}

// 全程分鐘 g（0..500）對應的位置：x 與方向。
export function positionAt(g) {
  g = clamp(g, 0, GRAND_TOTAL)
  if (g <= FORWARD_TOTAL) {
    return { x: xForValue(2, g), leg: 'forward' }
  }
  return { x: xForValue(3, g - FORWARD_TOTAL), leg: 'return' }
}

// 以行進方向看，下一座「休息點（營地）」與它的全程抵達分鐘。
export function nextRest(g) {
  const out = []
  for (const n of NODES) {
    if (!n.rest) continue
    const arrive = g < FORWARD_TOTAL ? n.minF : n.minR
    if (arrive > g) out.push({ node: n, arrive })
  }
  out.sort((a, b) => a.arrive - b.arrive)
  return out[0] || null
}

// 按「我被打斷了」時，小登山者在哪裡休息。
// 離下一座營地不到十分鐘路線時間 → 進那座營地等候；否則坐在路邊喝水。
export function interruptState(g) {
  if (g >= GRAND_TOTAL) return { type: 'done' }
  const nr = nextRest(g)
  if (nr && nr.arrive - g < CAMP_WAIT_MINUTES) return { type: 'camp', node: nr.node }
  return { type: 'roadside' }
}

// 預告句「再兩次專注就到……」要用的下一個目的地：
// 去程是營地或嘉明湖，回程是營地或戒茂斯登山口，不含前峰。
export function nextLandmark(g) {
  const out = []
  for (const n of NODES) {
    let arrive = null
    if (g < FORWARD_TOTAL) {
      if (n.lake) arrive = FORWARD_TOTAL
      else if (n.rest && n.minF > g) arrive = n.minF
    } else {
      if (n.key === 'trailhead') arrive = GRAND_TOTAL
      else if (n.rest && n.minR > g) arrive = n.minR
    }
    if (arrive != null && arrive > g) out.push({ node: n, arrive })
  }
  out.sort((a, b) => a.arrive - b.arrive)
  return out[0] || null
}

// 這一次前進（prevG → newG）是否走過了會發小卡的去程營地。
// 回程（分鐘超過 400）不發卡。
export function cardsCrossed(prevG, newG) {
  const keys = []
  for (const n of NODES) {
    if (!n.card) continue
    if (n.minF > prevG && n.minF <= newG && n.minF <= FORWARD_TOTAL) keys.push(n.key)
  }
  return keys
}

export function reachedLake(g) {
  return g >= FORWARD_TOTAL
}

export function completed(g) {
  return g >= GRAND_TOTAL
}

export function milestoneCrossed(prevG, newG) {
  return prevG < GRAND_TOTAL && newG >= GRAND_TOTAL
}

// 這一段專注實際會前進的分鐘：剩下的路短於所選長度時只走剩下的。
export function sessionTarget(startWalked, length) {
  return Math.min(length, GRAND_TOTAL - startWalked)
}

// 依這一段開始時刻起算的經過分鐘，算出目前累積走到的全程分鐘。
// 進度不倒退：永遠 ≥ startWalked；且不超過這一段的預定結束。
export function sessionWalked(startWalked, length, elapsedMin) {
  const target = sessionTarget(startWalked, length)
  const adv = Math.min(Math.max(elapsedMin, 0), target)
  return startWalked + adv
}

export function sessionDone(startWalked, length, elapsedMin) {
  return elapsedMin >= sessionTarget(startWalked, length)
}
