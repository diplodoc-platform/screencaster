/** A trusted validation rejected the tool before its action was dispatched. */
export class ToolDispatchRejectedError extends Error {
    readonly terminal: boolean;

    constructor(message: string, terminal = false) {
        super(message);
        this.name = 'ToolDispatchRejectedError';
        this.terminal = terminal;
    }
}

/** The driver rejected an expired single-target reference before any action. */
export class TargetLookupRejectedError extends ToolDispatchRejectedError {}
