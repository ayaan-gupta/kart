"""
A store's catalog, compiled, and the thing that names a crop against it.

Everything else in this package is a piece. This is the assembly, and it is the object a
deployment holds: build it once from the store's product photographs, then ask it what a
detected crop is.

The pipeline, and why each stage is there rather than a simpler one:

  1. encode the crop
  2. score it against a head trained on this store's catalog, not against the catalog itself.
     Worth 10.8 points over nearest-neighbour lookup, and 16.3 on crowded scenes (head.py).
  3. keep the ten best, which hold the right answer 98.9% of the time. Everything after this
     is reordering, so that number is the hard ceiling.
  4. re-score those ten with evidence the encoder cannot represent: colour layout, and keypoint
     correspondences that must agree on a single homography. Worth 1.3 points overall and 2.2
     on the crowded scenes, from arithmetic on values already computed.
  5. return a calibrated probability, and decline to choose below the floor.

Measured end to end on 465 held-out cart crops against a 200-SKU catalog: 85.6% first choice,
against 65.2% for the MobileCLIP nearest-neighbour lookup this replaces. Full numbers and the negative
results in server/eval/CATALOG.md.

    index = Index.build("catalog/", encoder="siglipb16")
    index.save("index.npz")
    matcher = Matcher(Index.load("index.npz"))
    matcher.match([crop])
"""
import json
import pathlib

import numpy as np

from . import encode, geometry, head, rank

# Fitted by 4-fold cross-validation on scene, averaged over the ten best grid points per fold
# rather than the single best, because one grid point chosen on a couple of hundred queries is
# fit to their noise. Spread across folds is 0.02 to 0.05, so these are stable.
# server/eval/fuse_rerank.py reproduces them.
FUSION = {"head": 0.41, "nearest": 0.04, "color": 0.23, "geometry": 0.32}

# Logistic on the first-to-second margin. Held out, it says 60% and is right 56% of the time,
# says 92% and is right 92%, says 98% and is right 98%. Average gap 1.4 points.
CALIBRATION = (2.25, -0.18)

SHORTLIST = 10
REFERENCES = 3
# Keypoint matching is the expensive stage. Beyond the eighth candidate it is nearly never the
# answer, so those slots score zero and the fusion falls back to the cheaper signals.
GEOMETRY_TOP = 8

# Confidence below which nothing is named and the shopper is asked instead. Measured: 0.59 is
# the lowest floor at which the items added silently are right 90% of the time, and it defers 43
# of 465. Holding out for 95% correct means a floor of 0.88 and asking about 169 of 465, which
# is a different product. An item below the floor is not lost, it is the one the interface
# offers as alternatives, and that shortlist holds the right answer 98.9% of the time.
FLOOR = 0.59

# Below this many reference images a SKU has too little for the head to learn from and the
# whole advantage disappears (head.py). It is a requirement on the store, not a preference.
MIN_REFERENCES = head.MIN_REFERENCES


class Index:
    """A built catalog: features, a trained head, and where the reference images live."""

    def __init__(self, encoder, skus, features, colors, labels, references, weights):
        self.encoder = encoder
        self.skus = list(skus)
        self.features = features
        self.colors = colors
        self.labels = labels
        self.references = [str(p) for p in references]
        self.weights = weights
        self.groups = [np.flatnonzero(labels == s) for s in range(len(self.skus))]

    @classmethod
    def build(cls, root, encoder="siglipb16", log=print):
        """Compiles a directory of `root/<sku>/*.jpg` into an index.

        One directory per product, its photographs inside. That is the shape a store can
        actually produce, and it is the shape a turntable rig writes out.
        """
        from PIL import Image

        root = pathlib.Path(root)
        paths, labels, skus = [], [], []
        for folder in sorted(p for p in root.iterdir() if p.is_dir()):
            images = sorted(
                q for q in folder.iterdir() if q.suffix.lower() in {".jpg", ".jpeg", ".png"}
            )
            if len(images) < MIN_REFERENCES:
                log(f"  skipping {folder.name}: {len(images)} images, needs {MIN_REFERENCES}")
                continue
            skus.append(folder.name)
            paths += images
            labels += [len(skus) - 1] * len(images)
        if not skus:
            raise ValueError(f"no product folder under {root} had {MIN_REFERENCES} images")

        labels = np.array(labels)
        loaded = [Image.open(p).convert("RGB") for p in paths]
        log(f"  encoding {len(loaded)} references across {len(skus)} SKUs")
        prepare, run = encode.load(encoder)
        features = encode.embed(loaded, prepare, run)
        prepare, run = encode.load("color")
        colors = encode.embed(loaded, prepare, run)
        weights, held = head.train(features, labels, len(skus), log=log)
        log(f"  head trained, held-out catalog accuracy {held:.1%}")
        return cls(encoder, skus, features, colors, labels, paths, weights)

    def save(self, path):
        path = pathlib.Path(path)
        np.savez(
            path,
            features=self.features,
            colors=self.colors,
            labels=self.labels,
            weights=self.weights,
        )
        path.with_suffix(".json").write_text(
            json.dumps({"encoder": self.encoder, "skus": self.skus,
                        "references": self.references})
        )

    @classmethod
    def load(cls, path):
        path = pathlib.Path(path)
        arrays = np.load(path)
        meta = json.loads(path.with_suffix(".json").read_text())
        return cls(
            meta["encoder"], meta["skus"], arrays["features"], arrays["colors"],
            arrays["labels"], meta["references"], arrays["weights"],
        )


class Matcher:
    """Names crops against a built index. Loads its encoders on first use."""

    def __init__(self, index, fusion=None, calibration=CALIBRATION, floor=FLOOR,
                 shortlist=SHORTLIST, references=REFERENCES, geometry_top=GEOMETRY_TOP):
        self.index = index
        self.fusion = dict(fusion or FUSION)
        self.calibration = calibration
        self.floor = floor
        self.shortlist = shortlist
        self.references = references
        self.geometry_top = geometry_top
        self._encoders = {}
        self._described = {}

    def _encode(self, name, images):
        if name not in self._encoders:
            self._encoders[name] = encode.load(name)
        prepare, run = self._encoders[name]
        return encode.embed(images, prepare, run)

    def _reference_described(self, crop):
        path = self.index.references[crop]
        if path not in self._described:
            self._described[path] = geometry.describe(path)
        return self._described[path]

    def match(self, images):
        """One result per image: the chosen SKU or None, a confidence, and the runners-up."""
        if not images:
            return []
        index = self.index
        queries = self._encode(index.encoder, images)
        query_colors = self._encode("color", images)

        trained = head.score(queries, index.weights)
        similarity = queries @ index.features.T
        nearest = np.stack(
            [np.array([row[g].max() for g in index.groups]) for row in similarity]
        )
        color_similarity = query_colors @ index.colors.T
        order = rank.shortlist(trained, self.shortlist)

        results = []
        for q, row in enumerate(order):
            # Each candidate is represented by the few of its reference views that most
            # resemble this crop, rather than by an arbitrary few, so colour and geometry are
            # both answering a question about the same views.
            refs = [
                index.groups[sku][np.argsort(-similarity[q, index.groups[sku]])[: self.references]]
                for sku in row
            ]
            signals = {
                "head": rank.standardize(trained[q, row]),
                "nearest": rank.standardize(nearest[q, row]),
                "color": rank.standardize(
                    np.array([color_similarity[q, r].max() for r in refs])
                ),
            }
            if "geometry" in self.fusion:
                described = geometry.describe_image(images[q])
                counts = np.zeros(len(row))
                for slot in range(min(self.geometry_top, len(row))):
                    counts[slot] = max(
                        geometry.inliers(described, self._reference_described(int(c)))
                        for c in refs[slot]
                    )
                signals["geometry"] = rank.standardize(counts, log=True)
            fused = rank.fuse(signals, self.fusion)
            results.append(
                rank.decide(index.skus, row, fused, self.calibration, self.floor)
            )
        return results
