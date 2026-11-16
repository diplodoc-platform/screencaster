import inspectInputLabel from './inspect-input-label.js';
export default function checkInputTarget(element: HTMLElement) {
    return inspectInputLabel(element, false);
}
