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

    # The two changes waiting on a census pass, drawn rather than described. Both had their
    # recommendation corrected by looking at these pictures rather than at their totals.
    pending = ""
    for stem, title, note in (
        ("filter", "The proposal filter, off by default",
         "Red boxes are the proposals it would remove before the census is asked about them. On "
         "IMG_0254 all four are real products &mdash; the second egg carton, the jar, the salmon and "
         "the asparagus. The totals still improve, because the unmarked sweep volunteers most of "
         "them back, which is a weaker reason to ship than the numbers alone suggested."),
        ("augment", "The added regions, for the yellow produce bag",
         "Green boxes are what a lower detection threshold adds where the shipped pass found "
         "nothing. The one on the yellow bag also holds the purple bag and part of the baguette, so "
         "it reaches the item without isolating it &mdash; which is why the local model calls it "
         "purple cabbage."),
    ):
        shots = "".join(
            f'<figure class="wide"><img loading="lazy" alt="{title}" src="{data_uri(f)}">'
            f'<figcaption>{f.stem.split("-", 1)[1]}</figcaption></figure>'
            for f in sorted(RENDER.glob(f"{stem}-*.jpg")))
        if shots:
            pending += (f'<section class="pending"><h3>{title}</h3><p>{note}</p>'
                        f'<div class="shots">{shots}</div></section>')

    shot = HERE / ".cache/kart/app-unavailable.png"
    app_shot = data_uri(shot) if shot.exists() else ""
    bag = HERE / ".cache/kart/app-bag-local.png"
    bag_shot = data_uri(bag) if bag.exists() else ""

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
.pending {{ border:1px solid var(--rule); background:var(--raise); border-radius:12px;
  padding:20px 22px; margin-bottom:22px; }}
.pending h3 {{ margin:0 0 8px; font-family:"IBM Plex Sans",sans-serif; font-size:1rem; }}
.pending p {{ margin:0 0 16px; color:var(--ink-2); font-size:.88rem; max-width:66ch; }}
.gaps {{ width:100%; border-collapse:collapse; margin:0 0 14px; font-size:.86rem; }}
.gaps th {{ text-align:left; font-weight:600; font-size:.68rem; letter-spacing:.09em;
  text-transform:uppercase; color:var(--ink-2); padding:0 12px 8px 0;
  border-bottom:1px solid var(--rule); }}
.gaps td {{ padding:10px 12px 10px 0; border-bottom:1px solid var(--rule);
  vertical-align:top; color:var(--ink-2); }}
.gaps td:first-child {{ color:var(--ink); font-family:"IBM Plex Mono",monospace;
  font-size:.78rem; white-space:nowrap; }}
.gaps .yes {{ color:var(--ink); font-weight:600; }}
.scroll {{ overflow-x:auto; }}
.shot-app {{ margin:0 0 18px; max-width:300px; }}
.shot-app img {{ width:100%; height:auto; border-radius:14px; border:1px solid var(--rule);
  display:block; }}
.shots {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; }}
figure.wide {{ margin:0; }}
figure.wide img {{ width:100%; height:auto; border-radius:8px; display:block; }}
figcaption {{ font-family:"IBM Plex Mono",monospace; font-size:.72rem; color:var(--ink-2);
  padding-top:6px; }}
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

<h2>Waiting on a census pass</h2>
<p class="section-note">Two changes are implemented and switched off until they can be measured
against the shipped model. Both are drawn here because looking at them changed what they were worth:
a total can say a change is free while the picture shows it removing four real products.</p>
{pending}

<h2>On a phone</h2>
<p class="section-note">A build installed on a phone today names nothing, and only the third reason
below is the model. The app compiles for real iPhone hardware: Release, arm64, iOS 17. A signed
build names the two things blocking an install, and neither is about recognition: Xcode has no Apple
ID signed in, so it cannot issue a provisioning profile, and no device is registered, which a free
account only does after the phone is attached once by cable. It has never run on a physical
device.</p>
<div class="scroll"><table class="gaps">
<tr><th>missing</th><th>what the app does</th><th>how it was checked</th></tr>
<tr><td>EXPO_PUBLIC_KART_API_URL</td><td><strong>Closed.</strong> Unset, every request returned
<code>unconfigured</code> while the camera, tracker, outlines and barcode path kept working. A
<code>.env</code> now carries it.</td><td class="yes">The endpoint is in the built bundle; the build
made before <code>.env</code> existed had none.</td></tr>
<tr><td>ENUMERATOR_URL</td><td>Degraded mode: no outlines, no catalog shortlist, 72% of units. Not
the pipeline any figure on this page was measured on.</td><td class="yes">The server logged
<code>enumeration degraded: no enumerator configured</code>.</td></tr>
<tr><td>OpenAI credit</td><td><strong>Worked around.</strong> A local vision model now answers the
same census contract from weights on the machine, so a bag fills with no account at all. It is
worse than the shipped model and slower, and is a fallback rather than the product.</td><td class="yes">IMG_0252 named end to end in 113s with no credit: Oreo, cauliflower, Granny Smith apples and
baguette right, two answers plainly wrong.</td></tr>
</table></div>
<p class="section-note">The app had never once called a server: the Frame Lab harness used local
fixtures, written when nothing was deployed, so a full bag of named items on screen proved the
pipeline and nothing about reaching a service. A <code>server</code> run mode now uses the real
client. Verified end to end: the app formed tracks, encoded a keyframe, POSTed to the service, the
service took its marks and called the model, and it failed at the credit wall. The screenshot is the
unavailable notice driven by a real failure for the first time, bag at zero. This was a simulator,
not a phone.</p>
<div class="scroll" style="display:flex;gap:16px"><figure class="shot-app"><img loading="lazy" alt="The app showing the unavailable notice" src="{app_shot}"><figcaption>a real 429: the failure is loud</figcaption></figure><figure class="shot-app"><img loading="lazy" alt="The app bag filled by a local model" src="{bag_shot}"><figcaption>the same app, local model, nine items</figcaption></figure></div><h3 style="font-size:.95rem;margin:26px 0 4px">The whole set, with no OpenAI account</h3>
<p class="section-note">All ten photographs and the video, posted over HTTP to a running recognition
service exactly as a phone would. Strict asks for the truth item's head noun; lenient for any shared
non-generic word. The four shelf photographs hold no trolley and score 0 of 0 by construction.</p>
<div class="scroll"><table class="gaps">
<tr><th>input</th><th>products</th><th>strict</th><th>lenient</th></tr>
<tr><td>IMG_0244</td><td>1</td><td class="yes">1</td><td>1</td></tr>
<tr><td>IMG_0245</td><td>1</td><td class="yes">1</td><td>1</td></tr>
<tr><td>IMG_0246</td><td>2</td><td class="yes">2</td><td>2</td></tr>
<tr><td>IMG_0249</td><td>3</td><td class="yes">3</td><td>3</td></tr>
<tr><td>IMG_0252</td><td>9</td><td class="yes">8</td><td>8</td></tr>
<tr><td>IMG_0254</td><td>15</td><td class="yes">8</td><td>8</td></tr>
<tr><td>six trolleys</td><td>31</td><td class="yes">23</td><td>23</td></tr>
<tr><td>the video, four frames fused</td><td>10</td><td class="yes">7</td><td>8</td></tr>
</table></div>
<p class="section-note">The shipped model reaches 76 of 93 products over three passes and the video
8 of 9, in about four seconds a frame. This is a 2B model with no catalog shortlist and box-shaped
outlines, at 55 to 290 seconds a photograph. It is worse, except on the four sparse trolleys, where
it finds every item every time. IMG_0252 misses exactly one thing and it is the yellow produce bag.
One fault found here and since fixed: the local census hardcoded <code>subjectIsCart</code> true, so
it reported all four shelf photographs as trolleys. It asks now, and the wording mattered more than
the model did. Offered a choice between two words it narrates instead of answering, and a keyword
test over that narration returns whichever word it was looking for; asked one closed question about
a concrete visual fact, it separates every photograph. Verified on all seven the corpus can answer:
three trolleys true, four shelves false.</p>
<p class="section-note">The right-hand bag is filled with no OpenAI account. Read it as plumbing and not as recognition: the bundled test asset is a synthetic picture of coloured shapes, which is why four lines are "Orange square", "Blue oval", "Green square" and "Yellow rectangle". The recognition figures on this page are the corpus ones above.</p>
<p class="section-note">A separate hazard found while checking that build, and fixed. The
development <code>.env</code> raised the request timeout to fifteen minutes for the slow local
stand-in model, guarded by nothing but a comment asking nobody to ship it. Shipped, it would hold a
scan for fifteen minutes rather than failing at twenty seconds, and because the unavailable notice
keys off the failure count, the notice could not have appeared either: a live camera quietly adding
nothing. A Release build now ignores the override, verified in the artifact rather than only in a
test, since the value does not appear in a device bundle at all.</p>
<p class="section-note">The second gap now has a local host that runs the same detector on a Mac. It
reproduces the measured region set exactly: 10 regions against 10 on IMG_0252, 11 against 11 on
IMG_0254, and 21 of 21 matching at IoU 0.7 or better. A scan keyframe takes 3.9s on MPS. A real
photograph pushed through both servers reached the model and stopped only at the credit wall.
<code>docs/running-on-a-phone.md</code> is the runbook.</p>

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
