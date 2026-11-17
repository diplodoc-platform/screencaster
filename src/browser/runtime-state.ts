import {
    BROWSER_SESSION_INACTIVE,
    BROWSER_STARTUP_INTERRUPTED,
    THE_OWNED_BROWSER_IS_ALREADY_RUNNING,
} from './messages.js';
import {BrowserContextLostError} from './errors/browser-context-lost-error.js';
import {ToolDispatchRejectedError} from './errors/tool-dispatch-rejected-error.js';

export type RuntimePhase =
    'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'aborting' | 'aborted' | 'failed';

export class RuntimeState {
    private current: RuntimePhase = 'idle';
    private contextLost = false;
    private cancelled = false;

    get phase(): RuntimePhase {
        return this.current;
    }

    start(transportStopped: boolean): void {
        if (this.contextLost) {
            throw new BrowserContextLostError();
        }
        if (
            this.cancelled ||
            !transportStopped ||
            !['idle', 'stopped', 'failed'].includes(this.current)
        ) {
            throw new Error(THE_OWNED_BROWSER_IS_ALREADY_RUNNING);
        }
        this.current = 'starting';
    }

    assertStarting(): void {
        if (this.current !== 'starting') {
            throw new Error(BROWSER_STARTUP_INTERRUPTED);
        }
    }

    ready(): void {
        this.assertStarting();
        this.current = 'ready';
    }

    assertUsable(): void {
        if (this.contextLost) {
            throw new BrowserContextLostError();
        }
        // Startup hooks may observe/navigate before the public start completes.
        if (this.current !== 'ready' && this.current !== 'starting') {
            throw new ToolDispatchRejectedError(BROWSER_SESSION_INACTIVE);
        }
    }

    stopping(): void {
        if (!['stopped', 'aborted', 'aborting'].includes(this.current)) {
            this.current = 'stopping';
        }
    }

    aborting(): void {
        this.cancelled = true;
        this.current = 'aborting';
    }

    settle(phase: 'stopped' | 'aborted' | 'failed'): void {
        // A graceful close completing after cancellation cannot revive the session.
        if (this.current === 'aborting' || this.current === 'aborted') {
            this.current = phase === 'failed' ? 'failed' : 'aborted';
        } else {
            this.current = phase;
        }
    }

    loseContext(): void {
        this.contextLost = true;
        this.current = 'failed';
    }
}
