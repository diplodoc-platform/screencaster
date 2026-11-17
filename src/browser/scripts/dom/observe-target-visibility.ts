import type {Input as RevealTargetInput} from '../driver/reveal-target.js';

import {MAX_GEOMETRY_MAGNITUDE, VISIBILITY_SAMPLE_FRACTIONS} from '../config.js';

import observe from './inspect-element.js';
import coveringLabels from './covering-branch-labels.js';
export default function observeTargetVisibility(
    el: SVGElement | HTMLElement,
    scriptArguments: {value: number; input: RevealTargetInput},
) {
    return new Promise<
        true | {visible: boolean; reason?: string; observations?: Record<string, unknown>}
    >((resolve) => {
        const {value: count, input} = scriptArguments;
        const interactive =
            'a[href], button, input, textarea, select, label, summary, ' +
            '[contenteditable], [tabindex], ' +
            '[role]:not([role="none"]):not([role="presentation"]):not([role="img"])';

        const allowedLabels = input.allowedBlockerLabels;
        let observedEntry: IntersectionObserverEntry | undefined;
        const failure = (reason: string, flags = {}) => {
            let observations = {
                targetCount: Math.min(MAX_GEOMETRY_MAGNITUDE, count),
                connected: el.isConnected,
            };
            try {
                observations = {...observations, ...observe(el, observedEntry, interactive)};
            } catch {
                // Optional measurements cannot replace the original predicate.
            }
            return {visible: false, reason, observations: {...observations, ...flags}};
        };
        const view = el.ownerDocument.defaultView;
        // A local-frame hit cannot establish visibility through its ancestors.
        if (!view || view !== view.top) {
            resolve(failure('frame-boundary'));
            return;
        }
        // Styled native checkboxes/radios can expose their state through
        // an associated label while a decorative sibling receives hits.
        // Only that input's own non-interactive label content qualifies.
        const labels =
            el.tagName === 'INPUT' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type)
                ? Array.from((el as HTMLInputElement).labels || []).filter(
                      (label) => label.control === el,
                  )
                : [];
        const associatedDecoration = (hit: Element) =>
            labels.some(
                (label) =>
                    (hit === label || label.contains(hit)) &&
                    !hit.closest(
                        'a[href], button, input, textarea, select, [contenteditable="true"], ' +
                            '[tabindex]:not([tabindex="-1"]), ' +
                            '[role]:not([role="none"]):not([role="presentation"]):not([role="img"])',
                    ),
            );
        const observer = new IntersectionObserver(([entry]) => {
            observer.disconnect();
            observedEntry = entry;
            const rect = entry.intersectionRect;
            if (!el.isConnected || rect.width <= 0 || rect.height <= 0) {
                resolve(failure(el.isConnected ? 'empty-intersection' : 'disconnected'));
                return;
            }
            const points = VISIBILITY_SAMPLE_FRACTIONS;
            let clientRects = Array.from(el.getClientRects());
            let textRectsCount;
            let glyphsContained;
            let usedTextRects = false;
            // A static text leaf can have padding/line-height whitespace
            // underneath a neighbouring control. Sample its text runs;
            // interactive targets still require their full layout box.
            const interactiveAncestor = el.closest(interactive);
            const rangeEligible =
                el.childElementCount === 0 &&
                Boolean(el.textContent?.trim()) &&
                !(el as HTMLElement).isContentEditable &&
                !interactiveAncestor;
            if (rangeEligible) {
                const range = el.ownerDocument.createRange();
                range.selectNodeContents(el);
                const textRects = Array.from(range.getClientRects()).filter(
                    (fragment) => fragment.width > 0 && fragment.height > 0,
                );
                textRectsCount = Math.min(MAX_GEOMETRY_MAGNITUDE, textRects.length);
                const box = el.getBoundingClientRect();
                // Overflowing text must retain the existing clipping and
                // oversized-element rules instead of bypassing them.
                const textContained =
                    box.left >= rect.left - 1 &&
                    box.right <= rect.right + 1 &&
                    box.top >= rect.top - 1 &&
                    box.bottom <= rect.bottom + 1 &&
                    textRects.length > 0 &&
                    textRects.every(
                        (fragment) =>
                            fragment.left >= box.left - 1 &&
                            fragment.right <= box.right + 1 &&
                            fragment.top >= box.top - 1 &&
                            fragment.bottom <= box.bottom + 1,
                    );
                glyphsContained = textContained;
                if (textContained) {
                    clientRects = textRects;
                    usedTextRects = true;
                }
            }
            const fragments = clientRects
                .map((fragment) => ({
                    left: Math.max(fragment.left, rect.left),
                    top: Math.max(fragment.top, rect.top),
                    right: Math.min(fragment.right, rect.right),
                    bottom: Math.min(fragment.bottom, rect.bottom),
                }))
                .filter(
                    (fragment) => fragment.right > fragment.left && fragment.bottom > fragment.top,
                );
            let blockerLabels: string[] = [];
            const hits = {
                sampleCount: 0,
                targetHits: 0,
                descendantHits: 0,
                ancestorHits: 0,
                associatedHits: 0,
                otherHits: 0,
                nullHits: 0,
            };
            const countHit = (key: keyof typeof hits) => {
                hits.sampleCount = Math.min(MAX_GEOMETRY_MAGNITUDE, hits.sampleCount + 1);
                hits[key] = Math.min(MAX_GEOMETRY_MAGNITUDE, hits[key] + 1);
            };
            const visible =
                fragments.length > 0 &&
                fragments.every((fragment) =>
                    points.every(([x, y]) => {
                        const hit = el.ownerDocument.elementFromPoint(
                            fragment.left + (fragment.right - fragment.left) * x,
                            fragment.top + (fragment.bottom - fragment.top) * y,
                        );
                        // Non-interactive text may inherit pointer-events:none;
                        // its actual ancestor can receive the hit instead.
                        // An unrelated sibling overlay is never accepted.
                        if (hit === null) {
                            countHit('nullHits');
                            return false;
                        }
                        if (hit === el) {
                            countHit('targetHits');
                            return true;
                        }
                        if (el.contains(hit)) {
                            countHit('descendantHits');
                            return true;
                        }
                        if (
                            view.getComputedStyle(el).pointerEvents === 'none' &&
                            hit.contains(el)
                        ) {
                            countHit('ancestorHits');
                            return true;
                        }
                        if (associatedDecoration(hit)) {
                            countHit('associatedHits');
                            return true;
                        }
                        countHit(hit.contains(el) ? 'ancestorHits' : 'otherHits');
                        try {
                            blockerLabels = coveringLabels(el, hit, allowedLabels);
                        } catch {
                            // Optional context cannot change a geometric rejection.
                        }
                        return false;
                    }),
                );
            resolve(
                visible
                    ? true
                    : failure(fragments.length ? 'occluded' : 'empty-intersection', {
                          rangeEligible,
                          textRectsCount,
                          glyphsContained,
                          usedTextRects,
                          fragmentCount: Math.min(MAX_GEOMETRY_MAGNITUDE, fragments.length),
                          ...hits,
                          ...(blockerLabels.length ? {blockerLabels} : {}),
                      }),
            );
        });
        observer.observe(el);
    });
}
