"""
Refit the fusion weights, calibration and floor for a new feature set.

`matcher.FUSION` weights four signals: the trained head, nearest-neighbour similarity, a colour
descriptor and keypoint geometry. Those weights were fitted on RPC, where the head's held-out
catalog accuracy was 99.6%, and the fit put almost everything on the head for exactly that
reason. On real shelves the same head lands near 71%, so the weighting inherited from RPC is
tuned for evidence quality this corpus does not have. Every earlier regression in this project
came from carrying a constant across feature sets, so the constants get refitted here rather
than assumed.

This reads the per-crop signals `score_grocer.py --tag ...` already dumped, so a sweep costs no
encoding at all. Weights are fitted on one half of the query photographs and reported on the
other, split by photograph and never by crop, so a weighting that happens to suit one shelf's
lighting cannot be chosen on the strength of that shelf and reported on it too.

    server/.venv/bin/python server/eval/fit_grocer_fusion.py --tag b16-spread-notta
"""
import argparse
import itertools
import json
import pathlib

import numpy as np

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache" / "grocer"

SIGNALS = ("head", "nearest", "color", "geometry")


def load(tag):
    """Rows that carry signals and whose truth is somewhere in the shortlist.

    A crop whose truth never entered the shortlist cannot be recovered by any weighting of
    signals computed over that shortlist, so including it would add a constant to every
    candidate weighting and hide the differences between them. It is counted separately and
    folded back in when the number is reported.
    """
    rows = json.loads((CACHE / f"rows-{tag}.json").read_text())
    answerable = [r for r in rows if r["answerable"] and r.get("signals")]
    inside = [r for r in answerable if r["truth"] in r["shortlist"]]
    return answerable, inside


def matrices(rows):
    """Signals as one array per name, plus the index of the truth in each row's shortlist."""
    width = max(len(r["shortlist"]) for r in rows)
    stacks = {}
    for name in SIGNALS:
        block = np.full((len(rows), width), -np.inf, dtype=np.float64)
        for i, r in enumerate(rows):
            values = r["signals"].get(name)
            if values:
                block[i, : len(values)] = values
        stacks[name] = block
    truth = np.array([r["shortlist"].index(r["truth"]) for r in rows])
    return stacks, truth


def accuracy(stacks, truth, weights):
    """Share of rows whose truth wins the weighted sum."""
    fused = sum(weights[name] * stacks[name] for name in SIGNALS)
    return float((np.argmax(np.nan_to_num(fused, neginf=-1e9), axis=1) == truth).mean())


def scenes_of(rows):
    """The photograph each crop came from, encoded in its filename by `grocer.corpus`."""
    return np.array([pathlib.Path(r["path"]).name.split("-")[0] for r in rows])


def sweep(stacks, truth, mask, step=0.05):
    """Grid search over weights that sum to one, on the fit half only."""
    best, best_score = None, -1.0
    ticks = np.round(np.arange(0.0, 1.0 + 1e-9, step), 3)
    for head, nearest, color in itertools.product(ticks, repeat=3):
        geometry = round(1.0 - head - nearest - color, 3)
        if geometry < -1e-9 or geometry > 1.0:
            continue
        weights = {"head": head, "nearest": nearest, "color": color, "geometry": geometry}
        score = accuracy(
            {k: v[mask] for k, v in stacks.items()}, truth[mask], weights
        )
        if score > best_score:
            best, best_score = weights, score
    return best, best_score


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--step", type=float, default=0.05)
    args = parser.parse_args(argv)

    answerable, inside = load(args.tag)
    ceiling = len(inside) / len(answerable)
    print(f"{len(answerable)} answerable crops, {len(inside)} with the truth in the shortlist "
          f"({ceiling:.1%} ceiling)")

    stacks, truth = matrices(inside)
    scenes = scenes_of(inside)
    unique = np.array(sorted(set(scenes.tolist())))
    fit_scenes = {s for i, s in enumerate(unique) if i % 2 == 0}
    fit = np.array([s in fit_scenes for s in scenes])
    print(f"  {len(unique)} photographs, {fit.sum()} crops fit / {(~fit).sum()} crops held out")

    shipped = {"head": 0.65, "nearest": 0.0, "color": 0.0, "geometry": 0.35}
    head_only = {"head": 1.0, "nearest": 0.0, "color": 0.0, "geometry": 0.0}

    print("\n  weighting                                     fit     held out   overall top-1")
    def line(label, weights):
        held = accuracy({k: v[~fit] for k, v in stacks.items()}, truth[~fit], weights)
        got = accuracy({k: v[fit] for k, v in stacks.items()}, truth[fit], weights)
        print(f"  {label:42s} {got:6.1%}   {held:6.1%}   {held * ceiling:6.1%}")
        return held

    line("shipped (RPC-fitted)                     ", shipped)
    line("head alone                               ", head_only)
    for name in SIGNALS:
        if name != "head":
            line(f"{name} alone", {k: (1.0 if k == name else 0.0) for k in SIGNALS})

    best, fit_score = sweep(stacks, truth, fit, args.step)
    label = " ".join(f"{k}={v:.2f}" for k, v in best.items())
    held = line(f"refitted: {label}", best)

    out = CACHE / f"fusion-{args.tag}.json"
    out.write_text(json.dumps({
        "tag": args.tag,
        "weights": best,
        "fit_accuracy_within_shortlist": fit_score,
        "heldout_accuracy_within_shortlist": held,
        "shortlist_ceiling": ceiling,
        "heldout_top1_overall": held * ceiling,
    }, indent=1))
    print(f"\nwrote {out}")
    return best


if __name__ == "__main__":
    main()
