"""Decode shipped VP9 alpha frames, check integrity and create visual review sheets.

Usage: python verify-media.py <evidence-directory>
Requires numpy, Pillow, opencv-python and imageio-ffmpeg on the development machine.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
evidence = Path(sys.argv[1])
evidence.mkdir(parents=True, exist_ok=True)
manifest = json.loads((root / 'assets/manifest.json').read_text(encoding='utf-8'))
width, height = manifest['width'], manifest['height']
report = {'assets': {}, 'visual_review_required': True}
detail_regions = manifest.get('processing', {}).get('detached_detail_regions', [])
for region in detail_regions:
    x0, y0, x1, y1 = region['bounds']
    assert 0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height, region
    assert 0 < region['max_area'] <= width * height * .002, region
rows = []
for name, record in manifest['assets'].items():
    source = root / 'assets' / record['file']
    assert hashlib.sha256(source.read_bytes()).hexdigest() == record['sha256'], name
    raw = subprocess.check_output([
        imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error',
        '-c:v', 'libvpx-vp9', '-i', str(source), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width, 4)
    assert len(frames) == record['frames'], (name, len(frames))
    green_counts, detached_counts, detail_counts, bounds = [], [], [], []
    for frame in frames:
        rgb = frame[:, :, :3].astype(np.int16)
        opaque = frame[:, :, 3] > 200
        green = opaque & (rgb[:, :, 1] > np.maximum(rgb[:, :, 0], rgb[:, :, 2]) + 35)
        green_counts.append(int(green.sum()))
        count, labels, stats, _ = cv2.connectedComponentsWithStats(opaque.astype(np.uint8), 8)
        order = np.argsort(stats[1:, cv2.CC_STAT_AREA])[::-1] + 1
        detached, detail = 0, 0
        for index in order[1:]:
            x, y, w, h, area = stats[index]
            if area <= 4:
                continue
            # Source-reviewed, bounded regions preserve intentional detached strands.
            # Report them separately; every other component retains the strict gate.
            intentional = any(
                x >= r['bounds'][0] and y >= r['bounds'][1]
                and x + w <= r['bounds'][2] and y + h <= r['bounds'][3]
                and area <= r['max_area'] for r in detail_regions)
            if intentional:
                detail += int(area)
            else:
                detached += int(area)
        detached_counts.append(detached)
        detail_counts.append(detail)
        ys, xs = np.where(opaque)
        assert len(xs) > width * height * .1, (name, 'empty foreground')
        bounds.append([int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
        assert np.max(frame[:4, :4, 3]) == 0, (name, 'opaque corner')
    report['assets'][name] = {
        'frames': len(frames), 'first_bounds': bounds[0],
        'max_green_pixels': max(green_counts), 'max_detached_pixels': max(detached_counts),
        'max_reviewed_detail_pixels': max(detail_counts),
        'worst_green_frame': int(np.argmax(green_counts)),
    }
    assert max(green_counts) < 20, (name, 'green spill', max(green_counts))
    if name != 'writing-loop':
        assert max(detached_counts) < 25, (name, 'detached foreground / crop seam')
    if name.startswith('writing-'):
        continue
    # First/middle/last alone can miss the moving watermark: sample the whole clip.
    sheet = Image.new('RGB', (width * 6, (height + 25) * 2))
    for j, index in enumerate(np.linspace(0, len(frames) - 1, 12).astype(int)):
        tile = Image.new('RGBA', (width, height + 25), '#eef0f4' if j % 2 == 0 else '#20232b')
        tile.alpha_composite(Image.fromarray(frames[index]), (0, 25))
        ImageDraw.Draw(tile).text((8, 5), f'{name} / frame {index}', fill='#57667f' if j % 2 == 0 else 'white')
        sheet.paste(tile.convert('RGB'), ((j % 6) * width, (j // 6) * (height + 25)))
    sheet.save(evidence / f'media-{name}.jpg', quality=95)
    sheet.thumbnail((864, 410))
    rows.append(sheet)
overview = Image.new('RGB', (864, sum(row.height for row in rows)), 'white')
y = 0
for row in rows:
    overview.paste(row, (0, y))
    y += row.height
overview.save(evidence / 'media-overview.jpg', quality=95)
(evidence / 'media-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
