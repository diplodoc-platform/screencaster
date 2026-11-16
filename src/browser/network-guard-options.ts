import {z} from 'zod';

import {INVALID_CAPTURE_POLICY} from './policy-messages.js';

export const postReadSchema = z
    .object({origin: z.string(), path: z.string().startsWith('/')})
    .strict();
export const requestGuardOptionsSchema = z
    .object({
        postReads: z.array(postReadSchema),
        allowedOrigins: z.array(z.string()).optional(),
        deniedHosts: z.array(z.string()).optional(),
        allowedNavigationUrls: z.array(z.string()).optional(),
        blockPopups: z.boolean().optional(),
        blockDownloads: z.boolean().optional(),
        blockRedirects: z.boolean().optional(),
        strictViolations: z.boolean().optional(),
    })
    .strict();
export type RequestGuardOptions = z.infer<typeof requestGuardOptionsSchema>;

export function exactOrigin(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(INVALID_CAPTURE_POLICY);
    }
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.origin !== value ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
    ) {
        throw new Error(INVALID_CAPTURE_POLICY);
    }
    return url.origin;
}

export function canonicalNavigationUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(INVALID_CAPTURE_POLICY);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error(INVALID_CAPTURE_POLICY);
    }
    url.hash = '';
    return url.href;
}

export function canonicalDeniedHost(value: string): string {
    let url: URL;
    try {
        url = new URL(`https://${value}`);
    } catch {
        throw new Error(INVALID_CAPTURE_POLICY);
    }
    if (
        !value ||
        url.hostname !== value ||
        url.host !== value ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        value.endsWith('.')
    ) {
        throw new Error(INVALID_CAPTURE_POLICY);
    }
    return value;
}

export function isDeniedHost(url: string, deniedHosts: readonly string[]): boolean {
    try {
        const parsed = new URL(url);
        const lower = parsed.hostname.toLowerCase();
        const host = lower.endsWith('.') ? lower.slice(0, -1) : lower;
        return deniedHosts.some((denied) => host === denied || host.endsWith(`.${denied}`));
    } catch {
        return true;
    }
}
