# The counting rule

Quantity of a product is **the largest number of its tracks that were ever simultaneously
alive**, with the model's per-frame `inViewCounts` clamping that number at each keyframe. It is
never a running sum of identification events, and it is never a count of distinct track ids.

## Why not a running sum

That is the bug this project started with. Every time a region was re-identified it added
another unit, so a cart of twelve items reported forty.

## Why not a count of distinct track ids

This is what the design spec says, and it is wrong in a way that only shows up on a real phone.

ByteTrack retires a track once it has been lost longer than `maxLostMs`. Panning away from two
cartons of milk and panning back produces two **new** track ids for the same two physical
cartons, so distinct-track counting reports four. A cart scan is made almost entirely of that
camera motion.

## What the high-water mark costs

Two clusters of the identical product that never appear in one frame together are counted once
instead of twice.

| Scenario | Distinct tracks | High-water mark | Truth |
|---|---|---|---|
| One bunch of bananas, three tracks, model says 1 | 1 after clamp | 1 | 1 |
| Two cartons in view, model says 2 | 2 | 2 | 2 |
| Two cartons, pan away, pan back | 4 | 2 | 2 |
| Two here, two elsewhere, never co-visible | 4 | 2 | 4 |

The last row needs a cart large enough that two separate clusters of the same product never
share a single roughly bird's-eye frame. That is uncommon, and guided capture pushes the user
toward the wider views that make co-occurrence more likely. Undercounting in a rare case is a
gentler failure than double-counting in a common one, so the trade is deliberate.

## Revising a bad clamp

A single occluded or glare-washed keyframe can badly undercount a product that is genuinely
present in force: six real apples read as one. Left alone, the clamp above would pin that
product's quantity at 1 for the rest of the session, because the tracks it folded away stay
folded away and a folded-away track never rejoins the pool the clamp counts from next time.

An **explicit** `inViewCounts` entry for a product is trusted enough to undo that. When a census
reports a real count for a key, the tracks previously folded under that key are released before
the clamp runs again, so a later honest keyframe can raise the quantity back up to what is
actually there.

A key the census stays silent on gets no such release, and that is deliberate. An omitted count
means the model had no opinion this frame, not that it re-confirmed the fold from before.
Releasing on silence is exactly what would let the split-bananas case creep back from 1 to 3 the
moment a keyframe simply didn't mention bananas: the clamp exists to survive silence, and only an
explicit, repeated statement from the model is allowed to overrule it.

## If you want to change this

The alternative that fixes the last row without reintroducing the pan-away bug is spatial
re-identification: remembering where in the cart each counted item sat, in a frame of reference
that survives camera motion. That is ARKit world anchoring, which the spec defers because
ARKit and react-native-vision-camera both demand exclusive camera control. Do not attempt a
half version of it with heuristics on normalized image coordinates; those do not survive
rotation, and the failure mode is silent overcounting.
