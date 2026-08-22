"""A census assembled from a local model, so the bag can be measured without a key.

The shipped census asks one question about a composite with numbered badges. A small model
cannot do that: measured on IMG_0249 it attached all three answers to the wrong badge. It can do
the same job asked differently, one crop at a time, where there is no badge to confuse and
alignment is exact by construction.

So this asks three questions instead of one:

  per crop   what is this, and is it a product a shopper is buying
  per frame  which products are in this trolley that no crop covered

and assembles the answers into the CensusResult shape `applyCensus` consumes. The cost is one
call per region rather than one per frame, which is why the shipped design does not do it. The
point here is a number for what the pipeline delivers with a real model in the loop and no key.
"""
import json, os, pathlib, re, sys
from PIL import Image, ImageOps

import vlm

# Overridable so the same three questions can be put to a bigger model without a second
# copy of this file. The 2B one names asparagus as brussels sprouts and a purple produce bag as
# a subway sandwich, and those two mistakes are the whole of the remaining count error.
MODEL = os.environ.get("KART_VLM", "Qwen/Qwen2-VL-2B-Instruct")
CARTS = ["IMG_0244", "IMG_0245", "IMG_0246", "IMG_0249", "IMG_0252", "IMG_0254"]
NAME_Q = ("What grocery product is this? Answer with the product name only, three words at most. "
          "If it is not a product a shopper is buying, answer NOT A PRODUCT.")
FRAME_Q = ("List every distinct grocery product you can see in this shopping trolley, one per "
           "line, name only. Do not list the trolley, the floor, bags, shoes or people.")

# Overridable for the same reason KART_VLM is: so one region set can be swapped for another
# without a second copy of this file. `KART_CENSUS_OUT` already pairs with it.
FRAMES = os.environ.get("KART_FRAMES", ".cache/kart/frames.json")
frames = {f["id"]: f for f in json.loads(pathlib.Path(FRAMES).read_text())["frames"]}
backend = vlm.load(MODEL)
ask = backend.ask

print(f"model {MODEL}, regions {FRAMES}", flush=True)
out = {}
for pid in CARTS:
    frame = frames[pid]
    pil = ImageOps.exif_transpose(Image.open(f".cache/kart/images/{pid}.jpg")).convert("RGB")
    pil.thumbnail((1333, 1333))
    W, H = pil.size
    marks = []
    for i, b in enumerate(frame["boxes"]):
        pad = 0.08
        crop = pil.crop((max(0, int((b["x"]-pad*b["w"])*W)), max(0, int((b["y"]-pad*b["h"])*H)),
                         min(W, int((b["x"]+b["w"]*(1+pad))*W)),
                         min(H, int((b["y"]+b["h"]*(1+pad))*H))))
        if crop.width < 16 or crop.height < 16:
            marks.append({"id": i, "name": "unreadable", "isProduct": False})
            continue
        said = ask(crop, NAME_Q)
        product = "not a product" not in said.lower()
        marks.append({"id": i, "name": said.lower().strip(". "), "isProduct": product})
    whole = pil.copy(); whole.thumbnail((1024, 1024))
    # Strip list markers, then drop what is left of a bare numbering line. Without the second
    # filter a reply of "1.\nOreo\n2.\nBread" counts the numbers as products, which is how an
    # earlier run of this file read 24 products off a reply that named 14.
    listed = [re.sub(r"^[-*\d.)\s]+", "", ln).strip().lower()
              for ln in ask(whole, FRAME_Q, tokens=220).splitlines() if ln.strip()]
    listed = [x for x in listed if x and not x.isdigit() and len(x) > 2]
    seen_names, unique = set(), []
    for name in listed:
        if name not in seen_names:
            seen_names.add(name)
            unique.append(name)
    out[pid] = {"marks": marks, "listed": unique}
    named = sum(1 for m in marks if m["isProduct"])
    print(f"  {pid}: {named}/{len(marks)} regions called products, "
          f"{len(out[pid]['listed'])} products listed for the whole frame", flush=True)
dest = pathlib.Path(os.environ.get("KART_CENSUS_OUT", ".cache/kart/census-local.json"))
dest.write_text(json.dumps(out, indent=1))
print(f"\nwrote {dest}")
