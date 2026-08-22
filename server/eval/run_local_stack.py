"""Puts the whole verification set through the running local stack and scores what comes back.

Every other harness here calls the recognition functions directly. This one goes over HTTP to a
running `server/scripts/serve.ts`, so what it measures is the path a phone uses: enumeration,
mark composition, the census, and the JSON that comes back. It exists because the hundred-and
-eleventh section measured one photograph that way and the requirement is the set.

    server/.venv/bin/python server/eval/run_local_stack.py [--url http://127.0.0.1:4310]

It does not start the servers. `docs/running-on-a-phone.md` has the two (or three) commands.

Scoring follows the convention the rest of KART.md uses, and reports both numbers rather than
picking the flattering one:

    strict    the answer carries the truth item's distinctive word ("cauliflower", "oreo")
    lenient   the answer shares any non-generic word with the truth item

"Generic" is the container vocabulary a shopper does not distinguish products by: bag, pack,
carton, box and so on. Counting those as matches would let "bread" match "apple bag", which is
how a scorer flatters a model that has only learned to say grocery words.
"""

import argparse
import base64
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from PIL import Image, ImageOps

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache/kart"
TRUTH = json.loads((HERE / "corpus/kart/counts.json").read_text())

# Words that name a container or a quantity rather than a product. A match on one of these is not
# evidence that the model saw the item.
GENERIC = {
    "bag", "bags", "pack", "packs", "package", "carton", "cartons", "box", "boxes", "tub",
    "bottle", "jar", "can", "cans", "party", "size", "of", "the", "a", "an", "and", "fresh",
    "organic", "green", "red", "purple", "yellow", "produce", "grocery", "item", "product",
}

# How many frames of the nine-second video to fuse. The shipped scan fires four censuses over a
# pass, so four is the number that matches the product rather than a number chosen to look good.
VIDEO_FRAMES = 4


def words(text: str) -> set[str]:
    return {w for w in re.split(r"[^a-z0-9]+", text.lower()) if w}


def distinctive(text: str) -> set[str]:
    """Generic words dropped, unless that would leave nothing to match on.

    The fallback matters: the corpus contains a truth item literally named "jar", and "jar" is in
    the generic list because it is a container word. Without this, that item has no distinctive
    words, can never be matched, and is scored as missed however well the model does. It answered
    "SPICE JAR".
    """
    stripped = words(text) - GENERIC
    return stripped or words(text)


def matches(answer: str, truth: str) -> tuple[bool, bool]:
    """(strict, lenient) for one answer against one truth item."""
    a, t = distinctive(answer), distinctive(truth)
    if not a or not t:
        return False, False
    # Strict asks for the truth item's *head* word, the last distinctive one, which is the noun
    # that names the product: "Granny Smith apple bag" -> "apple", "Mr Lucky cauliflower" ->
    # "cauliflower". A model that says "apples" for "Granny Smith apple bag" has seen the item;
    # one that only says "granny" has not.
    #
    # The head is looked for in the answer's *full* words, not its distinctive ones. Stripping
    # both sides is what made "SPICE JAR" fail to match the truth item "jar": the head restored
    # by the fallback in `distinctive` was thrown away again on the answer side. A generic word
    # is weak evidence on its own and exact evidence when it is the whole name of the item.
    head = list(t)[-1] if len(t) == 1 else sorted(t, key=lambda w: truth.lower().rfind(w))[-1]
    strict = any(w == head or w.rstrip("s") == head.rstrip("s") for w in words(answer))
    # Anything strict is lenient by construction, or the two could disagree in the jar case.
    return strict, strict or bool(a & t)


def score(answers: list[str], truth_items: list[str]) -> dict:
    """Each truth item is claimed by at most one answer, so two apple bags need two answers."""
    remaining = list(answers)
    strict_hits, lenient_hits = 0, 0
    for item in truth_items:
        for mode in ("strict", "lenient"):
            for i, ans in enumerate(remaining):
                s, l = matches(ans, item)
                if (s if mode == "strict" else l):
                    if mode == "strict":
                        strict_hits += 1
                        lenient_hits += 1
                    else:
                        lenient_hits += 1
                    remaining.pop(i)
                    break
            else:
                continue
            break
    return {"strict": strict_hits, "lenient": lenient_hits,
            "answers": len(answers), "truth": len(truth_items),
            "unmatched_answers": remaining}


def census(url: str, jpeg: bytes, counted: list[str]) -> dict:
    body = json.dumps({"image": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode(),
                       "counted": counted}).encode()
    req = urllib.request.Request(url + "/api/census", data=body,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=1800) as response:
        return json.loads(response.read())


def answers_from(payload: dict) -> list[str]:
    result = payload.get("result", {})
    out = [m["name"] for m in result.get("marks", []) if m.get("isProduct")]
    out += [u["description"] for u in result.get("unmarkedItems", [])]
    return out


def jpeg_of(path: pathlib.Path, max_edge: int = 1536) -> bytes:
    import io
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    img.thumbnail((max_edge, max_edge))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def video_frames(count: int) -> list[bytes]:
    """Evenly spaced frames from the scan, written to the scratch dir ffmpeg needs anyway."""
    mov = CACHE / "IMG_0253.MOV"
    out = []
    duration = 9.0
    for i in range(count):
        at = duration * (i + 0.5) / count
        dest = CACHE / f"frame-{i}.jpg"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{at:.2f}",
                        "-i", str(mov), "-frames:v", "1", "-vf", "scale=1080:-1", str(dest)],
                       check=True)
        out.append(dest.read_bytes())
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:4310")
    ap.add_argument("--out", default=str(CACHE / "local-stack-run.json"))
    args = ap.parse_args()

    try:
        with urllib.request.urlopen(args.url + "/", timeout=5) as r:
            json.loads(r.read())
    except (urllib.error.URLError, OSError) as err:
        print(f"no recognition service at {args.url}: {err}")
        print("see docs/running-on-a-phone.md")
        sys.exit(1)

    run = {"photographs": {}, "video": {}}
    totals = {"strict": 0, "lenient": 0, "truth": 0}

    for entry in TRUTH["counted"]:
        pid, items = entry["id"], entry["items"]
        path = CACHE / "images" / f"{pid}.jpg"
        if not path.exists():
            print(f"{pid}: image missing, skipped")
            continue
        started = time.monotonic()
        try:
            payload = census(args.url, jpeg_of(path), [])
        except Exception as err:
            print(f"{pid}: FAILED {err}")
            run["photographs"][pid] = {"error": str(err)}
            continue
        got = answers_from(payload)
        s = score(got, items)
        s["seconds"] = round(time.monotonic() - started, 1)
        s["named"] = got
        run["photographs"][pid] = s
        totals["strict"] += s["strict"]
        totals["lenient"] += s["lenient"]
        totals["truth"] += s["truth"]
        print(f"{pid:<9} {s['strict']:>2}/{s['truth']:<2} strict  "
              f"{s['lenient']:>2}/{s['truth']:<2} lenient  "
              f"{s['answers']:>2} answers  {s['seconds']:>5}s", flush=True)

    # The video is one trolley seen four times, so the answers are unioned before scoring: the
    # product is a scan that fuses passes, not four independent photographs.
    video_truth = TRUTH["video_recovery"]
    items = TRUTH["counted"][4]["items"] + ["tomatoes on the vine"]
    fused, counted = [], []
    for i, frame in enumerate(video_frames(VIDEO_FRAMES)):
        try:
            payload = census(args.url, frame, counted)
        except Exception as err:
            print(f"video frame {i}: FAILED {err}")
            continue
        got = answers_from(payload)
        fused += got
        counted = sorted({*counted, *got})[:64]
        print(f"video f{i}   {len(got):>2} answers", flush=True)
    vs = score(fused, items)
    vs["named"] = sorted(set(fused))
    run["video"] = vs
    print(f"video     {vs['strict']:>2}/{vs['truth']:<2} strict  "
          f"{vs['lenient']:>2}/{vs['truth']:<2} lenient  "
          f"(the corpus says {video_truth['found_somewhere_in_the_video']} of "
          f"{video_truth['products_in_trolley']} are findable)")

    run["totals"] = totals
    pathlib.Path(args.out).write_text(json.dumps(run, indent=1) + "\n")
    print(f"\nphotographs: {totals['strict']}/{totals['truth']} strict, "
          f"{totals['lenient']}/{totals['truth']} lenient")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
