import type {PreparedScreenshotCapturePolicy} from '../../capture/capture-policy.js';

import {
    CAPTURE_IMAGE_STYLE_PROPERTIES,
    CAPTURE_PSEUDO_ELEMENTS,
    CAPTURE_REDACTION_ATTRIBUTES,
    CAPTURE_UNSUPPORTED_SURFACES,
    MAX_CAPTURE_DOM_NODES,
    MAX_CAPTURE_TEXT_CHARS,
} from '../../capture/config.js';
import {
    SCREENSHOT_PAGE_CHANGED,
    SCREENSHOT_PRIVACY_FAILED,
    SCREENSHOT_UNSUPPORTED_SURFACE,
} from '../../capture/messages.js';
import {
    CAPTURE_BLOCK_DISPLAY_PATTERN,
    CAPTURE_CONTENT_LITERALS_PATTERN,
    CAPTURE_CONTENT_LITERAL_PATTERN,
    CAPTURE_GENERATED_IMAGE_PATTERN,
    CAPTURE_WHITESPACE_PATTERN,
    CAPTURE_ZERO_WIDTH_PATTERN,
} from '../../capture/patterns.js';

export type Input = {
    phase: 'prepare' | 'verify' | 'cleanup';
    token: string;
    policy: PreparedScreenshotCapturePolicy;
};
type CapturePrivacyState = {observers: MutationObserver[]; roots: ParentNode[]; changed: boolean};
type CaptureWindow = Window & {__docsCapturePrivacy?: Map<string, CapturePrivacyState>};

function subtreeRenderable(element: Element): boolean {
    if (!element.isConnected) {
        return false;
    }
    let ancestor: Element | null = element;
    while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.opacity === '0') {
            return false;
        }
        const root = ancestor.getRootNode();
        ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    return true;
}

function visible(element: Element): boolean {
    return (
        subtreeRenderable(element) &&
        getComputedStyle(element).visibility === 'visible' &&
        (element.getClientRects().length > 0 || getComputedStyle(element).display === 'contents')
    );
}

function pseudoVisible(element: Element, style: CSSStyleDeclaration): boolean {
    return (
        subtreeRenderable(element) &&
        style.display !== 'none' &&
        style.visibility === 'visible' &&
        style.opacity !== '0' &&
        !['none', 'normal'].includes(style.content)
    );
}

function pseudoText(element: Element, pseudo: string): string {
    const style = getComputedStyle(element, pseudo);
    if (!pseudoVisible(element, style)) {
        return '';
    }
    if (!CAPTURE_CONTENT_LITERALS_PATTERN.test(style.content)) {
        throw new Error(SCREENSHOT_UNSUPPORTED_SURFACE);
    }
    return [...style.content.matchAll(CAPTURE_CONTENT_LITERAL_PATTERN)]
        .map((match) => match[1] ?? match[2])
        .join('');
}

function positionedPseudoText(element: Element, after: boolean): string {
    return CAPTURE_PSEUDO_ELEMENTS.filter((pseudo) => (pseudo === '::after') === after)
        .map((pseudo) => pseudoText(element, pseudo))
        .join('');
}

function collect() {
    const roots: ParentNode[] = [document];
    const elements: Element[] = [];
    for (let index = 0; index < roots.length; index++) {
        for (const element of roots[index].querySelectorAll('*')) {
            elements.push(element);
            if (elements.length > MAX_CAPTURE_DOM_NODES) {
                throw new Error(SCREENSHOT_PRIVACY_FAILED);
            }
            if (element.shadowRoot) {
                roots.push(element.shadowRoot);
            }
        }
    }
    return {roots, elements};
}

function replace(
    value: string,
    replacements: NonNullable<PreparedScreenshotCapturePolicy['redaction']>['replacements'],
) {
    let result = value;
    for (const replacement of replacements) {
        result = result.split(replacement.from).join(replacement.to);
    }
    return result;
}

function textElements(root: ParentNode, apply: (node: Node, parent: Element | null) => void) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let count = 0;
    while ((node = walker.nextNode())) {
        if (++count > MAX_CAPTURE_DOM_NODES) {
            throw new Error(SCREENSHOT_PRIVACY_FAILED);
        }
        const parent = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
        if (parent && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
            apply(node, parent);
        }
    }
}

function nativeValueDescriptor(element: Element): PropertyDescriptor | undefined {
    let prototype: object;
    if (element instanceof HTMLInputElement) {
        prototype = HTMLInputElement.prototype;
    } else if (element instanceof HTMLTextAreaElement) {
        prototype = HTMLTextAreaElement.prototype;
    } else if (element instanceof HTMLSelectElement) {
        prototype = HTMLSelectElement.prototype;
    } else {
        return undefined;
    }
    return Object.getOwnPropertyDescriptor(prototype, 'value');
}

function nativeValue(element: Element): string | undefined {
    const descriptor = nativeValueDescriptor(element);
    if (!descriptor) {
        return undefined;
    }
    const value: unknown = descriptor.get?.call(element);
    if (typeof value !== 'string') {
        throw new Error(SCREENSHOT_PRIVACY_FAILED);
    }
    return value;
}

function sanitize(policy: PreparedScreenshotCapturePolicy) {
    const {roots, elements} = collect();
    const replacements = [...(policy.redaction?.replacements ?? [])].sort(
        (a, b) => b.from.length - a.from.length,
    );
    for (const root of roots) {
        for (const selector of policy.redaction?.hide ?? []) {
            for (const element of root.querySelectorAll(selector)) {
                if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
                    throw new Error(SCREENSHOT_PRIVACY_FAILED);
                }
                element.style.setProperty('display', 'none', 'important');
            }
        }
        textElements(root, (node) => {
            const original = node.nodeValue ?? '';
            const updated = replace(original, replacements);
            if (original !== updated) {
                node.nodeValue = updated;
            }
        });
    }
    for (const element of elements) {
        for (const attribute of CAPTURE_REDACTION_ATTRIBUTES) {
            const original = element.getAttribute(attribute);
            if (original !== null) {
                const updated = replace(original, replacements);
                if (original !== updated) {
                    element.setAttribute(attribute, updated);
                }
            }
        }
        const originalValue = nativeValue(element);
        if (originalValue !== undefined) {
            const updated = replace(originalValue, replacements);
            if (originalValue !== updated) {
                const descriptor = nativeValueDescriptor(element);
                if (!descriptor?.set) {
                    throw new Error(SCREENSHOT_PRIVACY_FAILED);
                }
                // Bypass instance accessors and emit no events: a presentation change never submits data.
                descriptor.set.call(element, updated);
            }
        }
    }
    return {roots, elements};
}

function normalizedVisibleText(value: string): string {
    return value
        .replace(CAPTURE_ZERO_WIDTH_PATTERN, '')
        .replace(CAPTURE_WHITESPACE_PATTERN, ' ')
        .toLowerCase();
}

function composedVisibleText(root: ParentNode): string {
    const fragments: string[] = [];
    let nodes = 0;
    let characters = 0;
    const append = (value: string) => {
        characters += value.length;
        if (characters > MAX_CAPTURE_TEXT_CHARS) {
            throw new Error(SCREENSHOT_PRIVACY_FAILED);
        }
        fragments.push(value);
    };
    const visit = (node: Node): void => {
        if (++nodes > MAX_CAPTURE_DOM_NODES) {
            throw new Error(SCREENSHOT_PRIVACY_FAILED);
        }
        if (node.nodeType === Node.TEXT_NODE) {
            const parent =
                node.parentElement ??
                (node.parentNode instanceof ShadowRoot ? node.parentNode.host : null);
            if (parent && visible(parent)) {
                append(node.nodeValue ?? '');
            }
            return;
        }
        if (node instanceof Element) {
            const style = getComputedStyle(node);
            if (
                !node.isConnected ||
                style.display === 'none' ||
                style.opacity === '0' ||
                ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)
            ) {
                return;
            }
            const block = CAPTURE_BLOCK_DISPLAY_PATTERN.test(style.display);
            if (block) {
                append('\n');
            }
            append(positionedPseudoText(node, false));
            const assigned =
                node instanceof HTMLSlotElement ? node.assignedNodes({flatten: true}) : [];
            const children = assigned.length
                ? assigned
                : (node.shadowRoot?.childNodes ?? node.childNodes);
            for (const child of children) {
                visit(child);
            }
            append(positionedPseudoText(node, true));
            if (block) {
                append('\n');
            }
            return;
        }
        for (const child of node.childNodes) {
            visit(child);
        }
    };
    visit(root as Node);
    return fragments.join('');
}

function hasGeneratedImage(element: Element): boolean {
    return [undefined, ...CAPTURE_PSEUDO_ELEMENTS].some((pseudo) => {
        const style = getComputedStyle(element, pseudo);
        if (pseudo ? !pseudoVisible(element, style) : !visible(element)) {
            return false;
        }
        return (
            CAPTURE_GENERATED_IMAGE_PATTERN.test(style.content) ||
            CAPTURE_IMAGE_STYLE_PROPERTIES.some((property) =>
                CAPTURE_GENERATED_IMAGE_PATTERN.test(style.getPropertyValue(property)),
            )
        );
    });
}

function verify(policy: PreparedScreenshotCapturePolicy, roots: ParentNode[], elements: Element[]) {
    const sources = (policy.redaction?.replacements ?? []).map((entry) => entry.from);
    const containsSource = (value: string) => sources.some((source) => value.includes(source));
    const normalizedSources = sources.map(normalizedVisibleText);
    const compactedSources = normalizedSources
        .map((source) => source.replace(CAPTURE_WHITESPACE_PATTERN, ''))
        .filter(Boolean);
    for (const root of roots) {
        const composed = normalizedVisibleText(
            composedVisibleText(root instanceof Document ? root.body : root),
        );
        const compacted = composed.replace(CAPTURE_WHITESPACE_PATTERN, '');
        if (
            normalizedSources.some((source) => composed.includes(source)) ||
            compactedSources.some((source) => compacted.includes(source))
        ) {
            throw new Error(SCREENSHOT_PRIVACY_FAILED);
        }
        textElements(root, (node, parent) => {
            if (parent && visible(parent) && containsSource(node.nodeValue ?? '')) {
                throw new Error(SCREENSHOT_PRIVACY_FAILED);
            }
        });
    }
    for (const element of elements) {
        if (!subtreeRenderable(element)) {
            continue;
        }
        if (
            (visible(element) && element.matches(CAPTURE_UNSUPPORTED_SURFACES)) ||
            hasGeneratedImage(element) ||
            element.getAnimations().some((animation) => animation.playState === 'running')
        ) {
            throw new Error(SCREENSHOT_UNSUPPORTED_SURFACE);
        }
        if (
            CAPTURE_REDACTION_ATTRIBUTES.some((attribute) =>
                containsSource(element.getAttribute(attribute) ?? ''),
            ) ||
            containsSource(nativeValue(element) ?? '') ||
            CAPTURE_PSEUDO_ELEMENTS.some((pseudo) =>
                containsSource(getComputedStyle(element, pseudo).content),
            )
        ) {
            throw new Error(SCREENSHOT_PRIVACY_FAILED);
        }
    }
}

export default function prepareScreenshotPrivacy(input: Input): void {
    const view = window as CaptureWindow;
    const states = (view.__docsCapturePrivacy ??= new Map<string, CapturePrivacyState>());
    const previous = states.get(input.token);
    if (input.phase === 'cleanup') {
        previous?.observers.forEach((observer) => observer.disconnect());
        states.delete(input.token);
        return;
    }
    if (input.phase === 'verify') {
        const observed = collect();
        if (
            !previous ||
            previous.changed ||
            observed.roots.length !== previous.roots.length ||
            observed.roots.some((root, index) => root !== previous.roots[index])
        ) {
            throw new Error(SCREENSHOT_PAGE_CHANGED);
        }
        verify(input.policy, observed.roots, observed.elements);
        return;
    }
    if (previous) {
        throw new Error(SCREENSHOT_PRIVACY_FAILED);
    }
    const observed = sanitize(input.policy);
    verify(input.policy, observed.roots, observed.elements);
    const state: CapturePrivacyState = {roots: observed.roots, observers: [], changed: false};
    for (const root of observed.roots) {
        const observer = new MutationObserver(() => {
            state.changed = true;
        });
        observer.observe(root, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
        });
        state.observers.push(observer);
    }
    states.set(input.token, state);
}
