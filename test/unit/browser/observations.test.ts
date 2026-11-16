import {expect, it, vi} from 'vitest';

import {
    BrowserObservations,
    type BrowserObserverResult,
} from '../../../src/browser/observations.js';

it('reports unavailable observations without discarding an earlier cumulative receipt', async () => {
    let fail = false;
    let retained: unknown;
    const accept = vi.fn((result: BrowserObserverResult) => {
        if (result.ok) {
            retained = result.value;
        }
    });
    const access = {runCode: vi.fn()};
    const observations = new BrowserObservations(
        [
            {
                id: 'created-items',
                install: async () => {},
                read: async () => {
                    if (fail) {
                        throw new Error('private provider detail');
                    }
                    return {ids: ['synthetic-item']};
                },
                accept,
            },
        ],
        access,
    );
    await observations.install();
    await observations.collect();
    fail = true;
    await expect(observations.collect()).rejects.toThrow('observations are incomplete');
    expect(accept).toHaveBeenLastCalledWith({id: 'created-items', ok: false});
    expect(retained).toEqual({ids: ['synthetic-item']});
    await expect(observations.install()).rejects.toThrow('once');
});

it('fails installation before collecting and rejects duplicate observer identities', async () => {
    const observer = {
        id: 'test',
        install: vi.fn(async () => {
            throw new Error('not ready');
        }),
        read: vi.fn(),
        accept: vi.fn(),
    };
    const access = {runCode: vi.fn()};
    expect(() => new BrowserObservations([observer, observer], access)).toThrow('unique');
    const observations = new BrowserObservations([observer], access);
    await expect(observations.install()).rejects.toThrow('could not be installed');
    await observations.collect();
    expect(observer.read).not.toHaveBeenCalled();
    expect(observer.accept).toHaveBeenCalledWith({id: 'test', ok: false});
});
