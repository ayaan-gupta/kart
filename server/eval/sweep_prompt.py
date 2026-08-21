"""
Sweep the detector's prompt, which is the one knob never chosen from data.

`GROCERY_PROMPT` in `server/enumerator/regions.py` was written by looking at overlays on five
cart photographs. The comment beside it records one real finding from that exercise, that
container words like "bag" and "package" made the model propose the trolley itself, and the fix
was to delete them. That is the whole evidential basis for the phrase list.

Detection is the binding constraint on this product: at cart-like density it finds under half of
the labelled items, which is a larger loss than anything downstream of it. The prompt is the
cheapest thing that could move it and the only stage with no measurement behind it at all.

Scored on shelf photographs, where recall is unbiased and precision is a lower bound because the
annotation is partial. Both are reported, and prompts are compared at similar precision: a prompt
that proposes twice as much will always find more, and finding more is not the same as being
better.

    server/.venv/bin/python server/eval/sweep_prompt.py --scenes 60
"""
import argparse
import json
import pathlib
import statistics
import sys
import time

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "enumerator"))

import regions  # noqa: E402
from grocer import corpus  # noqa: E402
from score_grocer_detection import match, set_match_iou  # noqa: E402

# Each candidate is one hypothesis about why the detector misses things, not a random reword.
PROMPTS = {
    "shipped": regions.GROCERY_PROMPT,
    # Does the list of shapes do any work, or is "a product" carrying all of it? If one phrase is
    # as good as nine, the extra phrases are only costing duplicate proposals for dedupe to undo.
    "product-only": "a product.",
    # Grocery packaging that none of the nine shipped phrases names: pouches, bags of crisps,
    # blister packs, tubes, punnets. A shelf is full of these and so is a cart.
    "more-shapes": (
        "a product. a box. a bottle. a carton. a can. a jar. fruit. a vegetable. a tub. "
        "a packet. a pouch. a bag of food. a tube. a tray of food. a carton of eggs."
    ),
    # The shipped list with the two weakest-yielding generic words removed, to test whether
    # "fruit" and "a vegetable" pull boxes onto produce displays rather than onto items.
    "no-produce": "a product. a box. a bottle. a carton. a can. a jar. a tub.",
    # Naming the thing rather than its shape. Grounding DINO is a text-grounded detector, so
    # "grocery product" may localise better than the shape vocabulary.
    "grocery-noun": "a grocery product. a packaged food item. a drink container.",
    # The shipped list plus one word for the case the whole design is about: an item that is
    # partly behind another one.
    # Kept as a recorded negative. Every miss on the one photograph in the cart corpus where a
    # person can count every item was loose or netted produce: celery, parsley, a leek bunch, a
    # parsnip, a net bag of onions, a net bag of potatoes, while seven packaged items on the same
    # table were all found. None of the three shipped phrases names an unpackaged vegetable, so
    # adding one looked obvious. It is wrong twice over.
    #
    # On 60 shelf photographs it costs 9.0 points of recall (61.2% -> 52.2%) and 6.4 of precision
    # at an unchanged 14.7 proposals per scene, so the phrase redistributes boxes rather than
    # adding them.
    #
    # On the photograph that motivated it, run directly, it recovers none of the six and loses
    # the loaf of bread. The misses are not a vocabulary gap.
    "produce": "a grocery product. a packaged food item. a drink container. a fruit or vegetable.",
    # The same addition split in two, since Grounding DINO scores each phrase separately. Worse
    # again: 50.8% recall on shelves, and on the motivating photograph it takes the proposals
    # from 7 to 22, recovers celery and parsley, and loses the apples and the clementines. Two
    # items bought for fifteen phantom boxes is a count error traded from -6 to +9.
    "produce-split": (
        "a grocery product. a packaged food item. a drink container. a fresh fruit. "
        "a fresh vegetable."
    ),
    # Naming produce generically fails; naming a specific vegetable works. Run on the produce
    # haul at the shipped threshold, "a fruit or vegetable." lands on none of the six missed
    # items while "celery. parsley. a leek. a parsnip. onions. potatoes." lands on five, the best
    # at 0.52. Grounding DINO grounds concrete nouns and does poorly on category words, which is
    # what "grounding" means and should have been the first guess.
    #
    # That phrase is leaked: it names the six items already known to be missing. This is the
    # unleaked version, a produce list written from what a supermarket sells rather than from
    # that photograph, and measured on the shelf corpus, which has never been inspected for
    # produce. The overlap with the leaked six is unavoidable and is the point: a store knows its
    # own produce list, and CLAUDE.md already assumes the catalog is known.
    "produce-nouns": (
        "a grocery product. a packaged food item. a drink container. "
        "bananas. apples. oranges. lemons. grapes. strawberries. avocados. tomatoes. "
        "potatoes. onions. carrots. lettuce. broccoli. celery. cucumbers. peppers. "
        "mushrooms. garlic. ginger. spinach. cabbage. cauliflower. herbs. leeks. "
        "a melon. a pineapple. pears. sweet potatoes."
    ),
    # The same nouns without the three shipped phrases, to separate what the produce list adds
    # from what the shipped phrases were already doing. If this scores near the combined one, the
    # list is carrying the whole prompt and the generic phrases are redundant.
    "nouns-only": (
        "bananas. apples. oranges. lemons. grapes. strawberries. avocados. tomatoes. "
        "potatoes. onions. carrots. lettuce. broccoli. celery. cucumbers. peppers. "
        "mushrooms. garlic. ginger. spinach. cabbage. cauliflower. herbs. leeks. "
        "a melon. a pineapple. pears. sweet potatoes."
    ),
    "shipped-plus-packet": (
        "a product. a box. a bottle. a carton. a can. a jar. fruit. a vegetable. a tub. "
        "a packet. a bag of food."
    ),
}


def wanted_prompts(args):
    return PROMPTS if not args.only else {k: PROMPTS[k] for k in args.only.split(",")}


def sweep_carts(images, prompts, proc, dino, torch, Image, args):
    """How much of the frame each prompt's proposals cover, on photographs that contain a trolley.

    The shipped phrase list has no container words in it because they made the model propose the
    trolley: a box over more than half the frame on four of five photographs, reaching the
    shopper's bag as one unit of an item that does not exist. Any prompt that raises recall on
    shelves has to be checked against that before it can be adopted, and only a corpus with a
    trolley in it can do the checking.
    """
    from pathlib import Path

    corpus_dir = HERE / "corpus" / "carts"
    results = {}
    for name, prompt in prompts.items():
        big = huge = proposals = 0
        for entry in images:
            with Image.open(corpus_dir / entry["file"]) as handle:
                pil = handle.convert("RGB")
            shrunk = pil.copy()
            shrunk.thumbnail((1333, 1333))
            inputs = proc(images=shrunk, text=prompt, return_tensors="pt").to(
                "mps" if torch.backends.mps.is_available() else "cpu")
            with torch.no_grad():
                outputs = dino(**inputs)
            got = proc.post_process_grounded_object_detection(
                outputs, inputs.input_ids, threshold=args.threshold,
                text_threshold=args.threshold, target_sizes=[shrunk.size[::-1]],
            )[0]
            boxes = [[float(v) for v in row] for row in got["boxes"].cpu().numpy()]
            scores = [float(s) for s in got["scores"].cpu()]
            if boxes:
                keep = regions.dedupe(boxes, scores)
                keep.sort(key=lambda i: -scores[i])
                boxes = [boxes[i] for i in keep[: regions.MAX_INSTANCES]]
            frame = shrunk.size[0] * shrunk.size[1]
            for box in boxes:
                share = max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1]) / frame
                proposals += 1
                if share > 0.4:
                    big += 1
                if share > 0.6:
                    huge += 1
        results[name] = {"proposals": proposals, "over_40pc": big, "over_60pc": huge,
                         "per_scene": proposals / len(images)}
        print(f"  {name:22s} {proposals:4d} proposals, {big:3d} cover >40% of the frame, "
              f"{huge:3d} cover >60%   ({proposals / len(images):.1f}/photo)")
    pathlib.Path(args.out).write_text(json.dumps(results, indent=1))
    print(f"\nwrote {args.out}")
    print("  These survive de-duplication, including the group pass. A prompt whose whole-frame")
    print("  proposals rise is proposing the trolley, whatever it does for recall on a shelf.")
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenes", type=int, default=60)
    parser.add_argument("--threshold", type=float, default=regions.BOX_THRESHOLD)
    parser.add_argument("--match-iou", type=float, default=0.5)
    parser.add_argument("--only", default=None, help="comma separated subset of prompt names")
    parser.add_argument("--carts", action="store_true",
                        help="score the cart and haul photographs instead, reporting how often "
                             "each prompt proposes a box over the whole trolley. That failure is "
                             "why the shipped phrase list has no container words in it, and a "
                             "shelf corpus cannot show it because there is no trolley in frame")
    parser.add_argument("--out", default=str(HERE / "prompt-sweep.json"))
    args = parser.parse_args(argv)

    set_match_iou(args.match_iou)

    import torch
    from PIL import Image
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"loading grounding-dino-base on {device}")
    proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    dino = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base").to(device)

    if args.carts:
        from score_carts import curated

        images = curated()
        print(f"{len(images)} cart and haul photographs, no labels: what is reported is how "
              f"much of the frame each prompt's proposals cover\n")
        return sweep_carts(images, wanted_prompts(args), proc, dino, torch, Image, args)

    _, query_scenes = corpus.split(corpus.scenes())
    chosen = query_scenes[: args.scenes]
    print(f"{len(chosen)} photographs, {sum(len(s.crops) for s in chosen)} labelled instances\n")

    wanted = wanted_prompts(args)
    results = {}
    for name, prompt in wanted.items():
        started = time.time()
        found = missed = proposed = 0
        by_density = {}
        for scene in chosen:
            with Image.open(scene.image) as handle:
                pil = handle.convert("RGB")
            shrunk = pil.copy()
            shrunk.thumbnail((1333, 1333))
            inputs = proc(images=shrunk, text=prompt, return_tensors="pt").to(device)
            with torch.no_grad():
                outputs = dino(**inputs)
            got = proc.post_process_grounded_object_detection(
                outputs, inputs.input_ids, threshold=args.threshold,
                text_threshold=args.threshold, target_sizes=[shrunk.size[::-1]],
            )[0]
            boxes = [[float(v) for v in row] for row in got["boxes"].cpu().numpy()]
            scores = [float(s) for s in got["scores"].cpu()]
            if boxes:
                keep = regions.dedupe(boxes, scores)
                keep.sort(key=lambda i: -scores[i])
                keep = keep[: regions.MAX_INSTANCES]
                boxes = [boxes[i] for i in keep]
            width, height = shrunk.size
            truth = [(c.x0 * width, c.y0 * height, c.x1 * width, c.y1 * height)
                     for c in scene.crops]
            hits, _ = match(boxes, truth)
            found += hits
            missed += len(truth) - hits
            proposed += len(boxes)
            band = "1-12" if len(truth) < 13 else "13-25" if len(truth) < 26 else "26+"
            entry = by_density.setdefault(band, [0, 0])
            entry[0] += hits
            entry[1] += len(truth)

        recall = found / max(found + missed, 1)
        precision = found / max(proposed, 1)
        results[name] = {
            "prompt": prompt,
            "recall": recall,
            "precision_floor": precision,
            "proposals_per_scene": proposed / len(chosen),
            "recall_by_density": {k: v[0] / max(v[1], 1) for k, v in by_density.items()},
            "seconds": round(time.time() - started, 1),
        }
        bands = "  ".join(
            f"{k} {v[0] / max(v[1], 1):.1%}" for k, v in sorted(by_density.items())
        )
        print(f"  {name:22s} recall {recall:5.1%}  precision {precision:5.1%}  "
              f"{proposed / len(chosen):4.1f}/scene   {bands}")

    pathlib.Path(args.out).write_text(json.dumps(results, indent=1))
    print(f"\nwrote {args.out}")

    best = max(results.items(), key=lambda kv: kv[1]["recall"])
    shipped = results.get("shipped")
    if shipped and best[0] != "shipped":
        print(f"\n  best recall: {best[0]} at {best[1]['recall']:.1%} against "
              f"{shipped['recall']:.1%} shipped, "
              f"precision {best[1]['precision_floor']:.1%} against "
              f"{shipped['precision_floor']:.1%}")
        print("  A prompt that proposes more will always find more. Compare the two columns "
              "together before adopting anything.")
    return results


if __name__ == "__main__":
    main()
