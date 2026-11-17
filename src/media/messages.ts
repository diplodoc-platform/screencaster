export const INVALID_ANNOTATION_RECORDING_OR_TIME_MAP = 'Invalid annotation recording or time map';
export const OFFLINE_STEP_SCREENSHOT_WAS_NOT_EXTRACTED =
    'Offline step screenshot was not extracted';
export const EXPECTED_SIGNED_16_BIT_PCM_WITH_EXPLICIT_SAMPLE =
    'Expected signed 16-bit PCM with explicit sample rate and channels';
export const AUDIO_EXCEEDS_THE_CONFIGURED_DURATION_LIMIT =
    'Audio exceeds the configured duration limit';
export const OPTIONAL_WORD_TIMINGS_MUST_BE_AN_ARRAY = 'Optional word timings must be an array';
export const INVALID_OPTIONAL_SPEECH_WORD_TIMINGS = 'Invalid optional speech word timings';
export const AUDIO_DURATION_MUST_BE_BETWEEN_ONE_SAMPLE_AND =
    'Audio duration must be between one sample and one hour';
export const AUDIO_CLIP_EXCEEDS_THE_DURATION_LIMIT = 'Audio clip exceeds the duration limit';
export const SYNTHESIS_REQUIRES_A_BOUNDED_PHRASE_AND_A_PROVIDER =
    'Synthesis requires a bounded phrase and a provider identity';
export const CORRUPTED_SPEECH_CACHE = 'Corrupted speech cache';
export const CORRUPTED_SPEECH_CACHE_COMPLETED_ENTRIES_MUST_BE_INTACT =
    'Corrupted speech cache; completed entries must be intact';
export const SPEECH_PROVIDER_FAILED_COMPLETED_CACHED_CLIPS_WERE_RETAINED =
    'Speech provider failed; completed cached clips were retained';
export const MISSING_NARRATION_AUDIO = 'Missing narration audio';
export const MIXING_REQUIRES_NORMALIZED_MONO_AUDIO = 'Mixing requires normalized mono audio';
export const SPEECH_WOULD_OVERLAP_OR_BE_TRUNCATED = 'Speech would overlap or be truncated';
export const INCOMPLETE_NARRATION_AUDIO_WRITE = 'Incomplete narration audio write';
export const CAPTION_CUES_MUST_BE_ORDERED_AND_MUST_NOT =
    'Caption cues must be ordered and must not overlap';
export const CAPTION_MAPPING_REQUIRES_A_POSITIVE_FRAME_RATE =
    'Caption mapping requires a positive frame rate';
export const CAPTION_INTERVAL_EXCEEDS_THE_EXPORTED_VIDEO =
    'Caption interval exceeds the exported video';
export const GIF_OPTIONS_MAY_REDUCE_SOURCE_FPS_AND_WIDTH =
    'GIF options may reduce source FPS and width, not increase them';
export const EDITORIAL_SOURCE_MUST_MATCH_ITS_EXPORT_TIMELINE =
    'Editorial source must match its export timeline';
export const SELECTION_MUST_PRODUCE_A_NONEMPTY_RESULT_AND_CUTS =
    'Selection must produce a nonempty result and cuts must remove some frames';
export const SELECTED_INTERVAL_IS_OUTSIDE_THE_INPUT_VIDEO =
    'Selected interval is outside the input video';
export const ACTION_AND_STEP_SELECTION_REQUIRES_THE_ORIGINAL_SYNCHRONIZED =
    'Action and step selection requires the original synchronized journal';
export const SELECTION_REFERENCES_AN_UNOBSERVED_ACTION_OR_STEP =
    'Selection references an unobserved action or step';
export const EXPORT_INPUT_HASHES_DO_NOT_MATCH_ITS_TIMELINE =
    'Export input hashes do not match its timeline';
export const EXPORT_FRAME_MAP_IS_INCONSISTENT = 'Export frame map is inconsistent';
export const EXPORT_SOURCE_DOES_NOT_MATCH_ITS_DECLARED_FRAME =
    'Export source does not match its declared frame rate';
export const ACTION_JOURNAL_BELONGS_TO_A_DIFFERENT_SOURCE_RECORDING =
    'Action journal belongs to a different source recording';
export const ACTION_JOURNAL_LIMIT_EXCEEDED = 'Action journal limit exceeded';
export const INVALID_RETAINED_FRAME_SEQUENCE = 'Invalid retained frame sequence';
export const INVALID_MEDIA_JOURNAL = 'Invalid media journal';
export const CLOCK_MARKER_OVERLAPS_RECORDING_BOUNDARY = 'Clock marker overlaps recording boundary';
export const EXPECTED_A_REGULAR_VIDEO_FILE = 'Expected a regular video file';
export const FFMPEG_SELECTION_CHANGED_A_RETAINED_FRAME =
    'FFmpeg selection changed a retained frame';
export const NARRATION_PHRASE_IDS_MUST_BE_UNIQUE = 'Narration phrase IDs must be unique';
export const EACH_PHRASE_NEEDS_ONE_AUDIO_SOURCE_AND_ONE =
    'Each phrase needs one audio source and one action ID or output-time anchor';
export const MISSING_SYNTHESIZED_PHRASE = 'Missing synthesized phrase';
export const REQUESTED_CAPTIONS_REQUIRE_VISIBLE_TEXT_FOR_EVERY_PHRASE =
    'Requested captions require visible text for every phrase';
export const TEXT_NARRATION_REQUIRES_A_CONFIGURED_SPEECH_PROVIDER =
    'Text narration requires a configured speech provider';
export const NARRATION_REQUIRES_A_CONFIRMED_RECORDED_ACTION_ANCHOR =
    'Narration requires a confirmed recorded action anchor';
export const NARRATION_ANCHORS_MUST_EXIST_AND_BE_SEQUENTIAL =
    'Narration anchors must exist and be sequential';
export const SURROUNDING_CONTEXT_MUST_BE_1_5_SECONDS_RESULT =
    'Surrounding context must be 1..5 seconds; result holds must be 0..5 seconds';
export const NARRATION_HAS_NO_RECORDED_ACTIVITY_FOR_AN_ENABLED =
    'Narration has no recorded activity for an enabled phrase';
export const NARRATED_VIDEO_EXCEEDS_THE_FRAME_LIMIT = 'Narrated video exceeds the frame limit';
export const EDITORIAL_AUDIO_IS_SHORTER_THAN_ITS_VIDEO =
    'Editorial audio is shorter than its video';
export const PREVIEW_REQUIRES_A_BOUNDED_TITLE_AND_SUBTITLE =
    'Preview requires a bounded title and subtitle';
export const UNEXPECTED_MARKER_FRAME_COUNT = 'Unexpected marker frame count';
export const INCOMPLETE_MARKER_SCAN = 'Incomplete marker scan';
export const PROTECTED_EXPORT_REQUIRES_A_COMPLETE_SYNCHRONIZED_ACTIVITY_JOURNAL =
    'Protected export requires a complete synchronized activity journal for this recording; wrapper timings are insufficient';
export const INVALID_STEP_IDENTITIES_IN_MEDIA_JOURNAL = 'Invalid step identities in media journal';
export const MEDIA_EDIT_OVERLAPS_A_RETAINED_ACTION_ORIGINAL_RECORDING =
    'Media edit overlaps a retained action; original recording preserved';
export const INVALID_MEDIA_ACTIVITY_GUARD = 'Invalid media activity guard';
export const ACTIONS_SPAN_MULTIPLE_TAB_RECORDINGS_RETAIN_ALL_RAW =
    'Actions span multiple tab recordings; retain all raw recordings for review';
export const MISSING_OR_AMBIGUOUS_VIDEO_CLOCK_MARKERS_OR_ACTIONS =
    'Missing or ambiguous video clock markers or actions';
export const ACTION_FALLS_OUTSIDE_THE_SELECTED_RECORDING_CLOCK_COVERAGE =
    'Action falls outside the selected recording clock coverage; retain all tab recordings';
export const VIDEO_CLOCK_DRIFT_EXCEEDS_500_MS_PLUS_FRAME =
    'Video clock drift exceeds 500 ms plus frame quantization; raw recording retained';
export const CONTENT_BOUNDARY_MAY_OVERLAP_RECORDED_ACTIVITY =
    'Content boundary may overlap recorded activity';
export const EXPECTED_A_CONTINUOUS_CONSTANT_RATE_RECORDING =
    'Expected a continuous constant-rate recording';
export const OPTIMIZATION_ACCEPTS_SILENT_BROWSER_RECORDINGS_ONLY_AUDIO_NEEDS =
    'Optimization accepts silent browser recordings only; audio needs its own time mapping';
export const UNSUPPORTED_VIDEO_TIME_BASE = 'Unsupported video time base';
export const MAPPED_RENDER_REFERENCES_AN_UNAVAILABLE_SOURCE_FRAME =
    'Mapped render references an unavailable source frame';
export const MAPPED_SOURCE_FRAME_ORDER_CHANGED_BEFORE_DECORATION =
    'Mapped source frame order changed before decoration';
export const MAPPED_RENDER_DID_NOT_VERIFY_EVERY_SOURCE_FRAME =
    'Mapped render did not verify every source frame';
export const MAPPED_RENDER_CHANGED_THE_FINAL_FRAME_COUNT_RATE =
    'Mapped render changed the final frame count, rate or audio';
export const MAPPED_RENDER_SOURCE_CHANGED_DURING_EXPORT =
    'Mapped render source changed during export';
export const INVALID_FRAME_MAP = 'Invalid frame map';
export const INVALID_SOURCE_FRAME_SEQUENCE = 'Invalid source frame sequence';
export const INVALID_SOURCE_FRAME = 'Invalid source frame';

export const IMAGE_PREVIEW_FAILED = 'Cannot generate a bounded local PNG preview';
