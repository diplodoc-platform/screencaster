import {describe, expect, it} from 'vitest';

import {
    remapCaptions,
    speechCaption,
    validateCaptions,
    webVtt,
} from '../../../src/media/audio/captions.js';
import {buildFrameMap, expandFrameMap} from '../../../src/media/timeline/time-map.js';

describe('independent captions and timeline', () => {
    it('creates VTT from text and intervals without a runner or speech provider', () => {
        const vtt = webVtt([{text: 'Open <editor>', startMs: 1000, endMs: 2000}]);
        expect(vtt).toContain('00:00:01.000 --> 00:00:02.000');
        expect(vtt).toContain('Open &lt;editor&gt;');
    });

    it('uses a whole-phrase cue when word timings are unavailable', () => {
        const cue = speechCaption(
            'Open the editor',
            {pcm: Buffer.alloc(4800), sampleRate: 24000, channels: 1},
            500,
        );
        expect(cue).toEqual({text: 'Open the editor', startMs: 500, endMs: 600});
    });

    it('maps holds and reports a caption partially cut by author edits', () => {
        const indices = [0, 1, 1, 2, 5, 6];
        const map = buildFrameMap(indices);
        expect(expandFrameMap(map)).toEqual(indices);
        const mapped = remapCaptions([{text: 'Visible phrase', startMs: 0, endMs: 700}], map, 10);
        expect(mapped.partial).toEqual([0]);
        expect(mapped.cues.at(-1)?.endMs).toBe(600);
    });

    it('rejects overlapping cues and reversed frame order', () => {
        expect(() =>
            validateCaptions([
                {text: 'A', startMs: 0, endMs: 1000},
                {text: 'B', startMs: 500, endMs: 1500},
            ]),
        ).toThrow('overlap');
        expect(() => buildFrameMap([2, 1])).toThrow('Invalid');
    });
});
