import type {EvidenceFailureReason} from '../evidence-diagnostics.js';

import {MAX_LABEL_CHARS, MAX_SAFE_ERROR_CHARS} from '../config.js';
import {EVIDENCE_FAILURE_EXPLANATIONS as explanations} from '../messages.js';
import {sanitizeForModel} from '../../shared/sanitize-for-model.js';

/** A completed reveal check could not establish the scroll target's visibility. */
export class EvidenceUnavailableError extends Error {
    readonly reason: keyof typeof explanations;

    readonly blockerLabels: string[];

    constructor(
        reason: EvidenceFailureReason = 'predicate-false',
        blockerLabels: readonly string[] = [],
    ) {
        const safeReason = Object.prototype.hasOwnProperty.call(explanations, reason)
            ? (reason as keyof typeof explanations)
            : 'predicate-false';
        const base = `Scroll target visibility could not be established (${safeReason}). ${explanations[safeReason]}`;
        const labels: string[] = [];
        const message = (values: string[]) =>
            base +
            (values.length
                ? ` Observed labels in the covering branch: ${JSON.stringify(values)}. Context only; not visibility proof or identification of a close control.`
                : '');
        if (safeReason === 'occluded') {
            for (const value of blockerLabels.slice(0, 4)) {
                const label = sanitizeForModel(value);
                if (label.length > MAX_LABEL_CHARS || labels.includes(label)) {
                    continue;
                }
                // The existing runner keeps 1000 characters of String(error).
                // Omit whole labels instead of cutting JSON or raising that limit.
                if (
                    `EvidenceUnavailableError: ${message([...labels, label])}`.length <=
                    MAX_SAFE_ERROR_CHARS
                ) {
                    labels.push(label);
                }
            }
        }
        super(message(labels));
        this.blockerLabels = labels;
        this.name = 'EvidenceUnavailableError';
        this.reason = safeReason;
    }
}
