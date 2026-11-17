type ObservationFailure = 'mcp-error' | 'invalid-response' | 'no-http-page' | 'transport';

export class SnapshotObservationError extends Error {
    readonly reason: ObservationFailure;

    constructor(message: string, reason: ObservationFailure) {
        super(message);
        this.name = 'SnapshotObservationError';
        this.reason = reason;
    }
}
