#!/usr/bin/env node
import {parseArgs} from 'node:util';

import {CLI_USAGE} from './application/cli-messages.js';
import {serveStdio} from './server/mcp/index.js';
import {loadLaunchOptions} from './application/launch-options.js';

async function main() {
    const {values} = parseArgs({
        options: {
            help: {type: 'boolean'},
            config: {type: 'string'},
            directory: {type: 'string'},
            providers: {type: 'string'},
            storageState: {type: 'string'},
            policy: {type: 'string'},
        },
    });
    if (values.help) {
        process.stdout.write(CLI_USAGE);
        return;
    }
    const runtime = await serveStdio(await loadLaunchOptions(values));
    const stop = () =>
        runtime.close().catch(() => {
            process.exitCode = 1;
        });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
}

await main().catch((error) => {
    process.stderr.write(
        `${error instanceof Error ? error.message : 'Screencaster initialization failed'}\n`,
    );
    process.exitCode = 1;
});
