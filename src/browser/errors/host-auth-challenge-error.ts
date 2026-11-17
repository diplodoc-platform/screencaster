import type {HostAuthResult} from '../host-auth.js';

import {HOST_AUTH_MANUAL_CONTINUATION_REQUIRED} from '../messages.js';

export class HostAuthenticationChallengeError extends Error {
    readonly origin: string;
    readonly challenge: Extract<HostAuthResult, {status: 'challenge'}>['challenge'];

    constructor(result: Extract<HostAuthResult, {status: 'challenge'}>) {
        super(HOST_AUTH_MANUAL_CONTINUATION_REQUIRED);
        this.name = 'HostAuthenticationChallengeError';
        this.origin = result.origin;
        this.challenge = result.challenge;
    }
}
