"""
Tests for the catalog matcher.

These cover the parts where a mistake is silent. A reranker that quietly lets one signal
dominate, or a confidence that is monotonic but meaningless, still produces plausible output
on every input, and the eval harness would report a slightly worse number without ever saying
why. So the properties asserted here are the ones the arithmetic is supposed to guarantee,
not the shapes of the arrays.

    pytest server/catalog/test_catalog.py
"""
import numpy as np
import pytest

from catalog import geometry, head, rank


# ---- shortlist -------------------------------------------------------------------------


def test_shortlist_is_ordered_best_first():
    scores = np.array([[0.1, 0.9, 0.5, 0.7]])
    assert rank.shortlist(scores, 3).tolist() == [[1, 3, 2]]


def test_shortlist_clamps_to_the_number_of_candidates():
    scores = np.array([[0.2, 0.4]])
    assert rank.shortlist(scores, 10).tolist() == [[1, 0]]


def test_shortlist_handles_each_query_independently():
    scores = np.array([[0.9, 0.1], [0.1, 0.9]])
    assert rank.shortlist(scores, 1).tolist() == [[0], [1]]


# ---- standardization and fusion --------------------------------------------------------


def test_standardize_removes_scale_so_a_wide_signal_cannot_dominate():
    """The reason this function exists.

    Cosine similarity varies over hundredths; inlier counts vary over hundreds. Summing them
    raw would let the counts decide every case regardless of weight. After standardizing, a
    weight of 0.5 each has to mean each contributes half.
    """
    narrow = np.array([[0.70, 0.71, 0.69]])
    wide = np.array([[10.0, 500.0, 3.0]])
    fused = rank.fuse(
        {"a": rank.standardize(narrow), "b": rank.standardize(wide)}, {"a": 0.5, "b": 0.5}
    )
    # Candidate 1 is best on both, so it must win; candidate 2 is worst on both, so it loses.
    assert fused.argmax() == 1
    assert fused.argmin() == 2
    # And the narrow signal is not merely rounding error next to the wide one.
    only_wide = rank.fuse({"b": rank.standardize(wide)}, {"b": 1.0})
    assert abs(fused[0, 0] - fused[0, 2]) > 0.1 * abs(only_wide[0, 0] - only_wide[0, 2])


def test_standardize_disagreement_is_settled_by_weight_not_by_range():
    narrow = np.array([[0.71, 0.70]])  # prefers candidate 0
    wide = np.array([[0.0, 900.0]])  # prefers candidate 1, on a far bigger scale
    assert rank.fuse(
        {"a": rank.standardize(narrow), "b": rank.standardize(wide)}, {"a": 0.9, "b": 0.1}
    ).argmax() == 0
    assert rank.fuse(
        {"a": rank.standardize(narrow), "b": rank.standardize(wide)}, {"a": 0.1, "b": 0.9}
    ).argmax() == 1


def test_log_standardize_keeps_the_order_but_compresses_the_lead():
    """Four hundred keypoint matches beat forty, but not by ten times the evidence."""
    counts = np.array([[400.0, 40.0, 0.0]])
    plain = rank.standardize(counts)
    logged = rank.standardize(counts, log=True)
    assert logged.argmax() == plain.argmax() == 0
    plain_lead = (plain[0, 0] - plain[0, 1]) / (plain[0, 1] - plain[0, 2])
    log_lead = (logged[0, 0] - logged[0, 1]) / (logged[0, 1] - logged[0, 2])
    assert log_lead < plain_lead


def test_standardize_survives_a_signal_that_is_identical_everywhere():
    """Every candidate scoring zero inliers is the common case, not an edge case."""
    flat = rank.standardize(np.zeros((1, 5)), log=True)
    assert np.all(np.isfinite(flat))
    assert np.allclose(flat, 0.0)


def test_fuse_rejects_a_weight_with_no_signal_behind_it():
    with pytest.raises(KeyError):
        rank.fuse({"a": np.zeros((1, 3))}, {"a": 0.5, "geometry": 0.5})


# ---- confidence ------------------------------------------------------------------------


def test_margin_is_the_gap_to_the_runner_up_not_to_the_worst():
    assert rank.margin(np.array([[5.0, 4.0, -10.0]]))[0] == pytest.approx(1.0)


def test_a_single_candidate_has_no_runner_up_to_be_unsure_about():
    assert np.isinf(rank.margin(np.array([[3.0]])))[0]


def test_confidence_rises_with_the_margin_and_stays_a_probability():
    coefficients = (1.4, -0.6)
    values = rank.confidence(np.array([0.0, 0.5, 2.0, 8.0]), coefficients)
    assert np.all(np.diff(values) > 0)
    assert values.min() > 0 and values.max() < 1


def test_decide_declines_rather_than_guessing_below_the_floor():
    fused = np.array([1.01, 1.0, 0.2])
    names = ["milk", "cream", "juice"]
    order = np.array([0, 1, 2])
    close = rank.decide(names, order, fused, (1.0, 0.0), floor=0.9)
    assert close["sku"] is None
    # Declining is not the same as having no opinion: the alternatives are still ranked.
    assert [a["sku"] for a in close["alternatives"]] == ["milk", "cream", "juice"]


def test_decide_names_the_item_when_the_lead_is_clear():
    fused = np.array([9.0, 0.5, 0.1])
    chosen = rank.decide(["milk", "cream", "juice"], np.array([0, 1, 2]), fused, (1.0, 0.0), 0.9)
    assert chosen["sku"] == "milk"
    assert chosen["confidence"] > 0.9


def test_decide_maps_shortlist_slots_back_to_catalog_positions():
    """The fused array is indexed by shortlist slot; the names are indexed by SKU.

    Getting this wrong returns a real product name with someone else's score, which is the
    kind of defect that never raises and never looks wrong in a log.
    """
    names = ["a", "b", "c", "d"]
    order = np.array([3, 1])
    chosen = rank.decide(names, order, np.array([0.1, 9.0]), (1.0, 0.0), floor=0.5)
    assert chosen["sku"] == "b"
    assert [a["sku"] for a in chosen["alternatives"]] == ["b", "d"]


# ---- the trained head ------------------------------------------------------------------


def test_prototypes_are_the_normalized_class_means():
    features = np.array([[1.0, 0.0], [3.0, 0.0], [0.0, 2.0]], dtype=np.float32)
    labels = np.array([0, 0, 1])
    got = head.prototypes(features, labels, 2)
    assert np.allclose(got, [[1.0, 0.0], [0.0, 1.0]], atol=1e-6)


def test_training_separates_classes_that_share_a_direction():
    """The case a lookup and a prototype both get wrong.

    Two SKUs whose reference crops point almost the same way differ only in a small component.
    Averaging keeps the shared direction and drops the difference, so prototypes confuse them.
    A trained head can weight the small component up, and that is the entire reason it is worth
    the retraining cost.
    """
    rng = np.random.default_rng(0)
    shared = np.array([1.0, 0.0, 0.0])
    per_class = 60
    features, labels = [], []
    for sku, tell in enumerate([np.array([0.0, 0.06, 0.0]), np.array([0.0, -0.06, 0.0])]):
        noise = rng.normal(0, 0.25, size=(per_class, 3))
        noise[:, 1] = 0.0  # the only reliable difference is the tell
        block = shared + tell + noise
        features.append(block / np.linalg.norm(block, axis=1, keepdims=True))
        labels += [sku] * per_class
    features = np.concatenate(features).astype(np.float32)
    labels = np.array(labels)

    proto = head.prototypes(features, labels, 2)
    # The whole set is one batch, so an epoch is one optimizer step. A real catalog of twenty
    # thousand crops takes twenty steps an epoch; a hundred and twenty synthetic rows take one.
    trained, _ = head.train(features, labels, 2, epochs=600, seed=1)
    proto_right = (np.argmax(features @ proto.T, axis=1) == labels).mean()
    trained_right = (np.argmax(head.score(features, trained), axis=1) == labels).mean()
    assert trained_right > proto_right
    assert trained_right > 0.9


def test_head_weights_come_back_normalized_so_scores_are_cosines():
    rng = np.random.default_rng(4)
    features = rng.normal(size=(80, 8)).astype(np.float32)
    features /= np.linalg.norm(features, axis=1, keepdims=True)
    labels = np.arange(80) % 4
    trained, _ = head.train(features, labels, 4, epochs=5, seed=2)
    assert np.allclose(np.linalg.norm(trained, axis=1), 1.0, atol=1e-5)
    assert np.abs(head.score(features, trained)).max() <= 1.0 + 1e-5


# ---- geometric verification ------------------------------------------------------------


def textured(seed=0, size=256):
    """A synthetic packet front: enough structure for keypoints, no real product needed."""
    rng = np.random.default_rng(seed)
    image = np.zeros((size, size, 3), dtype=np.uint8)
    for _ in range(40):
        x, y = rng.integers(0, size - 40, size=2)
        w, h = rng.integers(10, 40, size=2)
        image[y : y + h, x : x + w] = rng.integers(0, 255, size=3)
    return image


def test_an_image_matches_a_rotated_scaled_copy_of_itself(tmp_path):
    import cv2

    original = textured(1)
    matrix = cv2.getRotationMatrix2D((128, 128), 12, 0.85)
    warped = cv2.warpAffine(original, matrix, (256, 256))
    a, b = tmp_path / "a.png", tmp_path / "b.png"
    cv2.imwrite(str(a), original)
    cv2.imwrite(str(b), warped)
    assert geometry.inliers(geometry.describe(a), geometry.describe(b)) >= geometry.MIN_MATCHES


def test_unrelated_images_do_not_agree_on_a_geometry(tmp_path):
    import cv2

    a, b = tmp_path / "a.png", tmp_path / "b.png"
    cv2.imwrite(str(a), textured(2))
    cv2.imwrite(str(b), textured(99))
    same = geometry.inliers(geometry.describe(a), geometry.describe(a))
    different = geometry.inliers(geometry.describe(a), geometry.describe(b))
    assert different < same


def test_a_blank_image_yields_no_keypoints_rather_than_raising(tmp_path):
    import cv2

    blank = tmp_path / "blank.png"
    cv2.imwrite(str(blank), np.full((128, 128, 3), 200, dtype=np.uint8))
    assert geometry.describe(blank) == (None, None)
    assert geometry.inliers(geometry.describe(blank), geometry.describe(blank)) == 0


def test_a_missing_file_yields_no_keypoints_rather_than_raising(tmp_path):
    assert geometry.describe(tmp_path / "nope.png") == (None, None)


# ---- the assembled matcher -------------------------------------------------------------


def synthetic_index(tmp_path, skus=6, per_sku=12, dims=16, seed=7):
    """A small index over real image files, with features standing in for a real encoder.

    Building a genuine index would download an encoder and take minutes, which is the eval
    harness's job, not a unit test's. What has to be checked here is the wiring: that the
    shortlist, the reference choice, the two extra signals and the decision all address the
    same candidate. Real files on disk matter because the geometry stage reads them.
    """
    import cv2

    from catalog import matcher as matcher_module

    rng = np.random.default_rng(seed)
    directions = rng.normal(size=(skus, dims))
    directions /= np.linalg.norm(directions, axis=1, keepdims=True)
    colors = rng.random((skus, 8))
    colors /= np.linalg.norm(colors, axis=1, keepdims=True)

    features, color_rows, labels, references = [], [], [], []
    for sku in range(skus):
        for shot in range(per_sku):
            noisy = directions[sku] + rng.normal(0, 0.05, size=dims)
            features.append(noisy / np.linalg.norm(noisy))
            tinted = colors[sku] + rng.normal(0, 0.02, size=8)
            color_rows.append(tinted / np.linalg.norm(tinted))
            labels.append(sku)
            path = tmp_path / f"sku{sku}-{shot}.png"
            cv2.imwrite(str(path), textured(seed=100 + sku))
            references.append(path)

    features = np.array(features, dtype=np.float32)
    labels = np.array(labels)
    weights, _ = head.train(features, labels, skus, epochs=200, seed=1)
    index = matcher_module.Index(
        "stub", [f"sku{i}" for i in range(skus)], features,
        np.array(color_rows, dtype=np.float32), labels, references, weights,
    )
    return index, directions, colors


class StubMatcher:
    """Matcher with the encoders replaced, so no weights are downloaded during a test."""

    def __new__(cls, index, features, colors, **kwargs):
        from catalog import matcher as matcher_module

        instance = matcher_module.Matcher(index, **kwargs)
        instance._encode = lambda name, images: (
            colors if name == "color" else features
        ).astype(np.float32)
        return instance


def test_matcher_names_the_product_the_evidence_points_at(tmp_path):
    import cv2
    from PIL import Image

    index, directions, colors = synthetic_index(tmp_path)
    target = 3
    query_image = Image.fromarray(cv2.cvtColor(textured(seed=100 + target), cv2.COLOR_BGR2RGB))
    got = StubMatcher(
        index,
        directions[target][None, :],
        colors[target][None, :],
    ).match([query_image])
    assert got[0]["sku"] == f"sku{target}"
    assert got[0]["confidence"] > 0.5
    assert len(got[0]["alternatives"]) == 3


def test_matcher_declines_when_nothing_distinguishes_the_candidates(tmp_path):
    from PIL import Image

    index, directions, colors = synthetic_index(tmp_path)
    # Exactly between two products, on a blank crop that yields no keypoints. Every signal is
    # ambivalent, which is the case the floor exists for.
    between = (directions[0] + directions[1]) / 2
    got = StubMatcher(
        index,
        (between / np.linalg.norm(between))[None, :],
        ((colors[0] + colors[1]) / 2)[None, :],
    ).match([Image.fromarray(np.full((128, 128, 3), 210, dtype=np.uint8))])
    assert got[0]["sku"] is None
    assert got[0]["confidence"] < 0.9


def test_matcher_returns_nothing_for_no_crops(tmp_path):
    index, _, _ = synthetic_index(tmp_path)
    assert StubMatcher(index, np.zeros((0, 16)), np.zeros((0, 8))).match([]) == []


def test_index_refuses_a_product_with_too_few_reference_images(tmp_path):
    import cv2

    from catalog import matcher as matcher_module

    thin = tmp_path / "catalog" / "sparse"
    thin.mkdir(parents=True)
    for shot in range(matcher_module.MIN_REFERENCES - 1):
        cv2.imwrite(str(thin / f"{shot}.png"), textured(seed=shot))
    with pytest.raises(ValueError):
        matcher_module.Index.build(tmp_path / "catalog", log=lambda _m: None)


def test_index_round_trips_through_disk(tmp_path):
    from catalog import matcher as matcher_module

    index, _, _ = synthetic_index(tmp_path)
    index.save(tmp_path / "index.npz")
    back = matcher_module.Index.load(tmp_path / "index.npz")
    assert back.skus == index.skus
    assert back.encoder == index.encoder
    assert np.allclose(back.weights, index.weights)
    assert back.references == index.references


def test_descriptor_cache_does_not_grow_without_bound(tmp_path):
    """A long-running matcher touches more of the catalog the longer it runs.

    Each cached entry is a few hundred keypoint descriptors. Left unbounded against a large
    catalog that is tens of gigabytes of crops the matcher last needed hours ago, and it would
    look like a slow leak rather than a bug.
    """
    from PIL import Image

    index, directions, colors = synthetic_index(tmp_path, skus=6, per_sku=12)
    matcher = StubMatcher(
        index, directions[0][None, :], colors[0][None, :], descriptor_cache=4
    )
    for crop in range(20):
        matcher._reference_described(crop)
    assert len(matcher._described) == 4


def test_descriptor_cache_keeps_what_was_used_most_recently(tmp_path):
    index, directions, colors = synthetic_index(tmp_path, skus=6, per_sku=12)
    matcher = StubMatcher(
        index, directions[0][None, :], colors[0][None, :], descriptor_cache=2
    )
    matcher._reference_described(0)
    matcher._reference_described(1)
    matcher._reference_described(0)  # touching 0 again should save it from eviction
    matcher._reference_described(2)
    assert index.references[1] not in matcher._described
    assert index.references[0] in matcher._described


def test_index_round_trips_a_finetuned_encoder(tmp_path):
    """The features and head were produced by these weights.

    A saved index that forgets them loads the pretrained encoder instead and compares crops
    against a catalog encoded by a different model. Nothing raises; matching just gets worse.
    """
    import torch

    from catalog import matcher as matcher_module

    index, _, _ = synthetic_index(tmp_path)
    index.encoder_state = {"block.weight": torch.ones(3, 4), "block.bias": torch.zeros(3)}
    index.save(tmp_path / "index.npz")
    back = matcher_module.Index.load(tmp_path / "index.npz")
    assert back.encoder_state is not None
    assert sorted(back.encoder_state) == ["block.bias", "block.weight"]
    assert torch.equal(back.encoder_state["block.weight"], torch.ones(3, 4))


def test_a_frozen_index_records_that_it_has_no_finetuned_weights(tmp_path):
    from catalog import matcher as matcher_module

    index, _, _ = synthetic_index(tmp_path)
    index.save(tmp_path / "index.npz")
    assert not (tmp_path / "index-encoder.pt").exists()
    assert matcher_module.Index.load(tmp_path / "index.npz").encoder_state is None


def test_matcher_applies_finetuned_weights_to_its_own_encoder_and_not_to_colour(tmp_path):
    """Colour is a histogram, not a network, and has no weights to restore."""
    from catalog import encode, matcher as matcher_module

    index, directions, colors = synthetic_index(tmp_path)
    index.encoder = "siglipb16"
    index.encoder_state = {"pretend": 1}

    asked = {}
    original = encode.load

    def record(name, state=None):
        asked[name] = state
        return (lambda images: images, lambda batch: batch)

    encode.load = record
    try:
        matcher = matcher_module.Matcher(index)
        matcher._encoders = {}
        matcher._encode("siglipb16", [])
        matcher._encode("color", [])
    finally:
        encode.load = original
    assert asked["siglipb16"] == {"pretend": 1}
    assert asked["color"] is None


def test_embedding_nothing_returns_nothing_rather_than_failing():
    """A frame where the detector found nothing is a legitimate call, not a mistake."""
    from catalog import encode

    empty = encode.embed([], lambda images: images, lambda batch: batch)
    assert empty.shape[0] == 0


def test_the_padded_group_table_scores_every_sku_exactly_as_a_plain_loop_would(tmp_path):
    """The vectorized best-reference-per-SKU has to agree with the obvious version.

    Padding a ragged grouping into a rectangle is the kind of change that is easy to get subtly
    wrong: a SKU with fewer references than the widest one carries filler entries, and if the
    mask misses them that SKU is scored against another product's crop.
    """
    index, _, _ = synthetic_index(tmp_path, skus=5, per_sku=11)
    # Make the groups ragged, which is the case padding exists for and the uniform case hides.
    index.groups[2] = index.groups[2][:3]
    index.groups[4] = index.groups[4][:7]
    widest = max(len(g) for g in index.groups)
    index.group_table = np.zeros((len(index.skus), widest), dtype=np.int64)
    index.group_mask = np.zeros((len(index.skus), widest), dtype=bool)
    for sku, crops in enumerate(index.groups):
        index.group_table[sku, : len(crops)] = crops
        index.group_mask[sku, : len(crops)] = True

    rng = np.random.default_rng(2)
    row = rng.normal(size=len(index.features))
    vectorized = np.where(index.group_mask, row[index.group_table], -np.inf).max(axis=1)
    plain = np.array([row[g].max() for g in index.groups])
    assert np.allclose(vectorized, plain)
