import type {IllustrationAnalysis, IllustrationArtifact} from './contracts.js';

import {
    GENERIC_PUBLICATION_LIMITATION,
    MISSING_ASSET_DIRECTORY_LIMITATION,
    MIXED_DPR_LIMITATION,
    UNKNOWN_DPR_LIMITATION,
} from './messages.js';
import {MARKDOWN_ALT_PATTERN, WHITESPACE_PATTERN} from './patterns.js';

export function publicationLimitations(analysis: IllustrationAnalysis): string[] {
    const limitations: string[] = [];
    if (analysis.inputs.some((input) => input.dpr === undefined)) {
        limitations.push(UNKNOWN_DPR_LIMITATION);
    }
    if (
        ['before-after', 'variants', 'sequence'].includes(analysis.result) &&
        new Set(analysis.inputs.map((input) => input.dpr)).size > 1
    ) {
        limitations.push(MIXED_DPR_LIMITATION);
    }
    if (analysis.publication.format === 'generic') {
        limitations.push(GENERIC_PUBLICATION_LIMITATION);
    } else if (!analysis.publication.assetDirectory) {
        limitations.push(MISSING_ASSET_DIRECTORY_LIMITATION);
    }
    return limitations;
}

export function yfmPublication(
    analysis: IllustrationAnalysis,
    artifacts: IllustrationArtifact[],
): string | undefined {
    if (analysis.publication.format !== 'yfm') {
        return undefined;
    }
    const alt = analysis.purpose
        .replace(WHITESPACE_PATTERN, ' ')
        .replace(MARKDOWN_ALT_PATTERN, '\\$&');
    const classSuffix = analysis.publication.cssClass ? `{.${analysis.publication.cssClass}}` : '';
    const prefix = analysis.publication.assetDirectory
        ? `${analysis.publication.assetDirectory}/`
        : '';
    return (
        artifacts
            .filter((artifact) => artifact.kind === 'panel' || artifact.kind === 'collage')
            .map((artifact) => {
                const width = Math.min(
                    artifact.safeCssWidth ?? artifact.width ?? 1,
                    analysis.publication.width ?? Infinity,
                );
                return `![${alt}](${prefix}${artifact.path} =${width}x)${classSuffix}`;
            })
            .join('\n\n') + '\n'
    );
}
