import fs from 'node:fs';

import {
    AUDIO_ENCODER,
    OPUS_BITRATE,
    OPUS_SAMPLE_RATE,
    VIDEO_ENCODER,
    VIDEO_ENCODER_THREADS,
    VIDEO_PIXEL_FORMAT,
} from '../config.js';
import {PRIVATE_FILE_MODE} from '../../shared/config.js';
import {
    MAPPED_RENDER_CHANGED_THE_FINAL_FRAME_COUNT_RATE,
    MAPPED_RENDER_DID_NOT_VERIFY_EVERY_SOURCE_FRAME,
    MAPPED_RENDER_REFERENCES_AN_UNAVAILABLE_SOURCE_FRAME,
    MAPPED_RENDER_SOURCE_CHANGED_DURING_EXPORT,
    MAPPED_SOURCE_FRAME_ORDER_CHANGED_BEFORE_DECORATION,
} from '../messages.js';
import {ffmpeg} from '../recording/process.js';
import {scanFrames, sha256} from '../recording/recording.js';
import {type FrameHashes, frameHash} from '../recording/frame-table.js';

import {type AnnotationOptions, buildAnnotations} from './annotations.js';
import {buildFrameMap} from './time-map.js';

export async function renderMappedVideo(options: {
    input: string;
    output: string;
    frameRefs: ArrayLike<number>;
    fps: number;
    sourceFrames: FrameHashes;
    journal?: AnnotationOptions['journal'];
    protection?: AnnotationOptions['protection'];
    videoWidth: number;
    videoHeight: number;
    layout?: AnnotationOptions['layout'];
    audioFile?: string;
    signal?: AbortSignal;
}) {
    const frameMap = buildFrameMap(options.frameRefs);
    if (
        frameMap.some((segment) => segment.sourceEnd > options.sourceFrames.length) ||
        !Number.isFinite(options.fps) ||
        options.fps <= 0
    ) {
        throw new Error(MAPPED_RENDER_REFERENCES_AN_UNAVAILABLE_SOURCE_FRAME);
    }
    const annotations =
        options.journal && options.protection
            ? buildAnnotations({
                  journal: options.journal,
                  protection: options.protection,
                  frameMap,
                  fps: options.fps,
                  sourceFrames: options.sourceFrames.length,
                  videoWidth: options.videoWidth,
                  videoHeight: options.videoHeight,
                  layout: options.layout,
              })
            : {annotations: [], sourceTargets: [], filters: [], omitted: []};
    const sourceHash = await sha256(options.input, options.signal);
    const selection = frameMap
        .map((segment) => `between(n,${segment.sourceStart},${segment.sourceEnd - 1})`)
        .join('+');
    let selectedCount = 0;
    const loops: string[] = [];
    for (const segment of frameMap) {
        const sourceLength = segment.sourceEnd - segment.sourceStart;
        const outputLength = segment.outputEnd - segment.outputStart;
        if (sourceLength === 1 && outputLength > 1) {
            loops.push(`loop=loop=${outputLength - 1}:size=1:start=${selectedCount + 1}`);
        }
        selectedCount += sourceLength;
    }
    loops.reverse();
    const base = [
        `select='${selection}'`,
        `setpts=N/(${options.fps}*TB)`,
        ...loops,
        `setpts=N/(${options.fps}*TB)`,
        'split=2[clean][picture]',
    ].join(',');
    const decoration = annotations.filters.length
        ? annotations.filters.join(';')
        : '[picture]null[decorated]';
    const script = `${options.output}.filter.txt`;
    fs.writeFileSync(script, `[0:v]${base};${decoration}`, {
        flag: 'wx',
        mode: PRIVATE_FILE_MODE,
    });
    let verifiedFrames = 0;
    try {
        await ffmpeg(
            [
                '-v',
                'error',
                '-threads',
                String(VIDEO_ENCODER_THREADS),
                '-i',
                options.input,
                ...(options.audioFile ? ['-i', options.audioFile] : []),
                '-/filter_complex',
                script,
                '-map',
                '[clean]',
                '-an',
                '-r',
                String(options.fps),
                '-f',
                'framemd5',
                'pipe:1',
                '-map',
                '[decorated]',
                ...(options.audioFile ? ['-map', '1:a:0'] : ['-an']),
                '-c:v',
                VIDEO_ENCODER,
                // Browser recordings are opaque. Composite masks can negotiate an
                // alpha/RGB format unsupported by the portable VP9 encoder profile.
                '-pix_fmt',
                VIDEO_PIXEL_FORMAT,
                '-lossless',
                '1',
                '-threads',
                String(VIDEO_ENCODER_THREADS),
                '-r',
                String(options.fps),
                ...(options.audioFile
                    ? [
                          '-c:a',
                          AUDIO_ENCODER,
                          '-ar',
                          String(OPUS_SAMPLE_RATE),
                          '-b:a',
                          OPUS_BITRATE,
                          '-shortest',
                      ]
                    : []),
                '-n',
                options.output,
            ],
            (line) => {
                if (line.startsWith('#') || !line.trim()) {
                    return;
                }
                const fields = line.split(',').map((field) => field.trim());
                const expected = frameHash(options.sourceFrames, options.frameRefs[verifiedFrames]);
                if (
                    fields.length !== 6 ||
                    !expected ||
                    fields[5] !== expected ||
                    Number(fields[2]) !== verifiedFrames ||
                    Number(fields[3]) !== 1
                ) {
                    throw new Error(MAPPED_SOURCE_FRAME_ORDER_CHANGED_BEFORE_DECORATION);
                }
                verifiedFrames++;
            },
            undefined,
            options.signal,
        );
        if (verifiedFrames !== options.frameRefs.length) {
            throw new Error(MAPPED_RENDER_DID_NOT_VERIFY_EVERY_SOURCE_FRAME);
        }
        const final = await scanFrames(options.output, undefined, {
            allowAudio: Boolean(options.audioFile),
            signal: options.signal,
        });
        if (
            final.fps !== options.fps ||
            final.frameCount !== options.frameRefs.length ||
            (options.audioFile && !final.hasAudio)
        ) {
            throw new Error(MAPPED_RENDER_CHANGED_THE_FINAL_FRAME_COUNT_RATE);
        }
        if ((await sha256(options.input, options.signal)) !== sourceHash) {
            throw new Error(MAPPED_RENDER_SOURCE_CHANGED_DURING_EXPORT);
        }
        return {
            frameMap,
            annotations,
            retainedFramesVerified: true as const,
            sourceSha256: sourceHash,
        };
    } finally {
        fs.rmSync(script, {force: true});
    }
}
