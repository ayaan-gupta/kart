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

Measured end to end on 465 held-out cart crops against a 200-SKU catalog: 88.0% first choice,
or 89.7% with a fine-tuned index, against 65.2% for the MobileCLIP nearest-neighbour lookup this
replaces. The shortlist behind those holds the right answer 98.9% of the time, so what remains is
a choice among ten candidates rather than a recognition problem. Full numbers and the negative
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
# Fitted by four-fold cross-validation on scene, averaged over the best few grid points rather
# than the single best, since one grid point chosen on a couple of hundred queries is fit to its
# noise. Measured on the shipped configuration, which is the two-encoder ensemble with five-view
# queries, and that combination changes the answer:
#
#     signals                          R@1     hard
#     head alone                     88.0%    86.3%
#     head + geometry                88.0%    87.2%
#     head + colour + geometry       88.0%    86.3%
#     all four                       87.5%    86.3%
#
# Averaging five views moves a query towards its class centre and away from any single catalog
# crop. The head models class centres, so it gains; a nearest-neighbour lookup compares against
# individual crops, so it loses, falling from 88.4% to 80.2% on its own. Carrying it into the
# fusion then costs half a point. Colour is neutral overall and a point worse on the stacked
# scenes, which is where it matters. Both are kept at zero rather than deleted, so the weights
# read as a measurement rather than an omission.
FUSION = {"head": 0.65, "nearest": 0.0, "color": 0.0, "geometry": 0.35}

# Fitted on a fine-tuned single encoder WITHOUT five-view queries, which is the one configuration
# here not measured as shipped: reproducing it needs the fine-tuned weights, and the runs that
# produced these saved embeddings rather than the model. Anyone fine-tuning should refit these
# against their own index. The shape is expected to move the same way the frozen one did, since
# the cause is what averaging does to a lookup, not anything specific to frozen features.
FUSION_FINETUNED = {"head": 0.38, "nearest": 0.22, "color": 0.12, "geometry": 0.28}

# Logistic on the first-to-second margin, held out.
CALIBRATION = (2.41, -0.38)
CALIBRATION_FINETUNED = (1.87, 0.05)

SHORTLIST = 10

# How many candidates travel back with a result. The census step names a region by choosing from
# this list (`MAX_CANDIDATES` in server/src/enumerate.ts), so it is the width of the question the
# model is asked, and three was narrower than the endpoint believed it was: the API offered five
# slots and the matcher could structurally never fill more than three of them.
ALTERNATIVES = 5

REFERENCES = 3
# Keypoint matching is the expensive stage. Beyond the eighth candidate it is nearly never the
# answer, so those slots score zero and the fusion falls back to the cheaper signals.
GEOMETRY_TOP = 8

# Confidence below which nothing is named and the shopper is asked instead. Measured as the
# lowest floor at which the items added silently are right 90% of the time.
#
#     configuration                  floor   covers   actually right   asks about
#     frozen ensemble, five views     0.51    95.1%           90.3%    23 of 465
#     fine-tuned ensemble             0.48    99.4%           90.0%     3 of 465
#
# An item below the floor is not lost. It is the one the interface offers as alternatives, and
# that shortlist holds the right answer 99.4% of the time, so the question put to the shopper
# almost always contains its own answer.
FLOOR = 0.51
FLOOR_FINETUNED = 0.48

# Below this many reference images a SKU has too little for the head to learn from and the
# whole advantage disappears (head.py). It is a requirement on the store, not a preference.
MIN_REFERENCES = head.MIN_REFERENCES

# Context kept around a detector's box before matching it.
#
# Not cosmetic and not free to change. Every number in CATALOG.md was measured on crops taken
# with exactly this margin, because a box drawn tight against a package clips the logo often
# enough to matter, and a wider one drags in the neighbouring product. Whoever crops in
# production must use this, or the crops stop resembling the ones the head was trained on.
CROP_PADDING = 0.08

# The smallest crop worth asking about. Below this there is no legible brand mark left and the
# answer is noise wearing a confidence.
MIN_CROP_PX = 24

# References decoded at once while building an index. Bounds peak memory during import, which
# is the only stage that touches the whole catalog at all.
ENCODE_CHUNK = 512

# Two encoders, not one, and not three. Four-fold cross-validation over 60 scenes, three seeds,
# standard deviation under half a point throughout:
#
#     frozen                                   R@1     hard
#     SigLIP-B/16 alone                      84.0%    81.1%
#     SigLIP2-L alone                        80.9%    75.9%
#     both                                   86.1%    83.1%
#     both plus MobileCLIP                   84.7%    82.7%
#
# SigLIP2-L is the weaker of the two on its own and adding it is worth 2.1 points, which is the
# whole point of an ensemble: what it needs from a member is different errors, not fewer of
# them. MobileCLIP is a third opinion that agrees too often with the first two and costs
# accuracy rather than buying it.
#
# Fine-tuning adds its own tower in front of these, giving 89.2% and 87.1% on the stacked
# scenes, because a fine-tuned tower and the frozen one it came from disagree usefully too.
DEFAULT_ENCODERS = ("siglipb16", "siglip2l16")

# Reference crops whose keypoints stay in memory. Each is a few hundred descriptors, so a few
# hundred kilobytes, and the set of crops a long-running matcher touches grows towards the whole
# catalog. Unbounded, a hundred thousand reference catalog would eventually hold tens of
# gigabytes of descriptors for crops it last needed hours ago.
DESCRIPTOR_CACHE = 2048


class Index:
    """A built catalog: features, a trained head, and where the reference images live."""

    def __init__(self, encoder, skus, features, colors, labels, references, weights,
                 encoder_state=None):
        # One name or several. Several are concatenated, and it is worth 2.5 points: encoders
        # disagree about different crops, so a head over both feature spaces can use whichever
        # one happens to be right. The clearest evidence is that SigLIP2-L, the weakest encoder
        # measured on its own, contributes the most of any addition, because what an ensemble
        # needs from a member is different errors rather than fewer of them.
        self.encoders = [encoder] if isinstance(encoder, str) else list(encoder)
        # Fine-tuned weights, keyed by which encoder they belong to. Only one member of an
        # ensemble is normally fine-tuned, and loading them into the wrong tower would compare
        # crops against a catalog encoded by a different model, which fails quietly.
        self.encoder_state = encoder_state or {}
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

    @property
    def encoder(self):
        """The single encoder, for the common case. Raises rather than guessing on an ensemble."""
        if len(self.encoders) != 1:
            raise AttributeError(f"this index has {len(self.encoders)} encoders; use .encoders")
        return self.encoders[0]

    @classmethod
    def build(cls, root, encoder=DEFAULT_ENCODERS, finetune_epochs=0, log=print):
        """Compiles a directory of `root/<sku>/*.jpg` into an index.

        One directory per product, its photographs inside. That is the shape a store can
        actually produce, and it is the shape a turntable rig writes out.

        `encoder` may name one encoder or several. Several are concatenated and it is worth 2.5
        points, because what an ensemble needs from a member is different errors rather than
        fewer of them: the weakest encoder measured alone contributes the most of any addition.

        `finetune_epochs` above zero moves the first encoder itself rather than only the head on
        top of it. Worth 5.9 points and tens of minutes per epoch, so it is off by default and
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
        names = [encoder] if isinstance(encoder, str) else list(encoder)
        log(f"  encoding {len(paths)} references across {len(skus)} SKUs "
            f"with {', '.join(names)}")
        image_encoders = [encode.load(n) for n in names]
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
            feature_chunks.append(
                _stack([encode.embed(loaded, *e) for e in image_encoders])
            )
            color_chunks.append(encode.embed(loaded, *color_encoder))
            log(f"  {min(start + ENCODE_CHUNK, len(paths))}/{len(paths)}")
        features = np.concatenate(feature_chunks)
        colors = np.concatenate(color_chunks)
        weights, held = head.train(features, labels, len(skus), log=log)
        log(f"  head trained, held-out catalog accuracy {held:.1%}")
        if not finetune_epochs:
            return cls(names, skus, features, colors, labels, paths, weights)

        log(f"  fine-tuning {names[0]} for {finetune_epochs} epochs")
        visual, weights = finetune.train(
            paths, labels, len(skus), names[0],
            head.prototypes(features, labels, len(skus)),
            epochs=finetune_epochs, log=log,
        )
        # The fine-tuned tower joins the ensemble rather than replacing the frozen one it came
        # from: the two disagree usefully, and keeping both is worth 0.7 points over dropping
        # the frozen copy. The suffix is what keeps them apart as dictionary keys.
        tuned = f"{names[0]}:ft"
        state = {tuned: finetune.state_dict(visual)}
        names = [tuned] + names
        # Re-encoded through the same load path the matcher will use, so a mistake in restoring
        # the weights shows up here at build time rather than as quietly worse matching later.
        rebuilt = [encode.load(n, state.get(n)) for n in names]
        features = np.concatenate(
            [
                _stack([
                    encode.embed(
                        [Image.open(q).convert("RGB") for q in paths[s : s + ENCODE_CHUNK]], *e
                    )
                    for e in rebuilt
                ])
                for s in range(0, len(paths), ENCODE_CHUNK)
            ]
        )
        # The head was fitted on the fine-tuned tower alone; the features it will now score are
        # the concatenation, so it has to be refitted over the space that actually ships.
        weights, held = head.train(features, labels, len(skus), log=log)
        log(f"  head refitted over {len(names)} encoders, held-out {held:.1%}")
        return cls(names, skus, features, colors, labels, paths, weights, state)

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
        if self.encoder_state:
            import torch

            torch.save(self.encoder_state, path.with_name(path.stem + "-encoder.pt"))
        path.with_suffix(".json").write_text(
            json.dumps({"encoders": self.encoders, "skus": self.skus,
                        "references": self.references,
                        "finetuned": sorted(self.encoder_state)})
        )

    @classmethod
    def load(cls, path):
        path = pathlib.Path(path).with_suffix(".npz")
        arrays = np.load(path)
        meta = json.loads(path.with_suffix(".json").read_text())
        state = {}
        if meta.get("finetuned"):
            import torch

            state = torch.load(path.with_name(path.stem + "-encoder.pt"), map_location="cpu")
        # "encoder" is the older single-name key. Read either, so an index built before
        # ensembles existed still loads rather than failing on a missing field.
        names = meta.get("encoders") or [meta["encoder"]]
        return cls(
            names, meta["skus"], arrays["features"], arrays["colors"],
            arrays["labels"], meta["references"], arrays["weights"], state,
        )


# Extra looks at each query crop, averaged. Worth 1.9 points overall and 3.2 on the stacked
# scenes, for no training and no new model. A crop out of a cart is one arbitrary framing of a
# product: a few pixels more or less around the edge, a few degrees of rotation, and the encoder
# lands somewhere else. Averaging over several framings cancels that, and it cancels most on the
# crowded scenes, where the framing is worst.
#
# Applied to queries only, which is what was measured. The catalog side already has a hundred
# genuine views per SKU and does not need synthetic ones.
TTA_VIEWS = True
# No horizontal flip anywhere in here. Packaging carries text and mirrored text is not a thing
# the encoder will ever see in a cart, so a flipped view is a vote from evidence that cannot
# occur. Rotations stay small for the same reason.
TTA_CROPS = (0.9, 0.8)
TTA_ROTATIONS = (5, -5)


def views(image):
    """The framings one crop is scored under. The first is always the crop itself."""
    width, height = image.size
    out = [image]
    for fraction in TTA_CROPS:
        dx, dy = int(width * (1 - fraction) / 2), int(height * (1 - fraction) / 2)
        out.append(image.crop((dx, dy, width - dx, height - dy)))
    for degrees in TTA_ROTATIONS:
        out.append(image.rotate(degrees, expand=True, fillcolor=(255, 255, 255)))
    return out


def _stack(blocks):
    """Concatenates per-encoder features into one row per image, unit length overall.

    Each block is normalized before joining so a model with larger raw activations cannot
    dominate the concatenation, and the result is normalized again so the head still sees a
    cosine.
    """
    if len(blocks) == 1:
        return blocks[0]
    parts = [b / (np.linalg.norm(b, axis=-1, keepdims=True) + 1e-9) for b in blocks]
    joined = np.concatenate(parts, axis=1)
    return joined / (np.linalg.norm(joined, axis=-1, keepdims=True) + 1e-9)


def crop_region(image, box):
    """A padded crop for one normalized box, or None if there is too little of it to read.

    `box` is {x, y, w, h} normalized to the frame with origin top-left, which is the convention
    every coordinate in this codebase uses.
    """
    width, height = image.size
    pad_x, pad_y = box["w"] * CROP_PADDING, box["h"] * CROP_PADDING
    left = max(0, int((box["x"] - pad_x) * width))
    top = max(0, int((box["y"] - pad_y) * height))
    right = min(width, int((box["x"] + box["w"] + pad_x) * width))
    bottom = min(height, int((box["y"] + box["h"] + pad_y) * height))
    if right - left < MIN_CROP_PX or bottom - top < MIN_CROP_PX:
        return None
    return image.crop((left, top, right, bottom))


class Matcher:
    """Names crops against a built index. Loads its encoders on first use."""

    def __init__(self, index, fusion=None, calibration=None, floor=None,
                 shortlist=SHORTLIST, references=REFERENCES, geometry_top=GEOMETRY_TOP,
                 descriptor_cache=DESCRIPTOR_CACHE, tta=TTA_VIEWS):
        self.index = index
        self.tta = tta
        # Defaults follow the index rather than the call site. Handing a fine-tuned index the
        # frozen weights is not an error anything would raise; it just matches slightly worse,
        # which is the kind of mistake that survives review and never gets found.
        finetuned = bool(index.encoder_state)
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
            self._encoders[name] = encode.load(name, self.index.encoder_state.get(name))
        prepare, run = self._encoders[name]
        # Colour is a nine-cell histogram, and averaging it over rotations and crops blurs the
        # very layout it exists to describe. Only the learned encoders get extra views.
        if not self.tta or name == "color" or not images:
            return encode.embed(images, prepare, run)

        expanded, counts = [], []
        for image in images:
            look = views(image)
            expanded.extend(look)
            counts.append(len(look))
        vectors = encode.embed(expanded, prepare, run)
        out, at = [], 0
        for count in counts:
            block = vectors[at : at + count].mean(axis=0)
            out.append(block / (np.linalg.norm(block) + 1e-9))
            at += count
        return np.stack(out).astype(np.float32)

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

    def match_regions(self, image, boxes):
        """Matches one frame's detected regions. Returns one entry per box, or None for a box
        too small to read.

        Aligned with `boxes` by position rather than filtered, because the caller has already
        numbered these regions and a shorter list would silently shift every number after the
        first unreadable one. That renumbering is the exact failure set-of-mark prompting is
        most vulnerable to: the model reports an answer for badge 7 and it lands on badge 8.
        """
        crops, slots = [], []
        for i, box in enumerate(boxes):
            piece = crop_region(image, box)
            if piece is not None:
                crops.append(piece)
                slots.append(i)
        out = [None] * len(boxes)
        for slot, result in zip(slots, self.match(crops)):
            out[slot] = result
        return out

    def match(self, images, detail=False):
        """One result per image: the chosen SKU or None, a confidence, and the runners-up.

        `detail` adds the full ranked shortlist under `"shortlist"` and the unweighted signals
        that produced it under `"signals"`. It is off by default because nothing in the product
        needs either and every result crosses a network, and on in the eval harness, which
        measures the ceiling the shortlist sets on everything downstream and refits the fusion
        weights. Both go through this one code path so the measurement describes what ships.
        """
        if not images:
            return []
        index = self.index
        # Concatenated in the index's own order and renormalized, exactly as the catalog side
        # was built. A different order here would silently compare one encoder's features
        # against another's.
        queries = _stack([self._encode(name, images) for name in index.encoders])
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
            decided = rank.decide(
                index.skus, row, fused, self.calibration, self.floor, ALTERNATIVES
            )
            if detail:
                ranking = np.argsort(-fused)
                decided["shortlist"] = [index.skus[row[i]] for i in ranking]
                # The signals as the fusion saw them, before weighting. Every constant in this
                # file was fitted on one feature set and is a property of that feature set, not
                # of the task, so a new corpus has to refit them or it inherits weights chosen
                # for features it does not have. Returning the signals means that refit costs
                # one encode of the corpus rather than one per candidate weighting.
                decided["signals"] = {
                    k: [float(v[i]) for i in ranking] for k, v in signals.items()
                }
            results.append(decided)
        return results
