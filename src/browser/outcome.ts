export type DispatchOutcome = 'not-dispatched' | 'unknown' | 'observation-failed';

export class BrowserActionError extends Error {
    readonly outcome: DispatchOutcome;
    readonly actionId?: number;
    constructor(
        message: string,
        outcome: DispatchOutcome,
        actionId?: number,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'BrowserActionError';
        this.outcome = outcome;
        this.actionId = actionId;
    }
}
