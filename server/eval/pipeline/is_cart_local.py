"""The `subjectIsCart` question, put to a local model for all ten photographs.

Rule 0 of the census prompt asks whether one shopping cart's interior is the subject, and a false
answer empties the response: a shelf holds hundreds of facings that are in nobody's cart, and
without the gate four of this corpus's photographs produced up to 41 invented items
(`shelf-census.ts`, and KART.md's fifty-fourth).

That gate was measured once on the shipped model and the four shelves have had no live run since.
This puts the same question to a local 7B so the corpus's report can show a result it produced
rather than cite one, and so the discrimination is checked on both classes rather than assumed.

    KART_VLM=mlx-community/Qwen2.5-VL-7B-Instruct-4bit \
      server/.venv/bin/python server/eval/pipeline/is_cart_local.py
"""
import json, os, pathlib, sys

from PIL import Image, ImageOps

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import vlm

HERE = pathlib.Path(__file__).resolve().parent.parent
MODEL = os.environ.get("KART_VLM", "mlx-community/Qwen2.5-VL-7B-Instruct-4bit")
Q = ("Is the main subject of this photograph the inside of one shopping cart or trolley, "
     "with a shopper's own groceries in it? Answer YES or NO only.")
# What the corpus is: six trolleys, four store shelves.
EXPECT = {"IMG_0244": True, "IMG_0245": True, "IMG_0246": True, "IMG_0249": True,
          "IMG_0252": True, "IMG_0254": True,
          "IMG_0247": False, "IMG_0248": False, "IMG_0250": False, "IMG_0251": False}


def main():
    backend = vlm.load(MODEL)
    print(f"model {MODEL}\n")
    out, right = {}, 0
    for pid, expected in EXPECT.items():
        img = ImageOps.exif_transpose(
            Image.open(HERE / f".cache/kart/images/{pid}.jpg")).convert("RGB")
        img.thumbnail((1333, 1333))
        said = backend.ask(img, Q, tokens=8).strip().upper().startswith("YES")
        out[pid] = said
        right += said == expected
        print(f"  {pid}  said {'CART ' if said else 'not a cart'}"
              f"   expected {'cart' if expected else 'not a cart'}"
              f"   {'ok' if said == expected else 'X'}")
    print(f"\n  {right}/{len(EXPECT)} correct")
    (HERE / ".cache/kart/is-cart-local.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
