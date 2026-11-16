export const PCM_BYTES_PER_SAMPLE = 2;
export const WAVE_FORMAT = {
    headerBytes: 44,
    riffBaseBytes: 36,
    formatChunkBytes: 16,
    pcmEncoding: 1,
    bitsPerSample: 16,
    offsets: {
        riff: 0,
        riffSize: 4,
        waveFormat: 8,
        formatChunkSize: 16,
        encoding: 20,
        channels: 22,
        sampleRate: 24,
        byteRate: 28,
        blockAlignment: 32,
        sampleBits: 34,
        data: 36,
        dataBytes: 40,
    },
} as const;
