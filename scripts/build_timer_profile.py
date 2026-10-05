"""把 data/route.json 的戒茂斯線單程收成計時頁用的小剖面。

去程以奈史密斯估時（每公里十二分鐘，每上升一百公尺十分鐘，下坡只計距離）
算出費力，再整段縮放到四百分鐘。回程沿同一條剖面折返，用同一套
「每一單位費力幾分鐘」，不另外湊成整數。

輸出 public/timer-profile.js。頁面執行時不讀 route.json。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROUTE = ROOT / "data" / "route.json"
OUT = ROOT / "public" / "timer-profile.js"

# 奈史密斯：12 分鐘／公里、上升 10 分鐘／100 公尺
MIN_PER_M = 12 / 1000
MIN_PER_UP = 10 / 100
OUT_MIN = 400

PLACES = [
    ("trailhead", "戒茂斯登山口", 0, "start"),
    ("forepeak", "戒茂斯山前峰", 350, "landscape"),
    ("xinwu", "新武呂溪營地", 3250, "shelter"),
    ("soccer", "足球場營地", 5550, "shelter"),
    ("meichi", "妹池營地", 8950, "shelter"),
    ("lake", "嘉明湖", 10243, "lake"),
]


def naismith(seq):
    costs = []
    for a, b in zip(seq, seq[1:]):
        dd = b["d"] - a["d"]
        de = b["ele"] - a["ele"]
        costs.append(dd * MIN_PER_M + max(de, 0) * MIN_PER_UP)
    return costs


def cum_at(pts, key, dist):
    for i in range(1, len(pts)):
        if pts[i]["d"] >= dist:
            a, b = pts[i - 1], pts[i]
            span = b["d"] - a["d"]
            t = 0 if span == 0 else (dist - a["d"]) / span
            return a[key] + (b[key] - a[key]) * t, a["ele"] + (b["ele"] - a["ele"]) * t
    return pts[-1][key], pts[-1]["ele"]


def gain_to(pts, dist):
    total = 0
    prev_d, prev_e = pts[0]["d"], pts[0]["ele"]
    for p in pts[1:]:
        if p["d"] > dist:
            span = p["d"] - prev_d
            t = 0 if span == 0 else (dist - prev_d) / span
            ele = prev_e + (p["ele"] - prev_e) * t
            total += max(ele - prev_e, 0)
            break
        total += max(p["ele"] - prev_e, 0)
        prev_d, prev_e = p["d"], p["ele"]
    return total


def main():
    route = json.loads(ROUTE.read_text(encoding="utf8"))
    pts = [{"d": p[3], "ele": p[2]} for p in route["points"]]
    raw = naismith(pts)
    raw_sum = sum(raw)
    scale = OUT_MIN / raw_sum
    out = [0.0]
    for c in raw:
        out.append(out[-1] + c * scale)
    out[-1] = float(OUT_MIN)

    rev = list(reversed(pts))
    end_d = pts[-1]["d"]
    rev_seq = [{"d": end_d - p["d"], "ele": p["ele"]} for p in rev]
    raw_back = naismith(rev_seq)
    back_sum = sum(raw_back) * scale
    back_from_lake = [0.0]
    for c in raw_back:
        back_from_lake.append(back_from_lake[-1] + c * scale)
    back_from_lake[-1] = back_sum
    # back_from_lake 由湖走到登山口。轉回原點順序後，加上去程的四百分鐘。
    back = [OUT_MIN + b for b in reversed(back_from_lake)]
    back[0] = OUT_MIN + back_sum
    back[-1] = float(OUT_MIN)

    for p, o, b in zip(pts, out, back):
        p["out"] = round(o, 3)
        p["back"] = round(b, 3)
    pts[0]["out"] = 0
    pts[-1]["out"] = OUT_MIN
    pts[-1]["back"] = OUT_MIN
    pts[0]["back"] = round(OUT_MIN + back_sum, 3)

    places = []
    for pid, name, dist, role in PLACES:
        o, ele = cum_at(pts, "out", dist)
        b, _ = cum_at(pts, "back", dist)
        places.append({
            "id": pid,
            "name": name,
            "role": role,
            "d": dist,
            "ele": round(ele),
            "out": round(o, 2),
            "back": round(b, 2),
            "gain": round(gain_to(pts, dist)),
        })

    def legs(direction):
        rows = []
        ordered = places if direction == "out" else list(reversed(places))
        key = "out" if direction == "out" else "back"
        for a, b in zip(ordered, ordered[1:]):
            minutes = round(b[key] - a[key], 2)
            gain = 0
            d0, d1 = a["d"], b["d"]
            lo, hi = min(d0, d1), max(d0, d1)
            prev = None
            for p in pts:
                if p["d"] < lo or p["d"] > hi:
                    continue
                if prev is not None:
                    de = p["ele"] - prev
                    if d1 < d0:
                        de = -de
                    gain += max(de, 0)
                prev = p["ele"]
            rows.append({
                "from": a["name"],
                "to": b["name"],
                "minutes": minutes,
                "dist": abs(b["d"] - a["d"]),
                "gain": round(gain),
            })
        return rows

    profile = {
        "routeName": "戒茂斯線",
        "title": "嘉明湖",
        "trailhead": "戒茂斯登山口",
        "destination": "嘉明湖",
        "outMin": OUT_MIN,
        "backMin": round(back_sum, 2),
        "totalMin": round(OUT_MIN + back_sum, 2),
        "gainOut": route["gain_m"],
        "gainBack": route["loss_m"],
        "gainRound": route["gain_m"] + route["loss_m"],
        "lengthM": route["length_m"],
        "highEle": max(p["ele"] for p in pts),
        "highDist": max(pts, key=lambda p: p["ele"])["d"],
        "endEle": pts[-1]["ele"],
        "startEle": pts[0]["ele"],
        "points": [[p["d"], p["ele"], p["out"], p["back"]] for p in pts],
        "places": places,
        "legsOut": legs("out"),
        "legsBack": legs("back"),
        "quote": "先往上，再下到溪谷，然後一路爬到湖邊。",
    }
    OUT.parent.mkdir(exist_ok=True)
    text = "const PROFILE = " + json.dumps(profile, ensure_ascii=False, separators=(",", ":")) + ";\n"
    OUT.write_text(text, encoding="utf8")
    print(f"wrote {OUT} ({len(text)} bytes)")
    print(f"out {profile['outMin']} back {profile['backMin']} total {profile['totalMin']}")
    print(f"high {profile['highEle']} at {profile['highDist']} end {profile['endEle']}")
    print("--- outbound ---")
    for row in profile["legsOut"]:
        print(f"{row['from']} → {row['to']}: {row['minutes']} 分鐘, {row['dist']} 公尺, 上升 {row['gain']} 公尺")
    print("--- return ---")
    for row in profile["legsBack"]:
        print(f"{row['from']} → {row['to']}: {row['minutes']} 分鐘, {row['dist']} 公尺, 上升 {row['gain']} 公尺")
    for p in places:
        print(f"{p['name']} d={p['d']} ele={p['ele']} out={p['out']} back={p['back']} gain={p['gain']}")


if __name__ == "__main__":
    main()
