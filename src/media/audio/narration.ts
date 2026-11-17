import type {OutlineStyle} from '../../shared/outline-style.js';

import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';

import {MAX_CAPTION_CHARS, MAX_NARRATION_PHRASES, MAX_SPEECH_TEXT_CHARS} from '../config.js';
import {
    MILLISECONDS_PER_SECOND,
    PRIVATE_DIRECTORY_MODE,
    PRIVATE_FILE_MODE,
} from '../../shared/config.js';
import {
    EACH_PHRASE_NEEDS_ONE_AUDIO_SOURCE_AND_ONE,
    MISSING_SYNTHESIZED_PHRASE,
    NARRATION_ANCHORS_MUST_EXIST_AND_BE_SEQUENTIAL,
    NARRATION_PHRASE_IDS_MUST_BE_UNIQUE,
    NARRATION_REQUIRES_A_CONFIRMED_RECORDED_ACTION_ANCHOR,
    REQUESTED_CAPTIONS_REQUIRE_VISIBLE_TEXT_FOR_EVERY_PHRASE,
    TEXT_NARRATION_REQUIRES_A_CONFIGURED_SPEECH_PROVIDER,
} from '../messages.js';
import {writePrivateJson} from '../../shared/private-files.js';
import {exportHighlights, loadExport} from '../export/export-input.js';
import {renderMappedVideo} from '../timeline/render-mapped-video.js';
import {buildFrameMap, mapSourceFrame} from '../timeline/time-map.js';
import {sha256} from '../recording/recording.js';

import {type CaptionCue, speechCaption, webVtt} from './captions.js';
import {lowerBound} from './narration-time.js';
import {type NarrationWindow, fitAudioPacked} from './narration-time.js';
import {
    type AudioClip,
    type TtsProvider,
    audioDuration,
    cachedSpeech,
    normalizeAudio,
    readAudio,
    writeAudioTrack,
} from './audio.js';

export type NarrationPhrase = {
    id: number;
    text?: string;
    captionText?: string;
    clip?: AudioClip;
    audioFile?: string;
    actionId?: number;
    startMs?: number;
    holdAtMs?: number;
};
const phraseSchema = z
    .object({
        id: z.number().int().positive(),
        text: z.string().trim().min(1).max(MAX_SPEECH_TEXT_CHARS).optional(),
        captionText: z.string().trim().min(1).max(MAX_CAPTION_CHARS).optional(),
        clip: z.unknown().optional(),
        audioFile: z.string().min(1).optional(),
        actionId: z.number().int().positive().optional(),
        startMs: z.number().finite().nonnegative().optional(),
        holdAtMs: z.number().finite().nonnegative().optional(),
    })
    .strict();

export async function narrateVideo(options: {
    input: string;
    output: string;
    phrases: NarrationPhrase[];
    provider?: TtsProvider;
    cache?: string;
    captions?: boolean;
    highlights?: boolean;
    outline?: OutlineStyle;
    maxHoldSeconds?: number;
    signal?: AbortSignal;
}) {
    options.signal?.throwIfAborted();
    const phrases = z
        .array(phraseSchema)
        .min(1)
        .max(MAX_NARRATION_PHRASES)
        .parse(options.phrases) as NarrationPhrase[];
    if (new Set(phrases.map((phrase) => phrase.id)).size !== phrases.length) {
        throw new Error(NARRATION_PHRASE_IDS_MUST_BE_UNIQUE);
    }
    const input = await loadExport(options.input, options.signal);
    const {fps, sourceFrames} = input.timeline;
    const clips = new Map<number, AudioClip>();
    const durations = new Map<number, {durationMs: number}>();
    const windows: NarrationWindow[] = [];
    for (const phrase of phrases) {
        if (
            [
                phrase.text !== undefined,
                phrase.clip !== undefined,
                phrase.audioFile !== undefined,
            ].filter(Boolean).length !== 1 ||
            [phrase.startMs !== undefined, phrase.actionId !== undefined].filter(Boolean).length !==
                1
        ) {
            throw new Error(EACH_PHRASE_NEEDS_ONE_AUDIO_SOURCE_AND_ONE);
        }
        const clip = await loadPhraseAudio(phrase, options, input.root);
        clips.set(phrase.id, clip);
        durations.set(phrase.id, {durationMs: audioDuration(clip)});
        const {anchor, hold} = phraseAnchors(phrase, input, windows.at(-1)?.start);
        windows.push({
            id: phrase.id,
            first: anchor,
            last: anchor + 1,
            start: anchor,
            end: sourceFrames,
            anchorFrame: anchor,
            evidenceFrame: hold,
            ranges: [{start: anchor, end: anchor + 1}],
        });
    }
    for (let index = 0; index < windows.length - 1; index++) {
        windows[index].end = windows[index + 1].start;
    }
    const fit = fitAudioPacked(
        {
            indices: input.indices,
            timeline: {fps, sourceFrames, protection: input.timeline.protection ?? {markers: []}},
        },
        windows,
        durations,
        {surroundingSeconds: 5, maxHoldSeconds: options.maxHoldSeconds ?? 0},
    );
    const captions = narrationCaptions(fit.placements, clips, phrases, fps, options.captions);
    const output = path.resolve(options.output);
    await fs.mkdir(output, {mode: PRIVATE_DIRECTORY_MODE});
    const audioFile = path.join(output, 'audio.wav');
    await writeAudioTrack({
        file: audioFile,
        frames: fit.frameRefs.length,
        fps,
        placements: fit.placements,
        clips,
        signal: options.signal,
    });
    const raw = path.join(output, 'raw.webm');
    await fs.copyFile(input.raw, raw, constants.COPYFILE_EXCL);
    const rendered = await renderMappedVideo({
        input: raw,
        output: path.join(output, 'video.webm'),
        frameRefs: fit.frameRefs,
        fps,
        sourceFrames: input.frames.frames,
        videoWidth: input.frames.width,
        videoHeight: input.frames.height,
        journal: exportHighlights(input, options.highlights) ? input.journal : undefined,
        outline: {...input.timeline.annotations?.outline, ...options.outline},
        protection: input.timeline.protection,
        layout: input.timeline.layout,
        audioFile,
        signal: options.signal,
    });
    if (options.captions) {
        await fs.writeFile(path.join(output, 'captions.vtt'), webVtt(captions), {
            mode: PRIVATE_FILE_MODE,
            flag: 'wx',
        });
        writePrivateJson(path.join(output, 'captions.json'), captions);
    }
    if (input.journal) {
        writePrivateJson(path.join(output, 'media-events.json'), input.journal);
    }
    const manifest = {
        sourceSha256: input.timeline.sourceSha256,
        videoSha256: await sha256(path.join(output, 'video.webm'), options.signal),
        audioSha256: await sha256(audioFile, options.signal),
        fps,
        sourceFrames,
        outputFrames: fit.frameRefs.length,
        segments: buildFrameMap(fit.frameRefs),
        protection: input.timeline.protection,
        annotations: rendered.annotations,
        layout: input.timeline.layout,
        placements: fit.placements,
        captions: options.captions ? captions : undefined,
    };
    writePrivateJson(path.join(output, 'timeline.json'), manifest);
    writePrivateJson(
        path.join(output, 'narration.json'),
        phrases.map((phrase) => ({
            id: phrase.id,
            text: phrase.text,
            captionText: phrase.captionText,
            actionId: phrase.actionId,
            startMs: phrase.startMs,
            holdAtMs: phrase.holdAtMs,
        })),
    );
    return manifest;
}

type NarrationOptions = Parameters<typeof narrateVideo>[0];

async function loadPhraseAudio(phrase: NarrationPhrase, options: NarrationOptions, root: string) {
    let clip: AudioClip;
    if (phrase.clip) {
        clip = phrase.clip;
    } else if (phrase.audioFile) {
        clip = await readAudio(phrase.audioFile, options.signal);
    } else {
        if (!options.provider || !phrase.text) {
            throw new Error(TEXT_NARRATION_REQUIRES_A_CONFIGURED_SPEECH_PROVIDER);
        }
        clip = (
            await cachedSpeech(
                options.provider,
                phrase.text,
                options.cache ?? path.join(root, 'tts-cache'),
                options.signal,
            )
        ).clip;
    }
    clip = await normalizeAudio(clip, options.signal);
    return clip;
}

function phraseAnchors(
    phrase: NarrationPhrase,
    input: Awaited<ReturnType<typeof loadExport>>,
    previous?: number,
) {
    const {fps} = input.timeline;
    let anchor: number | undefined;
    if (phrase.startMs === undefined) {
        const action = input.journal?.actions.find((entry) => entry.id === phrase.actionId);
        if (action?.outcome !== 'returned' || !input.timeline.protection) {
            throw new Error(NARRATION_REQUIRES_A_CONFIRMED_RECORDED_ACTION_ANCHOR);
        }
        const observed = action.target?.atMs ?? action.startMs;
        const frame = Math.max(
            0,
            Math.floor(
                (observed / MILLISECONDS_PER_SECOND - input.timeline.protection.offsetSeconds) *
                    fps,
            ),
        );
        const mapped = mapSourceFrame(input.timeline.segments, frame);
        anchor = mapped ? frame : input.indices[lowerBound(input.indices, frame)];
    } else {
        anchor = input.indices[Math.floor((phrase.startMs / MILLISECONDS_PER_SECOND) * fps)];
    }
    if (anchor === undefined || (previous !== undefined && anchor <= previous)) {
        throw new Error(NARRATION_ANCHORS_MUST_EXIST_AND_BE_SEQUENTIAL);
    }
    const hold =
        phrase.holdAtMs === undefined
            ? undefined
            : input.indices[Math.floor((phrase.holdAtMs / MILLISECONDS_PER_SECOND) * fps)];
    return {anchor, hold};
}

function narrationCaptions(
    placements: ReturnType<typeof fitAudioPacked>['placements'],
    clips: Map<number, AudioClip>,
    phrases: NarrationPhrase[],
    fps: number,
    enabled?: boolean,
): CaptionCue[] {
    const captions: CaptionCue[] = [];
    for (const placement of placements) {
        const clip = clips.get(placement.id);
        const phrase = phrases.find((entry) => entry.id === placement.id);
        if (!clip || !phrase) {
            throw new Error(MISSING_SYNTHESIZED_PHRASE);
        }
        if (enabled) {
            const text = phrase.captionText ?? phrase.text;
            if (!text) {
                throw new Error(REQUESTED_CAPTIONS_REQUIRE_VISIBLE_TEXT_FOR_EVERY_PHRASE);
            }
            captions.push(
                speechCaption(text, clip, (placement.outputStart / fps) * MILLISECONDS_PER_SECOND),
            );
        }
    }
    return captions;
}
