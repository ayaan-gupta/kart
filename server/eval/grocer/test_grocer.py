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

    trolley = [0, 0, 100, 100]
    items = [[10, 10, 25, 25], [30, 10, 45, 25], [50, 10, 65, 25], [70, 10, 85, 25]]
    boxes = [trolley] + items
    assert regions.degroup(list(range(len(boxes))), boxes) == [1, 2, 3, 4]


def test_degroup_keeps_a_large_item_with_one_thing_in_front_of_it():
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    big, one = [0, 0, 100, 100], [40, 40, 55, 55]
    assert sorted(regions.degroup([0, 1], [big, one])) == [0, 1]


def test_degroup_keeps_a_large_item_with_two_things_in_front_of_it():
    # Two is still an occluded item, not a group. The bar is GROUP_MEMBERS.
    sys.path.insert(0, str(HERE.parents[1] / "enumerator"))
    import regions

    big = [0, 0, 100, 100]
    boxes = [big, [10, 10, 25, 25], [40, 40, 55, 55]]
    assert 0 in regions.degroup([0, 1, 2], boxes)


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
