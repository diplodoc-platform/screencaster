import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

import {PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE} from './config.js';
import {JOURNAL_PERSISTENCE_FAILED} from './messages.js';

type Write = {kind: 'snapshot' | 'append'; file: string; text: string};

export class JournalPersistenceError extends Error {
    constructor(cause: unknown) {
        super(JOURNAL_PERSISTENCE_FAILED, {cause});
        this.name = 'JournalPersistenceError';
    }
}

async function syncDirectory(directory: string) {
    if (process.platform === 'win32') {
        return;
    }
    const parent = await fs.open(directory, 'r');
    try {
        await parent.sync();
    } finally {
        await parent.close();
    }
}

async function persist(write: Write) {
    const directory = path.dirname(write.file);
    await fs.mkdir(directory, {recursive: true, mode: PRIVATE_DIRECTORY_MODE});
    const temporary = path.join(directory, `.${randomUUID()}.tmp`);
    const file = write.kind === 'snapshot' ? temporary : write.file;
    try {
        const handle = await fs.open(
            file,
            write.kind === 'snapshot' ? 'wx' : 'a',
            PRIVATE_FILE_MODE,
        );
        try {
            await handle.writeFile(write.text);
            await handle.sync();
        } finally {
            await handle.close();
        }
        if (write.kind === 'snapshot') {
            await fs.rename(temporary, write.file);
        }
        await syncDirectory(directory);
    } finally {
        if (write.kind === 'snapshot') {
            await fs.rm(temporary, {force: true});
        }
    }
}

// Capture immutable values at enqueue time. Only adjacent, not-yet-started
// snapshots of the same file can supersede each other; append order is exact.
export class JournalWriter {
    private readonly pending: Write[] = [];
    private running?: Promise<void>;
    private failure?: JournalPersistenceError;

    snapshot(file: string, value: unknown): void {
        this.enqueue({
            kind: 'snapshot',
            file: path.resolve(file),
            text: JSON.stringify(value, null, 2),
        });
    }

    append(file: string, value: unknown): void {
        this.enqueue({
            kind: 'append',
            file: path.resolve(file),
            text: JSON.stringify(value) + '\n',
        });
    }

    async flush(): Promise<void> {
        while (this.running) {
            await this.running;
        }
        if (this.failure) {
            throw this.failure;
        }
    }

    private enqueue(write: Write) {
        const previous = this.pending.at(-1);
        if (
            write.kind === 'snapshot' &&
            previous?.kind === 'snapshot' &&
            previous.file === write.file
        ) {
            previous.text = write.text;
        } else {
            this.pending.push(write);
        }
        this.running ??= Promise.resolve().then(async () => {
            try {
                let next: Write | undefined;
                while ((next = this.pending.shift())) {
                    try {
                        await persist(next);
                    } catch (cause) {
                        this.failure ??= new JournalPersistenceError(cause);
                    }
                }
            } finally {
                this.running = undefined;
            }
        });
    }
}
