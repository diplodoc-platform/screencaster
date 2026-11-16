import {ACTION_OBSERVATION_FAILED_MESSAGE} from '../messages.js';
import {summarizeReceipt} from '../../transport/mcp/receipt.js';

export class ActionObservationError extends Error {
    readonly returned: {ok: true; tool: string; result: string};

    constructor(tool: string, reply: string) {
        super(ACTION_OBSERVATION_FAILED_MESSAGE);
        this.name = 'ActionObservationError';
        this.returned = {ok: true, tool, result: summarizeReceipt(reply)};
    }
}
