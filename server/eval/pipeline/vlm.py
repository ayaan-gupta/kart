"""One way to put a question to a vision model, so the census harnesses can be pointed at a
bigger one without a second copy of each file.

Two backends, chosen by the model id. Transformers on MPS runs the Qwen2-VL and Qwen2.5-VL
checkpoints already measured here, unchanged. MLX runs 4-bit quantised weights, which is the
only way a 7B model fits beside the detector in 24 GB of unified memory: bfloat16 7B weights are
16 GB before a single activation, where the same model at 4 bits is under 5 GB.

The transformers path is byte-for-byte the code the 2B and 3B numbers were taken with. Anything
that would change those numbers belongs in the MLX branch, not here.
"""
import pathlib
import tempfile


class _Transformers:
    def __init__(self, model_id):
        import torch
        from transformers import (AutoProcessor, Qwen2VLForConditionalGeneration,
                                  Qwen2_5_VLForConditionalGeneration)
        loader = (Qwen2_5_VLForConditionalGeneration if "2.5" in model_id
                  else Qwen2VLForConditionalGeneration)
        self.torch = torch
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.proc = AutoProcessor.from_pretrained(model_id)
        self.model = loader.from_pretrained(
            model_id, dtype=torch.bfloat16 if "3B" in model_id else torch.float32
        ).to(self.device).eval()

    def ask(self, image, question, tokens=16):
        messages = [{"role": "user",
                     "content": [{"type": "image"}, {"type": "text", "text": question}]}]
        text = self.proc.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self.proc(text=[text], images=[image], return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            out = self.model.generate(**inputs, max_new_tokens=tokens, do_sample=False)
        got = out[:, inputs["input_ids"].shape[1]:]
        return self.proc.batch_decode(got, skip_special_tokens=True)[0].strip()


class _Mlx:
    """mlx-vlm takes image paths rather than objects, so each crop is written once to a scratch
    file. The write is microseconds against a generation measured in seconds."""

    def __init__(self, model_id):
        from mlx_vlm import generate, load
        from mlx_vlm.prompt_utils import apply_chat_template
        self._generate = generate
        self._template = apply_chat_template
        self.model, self.proc = load(model_id)
        self.config = self.model.config
        self._dir = tempfile.mkdtemp(prefix="kart-vlm-")

    def ask(self, image, question, tokens=16):
        path = pathlib.Path(self._dir, "crop.png")
        image.save(path)
        prompt = self._template(self.proc, self.config, question, num_images=1)
        result = self._generate(self.model, self.proc, prompt, image=[str(path)],
                                max_tokens=tokens, temperature=0.0, verbose=False)
        return (result.text if hasattr(result, "text") else str(result)).strip()


def load(model_id):
    """MLX weights are published under the mlx-community org and named for the quantisation."""
    return _Mlx(model_id) if model_id.startswith("mlx-community/") else _Transformers(model_id)
