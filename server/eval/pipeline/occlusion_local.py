"""Requirement 3, given a first number with a local model and no key.

`CLAUDE.md` names four separately measurable things and the third has never had a figure:
items hidden under other items must be flagged so the shopper is asked to move them.

The geometric half cannot supply one. `covered()` in `src/engine/liveVision/occlusion.ts`
measures how much of a *detected* box is hidden by other *detected* boxes, so it protects an item
the detector found and something else sits on. It is structurally unable to report the case that
matters here: the Fuji and yellow produce bags under the shopper's tote on IMG_0254, which are
never detected at all and therefore have no subject box to score. For those, the census's
`occlusion.itemsLikelyHidden` is the only channel there is.

This asks a local Qwen2-VL that one question about each photograph. It is not the shipped prompt
and not the shipped model, so it cannot say what the service would answer. It can say whether the
signal is present in the picture at all, which is the prior question and the cheaper one.

    KART_VLM=Qwen/Qwen2.5-VL-3B-Instruct server/.venv/bin/python \
      server/eval/pipeline/occlusion_local.py
"""
import json, os, pathlib
from PIL import Image, ImageOps

import vlm

MODEL = os.environ.get("KART_VLM", "Qwen/Qwen2-VL-2B-Instruct")
Q = ("Look at this shopping cart. Is any grocery item hidden underneath or behind another item, "
     "so that you cannot see all of it? Answer YES or NO only.")

# What the corpus says the answer should be. The two loaded trolleys hide goods under a shopper's
# woven tote and under each other; the sparse ones hold one to three items in an open basket. The
# shelves are not carts at all, and are asked anyway to see whether the question itself leaks.
EXPECT = {"IMG_0244": False, "IMG_0245": False, "IMG_0246": False, "IMG_0249": False,
          "IMG_0252": True, "IMG_0254": True,
          "IMG_0247": None, "IMG_0248": None, "IMG_0250": None, "IMG_0251": None}

HERE = pathlib.Path(__file__).parent.parent
backend = vlm.load(MODEL)
print(f"model {MODEL}\n")
right = scorable = 0
rows = {}
for pid, expected in EXPECT.items():
    img = ImageOps.exif_transpose(Image.open(HERE / f".cache/kart/images/{pid}.jpg")).convert("RGB")
    img.thumbnail((1333, 1333))
    said = backend.ask(img, Q, tokens=8).strip().upper()
    yes = said.startswith("YES")
    rows[pid] = yes
    if expected is None:
        print(f"  {pid}  said {'HIDDEN' if yes else 'clear ':6}  (shelf, not scored)")
        continue
    scorable += 1
    ok = yes == expected
    right += ok
    print(f"  {pid}  said {'HIDDEN' if yes else 'clear ':6}  expected "
          f"{'HIDDEN' if expected else 'clear ':6}  {'ok' if ok else 'X'}")
print(f"\n  {right}/{scorable} trolleys judged correctly")
(HERE / ".cache/kart/occlusion-local.json").write_text(json.dumps(rows, indent=1))
