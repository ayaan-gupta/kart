"""Naming per crop against naming by badge, with the same model on the same regions.

The census asks one question about a composite with numbered badges. On a real trolley that
misaligns: measured on IMG_0249, three items and three badges, a 2B model attached all three
answers to the wrong badge while naming products that really are in the trolley.

Asking one crop at a time cannot misalign, because there is no badge to confuse. It costs one
call per region instead of one per frame. This measures what that buys, so the trade is a
number rather than an argument.
"""
import json, pathlib
import torch
from PIL import Image, ImageOps
from transformers import AutoProcessor, Qwen2VLForConditionalGeneration

MODEL = "Qwen/Qwen2-VL-2B-Instruct"
QUESTION = ("What grocery product is this? Answer with the product name only, three words at "
            "most. If it is not a product a shopper is buying, answer NOT A PRODUCT.")
CARTS = ["IMG_0244", "IMG_0245", "IMG_0246", "IMG_0249", "IMG_0252", "IMG_0254"]
NOT_A_PRODUCT = {"skip", "not_a_product"}

labels = {}
labels.update(json.loads(pathlib.Path("corpus/kart/still-labels.json").read_text())["boxes"])
labels.update(json.loads(pathlib.Path("corpus/kart/query-labels.json").read_text())["boxes"])
frames = {f["id"]: f for f in json.loads(pathlib.Path(".cache/kart/frames.json").read_text())["frames"]}

device = "mps" if torch.backends.mps.is_available() else "cpu"
proc = AutoProcessor.from_pretrained(MODEL)
model = Qwen2VLForConditionalGeneration.from_pretrained(
    MODEL, dtype=torch.float32).to(device).eval()

def ask(crop):
    messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": QUESTION}]}]
    text = proc.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = proc(text=[text], images=[crop], return_tensors="pt").to(device)
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=12, do_sample=False)
    return proc.batch_decode(out[:, inputs["input_ids"].shape[1]:],
                             skip_special_tokens=True)[0].strip()

# Judged by whether the answer names the same thing the label does.
SAME = {
    "cauliflower": ["cauliflower"],
    "brussels_sprouts": ["brussels", "sprout"],
    "asparagus": ["asparagus"],
    "oreo": ["oreo", "cookie"],
    "seedtastic_bread": ["bread", "seedtastic"],
    "granny_smith_apples": ["apple", "granny"],
    "baguette": ["baguette", "bread"],
    "purple_produce_bag": ["grape", "plum", "purple"],
}
rows = []
for pid in CARTS:
    frame = frames[pid]
    pil = ImageOps.exif_transpose(Image.open(f".cache/kart/images/{pid}.jpg")).convert("RGB")
    pil.thumbnail((1333, 1333))
    W, H = pil.size
    for i, b in enumerate(frame["boxes"]):
        label = labels[pid][i] if i < len(labels[pid]) else "unlabelled"
        pad = 0.08
        crop = pil.crop((max(0, int((b["x"]-pad*b["w"])*W)), max(0, int((b["y"]-pad*b["h"])*H)),
                         min(W, int((b["x"]+b["w"]*(1+pad))*W)),
                         min(H, int((b["y"]+b["h"]*(1+pad))*H))))
        if crop.width < 16 or crop.height < 16:
            continue
        said = ask(crop)
        low = said.lower()
        if label in NOT_A_PRODUCT:
            ok = "not a product" in low
        elif label in SAME:
            ok = any(w in low for w in SAME[label])
        else:
            ok = None   # out_of_catalog: no single right answer to score against
        rows.append({"id": pid, "box": i, "label": label, "said": said, "ok": ok})
        mark = {True: "ok", False: "X", None: "-"}[ok]
        print(f"  {pid} #{i:<2} {label:22} -> {said[:34]:36} {mark}", flush=True)

scorable = [r for r in rows if r["ok"] is not None]
right = sum(1 for r in scorable if r["ok"])
print(f"\n  {len(scorable)} regions with a checkable answer, {right} named correctly "
      f"({right/max(len(scorable),1):.1%})")
print("  alignment is 100% by construction: one crop, one answer, no badge to confuse")
pathlib.Path(".cache/kart/percrop.json").write_text(json.dumps(rows, indent=1))
