import {passiveObservationMessage} from '../messages.js';
import {sanitizeForModel} from '../../shared/sanitize-for-model.js';

/** A read-only browser observation failed without dispatching a mutation. */
export class PassiveObservationError extends Error {
    constructor(detail: string, tool = 'browser_wait_for') {
        super(passiveObservationMessage(tool, sanitizeForModel(detail)));
        this.name = 'PassiveObservationError';
    }
}
