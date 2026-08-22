"""Requirement 4: are the items the system is unsure about flagged, rather than asserted?

    "items the system is unsure about are flagged as unsure, not asserted confidently"

Nothing has ever measured this. It needs no new model call: `census-live.ts` saves every census
response it receives, including each mark's `confidence` and `needsCloserLook`, beside the
per-badge verdict of whether that mark named its badge correctly. Calibration is the join of those
two, and it is the whole requirement: a wrong answer the system flags is a prompt to look again, a
wrong answer it asserts is a wrong line in a shopper's bag.

    server/.venv/bin/python server/eval/score_confidence.py [--in kart-census-live.json]
"""
import argparse, json, pathlib, statistics

HERE = pathlib.Path(__file__).parent


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", default="kart-census-live.json")
    args = ap.parse_args(argv)
    runs = json.loads((HERE / args.src).read_text())

    right, wrong = [], []
    flagged_wrong = flagged_right = 0
    for run in runs:
        marks = {m["id"]: m for m in run["census"]["marks"]}
        for row in run["rows"]:
            if row.get("ok") is None:      # unlabelled or not scorable
                continue
            m = marks.get(row["badge"] + 1)
            if m is None:
                continue
            conf = m.get("confidence")
            flag = bool(m.get("needsCloserLook"))
            if row["ok"]:
                right.append(conf)
                flagged_right += flag
            else:
                wrong.append(conf)
                flagged_wrong += flag

    def line(label, xs, flagged):
        if not xs:
            print(f"  {label:<26} none")
            return
        print(f"  {label:<26} n={len(xs):<4} mean confidence {statistics.mean(xs):.2f}   "
              f"needsCloserLook on {flagged}/{len(xs)}")

    print(f"{args.src}: {len(runs)} photograph-passes\n")
    line("named its badge right", right, flagged_right)
    line("named its badge wrong", wrong, flagged_wrong)
    if right and wrong:
        gap = statistics.mean(right) - statistics.mean(wrong)
        print(f"\n  confidence gap, right minus wrong   {gap:+.2f}")
        print("  A positive gap means the census is less sure when it is wrong, which is what")
        print("  requirement 4 asks for. A gap near zero means confidence carries no signal and")
        print("  the amber path is being driven by noise.")


if __name__ == "__main__":
    main()
