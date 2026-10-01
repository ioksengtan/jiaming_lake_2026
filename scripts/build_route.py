"""用 OpenStreetMap 的步道路線與 Copernicus 地形資料，產出 data/route.json。

用法（在專案根目錄）：python scripts/build_route.py
- 路線：登山口到嘉明湖的單程（回程原路折返，網頁端自行反轉）
- data/osm_raw.json 是 Overpass 查詢結果的快取，刪掉就會重新下載
- 海拔取自 Open-Meteo Elevation API（Copernicus DEM GLO-90）
"""
import heapq
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OSM = ROOT / 'data' / 'osm_raw.json'
PHOTOS = ROOT / 'data' / 'photos.json'
OUT = ROOT / 'data' / 'route.json'

BBOX = '23.215,120.995,23.305,121.045'
QUERY = (
    '[out:json][timeout:90];('
    f'way["highway"~"path|footway|track"]({BBOX});'
    f'way["natural"="water"]({BBOX});'
    f'node["tourism"]({BBOX});'
    f'node["natural"="peak"]({BBOX});'
    ');out body;>;out skel qt;'
)
TRAILHEAD = (23.2273, 121.0081)   # 台20線 160.5K 戒茂斯登山口
LAKE = (23.2924, 121.0333)        # 嘉明湖湖畔
STEP_M = 50                       # 重新取樣間距
PHOTO_MAX_ERR_M = 100             # GPS 誤差超過就不對位
PHOTO_MAX_OFF_M = 200             # 離路線太遠就不對位
UA = {'User-Agent': 'jiaming-lake-2026 travelogue'}

# 路線上的節點：(名稱, 緯度, 經度, 說明)。座標來自 OSM 或照片 GPS
WAYPOINTS = [
    ('戒茂斯登山口', 23.2273, 121.0081, '台20線 160.5K'),
    ('戒茂斯山前峰', 23.2298, 121.0091, ''),
    ('新武呂溪營地', 23.2485, 121.0112, '渡溪點；9/24、9/26 宿營'),
    ('足球場營地', 23.2608, 121.0207, ''),
    ('妹池營地', 23.2841, 121.0289, '9/25 宿營；位置依照片 GPS 估計'),
    ('嘉明湖', 23.2924, 121.0333, ''),
]


def hav(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def load_osm():
    if not OSM.exists():
        url = 'https://overpass-api.de/api/interpreter?' + urllib.parse.urlencode({'data': QUERY})
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
            OSM.write_bytes(r.read())
    return json.loads(OSM.read_text(encoding='utf8'))


def shortest_path(osm):
    nodes = {e['id']: (e['lat'], e['lon']) for e in osm['elements'] if e['type'] == 'node'}
    graph = {}
    for w in osm['elements']:
        if w['type'] != 'way' or 'highway' not in w.get('tags', {}):
            continue
        for a, b in zip(w['nodes'], w['nodes'][1:]):
            d = hav(nodes[a], nodes[b])
            graph.setdefault(a, []).append((b, d))
            graph.setdefault(b, []).append((a, d))
    src = min(graph, key=lambda n: hav(nodes[n], TRAILHEAD))
    dst = min(graph, key=lambda n: hav(nodes[n], LAKE))
    dist, prev, pq = {src: 0}, {}, [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in graph[u]:
            if d + w < dist.get(v, math.inf):
                dist[v] = d + w
                prev[v] = u
                heapq.heappush(pq, (d + w, v))
    path = [dst]
    while path[-1] != src:
        path.append(prev[path[-1]])
    return [nodes[n] for n in reversed(path)]


def resample(pts, step):
    out, carry = [pts[0]], 0.0
    for a, b in zip(pts, pts[1:]):
        seg = hav(a, b)
        pos = step - carry
        while pos <= seg:
            t = pos / seg
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            pos += step
        carry = (carry + seg) % step
    if hav(out[-1], pts[-1]) > 1:
        out.append(pts[-1])
    return out


def elevations(pts):
    eles = []
    for i in range(0, len(pts), 100):
        chunk = pts[i:i + 100]
        url = 'https://api.open-meteo.com/v1/elevation?' + urllib.parse.urlencode({
            'latitude': ','.join(f'{p[0]:.6f}' for p in chunk),
            'longitude': ','.join(f'{p[1]:.6f}' for p in chunk),
        })
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            eles += json.load(r)['elevation']
    return eles


def locate(pts, p):
    i = min(range(len(pts)), key=lambda k: hav(pts[k], p))
    return i, hav(pts[i], p)


def main():
    osm = load_osm()
    path = shortest_path(osm)
    total = sum(hav(a, b) for a, b in zip(path, path[1:]))
    pts = resample(path, STEP_M)
    # 取樣點沿原始路線每 STEP_M 一個，距離用原始路線長度算，避免截彎取直而變短
    cum = [min(i * STEP_M, total) for i in range(len(pts))]
    cum[-1] = total
    ele = elevations(pts)

    waypoints = []
    for name, lat, lon, note in WAYPOINTS:
        i, _ = locate(pts, (lat, lon))
        waypoints.append({'name': name, 'dist': round(cum[i]), 'ele': round(ele[i]),
                          'lat': round(pts[i][0], 6), 'lon': round(pts[i][1], 6), 'note': note})

    photos = {}
    for r in json.loads(PHOTOS.read_text(encoding='utf8')):
        if 'lat' not in r or r.get('gps_err_m', 0) > PHOTO_MAX_ERR_M:
            continue
        i, off = locate(pts, (r['lat'], r['lon']))
        if off <= PHOTO_MAX_OFF_M:
            photos[r['id']] = round(cum[i])

    nodes = {e['id']: (e['lat'], e['lon']) for e in osm['elements'] if e['type'] == 'node'}
    lake = next(e for e in osm['elements']
                if e['type'] == 'way' and e.get('tags', {}).get('name') == '嘉明湖')
    peaks = [{'name': e['tags']['name'], 'ele': int(e['tags']['ele']), 'lat': e['lat'], 'lon': e['lon']}
             for e in osm['elements']
             if e['type'] == 'node' and e.get('tags', {}).get('natural') == 'peak' and 'ele' in e['tags']]

    out = {
        'sources': {
            'route': '© OpenStreetMap contributors (ODbL)',
            'elevation': 'Copernicus DEM GLO-90 via Open-Meteo Elevation API',
        },
        'length_m': round(cum[-1]),
        'gain_m': round(sum(max(b - a, 0) for a, b in zip(ele, ele[1:]))),
        'loss_m': round(sum(max(a - b, 0) for a, b in zip(ele, ele[1:]))),
        # [經度, 緯度, 海拔 m, 累積距離 m]
        'points': [[round(p[1], 6), round(p[0], 6), round(e), round(d)]
                   for p, e, d in zip(pts, ele, cum)],
        'waypoints': waypoints,
        'peaks': peaks,
        'lake': [[round(nodes[n][1], 6), round(nodes[n][0], 6)] for n in lake['nodes']],
        'photo_dist': photos,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf8')
    print(f"{out['length_m']} m, +{out['gain_m']} m, -{out['loss_m']} m, {len(photos)} photos located")


if __name__ == '__main__':
    main()
