"""A single self-contained page showing what the pipeline did on every corpus image.

`render_results.py` draws the boxes and answers; this assembles them with the scoring into one
HTML file that opens anywhere. Images are embedded as data URIs so the page needs no server and no
network.

    server/.venv/bin/python server/eval/render_results.py
    server/.venv/bin/python server/eval/build_report.py --out kart-report.html
"""
import argparse, base64, html, json, pathlib

HERE = pathlib.Path(__file__).resolve().parent
RENDER = HERE / ".cache/kart/render"

SHELVES = ["IMG_0247", "IMG_0248", "IMG_0250", "IMG_0251"]


def data_uri(path):
    return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode()


def chips(items, cls):
    if not items:
        return ""
    return "".join(f'<span class="chip {cls}">{html.escape(str(i))}</span>' for i in items)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "kart-report.html"))
    args = ap.parse_args(argv)
    rows = json.loads((RENDER / "summary.json").read_text())

    carts = [r for r in rows if r["kind"] == "trolley"]
    shelves = [r for r in rows if r["kind"] == "shelf"]
    caps = [r for r in rows if r["kind"] == "video capture"]
    found = sum(r["found"] for r in carts)
    truth = sum(r["truth"] for r in carts)
    perfect = sum(1 for r in carts if r["found"] == r["truth"] and not r["spurious"])

    def card(r):
        img = RENDER / f"{r['id'].replace('video, ', 'video-t').replace('s', '')}.jpg" \
            if r["kind"] == "video capture" else RENDER / f"{r['id']}.jpg"
        if not img.exists():
            return ""
        if r["kind"] == "shelf":
            ok = r.get("is_cart") is False
            state = "good" if ok else "short"
            headline = "refused" if ok else "accepted as a cart"
        elif r["kind"] == "video capture":
            state, headline = "cap", f"{len(r['bag'])} named"
        elif r["found"] == r["truth"] and not r["spurious"]:
            state, headline = "good", f"{r['found']} of {r['truth']}"
        elif r["found"] >= r["truth"] - 1:
            state, headline = "near", f"{r['found']} of {r['truth']}"
        else:
            state, headline = "short", f"{r['found']} of {r['truth']}"
        detail = ""
        if r["kind"] == "shelf":
            detail = (f'<div class="lines"><span class="k">proposals</span>'
                      f'<span class="none">{r.get("proposals", 0)} regions, none named</span></div>'
                      f'<div class="lines"><span class="k">bag</span>'
                      f'<span class="none">empty, which is the right answer</span></div>')
        elif r["kind"] != "video capture":
            detail = (
                f'<div class="lines"><span class="k">missing</span>'
                f'{chips(r["missing"], "miss") or "<span class=none>none</span>"}</div>'
                f'<div class="lines"><span class="k">invented</span>'
                f'{chips(r["spurious"], "spur") or "<span class=none>none</span>"}</div>')
        bag = "".join(f"<li>{html.escape(str(b))}</li>" for b in r["bag"])
        more = "" if r["kind"] == "shelf" else (
            f'<details><summary>what reached the bag ({len(r["bag"])})</summary>'
            f'<ul>{bag}</ul></details>')
        return f"""<article class="card {state}">
  <figure><img loading="lazy" alt="{html.escape(r['id'])} with the regions the census was asked about"
    src="{data_uri(img)}"></figure>
  <div class="meta">
    <header><h3>{html.escape(r['id'])}</h3><p class="score">{headline}</p></header>
    {detail}
    {more}
  </div>
</article>"""

    body = "".join(card(r) for r in carts)
    shelf_cards = "".join(card(r) for r in shelves)
    refused = sum(1 for r in shelves if r.get("is_cart") is False)
    vid = "".join(card(r) for r in caps)

    page = f"""<title>Kart Verification Results</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root {{
  --ground:#F2F4F5; --raise:#FFFFFF; --ink:#16191C; --ink-2:#5C666E; --rule:#DCE1E4;
  --steel:#24485E; --good:#2E9E4B; --near:#B8860B; --short:#D33A47; --mute:#94A0A8;
  --good-bg:#E7F4EA; --short-bg:#FBE9EB; --near-bg:#FAF1DC;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --ground:#0F1316; --raise:#171C20; --ink:#E9EDEF; --ink-2:#9AA6AE; --rule:#283137;
    --steel:#7FB3D0; --good:#5FD07E; --near:#E0B84A; --short:#F0707C; --mute:#6B767E;
    --good-bg:#16301F; --short-bg:#33191D; --near-bg:#2E2716;
  }}
}}
:root[data-theme="dark"] {{
  --ground:#0F1316; --raise:#171C20; --ink:#E9EDEF; --ink-2:#9AA6AE; --rule:#283137;
  --steel:#7FB3D0; --good:#5FD07E; --near:#E0B84A; --short:#F0707C; --mute:#6B767E;
  --good-bg:#16301F; --short-bg:#33191D; --near-bg:#2E2716;
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--ground); color:var(--ink);
  font-family:"IBM Plex Sans",system-ui,sans-serif; line-height:1.55; }}
.wrap {{ max-width:1180px; margin:0 auto; padding:clamp(28px,5vw,64px) clamp(18px,4vw,40px) 96px; }}
.eyebrow {{ font-family:"IBM Plex Mono",monospace; font-size:.72rem; letter-spacing:.14em;
  text-transform:uppercase; color:var(--ink-2); margin:0 0 10px; }}
h1 {{ font-size:clamp(1.9rem,4.4vw,2.9rem); font-weight:600; letter-spacing:-.02em;
  margin:0 0 12px; text-wrap:balance; }}
.lede {{ max-width:64ch; color:var(--ink-2); margin:0 0 34px; }}
.stats {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1px;
  background:var(--rule); border:1px solid var(--rule); border-radius:10px; overflow:hidden;
  margin-bottom:46px; }}
.stat {{ background:var(--raise); padding:18px 20px; }}
.stat b {{ display:block; font-family:"IBM Plex Mono",monospace; font-size:1.7rem; font-weight:500;
  letter-spacing:-.02em; font-variant-numeric:tabular-nums; }}
.stat span {{ font-size:.78rem; color:var(--ink-2); }}
h2 {{ font-size:1.05rem; font-weight:600; margin:0 0 4px; }}
.section-note {{ color:var(--ink-2); font-size:.88rem; margin:0 0 18px; max-width:62ch; }}
.grid {{ display:grid; gap:20px; margin-bottom:52px; }}
.card {{ display:grid; grid-template-columns:minmax(0,1.15fr) minmax(0,1fr); gap:0;
  background:var(--raise); border:1px solid var(--rule); border-radius:12px; overflow:hidden;
  border-left:4px solid var(--mute); }}
.card.good {{ border-left-color:var(--good); }}
.card.near {{ border-left-color:var(--near); }}
.card.short {{ border-left-color:var(--short); }}
.card.cap {{ border-left-color:var(--steel); }}
@media (max-width:760px) {{ .card {{ grid-template-columns:1fr; }} }}
figure {{ margin:0; background:var(--ground); }}
figure img {{ display:block; width:100%; height:auto; }}
.meta {{ padding:20px 22px; display:flex; flex-direction:column; gap:14px; min-width:0; }}
.meta header {{ display:flex; align-items:baseline; justify-content:space-between; gap:12px;
  border-bottom:1px solid var(--rule); padding-bottom:10px; }}
h3 {{ margin:0; font-size:1rem; font-family:"IBM Plex Mono",monospace; font-weight:500; }}
.score {{ margin:0; font-family:"IBM Plex Mono",monospace; font-size:.95rem;
  font-variant-numeric:tabular-nums; color:var(--ink-2); }}
.card.good .score {{ color:var(--good); }}
.card.short .score {{ color:var(--short); }}
.lines {{ display:flex; flex-wrap:wrap; gap:6px; align-items:baseline; }}
.k {{ font-family:"IBM Plex Mono",monospace; font-size:.7rem; letter-spacing:.1em;
  text-transform:uppercase; color:var(--ink-2); min-width:72px; }}
.chip {{ font-size:.78rem; padding:2px 9px; border-radius:999px; border:1px solid transparent; }}
.chip.miss {{ background:var(--short-bg); color:var(--short); border-color:var(--short); }}
.chip.spur {{ background:var(--near-bg); color:var(--near); border-color:var(--near); }}
.none {{ font-size:.78rem; color:var(--mute); }}
details {{ border-top:1px solid var(--rule); padding-top:10px; }}
summary {{ cursor:pointer; font-size:.82rem; color:var(--ink-2); }}
summary:focus-visible {{ outline:2px solid var(--steel); outline-offset:3px; border-radius:4px; }}
details ul {{ margin:10px 0 0; padding-left:18px; font-size:.85rem; }}
details li {{ margin:3px 0; }}
.key {{ display:flex; flex-wrap:wrap; gap:18px; font-size:.8rem; color:var(--ink-2);
  border:1px solid var(--rule); background:var(--raise); border-radius:10px; padding:14px 18px;
  margin-bottom:38px; }}
.key i {{ display:inline-block; width:11px; height:11px; border-radius:3px; margin-right:7px;
  vertical-align:-1px; }}
.shelf {{ border:1px dashed var(--rule); border-radius:10px; padding:18px 20px; background:var(--raise);
  color:var(--ink-2); font-size:.88rem; margin-bottom:52px; }}
.shelf ul {{ margin:8px 0 0; padding-left:18px; font-family:"IBM Plex Mono",monospace;
  font-size:.82rem; }}
footer {{ border-top:1px solid var(--rule); padding-top:22px; color:var(--ink-2); font-size:.82rem;
  max-width:70ch; }}
</style>

<div class="wrap">
<p class="eyebrow">Verification corpus &middot; 10 photographs, 1 video</p>
<h1>What the pipeline saw</h1>
<p class="lede">Every box below is a region the detector proposed and the census was asked to name.
Green means the answer matched what is really there, red means it did not, grey means the region
was labelled as out of catalog or not a product, so there is nothing to be right about.</p>

<div class="stats">
  <div class="stat"><b>{found} / {truth}</b><span>products found across the six trolleys</span></div>
  <div class="stat"><b>{perfect} / {len(carts)}</b><span>trolleys exactly right, nothing invented</span></div>
  <div class="stat"><b>{refused} / {len(shelves)}</b><span>shelves refused as not a cart</span></div>
  <div class="stat"><b>{len(caps)}</b><span>captures fired in a nine-second scan</span></div>
</div>

<div class="key">
  <span><i style="background:var(--good)"></i>answer matched the region</span>
  <span><i style="background:var(--short)"></i>answer did not match</span>
  <span><i style="background:var(--mute)"></i>region not scorable</span>
</div>

<h2>Trolleys</h2>
<p class="section-note">Ordered by how much is in them. The four sparse trolleys are exact on every
pass; all of the error sits in the two loaded ones.</p>
<div class="grid">{body}</div>

<h2>Shelves</h2>
<p class="section-note">Four of the ten photographs are store shelves, not carts. The detector still
proposes regions &mdash; forty-three of them on the meat case &mdash; and the right answer is to name
none of them, because a shelf holds hundreds of facings that are in nobody&rsquo;s trolley. The boxes
below are drawn muted because nothing was asked about them: the <code>subjectIsCart</code> gate
refuses the photograph first. Without it these became up to 41 invented items.</p>
<div class="grid">{shelf_cards}</div>

<h2>Video, nine seconds of scanning</h2>
<p class="section-note">The scan fires four censuses as the camera passes over the trolley. Each
capture sees part of the cart; the bag is fused from all four.</p>
<div class="grid">{vid}</div>

<footer>Drawn from saved runs, not re-measured for this page. Boxes come from the shipped detector
pass, answers from the census responses those runs recorded, and verdicts are re-derived against the
labels as they stand today. The full method and every refused change are in
<code>server/eval/KART.md</code>.</footer>
</div>"""
    pathlib.Path(args.out).write_text(page)
    kb = len(page.encode()) / 1024
    print(f"wrote {args.out} ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
