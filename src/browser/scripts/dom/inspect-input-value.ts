import type {InputExpectation as InputEvidenceInputExpectation} from '../../interaction/input-evidence.js';

import matchesText from './editable-text-matches.js';
export default function inspectInputValue(
    el: SVGElement | HTMLElement,
    expected: InputEvidenceInputExpectation,
) {
    if (!el.isConnected) {
        return {status: 'unavailable'};
    }
    if (el instanceof HTMLInputElement && (el as HTMLInputElement).type === 'password') {
        return {status: 'sensitive'};
    }
    const matches = matchesInput(el, expected);
    return matches === undefined
        ? {status: 'unavailable'}
        : {status: 'observed', matchesRequested: matches};
}

function matchesInput(el: SVGElement | HTMLElement, expected: InputEvidenceInputExpectation) {
    switch (expected.type) {
        case 'textbox':
            return matchesTextbox(el, expected.value);
        case 'checkbox':
        case 'radio':
            if (el instanceof HTMLInputElement && (el as HTMLInputElement).type === expected.type) {
                return el.checked === (expected.value === 'true');
            }
            return undefined;
        case 'combobox':
            if (el instanceof HTMLSelectElement) {
                return (
                    el.selectedOptions.length === 1 &&
                    el.selectedOptions[0].label === expected.value
                );
            }
            return undefined;
        case 'slider':
            if (el instanceof HTMLInputElement && (el as HTMLInputElement).type === 'range') {
                return el.value === expected.value;
            }
            return undefined;
    }
}

function matchesTextbox(el: SVGElement | HTMLElement, value: string) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return el.value === value;
    }
    if ((el as HTMLElement).isContentEditable) {
        let host = el;
        while (host.parentElement?.isContentEditable) {
            host = host.parentElement;
        }

        return matchesText(host as HTMLElement, value);
    }
    return undefined;
}
