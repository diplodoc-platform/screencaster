import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';

import {SpeechKitProvider, parseSpeechKitResponse} from '../../../src/providers/speech-kit.js';
import {type AudioClip, audioDuration, cachedSpeech} from '../../../src/media/audio/audio.js';

const clip: AudioClip = {pcm: Buffer.alloc(4800), channels: 1, sampleRate: 24000};

describe('replaceable speech providers', () => {
    it('accepts a provider format without word timings', () => {
        expect(audioDuration(clip)).toBe(100);
        expect(() => audioDuration({...clip, channels: 3} as unknown as AudioClip)).toThrow('PCM');
    });

    it('reuses only complete clips and keys them by provider settings', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-test-'));
        const synthesize = vi.fn(async () => clip);
        try {
            const provider = {identity: 'voice:a', synthesize};
            expect((await cachedSpeech(provider, 'Hello', root)).reused).toBe(false);
            expect((await cachedSpeech(provider, 'Hello', root)).reused).toBe(true);
            await cachedSpeech({...provider, identity: 'voice:b'}, 'Hello', root);
            expect(synthesize).toHaveBeenCalledTimes(2);
        } finally {
            await fs.rm(root, {recursive: true, force: true});
        }
    });

    it('retains completed cache entries after provider failure without leaking errors', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-failure-'));
        try {
            const provider = {
                identity: 'voice',
                synthesize: async () => {
                    throw new Error('private authentication detail');
                },
            };
            await expect(cachedSpeech(provider, 'Hello', root)).rejects.toThrow(
                'Speech provider failed',
            );
            expect(await fs.readdir(root)).toEqual([]);
        } finally {
            await fs.rm(root, {recursive: true, force: true});
        }
    });

    it('rejects an incomplete existing cache entry without synthesizing again', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-corrupt-'));
        const synthesize = vi.fn(async () => clip);
        try {
            const provider = {identity: 'voice', synthesize};
            const result = await cachedSpeech(provider, 'Hello', root);
            await fs.rm(path.join(root, result.key, 'audio.pcm'));
            await expect(cachedSpeech(provider, 'Hello', root)).rejects.toThrow(
                'Corrupted speech cache',
            );
            expect(synthesize).toHaveBeenCalledOnce();
        } finally {
            await fs.rm(root, {recursive: true, force: true});
        }
    });

    it('normalizes SpeechKit output without requiring optional word timings', async () => {
        const pcm = Buffer.alloc(4410);
        const body = JSON.stringify({result: {audioChunk: {data: pcm.toString('base64')}}}) + '\n';
        expect(audioDuration(parseSpeechKitResponse(body))).toBe(100);
        const request = vi.fn(async () => new Response(body));
        const provider = new SpeechKitProvider({apiKey: 'synthetic-key', request});
        expect(audioDuration(await provider.synthesize('Hello'))).toBe(100);
        expect(provider.identity).not.toContain('synthetic-key');
        expect(request).toHaveBeenCalledOnce();
    });
});
