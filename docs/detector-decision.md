# Detector decision: capture then process, with SAM2.1-tiny

Decided 2026-08-16, on measured evidence. Supersedes the Apple instance mask detector.

## What was measured

| Candidate | Result on 10 real cart photos | Licence | Verdict |
|---|---|---|---|
| Apple `VNGenerateForegroundInstanceMaskRequest` | **1 instance every photo, 0 of ~100 items** | free | dead |
| Vision objectness saliency | 1, sometimes 2, still whole-cart blobs | free | dead |
| Vision attention saliency | 1, often nearly the whole frame | free | dead |
| Vision contours | 6 to 43 kept, dominated by cart mesh, no item separation | free | dead |
| Vision rectangles | 14 to 23, mostly cars, shelving, pavement, zero produce recall | free | dead |
| **SAM2.1-tiny (Apple Core ML)** | **56% mean recall, up to 90% on box-dense carts** | Apache-2.0 | **adopted** |

Latency, SAM2.1-tiny on an M4 Pro Mac: encoder alone 340 to 400ms, cheapest useful config 595ms.
Projected 6x to 30x over a 300ms phone frame budget. Seeded prompting made recall worse (21%).

## Why not the faster models

- **EdgeSAM**: 38.7 FPS on iPhone 14, official Core ML, and the best on-device numbers found
  anywhere. Blocked by licence: NTU S-Lab License 1.0 is non-commercial, verified from the
  LICENSE file. Would need a negotiated commercial agreement.
- **FastSAM**: AGPL-3.0, verified from the LICENSE file, which contradicts its own README.
  Relicensed deliberately by Ultralytics in commit 279ceab. Two copyright holders, both AGPL.
- **MobileSAM, NanoSAM, EfficientSAM, EfficientViT-SAM**: all Apache-2.0, but none has a
  measured iPhone number, and only MobileSAM has any Core ML port (third party).
- **SAM2 streaming**: does not help. Confirmed from `sam2_video_predictor.py` that propagation
  re-runs the full image encoder every frame, its feature cache holds exactly one frame.
  Meta's own EdgeTAM paper measured SAM2 tiny at about 1 FPS on an iPhone 15 Pro Max via
  Core ML. Apple's Core ML conversion ships no memory-attention component at all, so the
  streaming path does not exist on iOS.

## Why capture then process rather than low-rate live detection

1. It removes the latency problem instead of managing it. On one captured frame, 600ms to 2s is
   fine. At 3fps it is not, and no licensed model closes that gap.
2. **The fusion layer already accumulates across keyframes.** The high-water-mark counting rule
   was built to combine several views of the same cart. A user-triggered capture is just a
   keyframe with a different trigger, so the architecture barely changes.
3. Nothing above the detector is affected. Green and amber states, the check mark, the counting
   rule, coaching copy, guided capture, the bag with real photos all survive as built.
4. No shipping product does live per-item segmentation from a handheld phone. Amazon Dash Cart,
   Just Walk Out, Instacart Caper, Veeve, Shopic, Imagr and Trigo all use cart-fixed or
   store-fixed multi-camera rigs, usually with weight sensors. Amazon Lens Live is the closest
   handheld analogue and solves the easier single-object search problem. The absence is evidence.

## What this costs

Live outlines while panning are gone. The user frames the cart, captures, and sees results after
a short think. Several captures accumulate into one bag, which the counting rule already handles.

## Open follow-up that could restore live mode

**EdgeTAM** (Meta, CVPR 2025, `facebookresearch/EdgeTAM`): 15.7 to 16 FPS on an iPhone 15 Pro Max
via Core ML, measured by Meta with Xcode's performance tool, purpose-built as SAM2's on-device
successor. Its licence was not checked in this pass. If it is permissive, live mode becomes
viable and this decision should be revisited.

**RF-DETR-Seg** (Roboflow, Apache-2.0 verified): first-party Swift SDK with Core ML export
targeting the Neural Engine, and a segmentation head. iPhone latency unmeasured. Would need
single-class objectness fine-tuning, for which SKU-110K (1.7M densely packed retail products
under one class) is the established dataset. Best long-term path if training is on the table.

---

# REVISED 2026-08-16, after the EdgeTAM licence check

EdgeTAM is **Apache-2.0 for both the code and the weights**, verified from the LICENSE file, the
GitHub API, the README and the Hugging Face card. It does not follow Meta's usual pattern of a
bespoke weights licence, and there is no acceptable-use policy or usage cap. Only the standard
Apache defensive patent clause applies.

It also ships an **official in-repo Core ML conversion**: image encoder about 9.6MB, prompt
encoder about 2.0MB, mask decoder about 9.8MB, roughly 21MB total.

Measured by Meta with Xcode's performance tool on iOS 18.1, iPhone 15 Pro Max: **15.7 FPS full
video-object-segmentation pipeline**, encoder plus memory attention plus mask decoder together,
against 0.7 FPS for SAM2-B+ on the same hardware. Primary source, arXiv 2501.07256 Table 2 and
Appendix C. Unresolved: the paper does not state whether that figure is single or multi object.

## What this changes

15.7 FPS is about 64ms per frame, comfortably inside the 300ms budget. **Live outlines are back
on the table**, so capture-then-process is no longer the only option.

The important distinction: EdgeTAM is a *tracking* model. It propagates masks it has been
prompted with. It does not enumerate objects any more cheaply than SAM2 does, so the expensive
step of discovering what is in the cart in the first place remains expensive.

## The decision

**Enumerate once, then track live.**

1. On the first frame of a scan, run an enumeration pass to discover the items. This is the
   expensive step, roughly 600ms to 2s, and is exactly the SAM2.1-tiny automatic mask generation
   already measured at 56% recall.
2. Hand those masks to EdgeTAM as prompts and let it propagate them at about 15 FPS while the
   user moves the phone.
3. Re-enumerate occasionally, on a keyframe or when occlusion scoring says the view changed
   materially, to pick up items that were hidden before.

This fits the app's shape almost exactly: one continuous scan of one cart, which is what a
track-anything model is built for. It also preserves everything already built and verified,
including the green and amber states, the check mark, the counting rule, the coaching copy,
guided capture and the bag with real photographs.

It may also subsume or simplify ByteTrack, since EdgeTAM propagates identity itself. That should
be decided by measurement rather than assumed: the existing tracker is verified and the counting
rule depends on its track ids, so the safe first step is to keep it and feed it EdgeTAM's masks.

## What is still unproven

- EdgeTAM has not been run on this project's cart photographs. Its tracking quality on a crowded
  cart with many similar-looking items is unmeasured, and SAM2's own paper flags exactly that
  case as a known weakness.
- Whether the 15.7 FPS figure holds while tracking 10 to 30 objects rather than one.
- Whether items entering the frame mid-scan can be added to an in-flight EdgeTAM session, which
  is a documented rough edge in SAM2 and may be inherited.
- The enumeration pass recall on a phone, as opposed to the 56% measured on a Mac.
