export {optimizeVideo} from './export/montage.js';
export {narrateVideo} from './audio/narration.js';
export {editVideo} from './export/editorial.js';
export type {EditorialCut} from './export/editorial.js';
export {exportClip} from './export/clips.js';
export type {ClipOptions} from './export/clips.js';
export {decideEdit, editProposalSchema, closedStateRanges} from './timeline/editing.js';
export type {NarrationPhrase} from './audio/narration.js';
export {generatePreview, renderPreview} from './preview/preview.js';
export {
    audioDuration,
    readAudio,
    normalizeAudio,
    cachedSpeech,
    waveHeader,
    pcmWaveHeader,
    writeAudioTrack,
} from './audio/audio.js';
export type {TtsProvider, AudioClip, WordTiming} from './audio/audio.js';
export {
    webVtt,
    speechCaption,
    remapCaptions,
    validateCaptions,
    exportCaptions,
} from './audio/captions.js';
export type {CaptionCue} from './audio/captions.js';
export {
    buildFrameMap,
    expandFrameMap,
    mapSourceFrame,
    validateFrameMap,
} from './timeline/time-map.js';
export type {FrameMapSegment} from './timeline/time-map.js';
export {buildAnnotations, extractStepScreenshots, targetVideoBox} from './timeline/annotations.js';
export {MediaRecorder} from './recording/journal.js';
export type {MediaJournal, MediaActivity, MediaClock, MediaTarget} from './recording/journal.js';

export {ffmpeg, FfmpegError} from './recording/process.js';
export {readFrames, sha256} from './recording/recording.js';

export {writeEditorialAudio} from './recording/pcm.js';

export * from './illustration/index.js';

export type {OutlineStyle, ResolvedOutlineStyle} from '../shared/outline-style.js';
