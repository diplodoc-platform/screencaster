import {spawn} from 'node:child_process';

import {
    FFMPEG_BINARY,
    FFMPEG_ERRORS,
    FFMPEG_STDERR_TAIL_CHARS,
    FFMPEG_TIMEOUT_MS,
} from '../config.js';
import {mediaCancelledError, throwIfMediaAborted} from '../cancellation.js';

export class FfmpegError extends Error {
    readonly reason: keyof typeof FFMPEG_ERRORS;

    constructor(reason: keyof typeof FFMPEG_ERRORS) {
        super(FFMPEG_ERRORS[reason]);
        this.reason = reason;
        this.name = 'FfmpegError';
    }
}

// No shell interpolation, credentials or FFmpeg diagnostics in errors.
export function ffmpeg(
    args: string[],
    onLine?: (line: string) => void,
    onChunk?: (chunk: Buffer) => void,
    signal?: AbortSignal,
): Promise<{hasAudio: boolean}> {
    return new Promise((resolve, reject) => {
        throwIfMediaAborted(signal);
        const child = spawn(process.env.FFMPEG_PATH || FFMPEG_BINARY, ['-nostdin', ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let pending = '';
        let stderrTail = '';
        let hasAudio = false;
        let failure: Error | undefined;
        const stop = (error: Error) => {
            failure ??= error;
            child.kill('SIGKILL');
        };
        const abort = () => stop(mediaCancelledError());
        const timer = setTimeout(() => stop(new FfmpegError('timeout')), FFMPEG_TIMEOUT_MS);
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) {
            abort();
        }
        if (!onChunk) {
            child.stdout.setEncoding('utf8');
        }
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (text: string) => {
            stderrTail = (stderrTail + text).slice(-FFMPEG_STDERR_TAIL_CHARS);
            hasAudio = hasAudio || stderrTail.includes('Audio:');
        });
        child.stdout.on('data', (text: string | Buffer) => {
            if (failure) {
                return;
            }
            if (onChunk && Buffer.isBuffer(text)) {
                try {
                    onChunk(text);
                } catch {
                    stop(new FfmpegError('pixels'));
                }
                return;
            }
            if (!onLine) {
                return;
            }
            pending += text;
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            try {
                lines.forEach(onLine);
            } catch {
                pending = '';
                stop(new FfmpegError('timeline'));
            }
        });
        child.on('error', () => {
            failure ??= new FfmpegError('start');
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            // Wait for process exit before settling, including parser failure or cancellation.
            if (failure) {
                reject(failure);
                return;
            }
            if (code === 0) {
                try {
                    if (pending && onLine) {
                        onLine(pending);
                    }
                    resolve({hasAudio});
                } catch {
                    reject(new FfmpegError('timeline'));
                }
            } else {
                reject(new FfmpegError('process'));
            }
        });
    });
}
