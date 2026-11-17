import {partialFormFillMessage} from '../messages.js';
// Earlier fields returned; the current field was refused before text entry.
export class PartialFormFillError extends Error {
    readonly completedFields: number;

    constructor(completedFields: number, reason: string) {
        super(partialFormFillMessage(completedFields, reason));
        this.name = 'PartialFormFillError';
        this.completedFields = completedFields;
    }
}
