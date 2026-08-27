#!/usr/bin/env python3
"""
Turns one still photograph of a real loaded cart into a handheld video clip, so the frame
processor can be driven from something with a time axis instead of a single frozen image.

Why this exists
---------------
`assets/dev/cart-lab-sample.png` proves the plugin decodes a buffer and finds instances. It
cannot prove anything about the parts of this app that only exist across frames: motion, the
sharpness distribution the adaptive blur floor is drawn from, the pacing interval, the
scene-change rule, or the two-gate handshake where JavaScript decides on frame N and native
re-tests on frame N+1. Every one of those needs a sequence, and until now the only sequence
available was a phone in a hand.

What the clip contains
----------------------
A scripted camera path with the three regimes a real scan actually has, so a replay produces
frames the gate is supposed to reject as well as frames it is supposed to accept. A clip that
was steady throughout would pass a gate that had been deleted.

  sweep   fast pan, heavy motion blur          the gate must hold these
  settle  deceleration into a framing          borderline by construction
  hold    near-still with handheld jitter      the gate must fire in here

Motion blur is integrated rather than filtered: each output frame is the mean of `SUBSAMPLES`
crops taken along the path across one shutter interval, which is what a real shutter does and
what makes `FrameMetrics.sharpness` fall on the fast segments for the same reason it falls on a
phone. A Gaussian blur applied afterwards would dim sharpness without any relationship to how
fast the camera was moving, and the blur floor would then be measuring the filter.

The sidecar
-----------
Alongside the clip, a JSON file records each frame's regime and the path speed that produced it.
`server/eval/replay` scores a replay report against it: "the gate fired inside a hold segment"
is a claim with ground truth behind it, where "the gate fired" on its own is not.

Usage
-----
    python3 scripts/make-replay-clip.py ov-a1c7f353-1d8
    python3 scripts/make-replay-clip.py --list
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
CARTS = REPO / "server" / "eval" / "corpus" / "carts"
CURATION = REPO / "server" / "eval" / "corpus" / "cart-curation.json"
OUT_DIR = REPO / "server" / "eval" / "corpus" / "replay"

# Matched to what a real device reported through the on-screen debug overlay: the frame processor
# on an iPhone 15 receives 1080x1920. A replay at any other size would exercise different tile
# geometry inside FrameMetrics and a different mask resolution inside Vision, so the numbers it
# produced could not be compared against the numbers from a phone.
WIDTH, HEIGHT = 1080, 1920
FPS = 30

# How much of one frame interval the shutter is open for. 0.5 is the 180-degree shutter that
# phone cameras approximate in daylight; it sets how much blur a given pan speed produces.
SHUTTER = 0.5
SUBSAMPLES = 8


@dataclass(frozen=True)
class Waypoint:
    """A framing to be at, and how the path should arrive there."""

    t: float
    # Pan position in units of available slack, -1 to 1, before jitter.
    x: float
    y: float
    regime: str


# One scripted scan: four framings of the cart, each reached by a whip-pan and then held.
#
# The sweeps are short and fast on purpose. An earlier version spread the same travel over
# seconds, and the two regimes came out indistinguishable: sweep frames measured a median 11.4
# pixels of travel against 5.1 in the holds, so the "blurry" frames and the "sharp" frames
# overlapped and the clip could not tell a working gate from a deleted one. Crossing the whole
# pan in about half a second is also what a hand actually does when it moves to look at
# something else, rather than gliding like a dolly.
#
# Each hold runs a little over two seconds, which is one `minIntervalMs` (keyframe.ts), so a
# correctly paced gate has room to fire exactly once inside each and no room to fire twice.
PATH = (
    Waypoint(0.0, -0.95, -0.60, "sweep"),
    Waypoint(0.7, 0.60, 0.25, "sweep"),
    Waypoint(1.0, 0.62, 0.28, "settle"),
    Waypoint(3.2, 0.62, 0.30, "hold"),
    Waypoint(3.8, -0.80, -0.35, "sweep"),
    Waypoint(4.1, -0.82, -0.38, "settle"),
    Waypoint(6.3, -0.80, -0.36, "hold"),
    Waypoint(6.9, 0.30, 0.62, "sweep"),
    Waypoint(7.2, 0.32, 0.65, "settle"),
    Waypoint(9.4, 0.30, 0.63, "hold"),
    Waypoint(9.9, -0.25, -0.70, "sweep"),
    Waypoint(10.2, -0.27, -0.72, "settle"),
    Waypoint(12.0, -0.25, -0.70, "hold"),
)

DURATION = PATH[-1].t

# Handheld tremor, in output pixels. Three frequencies because a real hand has a slow drift the
# arm cannot suppress and a fast tremor it cannot either; one sine alone reads as a machine.
# Amplitudes are small deliberately: at 1080 pixels wide, a hand holding still moves a few
# pixels, and a tremor large enough to rival the sweeps would put blur into the frames the gate
# is supposed to accept.
JITTER = (
    (2.9, 2.5, 0.0),  # hz, amplitude px, phase
    (6.7, 1.2, 1.7),
    (1.3, 3.5, 0.4),
)


def smoothstep(u: float) -> float:
    """Ease in and out, so the path has no instantaneous velocity steps a real arm cannot make."""
    u = min(1.0, max(0.0, u))
    return u * u * (3.0 - 2.0 * u)


def path_at(t: float) -> tuple[float, float, str]:
    """Pan position and the regime label in force, at time `t` seconds."""
    t = min(max(t, 0.0), DURATION)
    for a, b in zip(PATH, PATH[1:]):
        if t <= b.t:
            span = b.t - a.t
            u = smoothstep(0.0 if span <= 0 else (t - a.t) / span)
            return (a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, b.regime)
    last = PATH[-1]
    return (last.x, last.y, last.regime)


def jitter_at(t: float) -> tuple[float, float]:
    x = sum(amp * math.sin(2 * math.pi * hz * t + ph) for hz, amp, ph in JITTER)
    y = sum(amp * math.cos(2 * math.pi * hz * t * 0.83 + ph * 1.4) for hz, amp, ph in JITTER)
    return (x, y)


def load_source(image_path: Path) -> Image.Image:
    """
    The photograph, upscaled to cover the output frame with slack left over to pan across.

    The corpus tops out near one megapixel, so covering a 1080x1920 frame is already an upscale;
    `MARGIN` is deliberately small because every extra unit of pan room costs another unit of
    upscale, and an over-enlarged source would hand the detector a softness no phone produces.
    """
    MARGIN = 1.34
    src = Image.open(image_path).convert("RGB")
    scale = max(WIDTH * MARGIN / src.width, HEIGHT * MARGIN / src.height)
    size = (max(WIDTH + 2, round(src.width * scale)), max(HEIGHT + 2, round(src.height * scale)))
    return src.resize(size, Image.LANCZOS)


def render_frame(source: Image.Image, t: float) -> tuple[Image.Image, float]:
    """
    One output frame, and the path speed in pixels per frame that produced it.

    The frame is the mean of `SUBSAMPLES` crops spread across the open shutter, so a fast segment
    smears exactly as far as it travelled and a still segment does not smear at all.
    """
    slack_x = (source.width - WIDTH) / 2.0
    slack_y = (source.height - HEIGHT) / 2.0

    def centre(at: float) -> tuple[float, float]:
        px, py, _ = path_at(at)
        jx, jy = jitter_at(at)
        return (slack_x * (1.0 + px) + jx, slack_y * (1.0 + py) + jy)

    interval = 1.0 / FPS
    samples = [centre(t + (i / (SUBSAMPLES - 1) - 0.5) * SHUTTER * interval) for i in range(SUBSAMPLES)]

    acc = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    for cx, cy in samples:
        left = int(round(min(max(cx, 0.0), source.width - WIDTH)))
        top = int(round(min(max(cy, 0.0), source.height - HEIGHT)))
        acc += np.asarray(source.crop((left, top, left + WIDTH, top + HEIGHT)), dtype=np.float32)
    acc /= len(samples)

    before, after = centre(t - interval), centre(t)
    speed = math.hypot(after[0] - before[0], after[1] - before[1])
    return (Image.fromarray(acc.astype(np.uint8)), speed)


def curated_cart_ids() -> list[str]:
    return list(json.loads(CURATION.read_text())["cart"])


def build(cart_id: str) -> Path:
    image_path = CARTS / f"{cart_id}.jpg"
    if not image_path.exists():
        sys.exit(f"no such cart photograph: {image_path}\n(run server/eval/corpus/fetch_carts.py)")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    source = load_source(image_path)
    total = int(round(DURATION * FPS))
    frames = []

    staging = Path(tempfile.mkdtemp(prefix="kart-replay-"))
    try:
        for i in range(total):
            t = i / FPS
            image, speed = render_frame(source, t)
            image.save(staging / f"{i:05d}.jpg", quality=94, subsampling=0)
            frames.append({"index": i, "t": round(t, 4), "regime": path_at(t)[2],
                           "speedPxPerFrame": round(speed, 3)})
            if i % 30 == 0:
                print(f"  {i}/{total}", flush=True)

        clip = OUT_DIR / f"{cart_id}.mov"
        # `transpose=2` is a quarter turn anticlockwise, and it is the difference between a
        # replay that tests this app and one that tests a sideways version of it.
        #
        # The back camera's buffer is landscape even while the app is portrait-locked, and
        # `KartVisionFrameProcessorPlugin` corrects for that by pinning `.right` on every frame
        # it is handed. Feeding it upright portrait pixels would make it turn a correct image
        # into a wrong one, and the detector would then be measured against a cart lying on its
        # side. Storing the clip a quarter turn anticlockwise puts it in the same shape the
        # sensor produces, so the pin lands it upright, the frame reports 1080x1920 through the
        # same swap the device reports it through, and nothing downstream can tell the
        # difference.
        #
        # A rotation *tag* would not do: `AVAssetReaderTrackOutput` returns decoded pixels and
        # never applies a track's preferred transform, so the pixels themselves have to move.
        #
        # H.264 in yuv420p because that is what AVFoundation decodes on the Simulator without a
        # hardware path. `-g 1` makes every frame a keyframe: it costs bitrate and it buys the
        # certainty that no inter-frame prediction artefact is leaking into a blur measurement.
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
             "-i", str(staging / "%05d.jpg"), "-vf", "transpose=2",
             "-c:v", "libx264", "-preset", "slow",
             "-crf", "16", "-g", "1", "-pix_fmt", "yuv420p", str(clip)],
            check=True)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    sidecar = OUT_DIR / f"{cart_id}.frames.json"
    sidecar.write_text(json.dumps({
        "source": f"server/eval/corpus/carts/{cart_id}.jpg",
        "clip": clip.name,
        "displayWidth": WIDTH, "displayHeight": HEIGHT,
        # What AVAssetReader hands back, and what `Frame.width`/`Frame.height` therefore report,
        # before the plugin's `.right` pin swaps them back to display order.
        "storedWidth": HEIGHT, "storedHeight": WIDTH,
        "fps": FPS,
        "durationSeconds": DURATION,
        "shutter": SHUTTER,
        "note": "Regimes are the ground truth a replay report is scored against: the gate is "
                "expected to hold every sweep frame and to fire somewhere inside every hold. "
                "The clip is stored sensor-shaped (a quarter turn anticlockwise from display) "
                "so the plugin's pinned .right orientation lands it upright, as on a device.",
        "frames": frames,
    }, indent=1) + "\n")

    size_mb = clip.stat().st_size / 1e6
    print(f"{clip}  ({total} frames, {DURATION:.0f}s, {size_mb:.1f} MB)")
    print(f"{sidecar}")
    return clip


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cart_id", nargs="?", help="a cart id from cart-curation.json's cart tier")
    parser.add_argument("--list", action="store_true", help="print the curated cart ids and exit")
    parser.add_argument("--all", action="store_true", help="build a clip for every curated cart")
    args = parser.parse_args()

    if args.list:
        for cart_id in curated_cart_ids():
            present = "" if (CARTS / f"{cart_id}.jpg").exists() else "   (not fetched)"
            print(f"{cart_id}{present}")
        return

    if args.all:
        for cart_id in curated_cart_ids():
            if (CARTS / f"{cart_id}.jpg").exists():
                print(f"== {cart_id}")
                build(cart_id)
        return

    if not args.cart_id:
        parser.error("pass a cart id, or --list, or --all")
    build(args.cart_id)


if __name__ == "__main__":
    main()
