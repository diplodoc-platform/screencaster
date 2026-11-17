import type {ScriptPage} from '../types.js';
import type {CaptureLocator} from '../../capture/screenshot.js';
import type {PreparedScreenshotCapturePolicy} from '../../capture/capture-policy.js';
import type PrepareScreenshotPrivacy from '../dom/prepare-screenshot-privacy.js';

import {SCREENSHOT_REQUIRES_VISIBLE_BOUNDS} from '../messages.js';
import {
    CAPTURE_READINESS_POLL_MS,
    MAX_CAPTURE_DOM_NODES,
    MAX_CAPTURE_MATCHES,
} from '../../capture/config.js';
import {
    SCREENSHOT_CAPTURE_FAILED,
    SCREENSHOT_READINESS_FAILED,
    SCREENSHOT_UNSUPPORTED_SURFACE,
} from '../../capture/messages.js';
import privacyProgram from '../dom/prepare-screenshot-privacy.js?script';

export type Input = {
    input: {
        file: string;
        ref?: string;
        area: 'viewport' | 'page' | 'element';
        ready: CaptureLocator[];
        notReady: CaptureLocator[];
        timeoutMs: number;
        policy: PreparedScreenshotCapturePolicy;
        privacyToken: string;
    };
};

function locator(page: ScriptPage, spec: CaptureLocator) {
    return 'ref' in spec
        ? page.locator('aria-ref=' + spec.ref)
        : page.getByRole(spec.role, {name: spec.name, exact: true});
}

async function readinessMatches(page: ScriptPage, input: Input['input']): Promise<boolean> {
    for (const spec of input.ready) {
        const target = locator(page, spec);
        if ((await target.count()) !== 1 || !(await target.isVisible())) {
            return false;
        }
    }
    for (const spec of input.notReady) {
        const target = locator(page, spec);
        const count = await target.count();
        if (count > MAX_CAPTURE_MATCHES) {
            return false;
        }
        for (let index = 0; index < count; index++) {
            if (await target.nth(index).isVisible()) {
                return false;
            }
        }
    }
    return true;
}

async function waitForReadiness(page: ScriptPage, input: Input['input']) {
    const deadline = Date.now() + input.timeoutMs;
    do {
        if (await readinessMatches(page, input)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, CAPTURE_READINESS_POLL_MS));
    } while (Date.now() < deadline);
    throw new Error(SCREENSHOT_READINESS_FAILED);
}

type DomNode = {children?: DomNode[]; shadowRoots?: DomNode[]; shadowRootType?: string};
async function assertNoClosedShadow(page: ScriptPage) {
    const session = await page.context().newCDPSession(page);
    try {
        const tree = (await session.send('DOM.getDocument', {depth: -1, pierce: true})) as {
            root: DomNode;
        };
        const nodes = [tree.root];
        let count = 0;
        while (nodes.length) {
            const node = nodes.pop();
            if (!node || ++count > MAX_CAPTURE_DOM_NODES || node.shadowRootType === 'closed') {
                throw new Error(SCREENSHOT_UNSUPPORTED_SURFACE);
            }
            nodes.push(...(node.children ?? []), ...(node.shadowRoots ?? []));
        }
    } finally {
        await session.detach();
    }
}

export default async function script(page: ScriptPage, args: Input) {
    const input = args.input;
    const hasRedaction = Boolean(
        input.policy.redaction?.replacements.length || input.policy.redaction?.hide.length,
    );
    const privacyInput = {token: input.privacyToken, policy: input.policy};
    try {
        const targetLocator = input.ref ? page.locator('aria-ref=' + input.ref) : undefined;
        if (targetLocator && (await targetLocator.count()) !== 1) {
            throw new Error(SCREENSHOT_REQUIRES_VISIBLE_BOUNDS);
        }
        await targetLocator?.scrollIntoViewIfNeeded({timeout: input.timeoutMs});
        await waitForReadiness(page, input);
        if (hasRedaction) {
            await page.evaluate(privacyProgram as typeof PrepareScreenshotPrivacy, {
                ...privacyInput,
                phase: 'prepare' as const,
            });
            await assertNoClosedShadow(page);
        }
        const viewport = page.viewportSize();
        const target = targetLocator ? await targetLocator.boundingBox() : null;
        if (!viewport || (targetLocator && !target)) {
            throw new Error(SCREENSHOT_REQUIRES_VISIBLE_BOUNDS);
        }
        const display = await page.evaluate(() => ({
            deviceScaleFactor: window.devicePixelRatio,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
        }));
        const options = {
            path: input.file,
            type: 'png',
            scale: 'device',
            caret: 'initial',
            timeout: input.timeoutMs,
        } as const;
        if (input.area === 'element') {
            if (!targetLocator) {
                throw new Error(SCREENSHOT_REQUIRES_VISIBLE_BOUNDS);
            }
            await targetLocator.screenshot(options);
        } else {
            await page.screenshot({...options, fullPage: input.area === 'page'});
        }
        // Observe immediately: waiting here could bless pixels captured in a loading state.
        if (!(await readinessMatches(page, input))) {
            throw new Error(SCREENSHOT_READINESS_FAILED);
        }
        if (hasRedaction) {
            await page.evaluate(privacyProgram as typeof PrepareScreenshotPrivacy, {
                ...privacyInput,
                phase: 'verify' as const,
            });
            await assertNoClosedShadow(page);
        }
        const origin = screenshotOrigin(input.area, target, display);
        return JSON.stringify({
            viewport,
            target,
            deviceScaleFactor: display.deviceScaleFactor,
            area: input.area,
            origin,
        });
    } catch {
        // Playwright traces can echo selectors, URLs and the entire evaluation argument.
        throw new Error(SCREENSHOT_CAPTURE_FAILED);
    } finally {
        if (hasRedaction) {
            await page
                .evaluate(privacyProgram as typeof PrepareScreenshotPrivacy, {
                    ...privacyInput,
                    phase: 'cleanup' as const,
                })
                .catch(() => {});
        }
    }
}

function screenshotOrigin(
    area: Input['input']['area'],
    target: {x: number; y: number} | null,
    display: {scrollX: number; scrollY: number},
) {
    let origin = {x: 0, y: 0};
    if (area === 'element' && target) {
        origin = {
            x: Math.floor(target.x + display.scrollX) - display.scrollX,
            y: Math.floor(target.y + display.scrollY) - display.scrollY,
        };
    } else if (area === 'page') {
        origin = {x: -display.scrollX, y: -display.scrollY};
    }

    return origin;
}
