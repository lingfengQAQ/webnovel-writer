"""Rebuild transparent companion media. Requires av, cv2, numpy, Pillow, imageio-ffmpeg.

Usage: python prepare-media.py <downloaded-originals-directory> [--sample]
Tools are only used during development, never during plugin installation.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import av
import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('originals', type=Path)
parser.add_argument('--sample', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = root / 'assets'
output.mkdir(exist_ok=True)
width, height, fps = 288, 384, 18
names = ['idle', 'thinking', 'writing', 'complete', 'interact', 'waiting', 'rest']

def key(rgb):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    background = (hsv[:, :, 0] >= 32) & (hsv[:, :, 0] <= 94) & (hsv[:, :, 1] > 18)
    candidate = (~background).astype(np.uint8)
    count, components, stats, _ = cv2.connectedComponentsWithStats(candidate, 8)
    largest = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    foreground = (components == largest).astype(np.uint8)
    # Keep connected character detail, excluding detached shadows, lettering and specks.
    support = cv2.dilate(foreground, np.ones((3, 3), np.uint8))
    alpha = candidate * support * 255
    alpha = cv2.GaussianBlur(alpha, (3, 3), .45)
    color = rgb.copy()
    # Green contaminated boundary pixels are replaced with nearby foreground color.
    boundary = (cv2.dilate(foreground, np.ones((3, 3), np.uint8)) - cv2.erode(foreground, np.ones((3, 3), np.uint8))) > 0
    spill = boundary & (color[:, :, 1] > color[:, :, 2])
    color[:, :, 1][spill] = np.minimum(color[:, :, 0], color[:, :, 2])[spill]
    color[alpha == 0] = 0
    return np.dstack([color, alpha])

from PIL import ImageDraw, ImageFont
font = ImageFont.truetype('arialbd.ttf', 40)
logo = Image.new('L', (155, 55))
ImageDraw.Draw(logo).text((2, -2), 'Dola AI', font=font, fill=255)
logo = np.array(logo)
ys, xs = np.where(logo > 0)
logo = np.pad(logo[ys.min():ys.max()+1, xs.min():xs.max()+1], 4)
flow_engine = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_FAST)

def clean_watermark(rgb, reference):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    top = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, np.ones((35, 35), np.uint8))
    match = cv2.matchTemplate(top, logo, cv2.TM_CCOEFF_NORMED)
    _, score, _, (x, y) = cv2.minMaxLoc(match)
    if score < .40:
        return rgb
    h, w = logo.shape
    mask = np.zeros(gray.shape, np.uint8)
    mask[y:y+h, x:x+w] = cv2.dilate((logo > 8).astype(np.uint8) * 255, np.ones((5, 5), np.uint8))
    # Estimate motion with the lettering inpainted, then borrow the clean first-frame
    # pixels through that motion field. This preserves line art under moving logos.
    provisional = cv2.inpaint(rgb, mask, 3, cv2.INPAINT_TELEA)
    current = cv2.resize(cv2.cvtColor(provisional, cv2.COLOR_RGB2GRAY), None, fx=.5, fy=.5)
    clean = cv2.resize(cv2.cvtColor(reference, cv2.COLOR_RGB2GRAY), None, fx=.5, fy=.5)
    flow = cv2.resize(flow_engine.calc(current, clean, None), (rgb.shape[1], rgb.shape[0])) * 2
    yy, xx = np.mgrid[:rgb.shape[0], :rgb.shape[1]].astype(np.float32)
    warped = cv2.remap(reference, xx + flow[:, :, 0], yy + flow[:, :, 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    blend = cv2.GaussianBlur(mask.astype(np.float32) / 255, (5, 5), .8)[:, :, None]
    return np.uint8(rgb * (1 - blend) + warped * blend)

with av.open(str(next(args.originals.glob('01_*.mp4')))) as container:
    base_rgb = next(container.decode(video=0)).to_ndarray(format='rgb24')
base_rgba = key(base_rgb)
base_height, base_width = base_rgb.shape[:2]
sift = cv2.SIFT_create(nfeatures=2500)
face_mask = np.zeros((base_height, base_width), np.uint8)
face_mask[75:420, 200:680] = 255
base_points, base_descriptors = sift.detectAndCompute(cv2.cvtColor(base_rgb, cv2.COLOR_RGB2GRAY), face_mask)
base_bottom = int(np.where(base_rgba[:, :, 3] > 128)[0].max())

def registration(reference, name):
    points, descriptors = sift.detectAndCompute(cv2.cvtColor(reference, cv2.COLOR_RGB2GRAY), face_mask)
    pairs = cv2.BFMatcher().knnMatch(descriptors, base_descriptors, k=2)
    good = [a for a, b in pairs if a.distance < .7 * b.distance]
    src = np.float32([points[m.queryIdx].pt for m in good])
    dst = np.float32([base_points[m.trainIdx].pt for m in good])
    matrix, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3)
    if matrix is None or int(inliers.sum()) < 30:
        raise ValueError('Cannot reliably align ' + name)
    first = cv2.warpAffine(key(reference), matrix, (base_width, base_height))
    bottom = int(np.where(first[:, :, 3] > 128)[0].max())
    # Match head scale first, then preserve the shared seated foot baseline.
    yy, xx = np.mgrid[:base_height, :base_width].astype(np.float32)
    if name != 'thinking':
        yy = np.where(yy > 430, 430 + (yy - 430) * (bottom - 430) / (base_bottom - 430), yy).astype(np.float32)
    return matrix, xx, yy

def normalize(rgba, matrix, xx, yy, name):
    warped = cv2.warpAffine(rgba, matrix, (base_width, base_height))
    warped = cv2.remap(warped, xx, yy, cv2.INTER_LINEAR)
    if name == 'thinking':
        # Preserve the idle lower body: the cropped moving legs otherwise leave
        # a seam, and a blurred watermark fades in over the source's bottom edge.
        # Upper-body thought/eye motion stays from the supplied thinking clip.
        weight = (1 - np.clip((yy - 620) / 120, 0, 1))[:, :, None]
        warped = np.uint8(warped * weight + base_rgba * (1 - weight))
    return Image.fromarray(warped).resize((width, height), Image.Resampling.LANCZOS)

def encode(name, frames):
    target = output / (name + '.webm')
    command = [imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{width}x{height}', '-r', str(fps), '-i', '-',
        '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '38',
        '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-auto-alt-ref', '0', str(target)]
    with subprocess.Popen(command, stdin=subprocess.PIPE) as proc:
        try:
            for frame in frames:
                proc.stdin.write(frame.tobytes())
        finally:
            proc.stdin.close()
        if proc.wait():
            raise RuntimeError('FFmpeg failed: ' + name)
    return {'file': target.name, 'frames': len(frames), 'duration': len(frames) / fps,
        'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}

manifest = {'version': 1, 'width': width, 'height': height, 'fps': fps, 'assets': {}, 'sources': [],
    'processing': {'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'av': av.__version__, 'opencv': cv2.__version__, 'numpy': np.__version__,
        'thinking_lower_body': 'approved idle base, feathered across source y=620..740'}}
hit = np.zeros((height // 4, width // 4), dtype=bool)
for i, name in enumerate(names, 1):
    if args.sample and i > 1:
        break
    source = next(args.originals.glob(f'{i:02d}_*.mp4'))
    with av.open(str(source)) as container:
        frames = []
        reference = None
        for frame in container.decode(video=0):
            if float(frame.time or 0) + 0.0001 >= len(frames) / fps:
                rgb = frame.to_ndarray(format='rgb24')
                if reference is None:
                    reference = rgb
                    matrix, xx, yy = registration(reference, name)
                frames.append(normalize(key(clean_watermark(rgb, reference)), matrix, xx, yy, name))
    manifest['sources'].append({'name': source.name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
    manifest.setdefault('alignment', {})[name] = {'matrix': matrix.tolist(), 'head_reference': 'idle', 'feet_baseline': base_bottom, 'cropped_source_patch': name == 'thinking'}
    preview = Image.new('RGB', (width * 3, height), '#eef0f4')
    for j, frame in enumerate([frames[0], frames[len(frames)//2], frames[-1]]):
        preview.paste(frame, (j * width, 0), frame)
    preview.save(root / f'normalized-{name}.jpg')
    for frame in frames:
        hit |= np.asarray(frame.getchannel('A').resize((width//4, height//4), Image.Resampling.BOX)) > 100
    manifest['assets'][name] = encode(name, frames)
    if name == 'idle':
        frames[0].save(output / 'poster.png')
        # Diagnostic composites are deliberately outside the installable assets.
        for color, suffix in [('#f5f5f7', 'light'), ('#20232b', 'dark')]:
            background = Image.new('RGBA', (width, height), color)
            background.alpha_composite(frames[0])
            background.convert('RGB').save(root / f'matte-{suffix}.jpg')
    if name == 'writing':
        # Stable writing section, checked against the supplied 15s video.
        start, end = 4 * fps, 10 * fps
        enter, loop, leave = frames[:start], frames[start:end], frames[end:]
        # Blend the last 8 frames toward the first 8 for a continuous motion loop.
        blend = 8
        for j in range(blend):
            loop[-blend+j] = Image.blend(loop[-blend+j], loop[j], (j+1)/(blend+1))
        for part, items in [('writing-enter', enter), ('writing-loop', loop), ('writing-exit', leave)]:
            manifest['assets'][part] = encode(part, items)
    print(name + ': ' + str(manifest['assets'][name]['bytes']), flush=True)
manifest['poster'] = {'file': 'poster.png', 'sha256': hashlib.sha256((output/'poster.png').read_bytes()).hexdigest()}
rects = []
for y, row in enumerate(hit):
    padded = np.r_[False, row, False].astype(np.int8)
    starts = np.flatnonzero(np.diff(padded) == 1)
    ends = np.flatnonzero(np.diff(padded) == -1)
    for a, b in zip(starts, ends):
        rects.append(f'M{int(a)*4},{y*4}h{int(b-a)*4}v4h{-int(b-a)*4}z')
manifest['hitPath'] = ''.join(rects)
(output/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
