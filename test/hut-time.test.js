// 山屋時光計時邏輯的自動化測試：node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  routeData,
  positionAt,
  nextRest,
  interruptState,
  cardsCrossed,
  milestoneCrossed,
  reachedLake,
  completed,
  sessionTarget,
  sessionWalked,
  sessionDone,
  nodeByKey,
  FORWARD_TOTAL,
  RETURN_TOTAL,
  GRAND_TOTAL,
} from '../src/hut-time/engine.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const route = JSON.parse(readFileSync(path.join(here, '..', 'data', 'route.json'), 'utf-8'))

// 獨立重算奈史密斯費力，驗證產生的資料縮放正確。
function naismith(distM, gainM) {
  return (distM / 1000) * 12 + (gainM / 100) * 10
}
function cumForward(pts) {
  let c = 0
  const out = [0]
  for (let i = 0; i < pts.length - 1; i++) {
    c += naismith(pts[i + 1][3] - pts[i][3], Math.max(0, pts[i + 1][2] - pts[i][2]))
    out.push(c)
  }
  return out
}
function cumReturn(pts) {
  let c = 0
  const out = [0]
  for (let i = pts.length - 1; i > 0; i--) {
    c += naismith(pts[i][3] - pts[i - 1][3], Math.max(0, pts[i - 1][2] - pts[i][2]))
    out.push(c)
  }
  return out
}

test('奈史密斯估時：去程逐段合計正好 400、回程正好 100', () => {
  // 資料檔內 profile 的 mF/mR 逐段相加
  const prof = routeData.profile
  let sumF = 0
  for (let i = 0; i < prof.length - 1; i++) sumF += prof[i + 1][2] - prof[i][2]
  assert.ok(Math.abs(sumF - 400) < 1e-6, `去程合計=${sumF}`)
  // mR 由湖（0）到登山口（100）
  assert.equal(prof[0][3], 100)
  assert.equal(prof[prof.length - 1][3], 0)
  let sumR = 0
  for (let i = 0; i < prof.length - 1; i++) sumR += Math.abs(prof[i][3] - prof[i + 1][3])
  assert.ok(Math.abs(sumR - 100) < 1e-6, `回程合計=${sumR}`)
  assert.equal(routeData.forwardTotal, 400)
  assert.equal(routeData.returnTotal, 100)
  assert.equal(routeData.grandTotal, 500)
})

test('縮放係數與獨立重算一致，去程節點分鐘＝縮放後四捨五入', () => {
  const pts = route.points
  const cf = cumForward(pts)
  const scaleF = 400 / cf[cf.length - 1]
  const distToIdx = new Map(pts.map((p, i) => [p[3], i]))
  const expect = {
    // 登山口是出發點，全程第 0 分鐘（路線第一個點 dist 0）
    trailhead: Math.round(cf[0] * scaleF),
    frontpeak: Math.round(cf[distToIdx.get(350)] * scaleF),
    xinwulu: Math.round(cf[distToIdx.get(3250)] * scaleF),
    football: Math.round(cf[distToIdx.get(5550)] * scaleF),
    meichi: Math.round(cf[distToIdx.get(8950)] * scaleF),
    lake: 400,
  }
  for (const [k, v] of Object.entries(expect)) {
    assert.equal(nodeByKey(k).minF, v, `${k} 去程分鐘`)
  }
  // 也對照寫死值
  assert.deepEqual(expect, { trailhead: 0, frontpeak: 20, xinwulu: 129, football: 233, meichi: 349, lake: 400 })
})

test('回程節點全程分鐘＝400＋縮放後四捨五入，寫死一致', () => {
  const pts = route.points
  const cr = cumReturn(pts)
  const scaleR = 100 / cr[cr.length - 1]
  // 由湖折返累積到各節點（正向索引 i 對應反向 j=last-i）
  const last = pts.length - 1
  const distToIdx = new Map(pts.map((p, i) => [p[3], i]))
  const fromLake = (dist) => Math.round(cr[last - distToIdx.get(dist)] * scaleR)
  const expect = {
    meichi: 400 + fromLake(8950),
    football: 400 + fromLake(5550),
    xinwulu: 400 + fromLake(3250),
    frontpeak: 400 + fromLake(350),
    trailhead: 400 + fromLake(50),
  }
  for (const [k, v] of Object.entries(expect)) {
    assert.equal(nodeByKey(k).minR, v, `${k} 回程全程分鐘`)
  }
  assert.deepEqual(expect, { meichi: 414, football: 444, xinwulu: 461, frontpeak: 497, trailhead: 500 })
})

test('走滿去程 400 分鐘，人在嘉明湖、狀態抵達、無里程碑卡', () => {
  const g = 400
  assert.ok(reachedLake(g))
  assert.ok(!completed(g))
  const pos = positionAt(g)
  assert.ok(Math.abs(pos.x - 1) < 1e-6, `應在湖邊 x=${pos.x}`)
  // 這一刻沒有跨過 500，不發里程碑
  assert.ok(!milestoneCrossed(390, 400))
  // 去程三營地都已發卡，但嘉明湖不發卡
  const crossed = cardsCrossed(0, 400)
  assert.deepEqual(crossed, ['xinwulu', 'football', 'meichi'])
  assert.ok(!crossed.includes('lake'))
})

test('再走滿回程 100 分鐘才回到登山口並發里程碑卡', () => {
  assert.ok(!completed(499.9))
  assert.ok(completed(500))
  assert.ok(milestoneCrossed(499, 500))
  // 回程不發任何小卡
  assert.deepEqual(cardsCrossed(400, 500), [])
  const pos = positionAt(500)
  assert.ok(Math.abs(pos.x - 0) < 1e-6, `應回到登山口 x=${pos.x}`)
})

test('選 15 分鐘時最後一段只走剩下的 5 分鐘並在登山口結束', () => {
  const startWalked = 495
  assert.equal(sessionTarget(startWalked, 15), 5)
  // 走滿 5 分鐘（實際專注更久也只到 5）
  assert.equal(sessionWalked(startWalked, 15, 5), 500)
  assert.equal(sessionWalked(startWalked, 15, 15), 500)
  assert.ok(sessionDone(startWalked, 15, 5))
  assert.ok(completed(sessionWalked(startWalked, 15, 5)))
  // 全程仍是 500，不改成 495
  assert.equal(GRAND_TOTAL, 500)
})

test('中斷：離下一座營地不到十分鐘進營地等候，但不加成抵達', () => {
  // 新武呂溪營地抵達分鐘 129，取 g=120（差 9 分鐘 < 10）
  const g = 120
  const st = interruptState(g)
  assert.equal(st.type, 'camp')
  assert.equal(st.node.key, 'xinwulu')
  // 進度沒有被加成到抵達：仍是 120，未發卡
  assert.deepEqual(cardsCrossed(g, g), [])
  assert.ok(nodeByKey('xinwulu').minF > g)
})

test('中斷：離下一座營地還很遠時坐在路邊喝水', () => {
  const g = 60 // 離新武呂溪營地 129 還有 69 分鐘
  assert.equal(interruptState(g).type, 'roadside')
  // 過了最後一座營地、前面沒有營地（去程 349 之後到湖）也是路邊
  assert.equal(interruptState(360).type, 'roadside')
})

test('進度不倒退：sessionWalked 永不小於起始', () => {
  for (const el of [-5, 0, 3, 100]) {
    assert.ok(sessionWalked(200, 25, el) >= 200)
  }
  // 離開超過預定時間再加十五分鐘，仍只結算到預定結束
  assert.equal(sessionWalked(200, 25, 25 + 15), 225)
  assert.equal(sessionWalked(200, 25, 999), 225)
})

test('發卡只在去程、且走到才發；回程經過不再發', () => {
  assert.deepEqual(cardsCrossed(100, 130), ['xinwulu'])
  assert.deepEqual(cardsCrossed(128, 234), ['xinwulu', 'football'])
  // 回程經過新武呂溪（全程 461）不發
  assert.deepEqual(cardsCrossed(455, 465), [])
})

test('禁止印出的名稱與海拔不出現在頁面可顯示內容', () => {
  const read = (p) => readFileSync(path.join(here, '..', p), 'utf-8')
  const ui = read('src/hut-time/app.js') + read('hut-time/index.html')
  // 節點可顯示欄位（名稱、主句、可印海拔與距離）
  const shown = routeData.nodes
    .map((n) => [n.name, n.main, n.printEle, n.printDist].filter((v) => v != null).join(' '))
    .join(' ')
  const haystack = ui + ' ' + shown
  const forbiddenNames = ['向陽', '排球', '獵寮', '三叉', '登頂', '山屋避難', '山屋等候']
  for (const w of forbiddenNames) assert.ok(!haystack.includes(w), `不應出現「${w}」`)
  // 不可印的海拔（以帶千分位的顯示形式檢查）
  const forbiddenEle = ['3,310', '3,323', '3,353', '3,172', '2,038', '2,077', '2,508', '3,495', '3,435']
  for (const e of forbiddenEle) assert.ok(!haystack.includes(e + ' 公尺'), `不應印海拔 ${e} 公尺`)
  // 「山屋」不得用來稱呼休息點（可出現在產品名「山屋時光」）
  for (const n of routeData.nodes) assert.ok(!n.name.includes('山屋'), '營地不叫山屋')
})

test('可印的海拔與爬升數字存在且正確', () => {
  assert.equal(nodeByKey('trailhead').printEle, 1919)
  assert.equal(nodeByKey('xinwulu').printEle, 2245)
  assert.equal(nodeByKey('football').printEle, 2783)
  assert.equal(nodeByKey('meichi').printEle, null) // 妹池海拔不印
  assert.equal(nodeByKey('lake').printEle, null) // 湖的海拔不印
  assert.equal(routeData.printable.forwardGain, 2105)
  assert.equal(routeData.printable.roundTripGain, 2806)
})

test('下一座休息點：去程方向正確，過妹池後無營地', () => {
  assert.equal(nextRest(0).node.key, 'xinwulu')
  assert.equal(nextRest(130).node.key, 'football')
  assert.equal(nextRest(240).node.key, 'meichi')
  assert.equal(nextRest(360), null) // 去程最後一座營地之後
  // 回程：剛過湖，下一座營地是妹池（全程 414）
  assert.equal(nextRest(401).node.key, 'meichi')
  assert.equal(nextRest(470), null) // 回程過新武呂溪後無營地
})
