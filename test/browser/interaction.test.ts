import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, expect, it} from 'vitest';

import {CaptureRun} from '../../src/application/capture-run.js';

let server: http.Server;
let directory: string;
let url: string;

beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'screencaster-interaction-'));
    server = http.createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<!doctype html><title>Interaction fixture</title>
            <h1>Typed browser programs</h1>
            <input aria-label="Name" value="original">
            <div role="textbox" aria-label="Notes" contenteditable="true">Original notes</div>
            <label><input type="checkbox" aria-label="Enabled">Enabled</label>
            <div role="region" aria-label="Surface" style="width:500px;height:160px;margin-top:20px;border:1px solid black">Surface</div>
            <div style="height:1500px"></div>
            <button onclick="this.textContent='Revealed'">Target</button>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(directory, {recursive: true, force: true});
});

async function reference(run: CaptureRun, role: string, name: string): Promise<string> {
    const line = (await run.snapshot())
        .split('\n')
        .find((item) => item.includes(`${role} "${name}"`));
    const ref = line?.match(/\[ref=([^\]]+)\]/)?.[1];
    expect(ref, `${role} ${name}`).toBeTruthy();
    return ref as string;
}

it('replaces native and rich text, verifies requested values, and activates a native checkbox', async () => {
    const run = await CaptureRun.create({url, directory: path.join(directory, 'inputs')});
    try {
        const text = 'A "quote", `backtick`, and ${literal}';
        const name = await reference(run, 'textbox', 'Name');
        await run.action('browser_type', {element: 'Name', ref: name, text});
        expect(
            (await run.browser.observeInputs([{ref: name, type: 'textbox', value: text}])).evidence,
        ).toMatchObject([{status: 'observed', matchesRequested: true}]);
        const notes = await reference(run, 'textbox', 'Notes');
        const multiline = 'First line\nSecond line';
        await run.action('browser_type', {element: 'Notes', ref: notes, text: multiline});
        expect(
            (await run.browser.observeInputs([{ref: notes, type: 'textbox', value: multiline}]))
                .evidence,
        ).toMatchObject([{status: 'observed', matchesRequested: true}]);
        const checkbox = await reference(run, 'checkbox', 'Enabled');
        await run.action('browser_click', {element: 'Enabled', ref: checkbox});
        expect(
            (await run.browser.observeInputs([{ref: checkbox, type: 'checkbox', value: 'true'}]))
                .evidence,
        ).toMatchObject([{status: 'observed', matchesRequested: true}]);
        expect((await run.finish()).status).toBe('completed');
    } finally {
        await run.browser.close();
    }
});

it('uses measured container backgrounds and reveals an offscreen exact target', async () => {
    const run = await CaptureRun.create({url, directory: path.join(directory, 'geometry')});
    try {
        const surface = await reference(run, 'region', 'Surface');
        await run.action('browser_click', {
            element: 'Surface',
            ref: surface,
            targetArea: 'background',
        });
        const target = await reference(run, 'button', 'Target');
        await run.action('browser_scroll_to', {ref: target});
        await run.action('browser_click', {
            element: 'Target',
            ref: await reference(run, 'button', 'Target'),
        });
        expect((await run.action('browser_wait_for', {text: 'Revealed'})).snapshot).toContain(
            'Revealed',
        );
        expect((await run.finish()).status).toBe('completed');
    } finally {
        await run.browser.close();
    }
});
