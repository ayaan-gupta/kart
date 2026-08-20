"""
Fetch openly licensed photographs of loaded shopping carts, with provenance.

CLAUDE.md is explicit that getting real cart photographs is part of the work rather than a
blocker to report, and that the source URL and licence of every image go into a manifest beside
it at the time it is added. Ten photographs were once collected without provenance and could not
be committed, which is why this is a script and not a folder of downloads.

Two sources, both open APIs needing no key:

  Openverse       aggregates Flickr and others, returns the licence and the attribution string
  Wikimedia       Commons search, returns the licence out of the file's own metadata

Only licences that permit redistribution with attribution are kept. The images themselves are
still not committed: they are fetched on demand, exactly as `fetch_rpc.py` does, and the
manifest is what lives in the repository.

    server/.venv/bin/python server/eval/corpus/fetch_carts.py --want 40
"""
import argparse
import json
import pathlib
import time
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
IMAGES = HERE / "carts"
MANIFEST = HERE / "cart-manifest.json"

AGENT = "kart-eval/1.0 (research; contact via repository)"

# Licences that allow redistribution with attribution. Anything else is not fetched at all, so a
# non-redistributable image cannot end up in the corpus by accident and be discovered later.
ALLOWED = {"cc0", "pdm", "by", "by-sa"}

# Keyword search on a photo aggregator is noisy: the first pass of these terms returned nests of
# empty trolleys, aisles, a tram and a vernier caliper, and 7 of 45 images were of the thing this
# corpus is for. So the queries lean hard on the *contents* rather than on the cart, and the
# result is curated by eye afterwards (`--sheets`) rather than trusted.
QUERIES = [
    "shopping cart full of groceries",
    "loaded shopping cart food",
    "grocery cart packed items",
    "shopping trolley full of food",
    "supermarket trolley loaded groceries",
    "shopping basket full groceries",
    "grocery haul",
    "groceries on table unpacked",
    "groceries on kitchen counter",
    "grocery bags unpacked food",
    "checkout conveyor belt groceries",
    "grocery shopping haul food products",
    "cart of groceries checkout",
    "week of groceries",
    "food shopping products pile",
    "supermarket cart produce packages",
]


def get(url, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


def openverse(query, page_size=20, pages=2):
    """Openverse image search, restricted to licences that permit redistribution."""
    out = []
    items = []
    for page in range(1, pages + 1):
        url = ("https://api.openverse.org/v1/images/?"
               + urllib.parse.urlencode({
                   "q": query,
                   "license": ",".join(sorted(ALLOWED)),
                   "page_size": page_size,
                   "page": page,
                   "mature": "false",
               }))
        try:
            items += get(url).get("results", [])
        except Exception as error:  # noqa: BLE001
            print(f"  openverse '{query}' page {page}: {error}")
            break
        time.sleep(0.25)
    for item in items:
        if item.get("license") not in ALLOWED or not item.get("url"):
            continue
        out.append({
            "id": f"ov-{item['id'][:12]}",
            "url": item["url"],
            "source_page": item.get("foreign_landing_url"),
            "licence": f"CC {item['license'].upper()} {item.get('license_version', '')}".strip(),
            "licence_url": item.get("license_url"),
            "creator": item.get("creator"),
            "attribution": item.get("attribution"),
            "provider": item.get("provider"),
            "query": query,
        })
    return out


def wikimedia(query, limit=20):
    """Commons search. The licence lives in each file's extmetadata rather than a top-level field."""
    url = ("https://commons.wikimedia.org/w/api.php?"
           + urllib.parse.urlencode({
               "action": "query", "format": "json", "generator": "search",
               "gsrsearch": query, "gsrlimit": limit, "gsrnamespace": 6,
               "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": 2000,
           }))
    try:
        payload = get(url)
    except Exception as error:  # noqa: BLE001
        print(f"  wikimedia '{query}': {error}")
        return []
    out = []
    for page in payload.get("query", {}).get("pages", {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        licence = (meta.get("LicenseShortName", {}).get("value") or "").strip()
        short = licence.lower().replace("cc ", "").replace("-", " ").split()
        if not licence:
            continue
        # Public domain and the CC family, spelled a dozen ways in Commons metadata.
        keep = "public domain" in licence.lower() or "cc0" in licence.lower() or (
            short and short[0] == "by" and "nc" not in short and "nd" not in short
        )
        if not keep:
            continue
        out.append({
            "id": f"wm-{page['pageid']}",
            "url": info.get("thumburl") or info.get("url"),
            "source_page": info.get("descriptionurl"),
            "licence": licence,
            "licence_url": meta.get("LicenseUrl", {}).get("value"),
            "creator": (meta.get("Artist", {}).get("value") or "")[:200],
            "attribution": meta.get("Attribution", {}).get("value"),
            "provider": "wikimedia",
            "query": query,
        })
    return out


def download(entry, destination):
    request = urllib.request.Request(entry["url"], headers={"User-Agent": AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read()
    destination.write_bytes(data)
    return len(data)


def sheets(entries, out, cols=5, cell=300, per_page=15):
    """Contact sheets, because a keyword search cannot tell a loaded cart from a nest of empty
    ones and this corpus is only worth anything if someone has actually looked at it."""
    from PIL import Image, ImageDraw

    out.mkdir(parents=True, exist_ok=True)
    files = [IMAGES / e["file"] for e in entries]
    for start in range(0, len(files), per_page):
        chunk = files[start : start + per_page]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell, rows * cell), (24, 24, 24))
        draw = ImageDraw.Draw(sheet)
        for i, path in enumerate(chunk):
            try:
                image = Image.open(path).convert("RGB")
            except Exception:  # noqa: BLE001
                continue
            image.thumbnail((cell - 8, cell - 26))
            sheet.paste(image, ((i % cols) * cell + 4, (i // cols) * cell + 22))
            draw.text(((i % cols) * cell + 6, (i // cols) * cell + 6),
                      f"{start + i}: {path.stem[:22]}", fill=(255, 220, 80))
        sheet.save(out / f"carts-sheet-{start // per_page}.jpg", quality=85)
        print(f"  sheet {out / f'carts-sheet-{start // per_page}.jpg'}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--want", type=int, default=40)
    parser.add_argument("--sheets", default=None,
                        help="also write contact sheets here, for curating the result by eye")
    parser.add_argument("--min-bytes", type=int, default=60_000,
                        help="skip thumbnails; a cart photograph worth scoring is not 20kB")
    args = parser.parse_args(argv)

    IMAGES.mkdir(parents=True, exist_ok=True)
    found, seen = [], set()
    for query in QUERIES:
        for source in (openverse, wikimedia):
            for entry in source(query):
                if not entry["url"] or entry["url"] in seen:
                    continue
                seen.add(entry["url"])
                found.append(entry)
        time.sleep(0.4)
    print(f"{len(found)} candidates under a redistributable licence")

    kept = []
    for entry in found:
        if len(kept) >= args.want:
            break
        suffix = pathlib.Path(urllib.parse.urlparse(entry["url"]).path).suffix.lower()
        if suffix not in {".jpg", ".jpeg", ".png"}:
            suffix = ".jpg"
        path = IMAGES / f"{entry['id']}{suffix}"
        if path.exists():
            kept.append(entry | {"file": path.name, "bytes": path.stat().st_size})
            continue
        try:
            size = download(entry, path)
        except Exception as error:  # noqa: BLE001
            print(f"  failed {entry['id']}: {error}")
            continue
        # Commons asks clients not to hammer the file servers, and answers 429 when they do.
        if entry["provider"] == "wikimedia":
            time.sleep(1.0)
        if size < args.min_bytes:
            path.unlink(missing_ok=True)
            continue
        kept.append(entry | {"file": path.name, "bytes": size})
        print(f"  {entry['id']}  {size // 1024}kB  {entry['licence']}")

    MANIFEST.write_text(json.dumps({
        "note": "Openly licensed photographs of loaded shopping carts, for end-to-end scoring. "
                "Images are fetched on demand and are not committed; this manifest is. Every "
                "entry carries the source page and the licence it was fetched under.",
        "licences_allowed": sorted(ALLOWED),
        "count": len(kept),
        "images": kept,
    }, indent=1))
    print(f"\n{len(kept)} images in {IMAGES}")
    print(f"manifest {MANIFEST}")
    if args.sheets:
        sheets(kept, pathlib.Path(args.sheets))


if __name__ == "__main__":
    main()
