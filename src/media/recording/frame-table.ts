import {FRAME_HASH_BYTES, FRAME_TABLE_CHUNK_SIZE, MAX_FRAMES} from '../config.js';
import {EXPECTED_A_CONTINUOUS_CONSTANT_RATE_RECORDING} from '../messages.js';
import {PLAYWRIGHT_RECORDING_ID_PATTERN} from '../patterns.js';

export type Frame = {index: number; hash: string};
export type FrameHashes = readonly Frame[] | FrameTable;

// MD5 values occupy 16 bytes, without a JS object/string for every frame.
// Fixed-size chunks avoid reallocating/copying the entire table as it grows.
export class FrameTable {
    private readonly hashes: Buffer[] = [];
    private readonly indices: Uint32Array[] = [];
    private count = 0;

    get length() {
        return this.count;
    }

    get byteLength() {
        return (
            this.hashes.length *
            FRAME_TABLE_CHUNK_SIZE *
            (FRAME_HASH_BYTES + Uint32Array.BYTES_PER_ELEMENT)
        );
    }

    push(frame: Frame): void {
        if (
            this.count >= MAX_FRAMES ||
            !Number.isSafeInteger(frame.index) ||
            frame.index < 0 ||
            frame.index >= MAX_FRAMES ||
            !PLAYWRIGHT_RECORDING_ID_PATTERN.test(frame.hash) ||
            (this.count > 0 && (this.index(this.count - 1) ?? -1) >= frame.index)
        ) {
            throw new Error(EXPECTED_A_CONTINUOUS_CONSTANT_RATE_RECORDING);
        }
        const chunk = Math.floor(this.count / FRAME_TABLE_CHUNK_SIZE);
        const offset = this.count % FRAME_TABLE_CHUNK_SIZE;
        if (!this.hashes[chunk]) {
            this.hashes.push(Buffer.alloc(FRAME_TABLE_CHUNK_SIZE * FRAME_HASH_BYTES));
            this.indices.push(new Uint32Array(FRAME_TABLE_CHUNK_SIZE));
        }
        this.hashes[chunk].write(frame.hash, offset * FRAME_HASH_BYTES, FRAME_HASH_BYTES, 'hex');
        this.indices[chunk][offset] = frame.index;
        this.count++;
    }

    index(position: number): number | undefined {
        if (!Number.isInteger(position) || position < 0 || position >= this.count) {
            return undefined;
        }
        return this.indices[Math.floor(position / FRAME_TABLE_CHUNK_SIZE)][
            position % FRAME_TABLE_CHUNK_SIZE
        ];
    }

    hash(position: number): string | undefined {
        if (this.index(position) === undefined) {
            return undefined;
        }
        const offset = (position % FRAME_TABLE_CHUNK_SIZE) * FRAME_HASH_BYTES;
        return this.hashes[Math.floor(position / FRAME_TABLE_CHUNK_SIZE)].toString(
            'hex',
            offset,
            offset + FRAME_HASH_BYTES,
        );
    }
}

export function frameHash(frames: FrameHashes, position: number): string | undefined {
    return frames instanceof FrameTable ? frames.hash(position) : frames[position]?.hash;
}
