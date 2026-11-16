# Illustration production

This capability reads local PNG/JPEG files and performs deterministic local raster
processing through the shared PNG/JPEG raster helpers. Canvas draws overlays and
resizes previews; production crops copy source RGBA pixels directly. It never opens a browser, fetches a URL or runs caller
code. Crop, annotation and `bbox` coordinates are physical source-image pixels;
`viewport` dimensions are CSS pixels and `dpr` records their conversion. Each
localized input has independent geometry.

`analyzeIllustrations(job, {output})` validates hashes and geometry, computes safe
publication widths and optionally writes `analysis.json` plus a contact-sheet
preview into a new private directory. Analysis hashes bind all normalized source,
crop, annotation and preview values. It never guesses a crop or target.

`produceIllustrations({analysis, confirmation}, {output})` requires explicit
confirmation of that analysis hash and bounded evidence. It rechecks input hashes,
creates a new private output directory and returns an immutable production
manifest. Panels are cropped and decorated without resampling. Production collages
preserve each panel's physical pixels; only the clearly identified contact-sheet
preview resamples. Inputs are never overwritten. Combined image pixels, dimensions,
file bytes and input count are bounded before rendering.

Machine success leaves visual review pending and publication in draft.
`reviewIllustrations(directory, review)` is a host-only attestation API; model tools
must not turn a model's assertion into a host PASS. The host supplies visual evidence
and, separately, target-render evidence tied to the exact production hash. Unknown
or incompatible DPR and an unspecified publication destination keep publication in
draft even after a visual pass. Failed visual review remains failed.

Reviews append new private files and do not modify production files already
registered in a capture manifest. `verifyIllustrationReview(directory, reviewFile)`
checks the explicitly selected review, production manifest, source hashes and all
artifact hashes before its status is used again. Do not guess a newest review or
treat an old JSON status as a live integrity check. These hashes bind artifacts and
evidence; they do not authenticate a reviewer or prove that visual work occurred.

YFM markup uses bounded CSS widths, escaped alt text, validated relative asset
directories and optional validated CSS classes. Generating markup does not publish
it or verify rendering in a particular documentation project.
