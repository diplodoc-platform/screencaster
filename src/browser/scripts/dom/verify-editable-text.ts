import matchesText from './editable-text-matches.js';
export default function verifyEditableText(el: SVGElement | HTMLElement, expected: string) {
    return matchesText(el as HTMLElement, expected);
}
