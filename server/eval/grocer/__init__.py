"""The Grocer-Help corpus: real store shelves, densely packed, heavily occluded.

Everything measured before this file used RPC, which photographs products spread out on a
white tray. That corpus answers "can the encoder tell these two packages apart" and nothing
else. It cannot answer the questions the product is actually judged on, because it contains no
occlusion, no clutter, no shelf edges, no price tags, and no depth.

This corpus does. It is 6,289 distinct photographs of Indian grocery shelves, freezers and
baskets carrying 84,743 labelled instances across 623 product classes. It ships as 7,430
photographs; 1,141 of those are exact byte-for-byte duplicates of another, so anything that
counts files rather than pixels overstates the corpus by 18% and, worse, splits copies of one
photograph across both sides of a train/test boundary.

Three properties of the labels have to be understood before any number from it means anything,
and each one is load-bearing:

1. **Two label formats are mixed.** 5,202 files are YOLO detection (`class cx cy w h`), 317 are
   YOLO segmentation polygons (`class x1 y1 x2 y2 ...`), and 858 files contain both, which is
   16% of all instances. Reading a polygon line as a box parses without error and returns
   geometry that is simply wrong, so the failure is silent: the first pass at this corpus
   rendered those boxes, called the labels noisy, and was itself the bug. `load_label` handles
   both formats.

2. **Annotation is partial.** Many clearly visible products carry no box, either because their
   brand is outside the corpus vocabulary or because the annotator stopped. This is fatal for
   precision and mAP, which count an unlabelled-but-correctly-found product as a false positive,
   and harmless for recall and for crop classification, which only ever ask about boxes that do
   exist. Report accordingly.

3. **Classes are brand-level, not SKU-level, and inconsistently so.** `Aashirvaad` covers that
   brand's atta, besan and chilli powder alike, while `Butter_Amul` and `Biscuits_Biscoff_Lotus`
   name a single product. The vocabulary also carries spelling duplicates for one product
   (`CocaCola`/`Cocacola`, `Baggrys`/`Bagrrys`). So naming accuracy here is brand-or-product
   accuracy, an easier question than SKU accuracy on some classes and an unwinnable one on the
   duplicate pairs. `ALIASES` records the duplicates; nothing merges them silently.

The provided train/valid directories are not a usable split: 69 photographs appear in both by
filename and 1,141 appear more than once by content, so scoring against them leaks. `scenes()`
pools everything and dedupes by content hash, and `split()` divides by photograph, never by
crop, because two crops from one photograph share lighting, camera, angle and often the product
itself.
"""

from .corpus import (
    ALIASES,
    Crop,
    Scene,
    canonical,
    load_label,
    load_names,
    materialize,
    scenes,
    silhouette_fill,
    split,
)

__all__ = [
    "ALIASES",
    "Crop",
    "Scene",
    "canonical",
    "load_label",
    "load_names",
    "materialize",
    "scenes",
    "silhouette_fill",
    "split",
]
