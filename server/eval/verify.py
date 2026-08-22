"""One command that verifies the vision pipeline against the four things CLAUDE.md asks for.

The measurements in this directory grew one per question and are now scattered across a dozen
entry points with different flags. This runs the ones that apply, in order, and prints a single
report. Anything it cannot run is reported as SKIPPED with the reason, never omitted: a check that
quietly does not run reads as a check that passed.

Two tiers. Local checks need no API key and no credit, and cover the detector, the catalog matcher
and the region truth. Model checks call the shipped census through OpenAI and cover the bag itself.

    server/.venv/bin/python server/eval/verify.py            # local checks only
    server/.venv/bin/python server/eval/verify.py --model    # add the checks that cost money
"""
import argparse, os, pathlib, subprocess, sys

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent.parent
PY_BIN = str(ROOT / "server/.venv/bin/python")
TSX = str(ROOT / "server/node_modules/.bin/tsx")

# (requirement, name, argv, needs_model)
CHECKS = [
    ("1 every item reaches the bag",
     "detector recall and isolation, against hand-labelled boxes",
     [PY_BIN, str(HERE / "score_boxes.py")], False),
    ("1 every item reaches the bag",
     "catalog shortlist recall (closed world, first clause)",
     [PY_BIN, str(HERE / "score_shortlist.py")], False),
    ("1 every item reaches the bag",
     "the bag, six trolleys, live census",
     ["node", f"--env-file={ROOT}/server/.env.local", TSX,
      str(HERE / "pipeline/census-live.ts"), "--repeat=3"], True),
    ("2 quantities are right",
     "the scan loop over the video, contents-scored",
     ["node", f"--env-file={ROOT}/server/.env.local", TSX,
      str(HERE / "pipeline/scan-loop.ts"), "--path=capture"], True),
    ("3 hidden items are flagged",
     "occlusion, local model, discrimination over ten photographs",
     [PY_BIN, str(HERE / "pipeline/occlusion_local.py")], False),
    ("4 unsure items are flagged, not asserted",
     "census confidence calibration, from the last saved live run",
     [PY_BIN, str(HERE / "score_confidence.py")], False),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", action="store_true",
                    help="also run the checks that call OpenAI and cost money")
    args = ap.parse_args()

    results = []
    for req, name, argv, needs_model in CHECKS:
        if argv is None:
            results.append((req, name, "NOT BUILT", ""))
            continue
        if needs_model and not args.model:
            results.append((req, name, "SKIPPED", "needs --model"))
            continue
        print(f"\n=== {req}\n--- {name}\n", flush=True)
        env = dict(os.environ)
        if "occlusion_local" in " ".join(argv):
            env.setdefault("KART_VLM", "mlx-community/Qwen2.5-VL-7B-Instruct-4bit")
        proc = subprocess.run(argv, cwd=str(HERE), capture_output=True, text=True, env=env)
        tail = [l for l in proc.stdout.splitlines() if l.strip()][-6:]
        print("\n".join(tail))
        # A check can also fail by succeeding at nothing. scan-loop.ts printed "0 of 9" and exited
        # 0 when every census failed, and this runner called that "ran", which is the exact
        # confusion it exists to prevent. Treat an all-zero result as a failure to be looked at.
        joined = " ".join(tail)
        if proc.returncode == 0 and ("0 of 9" in joined or "bag 0 against" in joined
                                     or "0/31" in joined):
            results.append((req, name, "SUSPECT", "produced an all-zero result"))
            continue
        if proc.returncode != 0:
            err = (proc.stderr or "").strip().splitlines()
            why = next((l for l in err if "Error" in l or "error" in l), err[-1] if err else "failed")
            results.append((req, name, "FAILED", why[:90]))
        else:
            results.append((req, name, "ran", ""))

    print("\n\n=== summary\n")
    for req, name, state, why in results:
        print(f"  {state:<10} {req:<44} {name}" + (f"   [{why}]" if why else ""))
    print("\n  'ran' means the check produced numbers, not that the numbers are good;")
    print("  'SUSPECT' means it exited cleanly with an all-zero result, which is usually a")
    print("  broken run rather than a measured one. Read its output before believing it.")
    print("  read them above and compare against server/eval/KART.md.")


if __name__ == "__main__":
    main()
