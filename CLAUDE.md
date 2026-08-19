@AGENTS.md

# Testing standard

Nothing here counts as built until it has been tested against the real use case. Unit tests
prove the code does what its author meant. They do not prove the product works, and this
project has repeatedly shipped code with green tests and a broken outcome.

## The real use case

A shopper photographs a loaded grocery cart at the checkout queue. Success is four things,
and every one of them is separately measurable:

1. every item in the cart reaches the bag
2. quantities are right, two identical yogurts are 2 and not 1 or 4
3. items hidden under other items are flagged as hidden, so the shopper is asked to move them
4. items the system is unsure about are flagged as unsure, not asserted confidently

A change that improves 1 while breaking 2 has not improved anything. Measure all four.

## How to test

Test against photographs of real loaded carts. Not synthetic scenes, not single products on
white, not a screenshot of the UI with mock data.

Getting them is part of the work, not a blocker to report:

- search for openly licensed photographs (Wikimedia Commons, Openverse, Pexels, Unsplash)
- look for published datasets (SKU-110K, RP2K, Grocery Store Dataset, FGPR)
- ask the user to photograph their own cart, or to obtain store catalog data

Record the source URL and licence of every image in a manifest beside it, at the time you add
it. Ten photographs were once collected without provenance and cannot be committed, which is
why `server/eval/corpus/images/` is empty.

## Reporting a number

Every accuracy claim must state the corpus, its size, the metric, and the number. "It works
well" and "roughly 70%" are not results.

A number produced by a throwaway script in a scratch directory is not a result either. If a
measurement is worth quoting, commit the harness and the labels so it can be re-run after the
next change. Numbers that cannot be reproduced get treated as unmeasured.

Report regressions in the same message as improvements. A change that lifts detection recall
and costs naming accuracy is one result, not one good result.

## The closed-world assumption

Assume the deployment has the store's full product catalog, and that a model is fine-tuned per
store. The catalog is the complete set of things that can possibly be in the cart.

This changes what to measure. Do not measure open-world naming, where the answer is any product
on earth. Measure against the catalog: is the correct SKU in the top-k shortlist, and does the
resolver pick it. Open-world numbers understate what the shipped product will do and send tuning
in the wrong direction.
