import type {ScriptPage} from '../../src/browser/scripts/types.js';

import http from 'node:http';
import {expect, it} from 'vitest';
import {chromium} from 'playwright';

import installGuard from '../../src/browser/scripts/driver/install-request-guard.js';

it('blocks an HTTP redirect before a forbidden host or subresource receives a request', async () => {
    let forbidden = 0;
    const server = http.createServer((request, response) => {
        if (request.url === '/forbidden') {
            forbidden++;
            response.end('private');
        } else if (request.url === '/redirect') {
            response.writeHead(302, {
                Location: `http://127.0.0.1:${(server.address() as {port: number}).port}/forbidden`,
            });
            response.end();
        } else {
            response.setHeader('Content-Type', 'text/html');
            response.end(
                `<h1>Capture</h1><img src="http://127.0.0.1:${(server.address() as {port: number}).port}/forbidden">`,
            );
        }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://localhost:${(server.address() as {port: number}).port}`;
    const browser = await chromium.launch({headless: true});
    try {
        for (const pathname of ['/redirect', '/page']) {
            const context = await browser.newContext({serviceWorkers: 'block'});
            const page = await context.newPage();
            await installGuard(page as ScriptPage, {
                postReads: [],
                deniedHosts: ['127.0.0.1'],
                allowedOrigins: [origin],
                allowedNavigationUrls: [origin + pathname],
                blockRedirects: true,
                strictViolations: true,
            });
            if (pathname === '/redirect') {
                await expect(page.goto(origin + pathname)).rejects.toThrow();
            } else {
                await page.goto(origin + pathname);
                expect(await page.getByRole('heading').innerText()).toBe('Capture');
            }
            expect(forbidden).toBe(0);
            await context.close();
        }
    } finally {
        await browser.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

it('rejects a popup initial request before an otherwise allowed endpoint receives it', async () => {
    let popupRequests = 0;
    const server = http.createServer((request, response) => {
        if (request.url === '/popup') {
            popupRequests++;
            response.end('private popup content');
            return;
        }
        response.setHeader('Content-Type', 'text/html');
        response.end(
            '<button onclick="window.open(location.origin + \'/popup\')">Open popup</button>',
        );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
    const browser = await chromium.launch({headless: true});
    try {
        const context = await browser.newContext({serviceWorkers: 'block'});
        const page = await context.newPage();
        await installGuard(page as ScriptPage, {
            postReads: [],
            allowedOrigins: [origin],
            allowedNavigationUrls: [origin + '/page', origin + '/popup'],
            blockPopups: true,
            blockRedirects: true,
            strictViolations: true,
        });
        await page.goto(origin + '/page');
        const opening = context.waitForEvent('page');
        await page.getByRole('button', {name: 'Open popup'}).click();
        const popup = await opening;
        if (!popup.isClosed()) {
            await popup.waitForEvent('close');
        }
        await page.evaluate(
            () =>
                new Promise<void>((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                ),
        );
        expect(context.pages()).toHaveLength(1);
        expect(popupRequests).toBe(0);
        await context.close();
    } finally {
        await browser.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
