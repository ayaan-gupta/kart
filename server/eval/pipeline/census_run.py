"""The census, run with a local open model, on the real trolley.

Same badged images the compositor draws, same frozen CENSUS_SYSTEM_PROMPT and censusUserText the
service sends. Only the model differs. What this exercises that nothing before it did is
set-of-mark prompting on a real photograph: whether an answer for badge 7 lands on badge 7.
"""
import json, pathlib, re, sys
import torch
from PIL import Image
from transformers import AutoProcessor, Qwen2VLForConditionalGeneration

CENSUS = pathlib.Path(".cache/kart/census")
MODEL = "Qwen/Qwen2-VL-2B-Instruct"
CARTS = ["IMG_0244", "IMG_0245", "IMG_0246", "IMG_0249", "IMG_0252", "IMG_0254"]

system = CENSUS.joinpath("system.txt").read_text()
device = "mps" if torch.backends.mps.is_available() else "cpu"
proc = AutoProcessor.from_pretrained(MODEL)
model = Qwen2VLForConditionalGeneration.from_pretrained(
    MODEL, dtype=torch.float32).to(device).eval()

out = {}
for pid in CARTS:
    image = Image.open(CENSUS / f"{pid}.png").convert("RGB")
    image.thumbnail((1024, 1024))
    user = CENSUS.joinpath(f"{pid}.txt").read_text()
    messages = [
        {"role": "system", "content": [{"type": "text", "text": system}]},
        {"role": "user", "content": [{"type": "image"},
                                     {"type": "text", "text": user + "\n\nReply with JSON only."}]},
    ]
    text = proc.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = proc(text=[text], images=[image], return_tensors="pt").to(device)
    with torch.no_grad():
        gen = model.generate(**inputs, max_new_tokens=900, do_sample=False)
    reply = proc.batch_decode(gen[:, inputs["input_ids"].shape[1]:],
                              skip_special_tokens=True)[0]
    out[pid] = reply
    body = re.sub(r"^```(?:json)?|```$", "", reply.strip(), flags=re.M).strip()
    try:
        parsed = json.loads(body)
    except Exception as exc:
        print(f"  {pid}: not JSON ({type(exc).__name__}), {len(reply)} chars", flush=True)
        continue
    if not isinstance(parsed, dict):
        print(f"  {pid}: JSON parses but is a {type(parsed).__name__}, not the object the schema "
              f"requires; no marks/inViewCounts/unmarkedItems", flush=True)
        continue
    marks = parsed.get("marks", [])
    with_id = sum(1 for m in marks if isinstance(m, dict) and "id" in m)
    print(f"  {pid}: object with {len(marks)} marks, {with_id} carrying an id", flush=True)
pathlib.Path(".cache/kart/census-replies.json").write_text(json.dumps(out, indent=1))
print("\nwrote .cache/kart/census-replies.json")
