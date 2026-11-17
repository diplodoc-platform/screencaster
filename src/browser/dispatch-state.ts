import type {DispatchOutcome} from './outcome.js';

export class DispatchState {
    private dispatched = 0;

    get count(): number {
        return this.dispatched;
    }

    begin(): void {
        this.dispatched++;
    }

    failure(before: number, refused: boolean, passive: boolean): DispatchOutcome {
        if (refused || before === this.dispatched) {
            return 'not-dispatched';
        }
        return passive ? 'observation-failed' : 'unknown';
    }
}
