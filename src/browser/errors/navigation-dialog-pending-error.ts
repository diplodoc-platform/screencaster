import {NAVIGATION_DIALOG_PENDING_MESSAGE} from '../messages.js';
export class NavigationDialogPendingError extends Error {
    constructor() {
        super(NAVIGATION_DIALOG_PENDING_MESSAGE);
        this.name = 'NavigationDialogPendingError';
    }
}
