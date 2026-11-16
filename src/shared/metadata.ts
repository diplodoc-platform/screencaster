import fs from 'node:fs';

import {MCP_SERVICE_NAME} from './config.js';
import {PACKAGE_VERSION_IS_MISSING} from './messages.js';

const metadata: unknown = JSON.parse(
    fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
if (
    !metadata ||
    typeof metadata !== 'object' ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string'
) {
    throw new Error(PACKAGE_VERSION_IS_MISSING);
}
export const MCP_IDENTITY = {name: MCP_SERVICE_NAME, version: metadata.version};
