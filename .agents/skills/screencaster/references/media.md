# Optional media

The raw recording is retained. Export into a new name, never overwrite an original
or earlier export. Use the run manifest instead of guessing the newest video file.

With host `outputs.video` configured, `screencaster_finish` produces and registers
the automatic export before returning. Its `highlights` option controls action
outlines. Inspect the finish manifest for export failures and artifact paths;
do not issue a duplicate export. Without this setting, exports remain manual.
Additional variants can still be exported under new names from the raw recording.

With `outputs.narration`, finish also synthesizes short `actionText` phrases from
successful plan steps, anchored to their first confirmed recorded interaction,
and registers a narrated export with inherited highlights. Use spoken, factual
sentences of at most 1000 characters per step. Steps without interactions and
failed/skipped steps are omitted. Missing anchors or speech that cannot fit cause
an explicit failure with silent video/cache retained. The host configures TTS
through `tts.module` and `tts.options`; the bundled SpeechKit factory supports
API keys, IAM tokens and service-account keys from env or private files.
See [configuration.md](configuration.md). Inspect both sound and video before
claiming a completed narrated guide; no separate narration call is needed when
this automatic output is configured.

- `screencaster_export` shortens a finalized recording. `highlights` is opt-in.
  Video timing and geometry come from measured browser events, not estimated
  model latency or manually invented coordinates.
- `screencaster_narrate` accepts phrases anchored to action IDs or explicit export
  times. The host supplies a TTS provider; SpeechKit is one optional implementation.
  Use neutral reusable narration, grounded in observed actions. A phrase that does
  not fit must be shortened or placed using a bounded explicit hold anchor.
- Captions are opt-in and use visible text and time intervals. Their spelling may
  differ from speech pronunciation. Missing word timings do not prevent audio.
  `screencaster_captions` also accepts timed text independently of narration.
- `screencaster_edit` cuts explicit time intervals, action IDs or step IDs from an
  existing export. Raw, original execution status and earlier exports stay intact.
  Partial caption cuts require author review.
- `screencaster_edit_proposal` can validate a reversible detour against recorded
  states; a rejected proposal is not permission to remove uncertain actions.
- `screencaster_preview` creates a neutral PNG cover.
- `screencaster_clip` exports an explicit range from an existing export as WebM,
  or additionally as a silent looping GIF with `format: gif`. Select output times,
  action IDs or step IDs; use the synchronized journal for IDs. GIF FPS and width
  can be reduced explicitly. No clips are made unless requested, and no browser
  replay is required. Read clip-manifest.json for actual output paths and timing.

The library returns local files and manifests. A player page, human approval,
speech recognition, translation and publication belong to the consumer. Inspect
the actual video, sound, highlights and captions before claiming editorial quality.

For screenshot post-processing, use the separate offline illustration workflow in
[illustrations.md](illustrations.md). A successful capture or machine report does
not establish visual approval or publication readiness. Host review is recorded
separately and tied to the production hashes; changing any input or output
invalidates that evidence.
