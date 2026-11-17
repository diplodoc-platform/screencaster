import associatedInput from './associated-input.js';
export default function inspectFillTarget(el: HTMLElement) {
    if (!el?.isConnected) {
        return 'unavailable';
    }
    let target = el;
    // Match native fill's label association without focusing or choosing another ref.
    if (!target.matches('input, textarea, select') && !target.isContentEditable) {
        target = (associatedInput(target)?.field as HTMLElement | undefined) ?? target;
    }
    const fillableInputTypes = new Set([
        'text',
        'search',
        'email',
        'tel',
        'url',
        'password',
        'number',
        'color',
        'date',
        'time',
        'datetime-local',
        'month',
        'range',
        'week',
    ]);
    if (
        !target.isContentEditable &&
        target.tagName !== 'TEXTAREA' &&
        !(target.tagName === 'INPUT' && fillableInputTypes.has((target as HTMLInputElement).type))
    ) {
        return 'not-fillable';
    }
    if (
        target.matches(':disabled') ||
        (target as HTMLInputElement).readOnly === true ||
        target.getAttribute('aria-readonly') === 'true' ||
        target.getAttribute('aria-disabled') === 'true'
    ) {
        return 'not-editable';
    }
    return 'fillable';
}
