"""Make the reviewed 30-second source into seven actions and a writing cycle.

Usage: python prepare-continuous-media.py whalegirl_video.mp4 [--output directory]
Requires av, opencv-python, numpy, Pillow and imageio-ffmpeg during development.
Cut points belong to the reviewed source hash, not to arbitrary generated videos.
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


SOURCE_SHA256 = '160ab279c8656465b0d406e8ce63a3b43e1307db9351bcbd93a51d5187beead3'
WIDTH, HEIGHT, FPS = 288, 384, 24
IDLE_HOLD_FRAMES = 3 * FPS
REST_HOLD_FRAME, REST_HOLD_FRAMES = 672, 60
# Half-open source-frame ranges. Consecutive actions share a seated boundary.
RANGES = {
    'idle': (0, 47),
    'thinking': (47, 134),
    'writing': (134, 387),
    'complete': (387, 439),
    'interact': (439, 519),
    'waiting': (519, 606),
    'rest': (606, 720),
    'writing-enter': (134, 235),
    'writing-loop': (235, 283),
    'writing-exit': (283, 387),
}


def matte(rgb):
    """Key the uniform green while retaining detached strands of the forelock."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    background = (hsv[:, :, 0] >= 32) & (hsv[:, :, 0] <= 94) & (hsv[:, :, 1] > 18)
    foreground = (~background).astype(np.uint8)
    count, components, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    # The reviewed source has no overlaid text. Keep small intentional hair detail;
    # selecting only the largest component would intermittently delete the forelock.
    keep = np.zeros(count, np.uint8)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= 8
    foreground = keep[components]
    alpha = cv2.GaussianBlur(foreground * 255, (3, 3), .45)
    boundary = (cv2.dilate(foreground, np.ones((3, 3), np.uint8))
                - cv2.erode(foreground, np.ones((3, 3), np.uint8))) > 0
    color = rgb.copy()
    spill = boundary & (color[:, :, 1] > color[:, :, 2])
    color[:, :, 1][spill] = np.minimum(color[:, :, 0], color[:, :, 2])[spill]
    color[alpha == 0] = 0
    return np.asarray(Image.fromarray(np.dstack([color, alpha])).resize(
        (WIDTH, HEIGHT), Image.Resampling.LANCZOS))


def encode(output, name, frames):
    target = output / (name + '.webm')
    command = [imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-y',
               '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{WIDTH}x{HEIGHT}',
               '-r', str(FPS), '-i', '-', '-an', '-c:v', 'libvpx-vp9',
               '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '34', '-deadline', 'good',
               '-cpu-used', '4', '-row-mt', '1', '-auto-alt-ref', '0', str(target)]
    with subprocess.Popen(command, stdin=subprocess.PIPE) as proc:
        try:
            for frame in frames:
                proc.stdin.write(frame.tobytes())
        finally:
            proc.stdin.close()
        if proc.wait():
            raise RuntimeError('FFmpeg failed: ' + name)
    start, end = RANGES[name]
    return {'file': target.name, 'frames': len(frames), 'duration': len(frames) / FPS,
            'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
            'end_hold_frames': IDLE_HOLD_FRAMES if name == 'idle' else 0,
            'closed_eye_hold_frames': REST_HOLD_FRAMES if name == 'rest' else 0,
            'source_frames': [start, end], 'source_seconds': [start / FPS, end / FPS]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'assets')
    args = parser.parse_args()
    digest = hashlib.sha256(args.source.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        parser.error('Source differs from the reviewed video; review and update cut points first.')
    frames = []
    with av.open(str(args.source)) as container:
        stream = container.streams.video[0]
        if (stream.width, stream.height, float(stream.average_rate)) != (834, 1112, FPS):
            raise ValueError('Unexpected source dimensions or frame rate')
        for frame in container.decode(video=0):
            frames.append(matte(frame.to_ndarray(format='rgb24')))
    if len(frames) != 721:
        raise ValueError(f'Incomplete source decode: {len(frames)} frames')
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {
        'version': 1, 'width': WIDTH, 'height': HEIGHT, 'fps': FPS,
        'assets': {}, 'sources': [{'name': args.source.name, 'sha256': digest, 'frames': len(frames)}],
        'processing': {
            'script': Path(__file__).name,
            'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'av': av.__version__, 'opencv': cv2.__version__, 'numpy': np.__version__,
            'ffmpeg': imageio_ffmpeg.get_ffmpeg_version(),
            'alignment': 'one fixed source canvas, uniform resize; no lower-body replacement',
            'writing_loop': 'natural forward frames 235..282, no blend or reverse',
            'idle': 'hold the open-eye seated endpoint for 3 seconds; preserve blink speed',
            'rest': 'hold closed-eye source frame 672 for an additional 2.5 seconds',
            'detached_detail_regions': [
                {'name': 'forelock', 'bounds': [80, 12, 160, 66], 'max_area': 220},
            ],
            'limitations': ['source tail tip touches and is slightly clipped at the right edge',
                            'natural loop endpoints are similar, not pixel-identical'],
        },
    }
    hit = np.zeros((HEIGHT // 4, WIDTH // 4), dtype=bool)
    for frame in frames[:720]:
        hit |= cv2.resize(frame[:, :, 3], (WIDTH // 4, HEIGHT // 4), interpolation=cv2.INTER_AREA) > 100
    for name, (start, end) in RANGES.items():
        items = frames[start:end]
        if name == 'idle':
            items = items + [frames[end - 1]] * IDLE_HOLD_FRAMES
        elif name == 'rest':
            split = REST_HOLD_FRAME - start + 1
            items = items[:split] + [frames[REST_HOLD_FRAME]] * REST_HOLD_FRAMES + items[split:]
        manifest['assets'][name] = encode(args.output, name, items)
        print(f'{name}: {len(items)} frames, {manifest["assets"][name]["bytes"]} bytes', flush=True)
    poster = args.output / 'poster.png'
    Image.fromarray(frames[47]).save(poster)
    manifest['poster'] = {'file': poster.name, 'sha256': hashlib.sha256(poster.read_bytes()).hexdigest()}
    rects = []
    for y, row in enumerate(hit):
        edges = np.diff(np.r_[False, row, False].astype(np.int8))
        for start, end in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)):
            rects.append(f'M{int(start)*4},{y*4}h{int(end-start)*4}v4h{-int(end-start)*4}z')
    manifest['hitPath'] = ''.join(rects)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
