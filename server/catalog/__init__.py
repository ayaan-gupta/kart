"""
Catalog matching: turning a crop of one product into the SKU the store actually sells.

The design assumes a deployment holds the store's complete product list, which makes naming a
closed-world problem. That assumption is load-bearing and it is what everything here exploits.

    encode    frozen image encoders, plus a colour-layout descriptor that no encoder provides
    head      a classifier trained on the store's own catalog, which is the largest single win
              measured (server/eval/CATALOG.md)
    geometry  keypoint correspondence, for telling two near-identical packages apart
    rank      shortlist, fusion of the above, and a calibrated confidence

server/eval imports from here rather than reimplementing, so every published number describes
this code and not a copy of it that has since drifted.
"""
