import type {ScriptPage} from '../types.js';
export default async function script(page: ScriptPage) {
    const context = page.context();
    if (context.__docsRequestGuardFailures === 0) {
        const blocked = context.__docsRequestGuardBlocked;
        const counts = (['requests', 'redirects', 'sockets'] as const).map((key) => {
            const count = blocked?.[key];
            return Number.isSafeInteger(count) && count !== undefined && count >= 0 ? count : 0;
        });
        return 'REQUEST_GUARD_HEALTHY:' + counts.join(':');
    }
    const failure = context.__docsRequestGuardFailure;
    const phase = ['dispatch', 'fetch', 'fulfill', 'fallback', 'abort'].includes(
        failure?.phase ?? '',
    )
        ? (failure?.phase ?? 'unknown')
        : 'unknown';
    const category = [
        'reset',
        'timeout',
        'dns',
        'tls',
        'refused',
        'closed',
        'policy-write',
        'policy-navigation',
        'policy-popup',
        'policy-download',
        'policy-host',
        'policy-redirect',
        'policy-socket',
    ].includes(failure?.category ?? '')
        ? (failure?.category ?? 'unknown')
        : 'unknown';
    return 'REQUEST_GUARD_FAILED:' + phase + ':' + category;
}
