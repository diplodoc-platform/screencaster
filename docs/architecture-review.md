# Architecture and code-quality review

## Reference repositories

The review consulted public repository trees, package configurations, and agent
instructions on GitHub:

- [Diplodoc CLI AGENTS.md](https://github.com/diplodoc-platform/cli/blob/master/AGENTS.md)
  documents capability folders, configuration, public types, and module context.
- [Diplodoc utils](https://github.com/diplodoc-platform/utils) keeps a separate
  `test/` tree and supports a standalone package build.
- [Diplodoc transform](https://github.com/diplodoc-platform/transform) separates
  server and browser code and keeps tests outside production output.
- [Diplodoc skills](https://github.com/diplodoc-platform/skills) uses `SKILL.md`
  entry points with conditional resources under `references/`.

These repositories use different layouts. Screencaster adopts capability modules,
a separate test tree, explicit package exports, and root/module agent guidance.

## Changes implemented

| Finding                                                   | Change                                                                                                      | Verification                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Mixed PascalCase and camelCase filenames                  | Source filenames and feature directories use kebab-case                                                     | Architecture test                                                |
| MCP client and application tools shared one folder        | Separate `transport/mcp` and `server/mcp` modules                                                           | Dependency-boundary test                                         |
| Browser execution depended on media implementation        | UI-state classification moved into shared capture contracts; clock integration belongs to browser recording | Runtime dependency and cycle tests                               |
| Browser programs were built from long JavaScript strings  | Strict TypeScript driver and DOM programs with esbuild serialization and explicit data arguments            | Type checking, callable-boundary regression, browser integration |
| Repeated patterns, diagnostics, and hard-coded settings   | Module-specific configuration, patterns, and message files                                                  | Type checking and behavioral regression suites                   |
| Tests were included in the source tree                    | Separate unit, browser, and architecture directories; updated compilers, Vitest, lint, and Sonar paths      | Build and package-content check                                  |
| Agent guidance lived in an unrecognized harness directory | Standard `.agents/skills/screencaster` entry point and root `AGENTS.md` routing                             | Skill validation and installed-package guide checks              |
| File moves could break consumers                          | Explicit legacy and canonical export aliases                                                                | Installed consumer import and declaration checks                 |
| Browser installation ran before every session             | Check the binary belonging to the MCP driver's Playwright version before invoking installation              | Browser integration startup                                      |
| Screenshot file handling enlarged the runtime coordinator | Dedicated capture service with explicit execution/snapshot capabilities                                     | PNG integration tests                                            |

## Runtime, large recordings and journals implemented

The three initial follow-up priorities are implemented:

- Runtime lifecycle, dialog ownership and dispatch receipts have explicit state
  collaborators. Start/close/abort races join the same process lifecycle, context
  replacement is terminal, and overlapping model calls are refused before dispatch.
  Native dialogs retain the exact initiating page; a changed page/tab permits
  cancellation only. Mutation failures are never replayed.
- Raw hashes use chunked binary storage; source selection and narration counts use
  typed arrays. Selection hashes and final-video counts are checked as streams.
  Rendering derives filters from ranges without a million-entry Set or repeated
  linear searches. Every retained clean hash/order, final count/rate/audio and raw
  SHA-256 check remains enabled. Public eager array APIs keep their contracts.
- A shared ordered async writer persists manifests, media journals and JSONL events
  using immutable snapshots, private files, fsync and atomic snapshot replacement.
  Every async action drains its receipts before returning. Failures stay sticky and
  block subsequent actions while preserving unknown outcomes and action IDs.
  Finalization/cancellation stop the browser and attempt all remaining writes even
  after disk failure. Synchronous state-mutating APIs enqueue writes and expose an
  explicit `flush()` barrier; MCP handlers await it automatically.

## Measurements

Run `npm run benchmark` for metadata/journals, or
`FFMPEG_PATH=/path/to/ffmpeg npm run benchmark -- --video` to include a real
30-minute encoded fixture and verified export. The script is TypeScript and is
checked before execution. Each case runs in a fresh Node process. Full values are
saved in [benchmark-results.json](benchmark-results.json).

Measured on 2026-11-16, darwin/arm64, Node 24.16.0 and FFmpeg 9.0.2:

| Case                                                                            | Eager/synchronous | Packed/queued |
| ------------------------------------------------------------------------------- | ----------------: | ------------: |
| 1,000,000 frames: retained heap + external memory, including refs and selection |        243.79 MiB |     24.17 MiB |
| Same metadata workload: peak Node RSS                                           |        519.55 MiB |    121.41 MiB |
| Frame-store construction                                                        |         134.35 ms |     245.15 ms |
| Reference/selection construction                                                |          58.36 ms |      22.80 ms |
| Comparing all 1,000,000 hashes in order                                         |         241.49 ms |     181.28 ms |
| 30-minute, 320×180, 25 fps fixture: retained frame metadata                     |          8.43 MiB |      1.58 MiB |
| Same encoded fixture: read/validate 45,000 frames                               |           5.414 s |       5.388 s |
| 4,000-action journal (~1.02 MiB), 100 durable snapshots                         |          1,315 ms |      1,213 ms |
| Same durable-per-snapshot workload: largest timer interval                      |          1,316 ms |       2.91 ms |

A burst of 100 enqueues with barriers every 20 updates coalesced to five durable
snapshots in 140 ms; its largest timer interval was 18.04 ms. This models observer
bursts. Browser action receipt barriers are not coalesced across actions: the
separate durable-per-snapshot case above flushes every update. Queue peak RSS was
115–124 MiB versus 108 MiB for the synchronous journal case: immutable serialized
snapshots have a memory cost.

The real fixture completed the new export path in 6.879 s, with all 45,000 source
frames validated and all 51 retained/held output frames verified. Its static color
content intentionally stresses long input duration and strongly reducible idle
material; it does not represent dynamic desktop rendering or a typical output
length. Real browser recordings, narration and editorial cuts are covered by the
integration suite separately.

These are single local measurements, not throughput guarantees. The million-frame
case isolates metadata, not FFmpeg decoding or pixel buffers. RSS values measure
Node, not aggregate child-process memory. Binary storage costs more CPU to fill;
no general rendering-speed improvement is claimed. JSON serialization still runs
on the caller thread; queued filesystem I/O and bounded bursts reduce its blocking
window but do not remove serialization cost.

## Capture privacy and illustration follow-up

The package includes offline still-image processing and trusted host adapters.
Screenshot capture supports bounded readiness,
host-owned DOM redaction, conservative post-pixel checks, clean-source retention
and derived SHA-256 provenance. Native screenshots cannot bypass a configured
policy. Local raster processing replaces browser-based highlight/attachment work.

`media/illustration` implements analyze/preview, hash-confirmed production,
non-resampled panels/collages, contact sheets and local YFM. Production keeps
visual/publication statuses pending/draft. Host review is append-only and binds
source/preview/production/artifact hashes; no model-facing review/PASS endpoint is
exposed. The MCP bridge only reads registered unchanged run artifacts and saved
analyses; arbitrary filesystem inputs are restricted to the trusted direct API.

Host authentication, configurable policies and bounded test-fixture operations
live in typed host examples. The library checks the authorized
target before invoking a login callback and returns manual challenge metadata
before capture starts. Examples are synthetic integration contracts, not claims
about production service endpoints or exercised production credentials.

Three implementation agents performed cross-reviews of code they did not author.
The parent integrated changes, added protocol/registration regressions and ran the
actual browser checks. Concrete findings were corrected before acceptance:

| Finding                                                          | Correction                                                                         | Regression evidence                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Popup page event arrives after its initial request can start     | Request-boundary owned-page check before fetch/fallback                            | Popup endpoint receives zero requests                    |
| Hidden ancestor can have a painted visibility override           | Hide via display:none and inspect actual target/pseudo visibility                  | Visible descendant canvas and pseudo cases               |
| Known source can span inline, shadow, flex or generated text     | Bounded composed and whitespace-compacted verification, including marker content   | Inline/shadow/flex/before/marker source refusals         |
| CSS content can paint uninspectable image pixels                 | Reject generated-image functions in relevant computed styles/pseudos               | content:url image refusal and explicit hide success      |
| Public runtime could record video despite screenshot redaction   | Guard both public startup paths before process launch                              | No MCP process start for unsupported combination         |
| Escape grant required an invalid ref; approved tools disappeared | Page-bound Escape and separate constrained tool discovery                          | Valid Escape, wrong ref/key and behavioral-extra refusal |
| Tiny positive DPR produced an invalid analysis                   | Bound derived CSS widths and parse final analysis before output                    | Tiny/subnormal DPR refusal without output directory      |
| Node refuses TypeScript execution inside node_modules            | Compile typed examples into build/examples and run installed JS                    | Installed synthetic adapter execution                    |
| Sharp bundled libvips under a license denied by CI               | Replace Sharp with MIT/BSD PNG/JPEG codecs and Canvas; preserve source RGBA pixels | Production npm audit reports zero findings               |

Conservative limitations remain explicit: DOM checks cover configured source
values, not automatic DLP/OCR or proof against hostile transient page rendering;
visual review is still required. Strict capture rejects redirects, unsupported
surfaces and write-like background traffic instead of weakening the network
contract. Reviewer evidence is a trusted host assertion; hashes bind content and
do not authenticate identity or prove the review occurred.

Final independent read-only re-review found no blocking findings within this
known-DOM-value and trusted-host contract. All listed fixes were inspected; the
parent separately ran the regression suites described below.

## Further optimizations

1. **Narrow future public contracts.** Compatibility aliases expose historical
   implementation modules. Keep the aliases until consumers are inventoried, then
   document deprecations and consolidate the API in a separately versioned change.
2. **Define the minimum FFmpeg version.** The implementation needs
   `-/filter_complex` and specific encoders. Add a capability probe with actionable
   diagnostics before a first media export. Test the chosen minimum on all supported
   operating systems before declaring a numeric version floor.
3. **Profile dynamic, high-resolution exports.** Measure child-process memory and
   filter-graph cost on real 1080p/4K recordings with many cuts/holds before changing
   graph construction, on-disk hash indexing or the existing frame limit.
4. **Profile JSON serialization under sustained journal load.** Async persistence
   retains full immutable JSON snapshots. Consider an incremental log/checkpoint
   format only with a recovery contract and crash-consistency tests.

## Validation

- Strict production/test TypeScript checks, ESLint and formatting pass. Lint also
  passes in a clean copy without generated build output.
- 154 unit and architecture tests pass, including policies/authentication,
  capture provenance, illustration review integrity, bounded PNG/JPEG decoding,
  exact RGBA crops, alpha compositing and linear-time pattern regression cases.
- All 27 browser integration scenarios pass with Chromium and FFmpeg 9.0. They
  cover screenshot privacy, native dialogs, rich text/checkbox/background/scroll
  interactions, unknown receipts, finalization failures, PNG/video/narration/editing
  and request-boundary network policies.
- V8 unit/architecture coverage is exported as LCOV for SonarCloud: 42.41% of
  source lines. Page-realm and browser integration execution is not included.
- Installed-package validation passes for public exports/declarations, CLI, host
  examples and packaged agent guidance; generated configuration artifacts are current.
- Sharp/libvips are absent from the dependency tree. The replacement PNG/JPEG
  codecs, metadata reader and Canvas packages use MIT/BSD licenses. Production
  dependency audit reports zero vulnerabilities.
