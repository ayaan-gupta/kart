"""Half of the closed-world measurement CLAUDE.md asks for, and the half that needs no model.

    "Measure against the catalog: is the correct SKU in the top-k shortlist, and does the
     resolver pick it."

The first clause is a property of the matcher and the index, so it can be scored offline from the
cached catalog column. The second needs a census pass. Reporting them apart matters: a product
missing from the bag can be a matcher that never offered the right SKU or a census that was
offered it and said something else, and from the bag those look identical.

    server/.venv/bin/python server/eval/score_shortlist.py
"""
import json, pathlib

HERE = pathlib.Path(__file__).parent
SKIP = {"not_a_product", "out_of_catalog", "skip", "unlabelled"}
CARTS = ["IMG_0244", "IMG_0245", "IMG_0246", "IMG_0249", "IMG_0252", "IMG_0254"]


def main():
    labels = {}
    for f in ("still-labels.json", "query-labels.json"):
        labels.update(json.loads((HERE / "corpus/kart" / f).read_text())["boxes"])
    data = json.loads((HERE / ".cache/kart/frames-named.json").read_text())
    frames = {f["id"]: f for f in (data["frames"] if isinstance(data, dict) else data)}

    hit = top1 = total = 0
    for img in CARTS:
        cat = frames[img].get("catalog") or []
        for i, lab in enumerate(labels.get(img, [])):
            if lab in SKIP:
                continue
            alts = (cat[i] or {}).get("alternatives", []) if i < len(cat) else []
            want = f"kart_{lab}"
            rank = alts.index(want) + 1 if want in alts else None
            total += 1
            hit += rank is not None
            top1 += rank == 1
            print(f"  {img} #{i:<2} {lab:<22} "
                  f"{('rank ' + str(rank)) if rank else 'NOT IN TOP 5':<13}{alts[:3]}")
    print(f"\n  correct SKU in the top-5 shortlist  {hit}/{total} ({100*hit/total:.0f}%)")
    print(f"  correct SKU at rank 1               {top1}/{total} ({100*top1/total:.0f}%)")
    print("\n  Badges labelled out_of_catalog are excluded: the index has no SKU for them, so\n"
          "  the shortlist cannot contain one and scoring them would measure the corpus.")


if __name__ == "__main__":
    main()
