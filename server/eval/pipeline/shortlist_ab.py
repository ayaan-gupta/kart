"""Does offering the catalog shortlist change what a model calls a crop?

The seventy-eighth section measured that the correct SKU is in the top-5 shortlist for 21 of 22
labelled badges, and found a badge where it was offered at rank 2 and the census answered with a
category instead ("vegetables" for asparagus). That is the second clause of CLAUDE.md's closed-world
instruction, "does the resolver pick it", and it cannot be measured on the shipped model without
credit.

It can be measured as an A/B on a local one: the same crop, the same model, asked to name it with
and without the five candidates the service actually attached. That does not say what gpt-5.4-mini
would do. It says whether the information helps a model that has it, which is the question the
prompt work would rest on.

    KART_VLM=mlx-community/Qwen2.5-VL-7B-Instruct-4bit \
      server/.venv/bin/python server/eval/pipeline/shortlist_ab.py
"""
import json, os, pathlib, sys
from PIL import Image, ImageOps

import vlm

HERE = pathlib.Path(__file__).parent.parent
MODEL = os.environ.get("KART_VLM", "mlx-community/Qwen2.5-VL-7B-Instruct-4bit")
SKIP = {"not_a_product", "out_of_catalog", "skip", "unlabelled"}
CARTS = ["IMG_0244", "IMG_0245", "IMG_0246", "IMG_0249", "IMG_0252", "IMG_0254"]

# The same word map `census-live.ts` scores badge alignment with, so both harnesses agree on what
# counts as the right answer for a badge.
SAME = {
    "cauliflower": ["cauliflower"], "brussels_sprouts": ["brussels", "sprout"],
    "asparagus": ["asparagus"], "oreo": ["oreo"], "seedtastic_bread": ["bread", "seedtastic"],
    "granny_smith_apples": ["apple", "granny"], "baguette": ["baguette", "bread"],
    "purple_produce_bag": ["apple", "fuji", "produce bag", "purple"],
}
FREE = ("What grocery product is this? Answer with the product name only, three words at most.")


def readable(sku):
    return sku[5:].replace("_", " ") if sku.startswith("kart_") else sku


def main():
    labels = {}
    for f in ("still-labels.json", "query-labels.json"):
        labels.update(json.loads((HERE / "corpus/kart" / f).read_text())["boxes"])
    data = json.loads((HERE / ".cache/kart/frames-named.json").read_text())
    frames = {f["id"]: f for f in (data["frames"] if isinstance(data, dict) else data)}
    backend = vlm.load(MODEL)
    print(f"model {MODEL}\n")

    free_ok = shortlist_ok = raw_ok = total = 0
    for img in CARTS:
        pil = ImageOps.exif_transpose(Image.open(HERE / f".cache/kart/images/{img}.jpg")).convert("RGB")
        pil.thumbnail((2000, 2000))
        W, H = pil.size
        cat = frames[img].get("catalog") or []
        for i, lab in enumerate(labels.get(img, [])):
            if lab in SKIP or lab not in SAME:
                continue
            b = frames[img]["boxes"][i]
            crop = pil.crop((int(b["x"]*W), int(b["y"]*H),
                             int((b["x"]+b["w"])*W), int((b["y"]+b["h"])*H)))
            if crop.width < 32 or crop.height < 32:
                continue
            alts = (cat[i] or {}).get("alternatives", []) if i < len(cat) else []
            names = [readable(a) for a in alts[:5]]
            raws = alts[:5]
            def offer(entries):
                return (f"What grocery product is this? The store catalog suggests it may be one "
                        f"of: {', '.join(entries)}. If one of those matches what you see, answer "
                        f"with it exactly. Otherwise answer with the product name. Name only.")
            withq = offer(names)
            rawq = offer(raws)
            a = backend.ask(crop, FREE, tokens=16).strip().lower()
            c = backend.ask(crop, withq, tokens=16).strip().lower()
            r = backend.ask(crop, rawq, tokens=16).strip().lower()
            aok = any(w in a for w in SAME[lab])
            cok = any(w in c for w in SAME[lab])
            rok = any(w in r for w in SAME[lab])
            total += 1; free_ok += aok; shortlist_ok += cok; raw_ok += rok
            flag = "  " if aok == cok else ("  ++" if cok else "  --")
            print(f"  {img} #{i:<2} {lab:<20} free={a[:26]:<28}{'ok' if aok else 'X'}"
                  f"   name={c[:20]:<22}{'ok' if cok else 'X'}"
                  f"   sku={r[:20]:<22}{'ok' if rok else 'X'}{flag}")
    print(f"\n  named correctly, no shortlist             {free_ok}/{total}")
    print(f"  named correctly, shortlist as SKUs        {raw_ok}/{total}   (what ships)")
    print(f"  named correctly, shortlist as names       {shortlist_ok}/{total}")


if __name__ == "__main__":
    main()
