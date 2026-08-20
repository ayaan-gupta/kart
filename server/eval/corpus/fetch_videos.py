"""
Fetch openly licensed video of a supermarket, so the pipeline can be scored over frames.

Every number in this repository so far comes from a single still. The app does not work that
way: it tracks items across frames, fuses several looks at the same item into one identity, and
counts. None of that machinery has ever been measured, and it cannot be measured on stills.

Wikimedia Commons is the source, because it serves media directly to scripted clients under a
declared licence. Pexels and Pixabay both answer 403 without an API key.

    server/.venv/bin/python server/eval/corpus/fetch_videos.py
"""
import argparse
import json
import pathlib
import time
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
VIDEOS = HERE / "videos"
MANIFEST = HERE / "video-manifest.json"
AGENT = "kart-eval/1.0 (research; contact via repository)"

QUERIES = [
    "filetype:video supermarket shopping",
    "filetype:video grocery store aisle",
    "filetype:video supermarket products shelves",
    "filetype:video shopping cart groceries",
    "filetype:video grocery shopping",
]

# Redistributable licences only, matching fetch_carts.py.
def allowed(licence):
    low = (licence or "").lower()
    if "nc" in low.split("-") or "nd" in low.split("-"):
        return False
    return "public domain" in low or "cc0" in low or low.startswith("cc by")


def get(url, timeout=40):
    request = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


def search(query, limit=10):
    url = ("https://commons.wikimedia.org/w/api.php?"
           + urllib.parse.urlencode({
               "action": "query", "format": "json", "generator": "search",
               "gsrsearch": query, "gsrlimit": limit, "gsrnamespace": 6,
               "prop": "imageinfo", "iiprop": "url|mime|size|extmetadata",
           }))
    try:
        payload = get(url)
    except Exception as error:  # noqa: BLE001
        print(f"  search '{query}': {error}")
        return []
    out = []
    for page in payload.get("query", {}).get("pages", {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        if not (info.get("mime") or "").startswith("video"):
            continue
        meta = info.get("extmetadata", {})
        licence = (meta.get("LicenseShortName", {}).get("value") or "").strip()
        if not allowed(licence):
            continue
        out.append({
            "id": f"wm-{page['pageid']}",
            "title": page["title"],
            "url": info.get("url"),
            "source_page": info.get("descriptionurl"),
            "mime": info.get("mime"),
            "bytes_remote": info.get("size"),
            "licence": licence,
            "licence_url": meta.get("LicenseUrl", {}).get("value"),
            "creator": (meta.get("Artist", {}).get("value") or "")[:200],
            "query": query,
        })
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--want", type=int, default=4)
    parser.add_argument("--max-mb", type=int, default=400)
    args = parser.parse_args(argv)

    VIDEOS.mkdir(parents=True, exist_ok=True)
    found, seen = [], set()
    for query in QUERIES:
        for entry in search(query):
            if entry["url"] in seen:
                continue
            seen.add(entry["url"])
            found.append(entry)
        time.sleep(0.5)
    # Relevance first, then size. Sorting on size alone picked a 1923 silent film and a mall
    # exterior over a grocery haul, because a keyword search returns anything whose description
    # mentions shopping and the biggest file is rarely the most useful one.
    def relevance(entry):
        title = entry["title"].lower()
        wanted = ("haul", "grocery", "groceries", "supermarket", "costco", "produce",
                  "shopping cart", "food")
        unwanted = ("trolley", "tram", "mall", "exterior", "1923", "1927", "1931", "trailer")
        score = sum(2 for word in wanted if word in title)
        score -= sum(3 for word in unwanted if word in title)
        return score
    found.sort(key=lambda e: (-relevance(e), -(e["bytes_remote"] or 0)))
    print(f"{len(found)} candidate videos under a redistributable licence")
    for entry in found[:12]:
        print(f"  {relevance(entry):+3d}  {(entry['bytes_remote'] or 0) // 1_000_000:4d}MB  "
              f"{entry['licence']:16s} {entry['title'][:56]}")

    kept = []
    for entry in found:
        if len(kept) >= args.want:
            break
        if (entry["bytes_remote"] or 0) > args.max_mb * 1_000_000:
            continue
        suffix = pathlib.Path(urllib.parse.urlparse(entry["url"]).path).suffix or ".webm"
        path = VIDEOS / f"{entry['id']}{suffix}"
        if not path.exists():
            print(f"  downloading {entry['title'][:50]} ...")
            try:
                request = urllib.request.Request(entry["url"], headers={"User-Agent": AGENT})
                with urllib.request.urlopen(request, timeout=300) as response:
                    path.write_bytes(response.read())
            except Exception as error:  # noqa: BLE001
                print(f"    failed: {error}")
                continue
            time.sleep(1.0)
        kept.append(entry | {"file": path.name, "bytes": path.stat().st_size})

    MANIFEST.write_text(json.dumps({
        "note": "Openly licensed supermarket video, for scoring the tracker and the multi-frame "
                "fusion. Files are fetched on demand and not committed; this manifest is.",
        "count": len(kept),
        "videos": kept,
    }, indent=1))
    print(f"\n{len(kept)} videos in {VIDEOS}")


if __name__ == "__main__":
    main()
