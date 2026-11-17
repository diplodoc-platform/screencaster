import {
    BROWSER_OBSERVERS_ARE_INSTALLED_ONCE_PER_OWNED_CONTEXT,
    BROWSER_OBSERVERS_REQUIRE_UNIQUE_BOUNDED_IDS,
} from './messages.js';
import {OBSERVER_ID_PATTERN} from './patterns.js';
export interface BrowserObservationAccess {
    /** A Playwright function taking the owned page in MCP's isolated environment,
     * returning JSON-serializable data. No Node imports or model-supplied code. */
    runCode(code: string): Promise<unknown>;
}

export type BrowserObserverResult =
    {id: string; ok: true; value: unknown} | {id: string; ok: false};

export interface BrowserObserver {
    readonly id: string;
    install(access: BrowserObservationAccess): Promise<void>;
    read(access: BrowserObservationAccess): Promise<unknown>;
    accept(result: BrowserObserverResult): void | Promise<void>;
}

// Registration belongs to trusted startup code. Results go only to its callback,
// never automatically to the agent, stdout or the public artifact manifest.
export class BrowserObservations {
    private readonly observers: readonly BrowserObserver[];
    private readonly access: BrowserObservationAccess;
    private ready = false;

    constructor(observers: readonly BrowserObserver[], access: BrowserObservationAccess) {
        if (
            observers.length > 16 ||
            observers.some((observer) => !OBSERVER_ID_PATTERN.test(observer.id)) ||
            new Set(observers.map(({id}) => id)).size !== observers.length
        ) {
            throw new Error(BROWSER_OBSERVERS_REQUIRE_UNIQUE_BOUNDED_IDS);
        }
        this.observers = observers.map((observer) => ({
            id: observer.id,
            install: (access) => observer.install(access),
            read: (access) => observer.read(access),
            accept: (result) => observer.accept(result),
        }));
        this.access = access;
    }

    async install(): Promise<void> {
        if (this.ready) {
            throw new Error(BROWSER_OBSERVERS_ARE_INSTALLED_ONCE_PER_OWNED_CONTEXT);
        }
        for (const observer of this.observers) {
            try {
                await observer.install(this.access);
            } catch {
                try {
                    await observer.accept({id: observer.id, ok: false});
                } catch {
                    // Installation still fails before the first UI action.
                }
                throw new Error(`Browser observer ${observer.id} could not be installed`);
            }
        }
        this.ready = true;
    }

    async collect(): Promise<void> {
        if (!this.ready) {
            return;
        }
        const failures: string[] = [];
        for (const observer of this.observers) {
            try {
                const value = await observer.read(this.access);
                await observer.accept({id: observer.id, ok: true, value});
            } catch {
                failures.push(observer.id);
                try {
                    await observer.accept({id: observer.id, ok: false});
                } catch {
                    // Still collect other observers; no later mutation is dispatched.
                }
            }
        }
        if (failures.length) {
            throw new Error(`Browser observations are incomplete: ${failures.join(', ')}`);
        }
    }
}
