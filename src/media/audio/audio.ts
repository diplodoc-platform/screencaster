import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

import {
    MAX_AUDIO_SAMPLE_RATE,
    MAX_AUDIO_TRACK_SECONDS,
    MAX_SPEECH_DURATION_MS,
    MAX_SPEECH_TEXT_CHARS,
    MIN_AUDIO_SAMPLE_RATE,
    MIX_SAMPLE_RATE,
} from '../config.js';
import {
    MILLISECONDS_PER_SECOND,
    PRIVATE_DIRECTORY_MODE,
    PRIVATE_FILE_MODE,
} from '../../shared/config.js';
import {
    AUDIO_CLIP_EXCEEDS_THE_DURATION_LIMIT,
    AUDIO_DURATION_MUST_BE_BETWEEN_ONE_SAMPLE_AND,
    AUDIO_EXCEEDS_THE_CONFIGURED_DURATION_LIMIT,
    CORRUPTED_SPEECH_CACHE,
    CORRUPTED_SPEECH_CACHE_COMPLETED_ENTRIES_MUST_BE_INTACT,
    EXPECTED_SIGNED_16_BIT_PCM_WITH_EXPLICIT_SAMPLE,
    INCOMPLETE_NARRATION_AUDIO_WRITE,
    INVALID_OPTIONAL_SPEECH_WORD_TIMINGS,
    MISSING_NARRATION_AUDIO,
    MIXING_REQUIRES_NORMALIZED_MONO_AUDIO,
    OPTIONAL_WORD_TIMINGS_MUST_BE_AN_ARRAY,
    SPEECH_PROVIDER_FAILED_COMPLETED_CACHED_CLIPS_WERE_RETAINED,
    SPEECH_WOULD_OVERLAP_OR_BE_TRUNCATED,
    SYNTHESIS_REQUIRES_A_BOUNDED_PHRASE_AND_A_PROVIDER,
} from '../messages.js';
import {ffmpeg} from '../recording/process.js';

import {PCM_BYTES_PER_SAMPLE, WAVE_FORMAT} from './wave-format.js';

export type WordTiming = {word: string; startMs: number; lengthMs: number};
export type AudioClip = {
    pcm: Uint8Array;
    sampleRate: number;
    channels: 1 | 2;
    words?: WordTiming[];
};
export interface TtsProvider {
    /** All synthesis settings affecting output, excluding credentials. */
    readonly identity: string;
    synthesize(text: string, signal?: AbortSignal): Promise<AudioClip>;
}

export {MIX_SAMPLE_RATE} from '../config.js';

export function audioDuration(clip: AudioClip, maxDurationMs = MAX_SPEECH_DURATION_MS): number {
    if (
        !Number.isInteger(clip.sampleRate) ||
        clip.sampleRate < MIN_AUDIO_SAMPLE_RATE ||
        clip.sampleRate > MAX_AUDIO_SAMPLE_RATE ||
        ![1, 2].includes(clip.channels) ||
        !(clip.pcm instanceof Uint8Array) ||
        !clip.pcm.byteLength ||
        clip.pcm.byteLength % (PCM_BYTES_PER_SAMPLE * clip.channels)
    ) {
        throw new Error(EXPECTED_SIGNED_16_BIT_PCM_WITH_EXPLICIT_SAMPLE);
    }
    const duration =
        (clip.pcm.byteLength / (PCM_BYTES_PER_SAMPLE * clip.channels * clip.sampleRate)) *
        MILLISECONDS_PER_SECOND;
    if (duration > maxDurationMs) {
        throw new Error(AUDIO_EXCEEDS_THE_CONFIGURED_DURATION_LIMIT);
    }
    let end = 0;
    if (clip.words !== undefined && !Array.isArray(clip.words)) {
        throw new Error(OPTIONAL_WORD_TIMINGS_MUST_BE_AN_ARRAY);
    }
    for (const word of clip.words ?? []) {
        if (
            !word.word.trim() ||
            !Number.isFinite(word.startMs) ||
            !Number.isFinite(word.lengthMs) ||
            word.startMs < end ||
            word.lengthMs <= 0 ||
            word.startMs + word.lengthMs > duration + 2
        ) {
            throw new Error(INVALID_OPTIONAL_SPEECH_WORD_TIMINGS);
        }
        end = word.startMs + word.lengthMs;
    }
    return duration;
}

export function waveHeader(clip: AudioClip, maxDurationMs = MAX_SPEECH_DURATION_MS): Buffer {
    audioDuration(clip, maxDurationMs);
    return pcmWaveHeader(
        clip.pcm.byteLength / (PCM_BYTES_PER_SAMPLE * clip.channels),
        clip.sampleRate,
        clip.channels,
    );
}

export function pcmWaveHeader(samples: number, sampleRate = MIX_SAMPLE_RATE, channels: 1 | 2 = 1) {
    if (
        !Number.isSafeInteger(samples) ||
        samples < 1 ||
        samples > sampleRate * MAX_AUDIO_TRACK_SECONDS ||
        !Number.isInteger(sampleRate) ||
        sampleRate < MIN_AUDIO_SAMPLE_RATE ||
        sampleRate > MAX_AUDIO_SAMPLE_RATE ||
        ![1, 2].includes(channels)
    ) {
        throw new Error(AUDIO_DURATION_MUST_BE_BETWEEN_ONE_SAMPLE_AND);
    }
    const bytes = samples * PCM_BYTES_PER_SAMPLE * channels;
    const header = Buffer.alloc(WAVE_FORMAT.headerBytes);
    header.write('RIFF', WAVE_FORMAT.offsets.riff);
    header.writeUInt32LE(WAVE_FORMAT.riffBaseBytes + bytes, WAVE_FORMAT.offsets.riffSize);
    header.write('WAVEfmt ', WAVE_FORMAT.offsets.waveFormat);
    header.writeUInt32LE(WAVE_FORMAT.formatChunkBytes, WAVE_FORMAT.offsets.formatChunkSize);
    header.writeUInt16LE(WAVE_FORMAT.pcmEncoding, WAVE_FORMAT.offsets.encoding);
    header.writeUInt16LE(channels, WAVE_FORMAT.offsets.channels);
    header.writeUInt32LE(sampleRate, WAVE_FORMAT.offsets.sampleRate);
    header.writeUInt32LE(
        sampleRate * channels * PCM_BYTES_PER_SAMPLE,
        WAVE_FORMAT.offsets.byteRate,
    );
    header.writeUInt16LE(channels * PCM_BYTES_PER_SAMPLE, WAVE_FORMAT.offsets.blockAlignment);
    header.writeUInt16LE(WAVE_FORMAT.bitsPerSample, WAVE_FORMAT.offsets.sampleBits);
    header.write('data', WAVE_FORMAT.offsets.data);
    header.writeUInt32LE(bytes, WAVE_FORMAT.offsets.dataBytes);
    return header;
}

export async function readAudio(file: string, signal?: AbortSignal): Promise<AudioClip> {
    const chunks: Buffer[] = [];
    let size = 0;
    await ffmpeg(
        [
            '-v',
            'error',
            '-i',
            file,
            '-vn',
            '-ac',
            '1',
            '-ar',
            String(MIX_SAMPLE_RATE),
            '-f',
            's16le',
            '-',
        ],
        undefined,
        (chunk) => {
            size += chunk.length;
            if (size > MIX_SAMPLE_RATE * 2 * 60) {
                throw new Error(AUDIO_CLIP_EXCEEDS_THE_DURATION_LIMIT);
            }
            chunks.push(chunk);
        },
        signal,
    );
    const clip: AudioClip = {pcm: Buffer.concat(chunks), sampleRate: MIX_SAMPLE_RATE, channels: 1};
    audioDuration(clip);
    return clip;
}

export async function normalizeAudio(clip: AudioClip, signal?: AbortSignal): Promise<AudioClip> {
    audioDuration(clip);
    if (clip.channels === 1 && clip.sampleRate === MIX_SAMPLE_RATE) {
        return clip;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'screencaster-audio-'));
    try {
        const file = path.join(directory, 'source.wav');
        await fs.writeFile(file, Buffer.concat([waveHeader(clip), clip.pcm]), {
            mode: PRIVATE_FILE_MODE,
        });
        return {...(await readAudio(file, signal)), ...(clip.words ? {words: clip.words} : {})};
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
}

export async function cachedSpeech(
    provider: TtsProvider,
    text: string,
    directory: string,
    signal?: AbortSignal,
) {
    signal?.throwIfAborted();
    if (!text.trim() || text.length > MAX_SPEECH_TEXT_CHARS || !provider.identity.trim()) {
        throw new Error(SYNTHESIS_REQUIRES_A_BOUNDED_PHRASE_AND_A_PROVIDER);
    }
    const key = createHash('sha256')
        .update(JSON.stringify({provider: provider.identity, text}))
        .digest('hex');
    const folder = path.join(directory, key);
    let existing = false;
    try {
        existing = (await fs.stat(folder)).isDirectory();
        const metadata = JSON.parse(await fs.readFile(path.join(folder, 'audio.json'), 'utf8'));
        const pcm = await fs.readFile(path.join(folder, 'audio.pcm'));
        const clip: AudioClip = {...metadata, pcm};
        if (
            metadata.identity !== provider.identity ||
            metadata.sha256 !== createHash('sha256').update(pcm).digest('hex')
        ) {
            throw new Error(CORRUPTED_SPEECH_CACHE);
        }
        audioDuration(clip);
        return {clip, key, reused: true};
    } catch (error) {
        if (existing) {
            throw new Error(CORRUPTED_SPEECH_CACHE_COMPLETED_ENTRIES_MUST_BE_INTACT);
        }
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
    let clip: AudioClip;
    try {
        clip = await provider.synthesize(text, signal);
    } catch (error) {
        signal?.throwIfAborted();
        throw new Error(SPEECH_PROVIDER_FAILED_COMPLETED_CACHED_CLIPS_WERE_RETAINED, {
            cause: error,
        });
    }
    signal?.throwIfAborted();
    audioDuration(clip);
    await fs.mkdir(directory, {recursive: true, mode: PRIVATE_DIRECTORY_MODE});
    const temporary = await fs.mkdtemp(path.join(directory, '.speech-'));
    try {
        const pcm = Buffer.from(clip.pcm);
        await fs.writeFile(path.join(temporary, 'audio.pcm'), pcm, {
            mode: PRIVATE_FILE_MODE,
            flag: 'wx',
        });
        await fs.writeFile(
            path.join(temporary, 'audio.json'),
            JSON.stringify({
                identity: provider.identity,
                sampleRate: clip.sampleRate,
                channels: clip.channels,
                words: clip.words,
                sha256: createHash('sha256').update(pcm).digest('hex'),
            }),
            {mode: PRIVATE_FILE_MODE, flag: 'wx'},
        );
        try {
            await fs.rename(temporary, folder);
        } catch (error) {
            if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
                throw error;
            }
            return cachedSpeech(provider, text, directory, signal);
        }
    } finally {
        await fs.rm(temporary, {recursive: true, force: true});
    }
    return {clip, key, reused: false};
}

export async function writeAudioTrack(options: {
    file: string;
    frames: number;
    fps: number;
    placements: Array<{id: number; outputStart: number}>;
    clips: ReadonlyMap<number, AudioClip>;
    signal?: AbortSignal;
}) {
    const samples = Math.ceil((options.frames / options.fps) * MIX_SAMPLE_RATE);
    const header = pcmWaveHeader(samples);
    const output = await fs.open(options.file, 'wx', PRIVATE_FILE_MODE);
    try {
        await output.write(header);
        await output.truncate(44 + samples * 2);
        let previousEnd = 0;
        for (const placement of options.placements) {
            options.signal?.throwIfAborted();
            const clip = options.clips.get(placement.id);
            if (!clip) {
                throw new Error(MISSING_NARRATION_AUDIO);
            }
            audioDuration(clip);
            if (clip.sampleRate !== MIX_SAMPLE_RATE || clip.channels !== 1) {
                throw new Error(MIXING_REQUIRES_NORMALIZED_MONO_AUDIO);
            }
            const start = Math.round((placement.outputStart / options.fps) * MIX_SAMPLE_RATE);
            const end = start + clip.pcm.byteLength / 2;
            if (start < previousEnd || end > samples) {
                throw new Error(SPEECH_WOULD_OVERLAP_OR_BE_TRUNCATED);
            }
            const pcm = Buffer.from(clip.pcm);
            let offset = 0;
            while (offset < pcm.length) {
                const {bytesWritten} = await output.write(
                    pcm,
                    offset,
                    pcm.length - offset,
                    44 + start * 2 + offset,
                );
                if (!bytesWritten) {
                    throw new Error(INCOMPLETE_NARRATION_AUDIO_WRITE);
                }
                offset += bytesWritten;
            }
            previousEnd = end;
        }
    } finally {
        await output.close();
    }
}
