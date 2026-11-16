import type {CaptureRun} from '../../../src/application/capture-run.js';

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {afterEach, expect, it} from 'vitest';

import {
    analyzeRunIllustrations,
    produceRunIllustrations,
} from '../../../src/application/illustrations.js';
import {sha256} from '../../../src/media/recording/recording.js';

const directories: string[] = [];
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((directory) => fs.rm(directory, {recursive: true, force: true})),
    );
});

async function fixture() {
    const directory = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), 'run-illustrations-')),
    );
    directories.push(directory);
    const image = path.join(directory, 'source.png');
    await sharp({create: {width: 20, height: 10, channels: 3, background: '#ffffff'}})
        .png()
        .toFile(image);
    const artifacts = [
        {
            path: 'source.png',
            kind: 'screenshot',
            sha256: await sha256(image),
            metadata: {
                deviceScaleFactor: 2,
                viewport: {width: 10, height: 5},
                bounds: {x: 0, y: 0, width: 10, height: 5},
                target: {x: 1, y: 1, width: 3, height: 2},
                pixelWidth: 20,
                pixelHeight: 10,
            },
        },
    ] as CaptureRun['manifest']['artifacts'];
    const run = {
        directory,
        manifest: {artifacts},
        registerExport: async (name: string) => {
            for (const entry of await fs.readdir(path.join(directory, name))) {
                artifacts.push({
                    path: path.join(name, entry),
                    kind: 'media-data',
                    sha256: await sha256(path.join(directory, name, entry)),
                });
            }
            return artifacts;
        },
    } as unknown as CaptureRun;
    const job = {
        version: 1,
        purpose: 'Explain a measured control',
        evidence: 'The control is visible',
        result: 'single',
        inputs: [{id: 'panel', source: 'source.png', dpr: 3}],
        publication: {format: 'yfm', assetDirectory: 'assets'},
    };
    return {run, job, directory};
}

it('bridges measured capture geometry into a hash-confirmed offline production', async () => {
    const {run, job, directory} = await fixture();
    const analysis = await analyzeRunIllustrations(run, {job, output: 'analysis'});
    expect(analysis.inputs[0]).toMatchObject({
        dpr: 2,
        viewport: {width: 10, height: 5},
        bbox: {x: 2, y: 2, width: 6, height: 4},
        safeCssWidth: 10,
    });
    const result = await produceRunIllustrations(run, {
        analysis: 'analysis',
        output: 'illustrations',
        confirmation: {
            analysisSha256: analysis.analysisSha256,
            evidence: 'Reviewed the contact sheet and retained full context',
        },
    });
    expect(result.quality).toMatchObject({
        machineStatus: 'PASS',
        visualStatus: 'PENDING',
        publicationStatus: 'DRAFT',
    });
    expect(
        await fs.readFile(path.join(directory, 'illustrations', 'publication-yfm.md'), 'utf8'),
    ).toContain('assets/panel.png =10x');
    expect(
        run.manifest.artifacts.some(
            (artifact) => artifact.path === path.join('illustrations', 'production.json'),
        ),
    ).toBe(true);
});

it('refuses unregistered or changed sources and forged saved analyses', async () => {
    const {run, job, directory} = await fixture();
    await expect(
        analyzeRunIllustrations(run, {
            job: {...job, inputs: [{id: 'panel', source: '../outside.png'}]},
            output: 'bad',
        }),
    ).rejects.toThrow('registered');
    const analysis = await analyzeRunIllustrations(run, {job, output: 'analysis'});
    const file = path.join(directory, 'analysis', 'analysis.json');
    await fs.writeFile(
        file,
        JSON.stringify({...analysis, inputs: [{...analysis.inputs[0], source: '/etc/passwd'}]}),
    );
    await expect(
        produceRunIllustrations(run, {
            analysis: 'analysis',
            output: 'forged',
            confirmation: {analysisSha256: analysis.analysisSha256, evidence: 'Reviewed'},
        }),
    ).rejects.toThrow('changed');
    await fs.writeFile(path.join(directory, 'source.png'), 'changed input');
    await expect(analyzeRunIllustrations(run, {job, output: 'changed'})).rejects.toThrow('changed');
    expect(await fs.readdir(directory)).not.toContain('forged');
});
