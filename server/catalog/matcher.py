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
or 88.0% with a fine-tuned index, against 65.2% for the MobileCLIP nearest-neighbour lookup this
replaces. Full numbers and the negative
results in server/eval/CATALOG.md.

    index = Index.build("catalog/", encoder="siglipb16")
    index.save("index.npz")
    matcher = Matcher(Index.load("index.npz"))
    matcher.match([crop])
"""
import collections
import json
import pathlib

import numpy as np

from . import encode, finetune, geometry, head, rank

# Fitted by 4-fold cross-validation on scene, averaged over the ten best grid points per fold
# rather than the single best, because one grid point chosen on a couple of hundred queries is
# fit to their noise. Spread across folds is 0.02 to 0.05, so these are stable.
# server/eval/fuse_rerank.py reproduces them.
FUSION = {"head": 0.41, "nearest": 0.04, "color": 0.23, "geometry": 0.32}

# A fine-tuned index needs its own weights, and the reason is worth stating rather than tuning
# around. The head and the fine-tune do the same job: both learn what separates this store's
# products. Once the encoder itself has learned it, a plain nearest-neighbour lookup in that
# space scores 87.1% against the head's 86.5%, and the fusion moves almost all of the weight
# across accordingly. On a frozen encoder the same comparison is 73.5% against 84.3%.
FUSION_FINETUNED = {"head": 0.08, "nearest": 0.42, "color": 0.15, "geometry": 0.35}

# Logistic on the first-to-second margin. Held out, the frozen one says 60% and is right 56% of
# the time, says 92% and is right 92%, says 98% and is right 98%. Average gap 1.4 points; the
# fine-tuned one, 2.1.
CALIBRATION = (2.25, -0.18)
CALIBRATION_FINETUNED = (2.17, -0.23)

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
# The same 90% target on a fine-tuned index, which reaches it while deferring 31 rather than 43.
FLOOR_FINETUNED = 0.62

# Below this many reference images a SKU has too little for the head to learn from and the
# whole advantage disappears (head.py). It is a requirement on the store, not a preference.
MIN_REFERENCES = head.MIN_REFERENCES

# References decoded at once while building an index. Bounds peak memory during import, which
# is the only stage that touches the whole catalog at all.
ENCODE_CHUNK = 512

# Reference crops whose keypoints stay in memory. Each is a few hundred descriptors, so a few
# hundred kilobytes, and the set of crops a long-running matcher touches grows towards the whole
# catalog. Unbounded, a hundred thousand reference catalog would eventually hold tens of
# gigabytes of descriptors for crops it last needed hours ago.
DESCRIPTOR_CACHE = 2048


class Index:
    """A built catalog: features, a trained head, and where the reference images live."""

    def __init__(self, encoder, skus, features, colors, labels, references, weights,
                 encoder_state=None):
        self.encoder = encoder
        # Present only for a fine-tuned index. The features and the head were produced by these
        # weights, so a matcher that loaded the pretrained ones instead would be comparing
        # against a catalog encoded by a different model, which fails quietly rather than loudly.
        self.encoder_state = encoder_state
        self.skus = list(skus)
        self.features = features
        self.colors = colors
        self.labels = labels
        self.references = [str(p) for p in references]
        self.weights = weights
        self.groups = [np.flatnonzero(labels == s) for s in range(len(self.skus))]
        # The same grouping as a rectangular table, padded, with a mask marking the real
        # entries. Scoring every SKU then costs one numpy call per crop instead of one Python
        # iteration per SKU per crop, which at a five thousand product catalog is the
        # difference between a matmul and a third of a million interpreted loop steps.
        widest = max(len(g) for g in self.groups)
        self.group_table = np.zeros((len(self.skus), widest), dtype=np.int64)
        self.group_mask = np.zeros((len(self.skus), widest), dtype=bool)
        for sku, crops in enumerate(self.groups):
            self.group_table[sku, : len(crops)] = crops
            self.group_mask[sku, : len(crops)] = True

    @classmethod
    def build(cls, root, encoder="siglipb16", finetune_epochs=0, log=print):
        """Compiles a directory of `root/<sku>/*.jpg` into an index.

        One directory per product, its photographs inside. That is the shape a store can
        actually produce, and it is the shape a turntable rig writes out.

        `finetune_epochs` above zero moves the encoder itself rather than only the head on top
        of it. Worth 5.9 points and tens of minutes per epoch, so it is off by default and
        chosen deliberately. One epoch is the measured optimum and more costs accuracy; see
        finetune.py, including why a store needs labelled carts to use this safely.
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
        log(f"  encoding {len(paths)} references across {len(skus)} SKUs")
        image_encoder = encode.load(encoder)
        color_encoder = encode.load("color")
        # Decoded in chunks, not all at once. A five thousand product catalog at twenty views
        # each is a hundred thousand images, which is tens of gigabytes held as decoded pixels
        # and an out-of-memory crash on the one machine that matters, the one doing the import.
        # Both encoders run on the same chunk so each file is read from disk once.
        feature_chunks, color_chunks = [], []
        for start in range(0, len(paths), ENCODE_CHUNK):
            loaded = [
                Image.open(p).convert("RGB") for p in paths[start : start + ENCODE_CHUNK]
            ]
            feature_chunks.append(encode.embed(loaded, *image_encoder))
            color_chunks.append(encode.embed(loaded, *color_encoder))
            log(f"  {min(start + ENCODE_CHUNK, len(paths))}/{len(paths)}")
        features = np.concatenate(feature_chunks)
        colors = np.concatenate(color_chunks)
        weights, held = head.train(features, labels, len(skus), log=log)
        log(f"  head trained, held-out catalog accuracy {held:.1%}")
        if not finetune_epochs:
            return cls(encoder, skus, features, colors, labels, paths, weights)

        log(f"  fine-tuning the encoder for {finetune_epochs} epochs")
        visual, weights = finetune.train(
            paths, labels, len(skus), encoder,
            head.prototypes(features, labels, len(skus)),
            epochs=finetune_epochs, log=log,
        )
        state = finetune.state_dict(visual)
        # Re-encoded through the same load path the matcher will use, so a mistake in restoring
        # the weights shows up here at build time rather than as quietly worse matching later.
        image_encoder = encode.load(encoder, state)
        features = np.concatenate(
            [
                encode.embed(
                    [Image.open(q).convert("RGB") for q in paths[s : s + ENCODE_CHUNK]],
                    *image_encoder,
                )
                for s in range(0, len(paths), ENCODE_CHUNK)
            ]
        )
        return cls(encoder, skus, features, colors, labels, paths, weights, state)

    def save(self, path):
        # np.savez appends .npz when it is missing, so without this the sidecar json and the
        # arrays end up under names that load() cannot pair back up.
        path = pathlib.Path(path).with_suffix(".npz")
        np.savez(
            path,
            features=self.features,
            colors=self.colors,
            labels=self.labels,
            weights=self.weights,
        )
        if self.encoder_state is not None:
            import torch

            torch.save(self.encoder_state, path.with_name(path.stem + "-encoder.pt"))
        path.with_suffix(".json").write_text(
            json.dumps({"encoder": self.encoder, "skus": self.skus,
                        "references": self.references,
                        "finetuned": self.encoder_state is not None})
        )

    @classmethod
    def load(cls, path):
        path = pathlib.Path(path).with_suffix(".npz")
        arrays = np.load(path)
        meta = json.loads(path.with_suffix(".json").read_text())
        state = None
        if meta.get("finetuned"):
            import torch

            state = torch.load(path.with_name(path.stem + "-encoder.pt"), map_location="cpu")
        return cls(
            meta["encoder"], meta["skus"], arrays["features"], arrays["colors"],
            arrays["labels"], meta["references"], arrays["weights"], state,
        )


class Matcher:
    """Names crops against a built index. Loads its encoders on first use."""

    def __init__(self, index, fusion=None, calibration=None, floor=None,
                 shortlist=SHORTLIST, references=REFERENCES, geometry_top=GEOMETRY_TOP,
                 descriptor_cache=DESCRIPTOR_CACHE):
        self.index = index
        # Defaults follow the index rather than the call site. Handing a fine-tuned index the
        # frozen weights is not an error anything would raise; it just matches slightly worse,
        # which is the kind of mistake that survives review and never gets found.
        finetuned = index.encoder_state is not None
        self.fusion = dict(fusion or (FUSION_FINETUNED if finetuned else FUSION))
        self.calibration = calibration or (
            CALIBRATION_FINETUNED if finetuned else CALIBRATION
        )
        self.floor = FLOOR_FINETUNED if finetuned else FLOOR
        if floor is not None:
            self.floor = floor
        self.shortlist = shortlist
        self.references = references
        self.geometry_top = geometry_top
        self._encoders = {}
        self._described = collections.OrderedDict()
        self._descriptor_cache = descriptor_cache

    def _encode(self, name, images):
        if name not in self._encoders:
            state = self.index.encoder_state if name == self.index.encoder else None
            self._encoders[name] = encode.load(name, state)
        prepare, run = self._encoders[name]
        return encode.embed(images, prepare, run)

    def _reference_described(self, crop):
        """Keypoints for one reference crop, cached with the least recently used dropped."""
        path = self.index.references[crop]
        if path in self._described:
            self._described.move_to_end(path)
        else:
            self._described[path] = geometry.describe(path)
            if len(self._described) > self._descriptor_cache:
                self._described.popitem(last=False)
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
            [
                np.where(index.group_mask, row[index.group_table], -np.inf).max(axis=1)
                for row in similarity
            ]
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
