"""Tests for the corpus reader.

Weighted towards the label parser, because that is where a mistake is invisible. A detection
box and a segmentation polygon are both a class id followed by floats, so reading one as the
other raises nothing, returns plausible geometry, and quietly corrupts 16% of the corpus. The
first pass at this dataset did exactly that and concluded the labels were noisy.
"""

import hashlib
import json
import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from grocer import corpus  # noqa: E402


def write(tmp_path, text):
    path = tmp_path / "label.txt"
    path.write_text(text)
    return path


def test_reads_a_detection_line_as_a_centred_box(tmp_path):
    (crop,) = corpus.load_label(write(tmp_path, "5 0.5 0.5 0.2 0.4\n"))
    assert crop.cls == 5
    assert crop.polygon is False
    assert (crop.x0, crop.y0, crop.x1, crop.y1) == pytest.approx((0.4, 0.3, 0.6, 0.7))


def test_reads_a_polygon_line_as_its_bounding_box(tmp_path):
    (crop,) = corpus.load_label(write(tmp_path, "7 0.1 0.2 0.5 0.3 0.4 0.9 0.2 0.6\n"))
    assert crop.cls == 7
    assert crop.polygon is True
    assert (crop.x0, crop.y0, crop.x1, crop.y1) == pytest.approx((0.1, 0.2, 0.5, 0.9))


def test_a_polygon_is_not_read_as_a_box(tmp_path):
    """The failure this parser exists to prevent.

    Taking the first four numbers of this polygon as cx, cy, w, h yields a box of
    (-0.13, -0.10, 0.33, 0.50). The correct answer is (0.1, 0.2, 0.5, 0.9). Nothing about the
    wrong one looks wrong, which is the problem.
    """
    (crop,) = corpus.load_label(write(tmp_path, "7 0.1 0.2 0.5 0.3 0.4 0.9 0.2 0.6\n"))
    assert crop.x0 >= 0 and crop.y0 >= 0
    assert (crop.x0, crop.y0, crop.x1, crop.y1) != pytest.approx((-0.15, -0.05, 0.35, 0.45))


def test_reads_a_file_that_mixes_both_formats(tmp_path):
    # 858 files in the corpus do this.
    crops = corpus.load_label(write(tmp_path, "1 0.5 0.5 0.2 0.2\n2 0.1 0.1 0.3 0.1 0.2 0.4\n"))
    assert [c.polygon for c in crops] == [False, True]


def test_drops_a_line_it_cannot_interpret_rather_than_guessing(tmp_path):
    # An odd number of polygon coordinates is not a shape. Inventing the missing one would put a
    # box somewhere plausible and wrong.
    crops = corpus.load_label(write(tmp_path, "1 0.5 0.5 0.2\n2 0.1 0.1 0.3 0.1 0.2\n3 0.5 0.5 0.2 0.2\n"))
    assert [c.cls for c in crops] == [3]


def test_blank_lines_and_trailing_whitespace_are_not_instances(tmp_path):
    crops = corpus.load_label(write(tmp_path, "\n1 0.5 0.5 0.2 0.2\n   \n\n"))
    assert len(crops) == 1


def test_aliases_fold_to_one_spelling():
    assert corpus.canonical("Cocacola") == "CocaCola"
    assert corpus.canonical("CocaCola") == "CocaCola"
    assert corpus.canonical("Maggi") == "Maggi"


def test_no_alias_points_at_another_alias():
    # `canonical` resolves one step. A chain (a -> b, b -> c) would leave two spellings of one
    # product alive and the fold would silently do nothing for the first of them.
    assert not set(corpus.ALIASES.values()) & set(corpus.ALIASES)


def scene(seed):
    """A stand-in scene whose digest is a real hash.

    Counting in hex instead (`f"{i:032x}"`) puts every scene's leading bytes at zero, and since
    `split` reads exactly those bytes, every scene would land on the same side and any test
    built on it would pass without exercising anything.
    """
    digest = hashlib.md5(str(seed).encode()).hexdigest()
    return corpus.Scene(pathlib.Path(f"{seed}.jpg"), pathlib.Path(f"{seed}.txt"), digest, ())


def test_split_is_decided_by_content_not_by_order():
    made = [scene(i) for i in range(200)]
    catalog, query = corpus.split(made, 0.6)
    assert len(catalog) + len(query) == len(made)
    assert catalog and query
    # Reversing the input cannot move a photograph to the other side.
    catalog_again, _ = corpus.split(list(reversed(made)), 0.6)
    assert {s.digest for s in catalog} == {s.digest for s in catalog_again}


@pytest.mark.parametrize("share", [0.3, 0.6, 0.9])
def test_split_share_is_roughly_honoured(share):
    made = [scene(i) for i in range(4000)]
    catalog, _ = corpus.split(made, share)
    assert abs(len(catalog) / len(made) - share) < 0.02


def test_silhouette_fill_is_the_polygon_over_its_box():
    # A triangle filling half of its own bounding box.
    crop = corpus.Crop(0, 0.0, 0.0, 1.0, 1.0, True, (0.0, 0.0, 1.0, 0.0, 0.0, 1.0))
    assert corpus.silhouette_fill(crop) == pytest.approx(0.5)


def test_silhouette_fill_ignores_winding_direction():
    clockwise = corpus.Crop(0, 0.0, 0.0, 1.0, 1.0, True, (0.0, 0.0, 1.0, 0.0, 0.0, 1.0))
    counter = corpus.Crop(0, 0.0, 0.0, 1.0, 1.0, True, (0.0, 1.0, 1.0, 0.0, 0.0, 0.0))
    assert corpus.silhouette_fill(clockwise) == pytest.approx(corpus.silhouette_fill(counter))


def test_silhouette_fill_is_none_without_a_polygon():
    assert corpus.silhouette_fill(corpus.Crop(0, 0.0, 0.0, 1.0, 1.0, False)) is None


def test_per_scene_cap_spreads_references_across_photographs():
    """The change worth 7 points, expressed as the rule that produced it.

    Without the per-scene cap one shelf of identical soap fills the whole reference budget, and
    the product is then described by one lighting condition and one camera angle.
    """
    names = ["Soap"]
    shelf = corpus.Scene(
        pathlib.Path("a.jpg"), pathlib.Path("a.txt"), "a" * 32,
        tuple(corpus.Crop(0, i / 20, 0.0, i / 20 + 0.04, 0.5, False) for i in range(20)),
    )
    other = corpus.Scene(
        pathlib.Path("b.jpg"), pathlib.Path("b.txt"), "b" * 32,
        tuple(corpus.Crop(0, i / 20, 0.0, i / 20 + 0.04, 0.5, False) for i in range(20)),
    )
    plan = corpus._plan([shelf, other], names, max_per_class=6, max_per_scene=3)
    assert [len(wanted) for _, wanted in plan] == [3, 3]

    # Without it, the first photograph takes the whole budget.
    greedy = corpus._plan([shelf, other], names, max_per_class=6, max_per_scene=None)
    assert [len(wanted) for _, wanted in greedy] == [6]


def test_per_class_cap_still_binds_across_many_photographs():
    names = ["Soap"]
    made = [
        corpus.Scene(
            pathlib.Path(f"{i}.jpg"), pathlib.Path(f"{i}.txt"), f"{i:032x}",
            (corpus.Crop(0, 0.0, 0.0, 0.2, 0.2, False),),
        )
        for i in range(50)
    ]
    plan = corpus._plan(made, names, max_per_class=10, max_per_scene=3)
    assert sum(len(wanted) for _, wanted in plan) == 10


def test_the_shared_occlusion_fixture_is_present_and_exercised():
    """The TypeScript overlay is asserted against this file; it must not go missing quietly."""
    cases = json.loads((HERE / "occlusion_cases.json").read_text())["cases"]
    assert len(cases) > 40
    assert any(c["hidden"] == 0 for c in cases)
    assert any(c["hidden"] >= 0.2 for c in cases)


def test_nesting_keeps_a_large_item_with_a_small_one_in_front_of_it():
    """The guard that was inverted for the whole life of the file.

    A small box well inside a much larger one is two real items, one standing in front of the
    other. Dropping the larger deletes the item that is being occluded, which is the case the
    product exists to notice. The old comparison was `area(smaller) <= 4 * area(larger)`, and
    since the pass visits boxes smallest first that is always true, so the guard never fired.
    """
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    big = [0, 0, 100, 100]
    small = [40, 40, 50, 50]
    assert sorted(regions.nested([0, 1], [big, small])) == [0, 1]


def test_nesting_still_collapses_two_proposals_on_one_item():
    # The pass has to keep doing the job it was added for: of two boxes on one bottle, the
    # tighter one is the better outline.
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    outer = [0, 0, 100, 100]
    inner = [2, 2, 98, 98]
    assert regions.nested([0, 1], [outer, inner]) == [1]


def test_nesting_drops_a_group_box_drawn_over_its_own_members():
    # The other case it was added for: one box over a row of cartons alongside boxes for the
    # cartons. Keeping the group box would erase items from the count. The members here are
    # each within the size ratio of the group, so the guard does not protect it.
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    group = [0, 0, 100, 100]
    member = [0, 0, 55, 100]
    assert regions.nested([0, 1], [group, member]) == [1]


def test_dedupe_is_its_two_passes_in_order():
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    boxes = [[0, 0, 100, 100], [2, 2, 98, 98], [300, 300, 340, 340]]
    scores = [0.9, 0.5, 0.8]
    assert regions.dedupe(boxes, scores) == regions.nested(regions.nms(boxes, scores), boxes)


def test_degroup_drops_a_box_drawn_over_several_items():
    """The failure the repaired nesting guard handed back.

    Before the size guard was fixed it fired on everything and removed group boxes by accident.
    Fixing it was necessary, because it was also deleting every item with something in front of
    it, but a whole trolley is far more than NESTED_MAX_RATIO times the size of a tin, so the
    repaired guard protects the group box. Counting members separates the two cases.
    """
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    # As many members as the shipped constant demands, so the test tracks the constant rather
    # than a number that happened to be right when it was written.
    trolley = [0, 0, 100, 100]
    items = [[10 + 18 * i, 10, 25 + 18 * i, 25] for i in range(regions.GROUP_MEMBERS)]
    boxes = [trolley] + items
    assert regions.degroup(list(range(len(boxes))), boxes) == list(range(1, len(boxes)))


def test_degroup_keeps_a_large_item_with_one_thing_in_front_of_it():
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    big, one = [0, 0, 100, 100], [40, 40, 55, 55]
    assert sorted(regions.degroup([0, 1], [big, one])) == [0, 1]


def test_degroup_keeps_a_large_item_one_member_short_of_a_group():
    """The measured edge. Three members at 80% containment cost 6.7 points of recall on the
    photographs most like a cart, because a large product with a few small ones in front of it
    matches that description exactly. The bar is GROUP_MEMBERS and it has to bind here."""
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    big = [0, 0, 100, 100]
    items = [[10 + 18 * i, 10, 25 + 18 * i, 25] for i in range(regions.GROUP_MEMBERS - 1)]
    boxes = [big] + items
    assert 0 in regions.degroup(list(range(len(boxes))), boxes)


def test_degroup_is_not_a_cap_on_box_area():
    # A close-up of one product legitimately fills the frame; 1.5% of labelled instances in the
    # shelf corpus exceed 40% of theirs. Size alone must never remove a box.
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    huge = [0, 0, 100, 100]
    assert regions.degroup([0], [huge]) == [0]


def test_dedupe_runs_all_three_passes():
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    boxes = [[0, 0, 100, 100], [2, 2, 98, 98], [300, 300, 340, 340]]
    scores = [0.9, 0.5, 0.8]
    expected = regions.degroup(
        regions.nested(regions.nms(boxes, scores), boxes), boxes
    )
    assert regions.dedupe(boxes, scores) == expected


def _floor_report():
    sys.path.insert(0, str(HERE.parents[0]))
    import report_grocer_floor

    return report_grocer_floor


def test_the_curve_reads_the_answer_off_the_shortlist_not_off_the_stored_sku():
    """The stored `sku` is None below whatever floor was current when the run was written, so a
    curve built from it can only ever go one direction. Reading the shortlist head recovers the
    answer the matcher actually gave, which is what makes two runs written under different floors
    comparable at all."""
    report = _floor_report()
    declined = {"truth": "Maggi", "sku": None, "shortlist": ["Maggi", "Lays"], "confidence": 0.5}
    named = {"truth": "Lays", "sku": "Lays", "shortlist": ["Lays", "Maggi"], "confidence": 0.99}
    assert report.answer(declined) == "Maggi"
    assert report.answer(named) == named["sku"]

    rows = [dict(r, head=report.answer(r)) for r in (declined, named)]
    (_, coverage, precision, overall), = report.curve(rows, steps=(0.0,))
    assert coverage == 1.0
    assert precision == 1.0
    assert overall == 1.0


def test_raising_the_floor_never_lowers_precision():
    """The whole point of the floor. If a cut ever bought less precision than a lower one, the
    confidence it sorts on would not be ranking anything and the amber state would be noise."""
    report = _floor_report()
    rows = [
        {"truth": "A", "shortlist": ["A"], "confidence": 0.99, "head": "A"},
        {"truth": "A", "shortlist": ["B"], "confidence": 0.60, "head": "B"},
        {"truth": "C", "shortlist": ["C"], "confidence": 0.95, "head": "C"},
        {"truth": "D", "shortlist": ["E"], "confidence": 0.55, "head": "E"},
    ]
    precisions = [p for _, _, p, _ in report.curve(rows, steps=(0.0, 0.7, 0.96))]
    assert precisions == sorted(precisions)


def test_coverage_falls_as_the_floor_rises():
    report = _floor_report()
    rows = [
        {"truth": "A", "shortlist": ["A"], "confidence": c, "head": "A"}
        for c in (0.5, 0.7, 0.9, 0.99)
    ]
    coverages = [c for _, c, _, _ in report.curve(rows, steps=(0.0, 0.6, 0.8, 0.95))]
    assert coverages == sorted(coverages, reverse=True)


def _regions():
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    return regions


def test_the_produce_pass_only_adds_where_the_first_pass_found_nothing():
    """The safety property the whole two-pass design rests on. A longer prompt changes what the
    working phrases find, and every produce wording measured cost recall doing so. A second pass
    that can only add cannot."""
    regions = _regions()
    base = [[0, 0, 100, 100]]
    boxes = [[2, 2, 98, 98], [300, 300, 340, 340]]
    kept = regions.merge_produce(base, boxes, [0.9, 0.9])
    assert kept == [1]


def test_the_produce_pass_deduplicates_against_itself():
    """Twenty-eight nouns describe one onion several ways. Without this a bag of them arrives
    once per matching noun, on empty ground where nothing else will suppress it."""
    regions = _regions()
    boxes = [[300, 300, 340, 340], [302, 302, 338, 338], [500, 500, 540, 540]]
    kept = regions.merge_produce([], boxes, [0.9, 0.5, 0.8])
    assert len(kept) == 2
    assert 2 in kept


def test_the_produce_pass_adds_everything_when_the_first_pass_is_empty():
    regions = _regions()
    boxes = [[0, 0, 40, 40], [300, 300, 340, 340]]
    assert sorted(regions.merge_produce([], boxes, [0.9, 0.8])) == [0, 1]


def test_the_produce_threshold_is_above_the_first_pass_threshold():
    """Second-pass boxes are kept where nothing suppresses them, so they have to clear a higher
    bar. At the first pass's threshold a dense produce pile returns 34 boxes on empty ground for
    six real items."""
    regions = _regions()
    assert regions.PRODUCE_THRESHOLD > regions.BOX_THRESHOLD


def test_the_produce_pass_drops_a_fruit_inside_a_bag_of_that_fruit():
    """The case an overlap test cannot see. A single clementine has an IoU of about 0.05 with the
    net holding it, so overlap passes it through and the net arrives as seven fruits. The net is
    one purchasable unit and the grocery prompt already drew it."""
    regions = _regions()
    net = [0, 0, 200, 200]
    one_fruit = [20, 20, 70, 70]
    assert regions._iou(one_fruit, net) < 0.1
    assert regions.merge_produce([net], [one_fruit], [0.9]) == []


def test_the_produce_pass_still_adds_a_loose_item_beside_a_bag():
    """The other half of the same rule. Two oranges sitting next to the yogurt, not inside
    anything, are two products and the second pass is the only thing that finds them."""
    regions = _regions()
    bag = [0, 0, 200, 200]
    beside = [260, 40, 320, 100]
    assert regions.merge_produce([bag], [beside], [0.9]) == [0]


def test_the_service_runs_the_produce_pass():
    """`app.py` builds a modal.Volume at import and cannot be loaded without credentials, so this
    reads the source. The wiring is what the cart measurement was of: without the second pass the
    service counts 32 of 43 hand-counted items, with it 38."""
    source = (HERE.parents[1] / "enumerator" / "app.py").read_text()
    assert "merge_produce(" in source
    assert "PRODUCE_PROMPT" in source


def test_the_service_keeps_the_instance_cap_after_the_produce_pass():
    """The cap is what bounds SAM's work and the number of badges a shopper is shown. A second
    pass appending to an already-capped list would walk straight past it."""
    source = (HERE.parents[1] / "enumerator" / "app.py").read_text()
    after = source[source.index("merge_produce("):]
    assert "MAX_INSTANCES" in after[:400]


def test_the_frame_itself_is_not_an_item():
    """A trolley photographed from inside, with one thing in it. The detector proposes the thing
    and the whole basket, and `degroup` cannot help: it needs GROUP_MEMBERS items inside before
    it fires and an empty trolley does not contain five of anything."""
    regions = _regions()
    frame = [0, 0, 1000, 1000]
    item = [600, 200, 800, 400]
    kept = regions.deframe([0, 1], [frame, item], (1000, 1000))
    assert kept == [1]


def test_an_item_held_up_to_the_camera_survives():
    """The case an area cap would break. 29 of the 84,743 labelled instances in the shelf corpus
    cover more than 90% of their photograph and every one is a close-up of a real product. What
    separates it from a trolley is that nothing else was proposed inside it."""
    regions = _regions()
    close_up = [10, 10, 990, 990]
    assert regions.deframe([0], [close_up], (1000, 1000)) == [0]


def test_a_frame_sized_box_survives_if_what_is_inside_it_is_not_contained():
    """Two proposals over the same crowded scene, neither inside the other, is not a container
    and its member. Only containment counts."""
    regions = _regions()
    frame = [0, 0, 1000, 1000]
    overlapping = [500, 500, 1500, 1500]
    assert 0 in regions.deframe([0, 1], [frame, overlapping], (1000, 1000))


def test_deframe_leaves_ordinary_boxes_alone():
    regions = _regions()
    boxes = [[0, 0, 100, 100], [200, 200, 300, 300]]
    assert regions.deframe([0, 1], boxes, (1000, 1000)) == [0, 1]


def test_dedupe_runs_deframe_only_when_it_knows_the_frame():
    """Whether a box is the whole picture is not a fact about the box, so the pass cannot run
    without the frame. Optional rather than required, so a caller measuring the first three
    passes in isolation still can."""
    regions = _regions()
    frame = [0, 0, 1000, 1000]
    item = [600, 200, 800, 400]
    boxes, scores = [frame, item], [0.9, 0.8]
    assert sorted(regions.dedupe(boxes, scores)) == [0, 1]
    assert regions.dedupe(boxes, scores, size=(1000, 1000)) == [1]
