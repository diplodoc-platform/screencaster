import {z} from 'zod';

import {MAX_SPEECH_TEXT_CHARS} from '../media/config.js';
import {
    MIX_SAMPLE_RATE as SAMPLE_RATE,
    type AudioClip as SpeechAudio,
    type TtsProvider,
    audioDuration,
} from '../media/audio/audio.js';
import {mediaCancelledError, throwIfMediaAborted} from '../media/cancellation.js';

import {
    DEFAULT_SPEECH_SPEED,
    DEFAULT_SPEECH_VOICE,
    MAX_SPEECH_RESPONSE_BYTES,
    MAX_SPEECH_SPEED,
    MIN_SPEECH_SPEED,
    SPEECH_ENDPOINT,
    SPEECH_REQUEST_TIMEOUT_MS,
} from './config.js';
import {
    BASE64_AUDIO_PATTERN,
    SPEECHKIT_VOICE_NAME_PATTERN,
    UNSIGNED_INTEGER_PATTERN,
} from './patterns.js';
import {
    CONFIGURE_EXACTLY_ONE_SPEECH_KIT_API_KEY_IAM_TOKEN,
    EMPTY_IAM_TOKEN,
    INVALID_SPEECH_KIT_VOICE_SPEED_OR_AUTHENTICATION_CONFIGURATION,
    SPEECH_TEXT_MUST_CONTAIN_1_1000_CHARACTERS,
} from './messages.js';

type SpeechKitPhase = 'authentication' | 'request' | 'response';

export class SpeechKitError extends Error {
    readonly phase: SpeechKitPhase;
    readonly status: number | undefined;

    constructor(phase: SpeechKitPhase, status?: number) {
        super(
            `SpeechKit synthesis failed at ${phase}${status === undefined ? '' : ` (HTTP ${status})`}; cached phrases retained`,
        );
        this.name = 'SpeechKitError';
        this.phase = phase;
        this.status = status;
    }
}

const milliseconds = z
    .union([z.string().regex(UNSIGNED_INTEGER_PATTERN), z.number()])
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value) && value >= 0);
const responseSchema = z.object({
    audioChunk: z
        .object({
            data: z.string().regex(BASE64_AUDIO_PATTERN),
        })
        .optional(),
    wordTimings: z
        .array(z.object({word: z.string().min(1), startMs: milliseconds, lengthMs: milliseconds}))
        .optional(),
});

export class SpeechKitProvider implements TtsProvider {
    readonly identity: string;
    private readonly authorization: (signal?: AbortSignal) => Promise<string>;
    private readonly voice: string;
    private readonly speed: number;
    private readonly folderId: string | undefined;
    private readonly request: typeof fetch;

    constructor(options: {
        apiKey?: string;
        iamToken?: string;
        getIamToken?: (signal?: AbortSignal) => Promise<string>;
        folderId?: string;
        voice?: string;
        speed?: number;
        request?: typeof fetch;
    }) {
        if ([options.apiKey, options.iamToken, options.getIamToken].filter(Boolean).length !== 1) {
            throw new Error(CONFIGURE_EXACTLY_ONE_SPEECH_KIT_API_KEY_IAM_TOKEN);
        }
        this.voice = options.voice ?? DEFAULT_SPEECH_VOICE;
        this.speed = options.speed ?? DEFAULT_SPEECH_SPEED;
        if (
            !SPEECHKIT_VOICE_NAME_PATTERN.test(this.voice) ||
            !Number.isFinite(this.speed) ||
            this.speed < MIN_SPEECH_SPEED ||
            this.speed > MAX_SPEECH_SPEED ||
            ((options.apiKey || options.getIamToken) && options.folderId)
        ) {
            throw new Error(INVALID_SPEECH_KIT_VOICE_SPEED_OR_AUTHENTICATION_CONFIGURATION);
        }
        const authorization = options.apiKey
            ? `Api-Key ${options.apiKey}`
            : `Bearer ${options.iamToken}`;
        const getIamToken = options.getIamToken;
        this.authorization = getIamToken
            ? async (signal) => {
                  const token = await getIamToken(signal);
                  if (!token.trim()) {
                      throw new Error(EMPTY_IAM_TOKEN);
                  }
                  return `Bearer ${token}`;
              }
            : async () => authorization;
        this.folderId = options.folderId;
        this.request = options.request ?? fetch;
        this.identity = JSON.stringify({
            provider: 'speechkit-v3',
            voice: this.voice,
            speed: this.speed,
            sampleRate: SAMPLE_RATE,
            encoding: 'LINEAR16_PCM',
        });
    }

    async synthesize(text: string, signal?: AbortSignal): Promise<SpeechAudio> {
        throwIfMediaAborted(signal);
        if (!text.trim() || text.length > MAX_SPEECH_TEXT_CHARS) {
            throw new Error(SPEECH_TEXT_MUST_CONTAIN_1_1000_CHARACTERS);
        }
        let phase: SpeechKitPhase = 'authentication';
        let status: number | undefined;
        const requestSignal = AbortSignal.any([
            AbortSignal.timeout(SPEECH_REQUEST_TIMEOUT_MS),
            ...(signal ? [signal] : []),
        ]);
        try {
            const authorization = await this.authorization(requestSignal);
            throwIfMediaAborted(requestSignal);
            phase = 'request';
            const response = await this.request(SPEECH_ENDPOINT, {
                method: 'POST',
                redirect: 'error',
                signal: requestSignal,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: authorization,
                    ...(this.folderId ? {'x-folder-id': this.folderId} : {}),
                },
                body: JSON.stringify({
                    text,
                    hints: [{voice: this.voice}, {speed: String(this.speed)}],
                    outputAudioSpec: {
                        rawAudio: {
                            audioEncoding: 'LINEAR16_PCM',
                            sampleRateHertz: String(SAMPLE_RATE),
                        },
                    },
                }),
            });
            status = response.status;
            if (!response.ok || !response.body) {
                await response.body?.cancel().catch(() => {});
                throw new SpeechKitError(phase, status);
            }
            phase = 'response';
            const chunks: Buffer[] = [];
            let size = 0;
            const reader = response.body.getReader();
            const cancelBody = () => {
                reader.cancel().catch(() => {});
            };
            requestSignal.addEventListener('abort', cancelBody, {once: true});
            try {
                if (requestSignal.aborted) {
                    cancelBody();
                }
                let part = await reader.read();
                while (!part.done) {
                    const value = part.value;
                    size += value.length;
                    if (size > MAX_SPEECH_RESPONSE_BYTES) {
                        throw new SpeechKitError(phase, status);
                    }
                    chunks.push(Buffer.from(value));
                    part = await reader.read();
                }
                throwIfMediaAborted(requestSignal);
            } finally {
                requestSignal.removeEventListener('abort', cancelBody);
                await reader.cancel().catch(() => {});
                reader.releaseLock();
            }
            return parseSpeechKitResponse(Buffer.concat(chunks).toString('utf8'));
        } catch {
            if (signal?.aborted) {
                throw mediaCancelledError();
            }
            // Never include headers, response bodies, spoken text or upstream errors.
            throw new SpeechKitError(phase, status);
        }
    }
}

export function parseSpeechKitResponse(body: string): SpeechAudio {
    const pcm: Buffer[] = [];
    const words: NonNullable<SpeechAudio['words']> = [];
    for (const line of body.split('\n').filter((entry) => entry.trim())) {
        const envelope = z.object({result: responseSchema}).parse(JSON.parse(line));
        if (envelope.result.audioChunk) {
            pcm.push(Buffer.from(envelope.result.audioChunk.data, 'base64'));
        }
        words.push(...(envelope.result.wordTimings ?? []));
    }
    const audio: SpeechAudio = {
        pcm: Buffer.concat(pcm),
        sampleRate: SAMPLE_RATE,
        channels: 1,
        ...(words.length ? {words} : {}),
    };
    audioDuration(audio);
    return audio;
}
