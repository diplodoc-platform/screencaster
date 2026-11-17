import type {McpStdioClient} from '../transport/mcp/client.js';
import type * as PlaywrightModule from 'playwright';

import fs from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

// Check the binary belonging to the MCP driver's Playwright version.
export function isDriverBrowserInstalled(): boolean {
    const driverRequire = createRequire(require.resolve('@playwright/mcp/package.json'));
    const {chromium} = driverRequire('playwright') as typeof PlaywrightModule;
    return fs.existsSync(chromium.executablePath());
}

export async function ensureDriverBrowserInstalled(client: McpStdioClient): Promise<void> {
    if (!isDriverBrowserInstalled()) {
        await client.callTool('browser_install', {});
    }
}
