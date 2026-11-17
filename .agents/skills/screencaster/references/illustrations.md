# Prepare documentation illustrations

Use this workflow for crop, outline/dim annotations, image series, before/after
comparisons, collages, contact sheets and local YFM markup. Browser capture and
local illustration production are separate; production needs no open browser.
Do not redraw product features or resample interface panels to invent resolution.

## Analyze

Use `screencaster_illustrations_analyze` with a `job` and a new `output` name. Job
sources are exact run-relative artifact paths from the current manifest, including
preserved screenshot originals; arbitrary host paths are refused. Each input has
an ID and may specify pixel crop/annotation geometry and a verified locale.
Choose `single`, `annotated`, `before-after`, `variants` or `sequence` deliberately.

Provide `version: 1`, the illustration's `purpose`, observed `evidence`, `result`,
`inputs` and `publication`. Each input needs `id` and `source`; crop/annotation
boxes use physical input pixels. For an annotation use `method: outline` or `dim`
and an explicit `box`. Do not reuse coordinates between locales without evidence.
Measured capture DPR/viewport/bbox take precedence over guessed metadata.

For YFM set `publication.format: yfm` and the known relative `assetDirectory`.
Requested CSS width is bounded by the source's physical width and DPR. Unknown
DPR, mixed scales, missing destination or unverified target rendering remain
limitations. `generic` retains draft publication status.

Analysis produces a hash-bound manifest and contact-sheet preview. Open the
preview, check context, crop, source data and target geometry. A contact sheet is
for inspection; it is not automatically a publication asset. If geometry needs
changing, create a new analysis rather than editing a confirmed file in place.

## Produce

Use `screencaster_illustrations_produce` with the saved analysis directory name,
a new output name and `confirmation: {analysisSha256, evidence}`. Evidence must
explain the inspected composition; a matching hash binds the chosen inputs and
geometry. The runner rereads the saved registered analysis, checks source hashes
and writes panels, optional collage, contact sheet, machine QA and YFM markup.
Originals and earlier outputs stay intact.

Machine success returns `visualStatus: PENDING`, `publicationStatus: DRAFT` and
`overallStatus: PENDING_VISUAL_QA`. Inspect every final panel at its intended size,
including margins and background details, spelling, locale and sensitive data.
If data cannot be removed by a truthful crop, request a new sanitized source.

## Review and return

Visual/publication review is a host attestation, not a model's automatic PASS.
The trusted TypeScript host can call `reviewIllustrations()` with the exact
production hash and reviewed visual evidence, plus target-render evidence when
publication was checked. Review appends a separate file; it does not modify
production artifacts. `verifyIllustrationReview()` checks an explicitly selected
attestation against current source, production and artifact hashes.

Return registered source and output paths, the analysis/production hashes, QA
statuses and remaining limitations. Local YFM markup does not publish a page.
Do not claim publication readiness from command completion, a machine PASS,
a supplied evidence sentence or an unverified historical review.
