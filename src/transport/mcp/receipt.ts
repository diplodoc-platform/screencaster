import {sanitizeSnapshotForModel} from '../../shared/sanitize-for-model.js';

import {RECEIPT_LIMIT} from './config.js';
import {CODE_FENCE_PATTERN, MARKDOWN_FENCE_PATTERN, SNAPSHOT_FENCE_PATTERN} from './patterns.js';

// A native action carries an earlier snapshot and generated code. The caller
// receives a separate fresh snapshot, so retain only the actual receipt here.
export function summarizeReceipt(value: string): string {
    const text = sanitizeSnapshotForModel(value);
    if (['[', '{', '"'].includes(text.trimStart()[0])) {
        return boundReceipt(text);
    }
    const lines = text.replaceAll('\r\n', '\n').split('\n');
    const output: string[] = [];
    let fence: string | undefined;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const redundant =
            (line === '### Snapshot' && SNAPSHOT_FENCE_PATTERN.test(lines[index + 1] ?? '')) ||
            (line === '### Ran Playwright code' && CODE_FENCE_PATTERN.test(lines[index + 1] ?? ''));
        if (!fence && redundant) {
            const closing = lines.indexOf('```', index + 2);
            if (closing >= 0) {
                index = closing;
                continue;
            }
        }
        const delimiter = MARKDOWN_FENCE_PATTERN.exec(line);
        if (delimiter) {
            if (!fence) {
                fence = delimiter[2];
            } else if (
                delimiter[2][0] === fence[0] &&
                delimiter[2].length >= fence.length &&
                !delimiter[3].trim()
            ) {
                fence = undefined;
            }
        }
        output.push(line);
    }
    return boundReceipt(output.join('\n').trim());
}

function boundReceipt(text: string) {
    if (text.length <= RECEIPT_LIMIT) {
        return text;
    }
    const marker = '\n[Receipt truncated; middle omitted.]\n';
    const half = Math.floor((RECEIPT_LIMIT - marker.length) / 2);
    return text.slice(0, half) + marker + text.slice(-half);
}
