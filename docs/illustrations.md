# Capture and illustration workflow

Browser capture and illustration production have separate contracts. Capture
returns the original device-pixel PNG and measured viewport/DPR/bounds. The local
raster pipeline crops and decorates PNG/JPEG, makes panels/collages/contact sheets,
and prepares local YFM markup without opening a browser or making network calls.
Production panels are never resampled. Only an inspection preview may be reduced.

## Capture privacy and readiness

Configure `BrowserSessionOptions.screenshotPolicy` or the same trusted
`ServerOptions` capability. It is not a model-facing argument. A policy contains
explicit replacement pairs, CSS selectors to hide and optional
`requireRedaction: true`. Configure known values at the host boundary; never put
real replacement maps in source control, model arguments or public reports.

A new session with redaction and no explicit browser policy uses
`createCapturePolicy()`. An explicit policy must include a reviewed read-only
network guard: DOM presentation changes can trigger application observers. The
guard prevents outgoing writes; it does not turn an arbitrary POST endpoint into
a read. Use only exact independently reviewed POST-read endpoints.

Capture applies configured DOM replacements and hiding without input/change
events, checks native input values, visible composed text and open shadow content,
and verifies again after pixels return. It refuses unsupported visible raster,
frame, generated-image or animation surfaces; explicitly hide them or prepare a
safe fixture. Closed shadow roots are refused. Mutation/known-source checks are
bounded and conservative, not automatic personal-data detection, OCR, proof
against hostile page JavaScript or a replacement for visual review. Registered
source strings of at least three characters are also masked in observations.

Use `ready` and `notReady` arrays with exact observed `{ref}` or `{role, name}`
locators and bounded `timeoutMs`. The first stage waits for unique visible ready
targets and absent/hidden loading targets. After screenshot capture it checks
immediately again; later readiness cannot validate earlier pixels. Refresh refs
after navigation/layout changes and account for locale when naming targets.

The unannotated original is the PNG **after redaction**. `highlight: true` retains
it at `<output>.original.png`, registers its SHA-256 and creates a separate derived
PNG with `derivedFrom` provenance. The temporary unsanitized state is never a
registered output. Native screenshot forwarding is disabled with a screenshot
policy; use the policy-checked screenshot API/tool.

DOM screenshot sanitation cannot retroactively protect recorded video. Both
public browser startup paths refuse `videoDir` with configured redaction before
launching capture. For video use an independently sanitized fixture and review
the complete raw recording. No automatic video privacy claim is made.

## TypeScript API

The following host-side example uses a previously captured registered screenshot:

```ts
import path from 'node:path';
import type {ScreenshotMetadata} from '@diplodoc/screencaster/browser';
import {
  analyzeIllustrations,
  produceIllustrations,
  reviewIllustrations,
  verifyIllustrationReview,
} from '@diplodoc/screencaster/media/illustration';

const metadata = screenshot.metadata as ScreenshotMetadata;
const analysis = await analyzeIllustrations(
  {
    version: 1,
    purpose: 'Find the project settings control',
    evidence: 'The settings control is visible in the source PNG',
    result: 'single',
    inputs: [
      {
        id: 'settings',
        source: path.join(run.directory, screenshot.path),
        sourceSha256: screenshot.sha256,
        dpr: metadata.deviceScaleFactor,
        viewport: metadata.viewport,
      },
    ],
    publication: {format: 'yfm', assetDirectory: '_assets'},
  },
  {output: path.join(run.directory, 'analysis')},
);

// Inspect the analysis preview and explicit pixel geometry before confirmation.
const output = path.join(run.directory, 'illustrations');
const production = await produceIllustrations(
  {
    analysis,
    confirmation: {
      analysisSha256: analysis.analysisSha256,
      evidence: 'The source and contact sheet retain the required context',
    },
  },
  {output},
);
```

`crop`, `bbox` and annotation `box` use physical source pixels, independently for
each locale. Annotation methods are `outline` and `dim`. `result` also supports
`annotated`, `before-after`, `variants` and `sequence`. Inputs may be PNG/JPEG;
animated, rotated-orientation or oversized inputs are refused rather than silently
changing geometry. Output directories must be new; originals and earlier outputs
are preserved. Source/preview hashes are checked before and after production.

## QA and publication

Production writes panels, an optional collage, a contact sheet, `production.json`,
`machine-qa.json` and optional `publication-yfm.md`. Machine success leaves visual
status `PENDING`, publication `DRAFT` and overall `PENDING_VISUAL_QA`.

The trusted host can record an independently performed review:

```ts
const review = await reviewIllustrations(output, {
  productionSha256: production.productionSha256,
  visual: {status: 'pass', evidence: reviewedVisualEvidence},
  publication: {renderEvidence: reviewedTargetRenderEvidence},
});
await verifyIllustrationReview(output, review.path);
await run.registerExport('illustrations');
```

Evidence must describe checks actually performed. Review is append-only and
verifies current source/production/artifact hashes; it never rewrites production
or prior reviews. Hashes bind content and evidence, not the reviewer's identity.
There is no MCP tool for a model to assert an automatic visual/publication PASS.
Unknown DPR, mixed collage scales, generic destination or missing asset directory
remain limitations even after a positive visual review. Local YFM markup does not
publish anything and does not establish that target rendering was checked.

## MCP workflow

1. Capture with `screencaster_screenshot`, retaining originals as needed.
2. Call `screencaster_illustrations_analyze` with `{job, output}`. Input `source`
   values must exactly name unchanged registered artifacts in the current run.
   The bridge uses measured capture DPR/viewport/bbox and attaches a preview.
3. Inspect the preview. Changed crop/geometry requires a new analysis.
4. Call `screencaster_illustrations_produce` with saved analysis directory name,
   new output name and `{analysisSha256, evidence}` confirmation. The tool reads
   the saved registered analysis, not model-supplied absolute filesystem paths.
5. Return artifacts and actual QA limitations; leave final host review pending.

See [host-adapters.md](host-adapters.md) and the typed
[Host examples](../examples/host-adapters/host.ts) for service-specific policies,
authentication and explicitly authorized fixture operations.
