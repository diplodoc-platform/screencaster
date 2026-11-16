# Media pipeline

`recording/` validates input frames, journals, clocks, PCM, and FFmpeg processes.
`timeline/` maps source frames, evaluates edits, and produces annotations.
`export/` renders montages and explicit cuts or clips. `audio/` fits narration and
captions to measured timing. `preview/` renders covers and image previews.

Keep raw recordings and earlier exports. New output uses an exclusive name and
private file permissions. Register only completed artifacts in the run manifest.

Source frame hashes and frame order are verified before decoration. Do not remove
that verification to speed up rendering. Timing comes from measured events and
validated clocks; avoid guessed model latency or manually invented coordinates.
A suggested reversible edit does not authorize applying it.

Cancellation must stop FFmpeg, wait for process exit, and retain raw material.
Process errors must not expose input paths or HTTP credentials. Narration providers
are optional; speech timing, caption spelling, and publication review are separate
contracts. No cloud publication happens in this module.

Configuration, patterns, and diagnostics live at the module root. Review output
frame counts, hashes, timing, audio, and caption intervals after changes; a process
exit code alone is insufficient evidence of a valid export.

Use `scanFrames()` for streaming validation/counts and `readFrameTable()` for
compact random-access source hashes. Internal exports use packed frame references
and selection/count arrays. Keep eager public compatibility wrappers intact.
`MediaRecorder` enqueues immutable journal snapshots; await `flush()` at receipt
boundaries and `finalize()` before registering the journal as an artifact.

`illustration/` is the offline still-image producer; read its nearest MODULE.md
before changing its contracts. Source/preview/production hashes bind confirmed
geometry and reviews. Machine success never grants visual/publication PASS.
Host reviews append immutable attestations and do not rewrite registered outputs.
