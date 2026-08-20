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
