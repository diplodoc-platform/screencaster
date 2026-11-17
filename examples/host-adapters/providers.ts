import type {ServerOptions} from '@diplodoc/screencaster/mcp';

import {createHostPolicy, hostAuthentication} from './host.ts';

// A complete CLI host module for a synthetic fixture. Adapt these explicit
// origins and data rules in the consuming project after its route review.
const FIXTURE_ORIGIN = 'https://docs.test.example';

export const policyFactory: NonNullable<ServerOptions['policyFactory']> = (target) =>
    createHostPolicy(target);

export const authentication = hostAuthentication({
    allowedOrigins: [FIXTURE_ORIGIN],
    login: async ({origin}) => {
        // The core validates the target before this callback. A real host can
        // invoke its audited provider login helper here; state contents stay opaque.
        const storageStatePath = process.env.SCREENCASTER_HOST_STORAGE_STATE;
        return storageStatePath
            ? {status: 'ready', origin, storageStatePath}
            : {status: 'challenge', origin, challenge: 'device'};
    },
});

export const screenshotPolicy: ServerOptions['screenshotPolicy'] = {
    requireRedaction: true,
    redaction: {replacements: [{from: 'Synthetic User', to: 'Example person'}]},
};
