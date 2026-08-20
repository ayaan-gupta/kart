"""Reading the corpus: labels, scenes, splits, and crops on disk.

Nothing here loads a model or scores anything. It exists so that the scoring harness and any
later training run see exactly the same photographs in exactly the same roles, because a split
that moves between runs makes two numbers incomparable without saying so.
"""

from __future__ import annotations

import collections
import dataclasses
import hashlib
import pathlib
import re

# Anchored at the repository root, not the working directory: the harness is run from
# `server/eval` and the corpus lives three levels up, so a relative default would resolve to
# nothing and the failure would read as a missing dataset rather than a missing `cd`.
DEFAULT_ROOT = pathlib.Path(__file__).resolve().parents[3] / ".data-grocer-help"

# The vocabulary carries more than one spelling for a single product. Left unmerged these are
# not hard classes, they are impossible ones: no evidence in the photograph can distinguish
# `CocaCola` from `Cocacola`, so every instance is a coin flip that costs the metric without
# telling anyone anything about the recognizer. `canonical` folds them; the harness reports the
# unfolded number too, so the cost of the decision stays visible rather than being assumed.
ALIASES = {
    "Cocacola": "CocaCola",
    "Bagrrys": "Baggrys",
    "Deodrant": "Deodorant",
    "Chocoloate_Amul": "Chocolate_Amul",
    "ToothPaste": "Toothpaste",
    "odonil": "Odonil",
    "Cavins": "Cavin",
    "Jabson": "Jabsons",
    "Sadabahar": "SadaBahar",
    "Zhandu": "Zandu",
    "Pistachios": "Pistachio",
    "MosquittoRepellent": "MosquitoRepellent",
    "Gaialite": "GaiaLite",
    "Nutridelite": "NutriDelite",
    "SlurpFarm": "SlurrpFarm",
    "Suffola": "Saffola",
    "Frutins": "Fruitins",
    "Fundoos": "Fondoos",
    "WnkinCow": "WinkinCow",
    "Conditoner": "Conditioner",
    "Godreg": "Godrej",
    "MothersRecipe": "Mother-sRecipe",
    "Noodle": "Noodles",
    "Wafer": "Wafers",
    "MAggi": "Maggi",
}


def canonical(name: str) -> str:
    """The spelling this project treats as the product's one name."""
    return ALIASES.get(name, name)


@dataclasses.dataclass(frozen=True)
class Crop:
    """One labelled instance, in normalized frame coordinates with origin top-left."""

    cls: int
    x0: float
    y0: float
    x1: float
    y1: float
    polygon: bool
    # The silhouette, flat as (x0, y0, x1, y1, ...), for the 16% of instances that carry one.
    # Kept rather than reduced away because how much of its own box an item's outline fills is
    # the closest thing this corpus has to a per-item occlusion label, and it is also a signal
    # the app has at runtime: the detector returns masks, and `ItemHighlights` already draws
    # them.
    points: tuple[float, ...] = ()


@dataclasses.dataclass(frozen=True)
class Scene:
    """One photograph and its instances. `digest` identifies the pixels, not the filename."""

    image: pathlib.Path
    label: pathlib.Path
    digest: str
    crops: tuple[Crop, ...]


def load_names(root: pathlib.Path | str = DEFAULT_ROOT) -> list[str]:
    """Class names in index order, straight out of `data.yaml`.

    Parsed with a regex rather than a YAML library so the harness carries no dependency for one
    flat list of strings. The file is machine-written by the export tool and its `names:` line is
    a single bracketed list; anything else would fail loudly here rather than mis-parse.
    """
    text = (pathlib.Path(root) / "data.yaml").read_text()
    match = re.search(r"names:\s*\[(.*?)\]", text, re.S)
    if not match:
        raise ValueError(f"no names list in {root}/data.yaml")
    return [part.strip().strip("'\"") for part in match.group(1).split(",")]


def load_label(path: pathlib.Path | str) -> list[Crop]:
    """Every instance in one label file, whichever of the two formats it uses.

    A five-field line is YOLO detection: `class cx cy w h`. A line with an even number of
    coordinates beyond that is a YOLO segmentation polygon, reduced here to its bounding box.
    Both appear in this corpus and 858 files contain both, so a reader that assumes one format
    does not fail, it silently returns boxes that are wrong by a factor of two on part of the
    data. Anything else, including an odd-length polygon, is dropped rather than guessed at.
    """
    crops: list[Crop] = []
    for line in pathlib.Path(path).read_text().splitlines():
        fields = line.split()
        if len(fields) < 5:
            continue
        cls = int(float(fields[0]))
        values = [float(f) for f in fields[1:]]
        if len(values) == 4:
            x, y, w, h = values
            crops.append(Crop(cls, x - w / 2, y - h / 2, x + w / 2, y + h / 2, False))
        elif len(values) >= 6 and len(values) % 2 == 0:
            xs, ys = values[0::2], values[1::2]
            crops.append(
                Crop(cls, min(xs), min(ys), max(xs), max(ys), True, tuple(values))
            )
    return crops


def scenes(root: pathlib.Path | str = DEFAULT_ROOT) -> list[Scene]:
    """Every photograph in the corpus, pooled across the two shipped directories and deduped.

    The shipped `train` and `valid` directories share 69 photographs byte for byte, so using
    them as a split leaks 10% of the validation set into training. Pooling and deduping by
    content hash removes the trap rather than documenting it. Sorted by digest so the order does
    not depend on the filesystem.
    """
    root = pathlib.Path(root)
    found: dict[str, Scene] = {}
    for split_dir in ("train", "valid"):
        images = root / split_dir / "images"
        labels = root / split_dir / "labels"
        if not images.is_dir():
            continue
        for image in sorted(images.iterdir()):
            if image.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            label = labels / f"{image.stem}.txt"
            if not label.exists():
                continue
            digest = hashlib.md5(image.read_bytes()).hexdigest()
            if digest in found:
                continue
            crops = tuple(load_label(label))
            if crops:
                found[digest] = Scene(image, label, digest, crops)
    return [found[d] for d in sorted(found)]


def split(pool: list[Scene], catalog_share: float = 0.6) -> tuple[list[Scene], list[Scene]]:
    """Divide photographs into the catalog side and the query side.

    By photograph, never by crop. Two crops from one photograph share the lighting, the camera,
    the angle and very often the product itself, so a crop-level split scores the recognizer on
    pictures it has effectively already seen and reads far too high.

    The side a photograph lands on is a function of its content hash, so it does not move when
    the corpus grows, when the filesystem reorders, or between two runs being compared.
    """
    catalog, query = [], []
    for scene in pool:
        (catalog if int(scene.digest[:8], 16) / 0xFFFFFFFF < catalog_share else query).append(scene)
    return catalog, query


def _box_pixels(crop: Crop, width: int, height: int, padding: float) -> tuple[int, int, int, int]:
    """The crop's box in pixels, padded and clamped to the frame."""
    x0, y0, x1, y1 = crop.x0 * width, crop.y0 * height, crop.x1 * width, crop.y1 * height
    pad_x, pad_y = (x1 - x0) * padding, (y1 - y0) * padding
    return (
        max(0, int(x0 - pad_x)),
        max(0, int(y0 - pad_y)),
        min(width, int(x1 + pad_x)),
        min(height, int(y1 + pad_y)),
    )


def _plan(pool, names, max_per_class, max_per_scene):
    """Decide which instances get written before any pixels are read.

    The caps have to be applied here, in one pass, rather than inside the workers: processes
    cannot share a running count, so a cap applied per worker would admit `workers` times as
    many crops for the commonest classes and quietly reweight the catalog.

    `max_per_scene` is the one that matters for reference quality. A shelf holds fifteen faces
    of the same soap, so a per-class cap alone is filled by two photographs, and the references
    for that product then describe two lighting conditions and two camera angles. Measured on
    this corpus, the median class drew its references from seven photographs and 130 of 343 drew
    from five or fewer. Capping per photograph spends the same budget across many more scenes,
    which is what a reference set is for.
    """
    written: dict[str, int] = collections.Counter()
    plan: list[tuple[Scene, list[tuple[int, Crop, str]]]] = []
    for scene in pool:
        here: dict[str, int] = collections.Counter()
        wanted = []
        for order, crop in enumerate(scene.crops):
            name = canonical(names[crop.cls]) if crop.cls < len(names) else str(crop.cls)
            if max_per_class is not None and written[name] >= max_per_class:
                continue
            if max_per_scene is not None and here[name] >= max_per_scene:
                continue
            written[name] += 1
            here[name] += 1
            wanted.append((order, crop, name))
        if wanted:
            plan.append((scene, wanted))
    return plan


def _cut(job):
    """One photograph's crops. Runs in a worker process, so it takes and returns plain data."""
    from PIL import Image

    image_path, digest, wanted, destination, padding, min_side, long_side = job
    destination = pathlib.Path(destination)
    with Image.open(image_path) as handle:
        image = handle.convert("RGB")
    width, height = image.size
    counts: dict[str, int] = collections.Counter()
    small = 0
    for order, crop, name in wanted:
        left, top, right, bottom = _box_pixels(crop, width, height, padding)
        if min(right - left, bottom - top) < min_side:
            small += 1
            continue
        folder = destination / name
        folder.mkdir(parents=True, exist_ok=True)
        patch = image.crop((left, top, right, bottom))
        patch.thumbnail((long_side, long_side))
        patch.save(folder / f"{digest[:12]}-{order:03d}.jpg", quality=92)
        counts[name] += 1
    return counts, small


def materialize(
    pool: list[Scene],
    destination: pathlib.Path | str,
    names: list[str],
    *,
    padding: float = 0.08,
    min_side: int = 32,
    max_per_class: int | None = None,
    max_per_scene: int | None = None,
    long_side: int = 320,
    workers: int = 8,
    clean: bool = True,
    log=print,
) -> dict[str, int]:
    """Write one directory of JPEG crops per class, the shape `Index.build` reads.

    Cutting crops out of 12-megapixel photographs is the expensive part of every run and the
    part that never changes, so it is paid once to disk instead of once per experiment. Each
    photograph is decoded exactly once no matter how many instances it carries, and decoding is
    the whole cost, so it is spread across processes.

    EXIF orientation is deliberately not applied. Some photographs in this corpus carry a
    rotation tag, and their boxes were drawn against the raw sensor pixels, so straightening the
    image would leave every box on it pointing somewhere else.

    Crops below `min_side` pixels on their shorter edge are dropped. Below that the crop carries
    fewer pixels than the encoder's own patch grid, so what it measures is the upsampler.
    """
    import concurrent.futures
    import shutil

    destination = pathlib.Path(destination)
    # Rewritten from empty rather than merged into. A run with a smaller cap would otherwise
    # leave the previous run's surplus crops in place, and the resulting index would describe
    # neither configuration.
    if clean and destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True, exist_ok=True)
    plan = _plan(pool, names, max_per_class, max_per_scene)
    jobs = [
        (str(scene.image), scene.digest, wanted, str(destination), padding, min_side, long_side)
        for scene, wanted in plan
    ]
    written: dict[str, int] = collections.Counter()
    small = 0
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool_exec:
        for done, (counts, dropped) in enumerate(pool_exec.map(_cut, jobs, chunksize=8)):
            written.update(counts)
            small += dropped
            if log and (done + 1) % 500 == 0:
                log(f"  {done + 1}/{len(jobs)} photographs, {sum(written.values())} crops")
    if log:
        log(f"  {sum(written.values())} crops across {len(written)} classes, "
            f"{small} below {min_side}px dropped")
    return dict(written)


def silhouette_fill(crop: Crop) -> float | None:
    """How much of its own bounding box the instance's outline fills, or None without one.

    A packaged grocery product is close to a rectangle head on, so a complete outline fills most
    of its box. An outline that fills half of it is an item with something in front of it, or an
    item cut off by the frame. Both are reasons to stop trusting the crop.

    Shoelace area on the raw polygon, unsigned, so winding order does not matter.
    """
    if len(crop.points) < 6:
        return None
    xs, ys = crop.points[0::2], crop.points[1::2]
    area = 0.0
    for i in range(len(xs)):
        j = (i + 1) % len(xs)
        area += xs[i] * ys[j] - xs[j] * ys[i]
    box = (crop.x1 - crop.x0) * (crop.y1 - crop.y0)
    if box <= 0:
        return None
    return min(1.0, abs(area) / 2 / box)
