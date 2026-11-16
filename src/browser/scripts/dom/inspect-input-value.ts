import type {InputExpectation as InputEvidenceInputExpectation} from '../../interaction/input-evidence.js';

import matchesText from './editable-text-matches.js';
export default (el: SVGElement | HTMLElement, expected: InputEvidenceInputExpectation) => {
    if (!el.isConnected) {
        return {status: 'unavailable'};
    }
    if (el instanceof HTMLInputElement && (el as HTMLInputElement).type === 'password') {
        return {status: 'sensitive'};
    }
    let matches;
    if (expected.type === 'textbox') {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            matches = el.value === expected.value;
        } else if ((el as HTMLElement).isContentEditable) {
            let host = el;
            while (host.parentElement?.isContentEditable) {
                host = host.parentElement;
            }

            matches = matchesText(host as HTMLElement, expected.value);
        }
    } else if (expected.type === 'checkbox' || expected.type === 'radio') {
        if (el instanceof HTMLInputElement && (el as HTMLInputElement).type === expected.type) {
            matches = el.checked === (expected.value === 'true');
        }
    } else if (expected.type === 'combobox') {
        if (el instanceof HTMLSelectElement) {
            matches =
                el.selectedOptions.length === 1 && el.selectedOptions[0].label === expected.value;
        }
    } else if (expected.type === 'slider') {
        if (el instanceof HTMLInputElement && (el as HTMLInputElement).type === 'range') {
            matches = el.value === expected.value;
        }
    }
    return matches === undefined
        ? {status: 'unavailable'}
        : {status: 'observed', matchesRequested: matches};
};
