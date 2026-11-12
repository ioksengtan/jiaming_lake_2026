#!/usr/bin/env python3
"""從 data/route.json 預先算好剖面與寫死的節點分鐘，產生計時頁用的小型資料。

規則（依 docs/山屋時光-需求.md）：
- 奈史密斯估時：每公里 12 分鐘，每上升 100 公尺 10 分鐘，下坡只計距離。
- 去程整段縮放到 400 分鐘；回程沿同一剖面折返、同一套費力，整段縮放到 100 分鐘。
- 節點分鐘寫死（四捨五入為整數）。
- 剖面只存正規化座標（x,y 皆 0..1），不寫入任何絕對海拔，
  避免把不可印的海拔（嘉明湖、妹池營地、戒茂斯山前峰）寫進頁面資料。

執行： python3 scripts/build_hut_time_data.py
輸出： src/hut-time/route-data.js （已提交，執行時頁面不再解析整份 route.json）
"""
import json
import itertools
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
route = json.load(open(os.path.join(ROOT, "data", "route.json")))
pts = route["points"]  # [lon, lat, ele, dist]
n = len(pts)
L = pts[-1][3]

FORWARD_TOTAL = 400.0
RETURN_TOTAL = 100.0


def naismith(dist_m, gain_m):
    return (dist_m / 1000.0) * 12.0 + (gain_m / 100.0) * 10.0


# 去程費力（逐段，點 i -> i+1）
eff_f = [0.0]
for i in range(n - 1):
    d = pts[i + 1][3] - pts[i][3]
    gain = max(0, pts[i + 1][2] - pts[i][2])
    eff_f.append(naismith(d, gain))
cum_f = list(itertools.accumulate(eff_f))
scale_f = FORWARD_TOTAL / cum_f[-1]
mF = [c * scale_f for c in cum_f]
mF[-1] = FORWARD_TOTAL  # 去程合計正好 400

# 回程費力（由湖折返，點 i -> i-1，上升＝去程的下降）
eff_r = [0.0]
for i in range(n - 1, 0, -1):
    d = pts[i][3] - pts[i - 1][3]
    gain = max(0, pts[i - 1][2] - pts[i][2])
    eff_r.append(naismith(d, gain))
cum_r = list(itertools.accumulate(eff_r))
scale_r = RETURN_TOTAL / cum_r[-1]
# mR_fwd[i] = 從湖折返、走到點 i（正向索引）已用的回程分鐘
mR_fwd = [0.0] * n
for j in range(n):
    i = (n - 1) - j
    mR_fwd[i] = cum_r[j] * scale_r
mR_fwd[0] = RETURN_TOTAL  # 回程合計正好 100
mR_fwd[-1] = 0.0

eles = [p[2] for p in pts]
min_e, max_e = min(eles), max(eles)


def norm_x(dist):
    return round(dist / L, 5)


def norm_y(ele):
    return round((ele - min_e) / (max_e - min_e), 4)


profile = [[norm_x(pts[i][3]), norm_y(pts[i][2]), round(mF[i], 2), round(mR_fwd[i], 2)] for i in range(n)]

dist_to_idx = {p[3]: i for i, p in enumerate(pts)}


def node_minF(dist):
    return round(mF[dist_to_idx[dist]])


def node_minR_global(dist):
    return round(FORWARD_TOTAL + mR_fwd[dist_to_idx[dist]])


# 節點（寫死分鐘）。printEle / printDist 只放〈軌跡檔核對〉允許印的數字。
nodes = [
    {
        "key": "trailhead", "name": "戒茂斯登山口", "x": norm_x(0),
        "minF": 0, "minR": 500,
        "camp": False, "card": False, "rest": False, "lake": False, "scenery": False,
        "printEle": 1919, "printDist": None,
        "main": "戒茂斯線起點，台 20 線 160.5 公里，海拔 1,919 公尺。",
    },
    {
        "key": "frontpeak", "name": "戒茂斯山前峰", "x": norm_x(350),
        "minF": node_minF(350), "minR": node_minR_global(350),
        "camp": False, "card": False, "rest": False, "lake": False, "scenery": True,
        "printEle": None, "printDist": None, "main": "",
    },
    {
        "key": "xinwulu", "name": "新武呂溪營地", "x": norm_x(3250),
        "minF": node_minF(3250), "minR": node_minR_global(3250),
        "camp": True, "card": True, "rest": True, "lake": False, "scenery": False,
        "printEle": 2245, "printDist": 3250,
        "main": "戒茂斯線的渡溪點，沿路線距登山口 3,250 公尺，海拔 2,245 公尺。",
    },
    {
        "key": "football", "name": "足球場營地", "x": norm_x(5550),
        "minF": node_minF(5550), "minR": node_minR_global(5550),
        "camp": True, "card": True, "rest": True, "lake": False, "scenery": False,
        "printEle": 2783, "printDist": 5550,
        "main": "沿戒茂斯線距登山口 5,550 公尺的營地，海拔 2,783 公尺。",
    },
    {
        "key": "meichi", "name": "妹池營地", "x": norm_x(8950),
        "minF": node_minF(8950), "minR": node_minR_global(8950),
        "camp": True, "card": True, "rest": True, "lake": False, "scenery": False,
        "printEle": None, "printDist": None,
        "main": "戒茂斯線上的高地營地。",
    },
    {
        "key": "lake", "name": "嘉明湖", "x": norm_x(L),
        "minF": 400, "minR": 400,
        "camp": False, "card": False, "rest": False, "lake": True, "scenery": True,
        "printEle": None, "printDist": None,
        "main": "抵達嘉明湖。",
    },
]

data = {
    "forwardTotal": 400,
    "returnTotal": 100,
    "grandTotal": 500,
    "routeName": "戒茂斯線",
    "profile": profile,
    "nodes": nodes,
    "printable": {
        "trailheadEle": 1919,
        "forwardGain": 2105,
        "roundTripGain": 2806,
    },
    "naismith": {"minPerKm": 12, "minPer100mGain": 10},
}

out_dir = os.path.join(ROOT, "src", "hut-time")
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "route-data.js")
with open(out_path, "w", encoding="utf-8") as f:
    f.write("// 由 scripts/build_hut_time_data.py 從 data/route.json 產生，請勿手改。\n")
    f.write("// 奈史密斯估時後去程縮放到 400 分鐘、回程縮放到 100 分鐘；節點分鐘寫死。\n")
    f.write("export const routeData = ")
    f.write(json.dumps(data, ensure_ascii=False, indent=0).replace("\n", ""))
    f.write("\n")

print("wrote", out_path)
print("forward node minutes:", {nd["key"]: nd["minF"] for nd in nodes})
print("return node global minutes:", {nd["key"]: nd["minR"] for nd in nodes})
