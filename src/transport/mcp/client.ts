import type {ChildProcess} from 'node:child_process';
import type {Interface} from 'node:readline';
import type {JsonRpcNotification, JsonRpcRequest, JsonRpcResponse} from './types.js';

import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

import {MCP_IDENTITY} from '../../shared/metadata.js';

import {
    DEFAULT_RPC_TIMEOUT_MS,
    KILL_TIMEOUT,
    MCP_PROTOCOL_VERSION,
    STOP_TIMEOUT,
} from './config.js';
import {
    INVALID_MCP_SHUTDOWN_TIMEOUT,
    MCP_CLIENT_NOT_INITIALIZED,
    MCP_PROCESS_COULD_NOT_BE_STARTED,
    MCP_PROCESS_EXIT_COULD_NOT_BE_CONFIRMED_AFTER,
    MCP_PROCESS_INPUT_CLOSED,
    MCP_PROCESS_IS_ALREADY_RUNNING,
    MCP_PROCESS_REQUIRED_SIGKILL_BROWSER_SHUTDOWN_IS_UNCONFIRMED,
    MCP_PROCESS_STDIN_NOT_WRITABLE,
    MCP_REQUEST_COULD_NOT_BE_SENT,
    MCP_SESSION_STOPPED,
} from './messages.js';

export type McpDiagnostic = {
    kind: 'process-start' | 'process-exit' | 'rpc-timeout' | 'rpc-send-failed' | 'late-response';
    pid?: number;
    code?: number | null;
    signal?: string | null;
    requestId?: number;
    method?: string;
    durationMs?: number;
    timeoutMs?: number;
    pending: number;
};

export class McpStdioClient {
    private proc: ChildProcess | null = null;
    private rl: Interface | null = null;
    private nextId = 1;
    private readonly pending = new Map<
        number,
        {resolve: (v: unknown) => void; reject: (e: Error) => void}
    >();
    private initialized = false;
    private exited: Promise<void> | undefined;
    private stopPromise: Promise<void> | undefined;
    private readonly stopTimeoutMs: number;
    private readonly killTimeoutMs: number;
    private readonly onDiagnostic?: (event: McpDiagnostic) => void;

    constructor(
        options: {
            stopTimeoutMs?: number;
            killTimeoutMs?: number;
            onDiagnostic?: (event: McpDiagnostic) => void;
        } = {},
    ) {
        this.stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT;
        this.killTimeoutMs = options.killTimeoutMs ?? KILL_TIMEOUT;
        this.onDiagnostic = options.onDiagnostic;
        for (const timeout of [this.stopTimeoutMs, this.killTimeoutMs]) {
            if (!Number.isInteger(timeout) || timeout < 1) {
                throw new Error(INVALID_MCP_SHUTDOWN_TIMEOUT);
            }
        }
    }

    async start(command: string, args: string[], options: {cwd?: string} = {}) {
        await this.stopPromise;
        if (this.proc) {
            throw new Error(MCP_PROCESS_IS_ALREADY_RUNNING);
        }
        this.stopPromise = undefined;
        const proc = spawn(command, args, {
            cwd: options.cwd,
            stdio: ['pipe', 'pipe', 'inherit'],
            env: {...process.env, NODE_NO_WARNINGS: '1'},
        });
        this.proc = proc;
        this.diagnostic({kind: 'process-start', pid: proc.pid});
        proc.stdin?.on('error', () => {
            if (this.proc === proc) {
                this.rejectPending(new Error(MCP_PROCESS_INPUT_CLOSED));
            }
        });

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.rl = createInterface({input: proc.stdout!});
        this.rl.on('line', (line) => this.handleLine(line));

        this.exited = new Promise((resolve) => {
            proc.once('exit', (code, signal) => {
                this.diagnostic({kind: 'process-exit', pid: proc.pid, code, signal});
                this.rejectPending(new Error(`MCP process exited with code ${code}`));
                this.proc = null;
                this.initialized = false;
                this.rl?.close();
                this.rl = null;
                resolve();
            });
            proc.once('error', () => {
                if (this.proc === proc) {
                    this.rejectPending(new Error(MCP_PROCESS_COULD_NOT_BE_STARTED));
                }
                if (proc.pid === undefined) {
                    this.proc = null;
                    this.rl?.close();
                    this.rl = null;
                    resolve();
                }
            });
        });

        try {
            await this.rpc('initialize', {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: MCP_IDENTITY,
            });
            await this.notify('notifications/initialized', {});
            this.initialized = true;
        } catch (error) {
            await this.stop();
            throw error;
        }
    }

    stop(): Promise<void> {
        this.stopPromise ??= this.stopProcess();
        return this.stopPromise;
    }

    isStopped(): boolean {
        return this.proc === null;
    }

    async callTool(name: string, args: Record<string, unknown> = {}, timeoutMs?: number) {
        if (!this.initialized) {
            throw new Error(MCP_CLIENT_NOT_INITIALIZED);
        }
        return this.rpc('tools/call', {name, arguments: args}, timeoutMs);
    }

    async listTools() {
        return this.rpc('tools/list', {});
    }

    private async stopProcess(): Promise<void> {
        const proc = this.proc;
        const exited = this.exited;
        if (!proc || !exited) {
            return;
        }

        this.rl?.close();
        this.rl = null;

        this.initialized = false;
        this.rejectPending(new Error(MCP_SESSION_STOPPED));

        proc.stdin?.end();
        proc.kill('SIGTERM');
        if (await waitForExit(exited, this.stopTimeoutMs)) {
            return;
        }
        proc.kill('SIGKILL');
        if (!(await waitForExit(exited, this.killTimeoutMs))) {
            throw new Error(MCP_PROCESS_EXIT_COULD_NOT_BE_CONFIRMED_AFTER);
        }
        // Chromium can be detached from MCP. Its closure is not confirmed by
        // forcibly killing the transport process, even after that process exits.
        throw new Error(MCP_PROCESS_REQUIRED_SIGKILL_BROWSER_SHUTDOWN_IS_UNCONFIRMED);
    }

    private rejectPending(error: Error): void {
        for (const {reject} of this.pending.values()) {
            reject(error);
        }
        this.pending.clear();
    }

    private send(msg: JsonRpcRequest | JsonRpcNotification) {
        if (!this.proc?.stdin?.writable) {
            throw new Error(MCP_PROCESS_STDIN_NOT_WRITABLE);
        }
        this.proc.stdin.write(JSON.stringify(msg) + '\n');
    }

    private rpc(method: string, params?: unknown, timeoutMs = DEFAULT_RPC_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            const startedAt = Date.now();

            const handle = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    this.diagnostic({
                        kind: 'rpc-timeout',
                        requestId: id,
                        method,
                        durationMs: Date.now() - startedAt,
                        timeoutMs,
                    });
                    reject(new Error(`MCP RPC timeout: ${method}`));
                }
            }, timeoutMs);

            this.pending.set(id, {
                resolve: (v) => {
                    clearTimeout(handle);
                    resolve(v);
                },
                reject: (e) => {
                    clearTimeout(handle);
                    reject(e);
                },
            });

            try {
                this.send({jsonrpc: '2.0', id, method, params});
            } catch {
                this.pending.delete(id);
                clearTimeout(handle);
                this.diagnostic({
                    kind: 'rpc-send-failed',
                    requestId: id,
                    method,
                    durationMs: Date.now() - startedAt,
                });
                reject(new Error(MCP_REQUEST_COULD_NOT_BE_SENT));
            }
        });
    }

    private notify(method: string, params?: unknown) {
        this.send({jsonrpc: '2.0', method, params});
        return Promise.resolve();
    }

    private handleLine(line: string) {
        const trimmed = line.trim();
        if (!trimmed) {
            return;
        }
        let msg: JsonRpcResponse;
        try {
            msg = JSON.parse(trimmed);
        } catch {
            return;
        }
        if (msg.id === null) {
            return;
        }
        const cb = this.pending.get(msg.id);
        if (!cb) {
            if (typeof msg.id === 'number') {
                this.diagnostic({kind: 'late-response', requestId: msg.id});
            }
            return;
        }
        this.pending.delete(msg.id);

        if (msg.error) {
            cb.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
        } else {
            cb.resolve(msg.result);
        }
    }

    private diagnostic(event: Omit<McpDiagnostic, 'pending'>) {
        try {
            this.onDiagnostic?.({...event, pending: this.pending.size});
        } catch {
            // Diagnostics never retry or change an RPC outcome.
        }
    }
}

async function waitForExit(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            exited.then(() => true),
            new Promise<false>((resolve) => {
                timer = setTimeout(() => resolve(false), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
