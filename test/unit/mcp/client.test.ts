import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';

import {McpStdioClient} from '../../../src/transport/mcp/client.js';

it('does not resend an action when its MCP process exits after receiving it', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-receipt-'));
    const script = path.join(directory, 'server.cjs');
    const receipt = path.join(directory, 'received.txt');
    await fs.writeFile(
        script,
        `const fs=require('node:fs');
        require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
            const request=JSON.parse(line);
            if(request.method==='initialize'){
                process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{}})+'\\n');
            }
            if(request.method==='tools/call'){
                fs.appendFileSync(${JSON.stringify(receipt)},request.params.name+'\\n');
                process.exit(1);
            }
        });`,
    );
    const client = new McpStdioClient();
    try {
        await client.start(process.execPath, [script]);
        await expect(client.callTool('browser_click', {ref: 'e1'})).rejects.toThrow('exited');
        expect(await fs.readFile(receipt, 'utf8')).toBe('browser_click\n');
    } finally {
        await client.stop();
        await fs.rm(directory, {recursive: true, force: true});
    }
});
