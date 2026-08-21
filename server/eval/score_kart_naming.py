"""Naming, on the trolley the pipeline is for, against a catalog of that trolley's own store.

The closed-world assumption in CLAUDE.md is that the store's product list is known. Testing it
needs two things this corpus can supply and no other corpus here could: references and queries
from separate captures of the same goods, and a catalog big enough that picking the right entry
is work.

References come from the video and from the four earliest trolley photographs
(`build_kart_catalog.py`). Queries are the detected boxes on IMG_0252 and IMG_0254, which
contribute nothing to the catalog, so a correct name here is recognition rather than recall.

Distractors are the 292-product shelf catalog, carried in whole. That matters more than it
sounds: one of them is an Oreo, in Indian packaging, sitting beside this trolley's American one.

Three numbers, and they answer different questions:

  top-1 / top-5    can the matcher rank the right entry, floor aside
  named / right    what the shopper actually sees, at the shipped floor
  declined         of the boxes holding a product the catalog does not contain, how many were
                   correctly refused. This is the fourth capability in CLAUDE.md and the only
                   corpus here that can measure it on real out-of-catalog goods rather than by
                   withholding entries on purpose.

    ../.venv/bin/python score_kart_naming.py --encoders siglipb16
"""

import argparse
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "kart"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

PREFIX = "kart_"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default=str(CACHE / "combined"))
    parser.add_argument("--encoders", default="siglipb16")
    parser.add_argument("--finetune-epochs", type=int, default=0)
    parser.add_argument("--index", default=None)
    parser.add_argument("--min-references", type=int, default=9,
                        help="two of this trolley's products have nine clean references and the "
                             "shipped floor is ten. The measured cliff is between five and ten, "
                             "so nine sits at the top of the safe range rather than below it")
    parser.add_argument("--out", default=str(HERE / "kart-naming.json"))
    args = parser.parse_args(argv)

    from PIL import Image, ImageOps

    from catalog import head as head_module
    from catalog import matcher as matcher_module
    from catalog.matcher import Index, Matcher, crop_region

    head_module.MIN_REFERENCES = args.min_references
    matcher_module.MIN_REFERENCES = args.min_references

    index_path = pathlib.Path(
        args.index or CACHE / f"index-{'-'.join(args.encoders.split(','))}.npz")
    if index_path.exists():
        print(f"loading cached index {index_path.name}")
        index = Index.load(index_path)
    else:
        print(f"building index from {args.catalog}")
        started = time.time()
        index = Index.build(pathlib.Path(args.catalog), encoder=args.encoders.split(","),
                            finetune_epochs=args.finetune_epochs,
                            log=lambda m: None if "skipping" in str(m) else print(m))
        index.save(index_path)
        print(f"  built in {time.time() - started:.0f}s")

    store = [s for s in index.skus if s.startswith(PREFIX)]
    print(f"  {len(index.skus)} products in the catalog, {len(store)} of them this trolley's")
    for sku in sorted(store):
        print(f"    {sku}")
    missing = [s for s in store if s not in index.skus]
    if missing:
        print(f"  missing: {missing}")

    matcher = Matcher(index, tta=1)
    frames = {f["id"]: f for f in json.loads((CACHE / "frames.json").read_text())["frames"]}
    labels = json.loads((HERE / "corpus" / "kart" / "query-labels.json").read_text())["boxes"]

    rows = []
    for photograph, names in labels.items():
        frame = frames.get(photograph)
        if frame is None:
            continue
        source = ImageOps.exif_transpose(
            Image.open(CACHE / "images" / f"{photograph}.jpg")).convert("RGB")
        source.thumbnail((1333, 1333))
        crops, kept = [], []
        for i, box in enumerate(frame["boxes"]):
            piece = crop_region(source, box)
            if piece is None:
                continue
            crops.append(piece)
            kept.append(i)
        results = matcher.match(crops, detail=True) if crops else []
        for i, result in zip(kept, results):
            truth = names[i] if i < len(names) else "not_a_product"
            rows.append({
                "photograph": photograph, "box": i, "truth": truth,
                "expected": PREFIX + truth if truth not in
                            ("out_of_catalog", "not_a_product") else None,
                "sku": result["sku"],
                "confidence": float(result["confidence"]),
                "alternatives": [a["sku"] for a in result["alternatives"]],
                "shortlist": result["shortlist"],
            })

    answerable = [r for r in rows if r["expected"]]
    absent = [r for r in rows if r["truth"] == "out_of_catalog"]
    n = max(len(answerable), 1)
    head = lambda r: r["shortlist"][0] if r["shortlist"] else None
    top1 = sum(1 for r in answerable if head(r) == r["expected"])
    top5 = sum(1 for r in answerable if r["expected"] in r["shortlist"][:5])
    ceiling = sum(1 for r in answerable if r["expected"] in r["shortlist"])
    named = [r for r in answerable if r["sku"] is not None]
    right = sum(1 for r in named if r["sku"] == r["expected"])
    declined = sum(1 for r in absent if r["sku"] is None)

    print(f"\n  {len(rows)} query boxes on {len(labels)} photographs")
    print(f"    holding a product the catalog contains   {len(answerable)}")
    print(f"    holding one it does not                  {len(absent)}")
    print(f"    not a product at all                     "
          f"{sum(1 for r in rows if r['truth'] == 'not_a_product')}")
    print("\n  ranking, floor aside")
    print(f"    top-1     {top1}/{len(answerable)}  {top1 / n:.1%}")
    print(f"    top-5     {top5}/{len(answerable)}  {top5 / n:.1%}")
    print(f"    in the shortlist at all  {ceiling}/{len(answerable)}  {ceiling / n:.1%}")
    print(f"\n  at the shipped floor of {matcher.floor:.2f}")
    print(f"    named     {len(named)}/{len(answerable)}  {len(named) / n:.1%}")
    print(f"    of those, right  {right}/{max(len(named), 1)}  {right / max(len(named), 1):.1%}")
    print(f"    correctly named, of all answerable  {right / n:.1%}")
    if absent:
        print(f"\n  the fourth capability: of {len(absent)} boxes holding a product the catalog "
              f"does not have,\n    {declined} were declined  ({declined / len(absent):.1%})")

    print("\n  every query box")
    print(f"    {'photograph':12} {'box':>3}  {'truth':24} {'said':24} conf")
    for r in rows:
        said = r["sku"] or f"(declined, best {head(r) or '-'})"
        mark = "  ok" if (r["sku"] == r["expected"]
                          or (r["expected"] is None and r["sku"] is None)) else "  X"
        print(f"    {r['photograph']:12} {r['box']:>3}  {r['truth']:24} {said:24}"
              f" {r['confidence']:.2f}{mark}")

    pathlib.Path(args.out).write_text(json.dumps({
        "catalog_products": len(index.skus), "store_products": len(store),
        "answerable": len(answerable), "top1": top1 / n, "top5": top5 / n,
        "ceiling": ceiling / n, "named": len(named) / n,
        "precision": right / max(len(named), 1), "right_of_all": right / n,
        "out_of_catalog": len(absent), "declined": declined,
        "rows": rows,
    }, indent=1))
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
