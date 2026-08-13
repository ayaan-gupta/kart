# Detector Spike: YOLOE-seg Instance Recovery

**STATUS: Not yet run, awaiting cart photos**

This spike has not been executed because the eval corpus at `server/eval/corpus/images/` contains only a `.gitkeep` file. Cart photos must be supplied before this spike can run. The `spike/detector/results.md` file does not exist yet; it must be created by whoever runs this spike with real data.

## Research Question

Does an off-the-shelf open-vocabulary segmenter (YOLOE-seg) find the distinct items in a top-down photo of a loaded shopping cart? This spike measures instance recovery accuracy as a gate for Plan 2's architecture: Plan 2 depends on knowing whether YOLOE can reliably segment individual items or whether we must instead seed tracks from model-returned points.

## Running the Spike

When cart photos are available in `server/eval/corpus/images/`, execute these commands from the `spike/detector/` directory:

```bash
python -m venv .venv
source .venv/bin/activate  # on Windows: .venv\Scripts\activate
pip install -r requirements.txt
python run.py ../../server/eval/corpus/images
```

Expected output: per-image instance counts for both configurations, plus annotated `out_*.jpg` files in the `spike/detector/` directory.

## Observations to Record

After running the spike, evaluate both configurations and record the following in `spike/detector/results.md`:

**For each configuration (prompt-free and text-prompt):**
- Mean instances found (average per image)
- Mean ground-truth item count (average per image)
- Frequency of item splitting: how often does one physical item become several masks (overcounting failure mode)?
- Frequency of item merging: how often do several items merge into one mask (undercounting failure mode)?
- Mask quality: are masks tight to the silhouette, allowing tinting, or loose/fuzzy?

## Verdicts

State a clear verdict at the top of `spike/detector/results.md` using one of these three options:

**GO**: Either configuration recovers most distinct items with tight masks around each item. The segmentation is reliable enough to drive Plan 2 directly.

**GO WITH TEXT PROMPTS**: Only the text-prompt configuration works reliably. The prompt-free configuration fails; Plan 2 should use the prompted configuration exclusively.

**NO GO**: Neither configuration works. Both fail to recover distinct items reliably (too much splitting or merging). Plan 2 must instead seed tracks from model-returned points rather than relying on segmentation masks.

## What the Spike Measures

The spike runs two configurations over the eval corpus:

1. **prompt-free**: YOLOE's internal LVIS/Objects365 vocabulary, no text prompts
2. **text-prompt**: A fixed grocery vocabulary covering common shopping items

Both use a confidence threshold of 0.15 (deliberately low to prioritize recall; the VLM filters later).
