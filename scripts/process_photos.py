"""把 raw/<拍攝者>/ 的原始照片轉成網頁用的 AVIF 與 WebP，並產出 data/photos.json。

用法（在專案根目錄）：python scripts/process_photos.py
- 輸出的圖檔不含 EXIF；時間與位置只寫進 data/photos.json
- scripts/hold.txt 列出的照片只記錄資料，不輸出圖檔
"""
import json
import os
import re
import base64
import io
import struct
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'raw'
OUT = ROOT / 'public' / 'photos'
DATA = ROOT / 'data' / 'photos.json'
HOLD = ROOT / 'scripts' / 'hold.txt'
WIDTHS = (480, 960, 1600)   # 直式照片不輸出 1600，版面上用不到那麼寬
# 新瀏覽器拿 AVIF，不支援的退回 WebP
FORMATS = (('avif', 'AVIF', {'quality': 45}), ('webp', 'WEBP', {'quality': 68, 'method': 6}))
TAIPEI = timezone(timedelta(hours=8))


def dms(v, ref):
    d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
    return -d if ref in ('S', 'W') else d


def photo_meta(im):
    e = im.getexif()
    x = e.get_ifd(0x8769)
    g = e.get_ifd(0x8825)
    t = x.get(36867) or e.get(306)
    m = {'time': t.replace(':', '-', 2) if t else None}
    if 2 in g and 4 in g:
        m['lat'] = round(dms(g[2], g.get(1)), 6)
        m['lon'] = round(dms(g[4], g.get(3)), 6)
        if 6 in g:
            m['alt'] = round(float(g[6]), 1)
        if 31 in g:
            m['gps_err_m'] = round(float(g[31]), 1)
    return m


def atoms(f, start, end):
    f.seek(start)
    while f.tell() < end:
        pos = f.tell()
        hdr = f.read(8)
        if len(hdr) < 8:
            return
        size, typ = struct.unpack('>I4s', hdr)
        hl = 8
        if size == 1:
            size = struct.unpack('>Q', f.read(8))[0]
            hl = 16
        elif size == 0:
            size = end - pos
        yield typ, pos + hl, pos + size
        f.seek(pos + size)


def video_meta(path):
    m = {}
    with open(path, 'rb') as f:
        for t, s, e in atoms(f, 0, os.path.getsize(path)):
            if t != b'moov':
                continue
            for t2, s2, e2 in atoms(f, s, e):
                if t2 == b'mvhd':
                    f.seek(s2)
                    ver = f.read(1)[0]
                    f.read(3)
                    if ver == 1:
                        _, _, ts, dur = struct.unpack('>QQIQ', f.read(28))
                    else:
                        _, _, ts, dur = struct.unpack('>IIII', f.read(16))
                    m['dur_s'] = round(dur / ts, 1)
                if t2 == b'meta':
                    keys, vals = [], {}
                    for t3, s3, e3 in atoms(f, s2, e2):
                        if t3 == b'keys':
                            f.seek(s3 + 4)
                            n = struct.unpack('>I', f.read(4))[0]
                            for _ in range(n):
                                ks = struct.unpack('>I', f.read(4))[0]
                                f.read(4)
                                keys.append(f.read(ks - 8).decode('utf8', 'ignore'))
                        if t3 == b'ilst':
                            for t4, s4, e4 in atoms(f, s3, e3):
                                idx = struct.unpack('>I', t4)[0]
                                for t5, s5, e5 in atoms(f, s4, e4):
                                    if t5 == b'data':
                                        f.seek(s5 + 8)
                                        vals[idx] = f.read(e5 - s5 - 8).decode('utf8', 'ignore')
                    for i, k in enumerate(keys, 1):
                        v = vals.get(i)
                        if v is None:
                            continue
                        if k.endswith('creationdate'):
                            t = datetime.strptime(v.replace('Z', '+0000'), '%Y-%m-%dT%H:%M:%S%z')
                            m['time'] = t.astimezone(TAIPEI).strftime('%Y-%m-%d %H:%M:%S')
                        if k.endswith('location.ISO6709'):
                            mm = re.match(r'([+-][\d.]+)([+-][\d.]+)([+-][\d.]+)?', v)
                            if mm:
                                m['lat'] = float(mm.group(1))
                                m['lon'] = float(mm.group(2))
                                if mm.group(3):
                                    m['alt'] = round(float(mm.group(3)), 1)
    return m


def main():
    hold = {l.strip() for l in HOLD.read_text(encoding='utf8').splitlines()
            if l.strip() and not l.startswith('#')}
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for owner_dir in sorted(p for p in RAW.iterdir() if p.is_dir()):
        owner = owner_dir.name
        files = sorted(owner_dir.iterdir())
        stills = {p.stem for p in files if p.suffix.upper() in ('.HEIC', '.JPG', '.JPEG')}
        for p in files:
            ext = p.suffix.upper()
            key = f'{owner}/{p.stem}'
            if ext in ('.HEIC', '.JPG', '.JPEG'):
                im = Image.open(p)
                row = {'id': f'{owner}-{p.stem}', 'owner': owner, 'type': 'photo', **photo_meta(im)}
                im = ImageOps.exif_transpose(im).convert('RGB')
                row['w'], row['h'] = im.size
                row['live'] = (owner_dir / f'{p.stem}.MOV').exists()
                row['published'] = key not in hold
                if row['published']:
                    row['widths'] = [w for w in WIDTHS if w <= 960 or im.width > im.height]
                    for w in row['widths']:
                        r = im.copy()
                        r.thumbnail((w, w * 4))
                        for ext, fmt, opts in FORMATS:
                            dst = OUT / f"{row['id']}-{w}.{ext}"
                            if not dst.exists():
                                r.save(dst, fmt, **opts)
                    # 極小的模糊預覽圖，直接寫進資料檔，照片下載完成前先顯示
                    tiny = im.copy()
                    tiny.thumbnail((24, 24))
                    buf = io.BytesIO()
                    tiny.save(buf, 'WEBP', quality=40)
                    row['lqip'] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
                rows.append(row)
            elif ext == '.MOV' and p.stem not in stills:
                rows.append({'id': f'{owner}-{p.stem}', 'owner': owner, 'type': 'video',
                             'published': False, **video_meta(p)})
    rows.sort(key=lambda r: (r.get('time') or '', r['id']))
    DATA.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n', encoding='utf8')
    keep = {f"{r['id']}-{w}.{ext}" for r in rows for w in r.get('widths', []) for ext, _, _ in FORMATS}
    for f in OUT.iterdir():
        if f.name not in keep:
            f.unlink()
    for ext, _, _ in FORMATS:
        size = sum(f.stat().st_size for f in OUT.glob(f'*.{ext}')) / 1e6
        print(f'{ext}: {len(list(OUT.glob(f"*.{ext}")))} files, {size:.1f} MB')


if __name__ == '__main__':
    sys.exit(main())
