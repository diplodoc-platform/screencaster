import fs from 'node:fs';
import {z} from 'zod';

import {
    type RequestGuardOptions,
    canonicalDeniedHost,
    canonicalNavigationUrl,
    exactOrigin,
    isDeniedHost,
    postReadSchema,
    requestGuardOptionsSchema,
} from './network-guard-options.js';
import {
    MAX_CAPTURE_DENIED_HOSTS,
    MAX_CAPTURE_NAVIGATION_URLS,
    MAX_CAPTURE_NETWORK_ORIGINS,
    MAX_CAPTURE_POLICY_PATH_CHARS,
    MAX_CAPTURE_POLICY_REF_CHARS,
    MAX_CAPTURE_POLICY_URL_CHARS,
    MAX_CAPTURE_READ_ACTIONS,
    MAX_CAPTURE_READ_ENDPOINTS,
} from './policy-config.js';
import {ARIA_REF_VALUE_PATTERN} from './patterns.js';
import {
    CAPTURE_POLICY_REFUSED_NAVIGATION,
    CAPTURE_POLICY_REFUSED_TOOL,
    INVALID_CAPTURE_POLICY,
} from './policy-messages.js';
import {
    BROWSER_POLICY_PATH_REQUIRES_AN_EXACT_NORMALIZED_PATH,
    POST_READ_ORIGIN_MUST_BE_ALLOWED_BY_NETWORK_ALLOWED_ORIGINS,
    POST_READ_REQUIRES_AN_EXACT_NORMALIZED_PATH_WITHOUT,
} from './messages.js';

const actionSchema = z.enum(['read', 'act', 'evaluate']);
type Action = z.infer<typeof actionSchema>;

const ruleSchema = z
    .object({
        origin: z.string(),
        pathPrefix: z.string().optional(),
        path: z.string().optional(),
        actions: z.array(actionSchema).nonempty(),
    })
    .strict();

const captureActionLocation = {
    origin: z.string().max(MAX_CAPTURE_POLICY_URL_CHARS),
    path: z.string().startsWith('/').max(MAX_CAPTURE_POLICY_PATH_CHARS),
};
const captureActionSchema = z.discriminatedUnion('tool', [
    z
        .object({
            ...captureActionLocation,
            tool: z.enum(['browser_click', 'browser_hover', 'browser_scroll_to']),
            ref: z.string().max(MAX_CAPTURE_POLICY_REF_CHARS).regex(ARIA_REF_VALUE_PATTERN),
        })
        .strict(),
    z
        .object({
            ...captureActionLocation,
            tool: z.literal('browser_press_key'),
            key: z.literal('Escape'),
        })
        .strict(),
]);
const capturePolicyOptionsSchema = z
    .object({
        postReads: z.array(postReadSchema).max(MAX_CAPTURE_READ_ENDPOINTS).optional(),
        deniedHosts: z.array(z.string()).max(MAX_CAPTURE_DENIED_HOSTS).optional(),
        navigationUrls: z
            .array(z.string().max(MAX_CAPTURE_POLICY_URL_CHARS))
            .min(1)
            .max(MAX_CAPTURE_NAVIGATION_URLS)
            .optional(),
        networkAllowedOrigins: z
            .array(z.string())
            .nonempty()
            .max(MAX_CAPTURE_NETWORK_ORIGINS)
            .optional(),
        readOnlyActions: z.array(captureActionSchema).max(MAX_CAPTURE_READ_ACTIONS).optional(),
    })
    .strict();
export type BrowserToolPermission = {allowed: boolean; arguments?: Record<string, unknown>[]};
export type CapturePolicyOptions = z.input<typeof capturePolicyOptionsSchema>;

export const browserPolicySchema = z
    .object({
        rules: z.array(ruleSchema).nonempty(),
        networkAllowedOrigins: z.array(z.string()).nonempty().optional(),
        // POST reads are explicit RPC endpoints reviewed by the caller. No
        // heuristic such as "all operations whose names start with get".
        capture: capturePolicyOptionsSchema.optional(),
        readOnlyNetwork: z
            .object({postReads: z.array(postReadSchema)})
            .strict()
            .optional(),
    })
    .strict();

const policySchema = browserPolicySchema;

type Rule = z.infer<typeof ruleSchema>;

const TOOL_ACTIONS: Record<string, Action> = {
    browser_snapshot: 'read',
    browser_verify_inputs: 'read',
    browser_take_screenshot: 'read',
    browser_wait_for: 'read',
    browser_navigate: 'read',
    browser_click: 'act',
    browser_type: 'act',
    browser_fill_form: 'act',
    browser_select_option: 'act',
    browser_press_key: 'act',
    browser_handle_dialog: 'act',
    browser_hover: 'act',
    browser_scroll_to: 'act',
    browser_upload_example_file: 'act',
    browser_fill_generated_password: 'act',
    browser_evaluate: 'evaluate',
};

function parseOrigin(value: string): string {
    const url = new URL(value);
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        value !== url.origin
    ) {
        throw new Error(`Browser policy requires an exact HTTP(S) origin: ${value}`);
    }
    return url.origin;
}

function pathMatches(pathname: string, prefix?: string): boolean {
    if (!prefix) {
        return true;
    }
    return pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

type CaptureOptions = z.infer<typeof capturePolicyOptionsSchema>;
type CaptureAction = z.infer<typeof captureActionSchema>;
type ReadOnlyNetwork = z.infer<typeof policySchema>['readOnlyNetwork'];

function validateRule(rule: Rule) {
    parseOrigin(rule.origin);
    if (rule.path !== undefined) {
        const url = new URL(rule.path, rule.origin);
        if (
            rule.pathPrefix !== undefined ||
            !rule.path.startsWith('/') ||
            url.origin !== rule.origin ||
            url.pathname !== rule.path ||
            url.search ||
            url.hash
        ) {
            throw new Error(BROWSER_POLICY_PATH_REQUIRES_AN_EXACT_NORMALIZED_PATH);
        }
    }
    if (rule.pathPrefix && !rule.pathPrefix.startsWith('/')) {
        throw new Error(INVALID_CAPTURE_POLICY);
    }
}

function validatePostRead(
    endpoint: {origin: string; path: string},
    allowedOrigins?: string[],
    deniedHosts: string[] = [],
) {
    parseOrigin(endpoint.origin);
    if (allowedOrigins && !allowedOrigins.includes(endpoint.origin)) {
        throw new Error(POST_READ_ORIGIN_MUST_BE_ALLOWED_BY_NETWORK_ALLOWED_ORIGINS);
    }
    const url = new URL(endpoint.path, endpoint.origin);
    if (
        url.origin !== endpoint.origin ||
        url.pathname !== endpoint.path ||
        url.search ||
        url.hash ||
        isDeniedHost(url.href, deniedHosts)
    ) {
        throw new Error(POST_READ_REQUIRES_AN_EXACT_NORMALIZED_PATH_WITHOUT);
    }
}

function captureGuard(options: CaptureOptions, allowedOrigins?: string[]): RequestGuardOptions {
    return requestGuardOptionsSchema.parse({
        postReads: options.postReads ?? [],
        allowedOrigins,
        deniedHosts: (options.deniedHosts ?? []).map(canonicalDeniedHost),
        allowedNavigationUrls: (options.navigationUrls ?? []).map(canonicalNavigationUrl),
        blockPopups: true,
        blockDownloads: true,
        blockRedirects: true,
        strictViolations: true,
    });
}

function validateCaptureRules(rules: Rule[], actions: CaptureAction[]) {
    if (rules.some((rule) => rule.actions.some((action) => action !== 'read'))) {
        throw new Error(INVALID_CAPTURE_POLICY);
    }
    for (const action of actions) {
        exactOrigin(action.origin);
        const url = new URL(action.path, action.origin);
        if (
            url.origin !== action.origin ||
            url.pathname !== action.path ||
            url.search ||
            url.hash ||
            !rules.some(
                (rule) =>
                    rule.origin === action.origin &&
                    (rule.path === undefined
                        ? pathMatches(action.path, rule.pathPrefix)
                        : rule.path === action.path),
            )
        ) {
            throw new Error(INVALID_CAPTURE_POLICY);
        }
    }
}

function captureActionArguments(action: CaptureAction): Record<string, unknown> {
    return 'ref' in action ? {ref: action.ref} : {key: action.key};
}

function matchesCaptureArguments(action: CaptureAction, args: Record<string, unknown>) {
    if ('ref' in action) {
        const allowedKeys = action.tool === 'browser_scroll_to' ? ['ref'] : ['ref', 'element'];
        return (
            args.ref === action.ref && Object.keys(args).every((key) => allowedKeys.includes(key))
        );
    }
    return args.key === action.key && Object.keys(args).every((key) => key === 'key');
}

export class BrowserPolicy {
    readonly networkAllowedOrigins: string[] | undefined;
    readonly readOnlyNetwork: ReadOnlyNetwork;
    readonly guardOptions: RequestGuardOptions | undefined;
    private readonly captureActions: z.infer<typeof captureActionSchema>[] | undefined;
    private readonly rules: Rule[];

    constructor(
        rules: Rule[],
        networkAllowedOrigins?: string[],
        readOnlyNetwork?: z.infer<typeof policySchema>['readOnlyNetwork'],
        capture?: CapturePolicyOptions,
    ) {
        rules.forEach(validateRule);
        this.rules = structuredClone(rules);
        this.networkAllowedOrigins = networkAllowedOrigins?.map(parseOrigin);
        const captureOptions = capture ? capturePolicyOptionsSchema.parse(capture) : undefined;
        this.captureActions = captureOptions
            ? structuredClone(captureOptions.readOnlyActions ?? [])
            : undefined;
        if (captureOptions) {
            if (readOnlyNetwork) {
                throw new Error(INVALID_CAPTURE_POLICY);
            }
            validateCaptureRules(rules, this.captureActions ?? []);
            this.guardOptions = captureGuard(captureOptions, this.networkAllowedOrigins);
            this.readOnlyNetwork = {postReads: structuredClone(this.guardOptions.postReads)};
        } else {
            this.readOnlyNetwork = readOnlyNetwork && structuredClone(readOnlyNetwork);
            this.guardOptions = this.readOnlyNetwork
                ? {postReads: structuredClone(this.readOnlyNetwork.postReads)}
                : undefined;
        }
        for (const endpoint of this.guardOptions?.postReads ?? []) {
            validatePostRead(endpoint, this.networkAllowedOrigins, this.guardOptions?.deniedHosts);
        }
        for (const url of this.guardOptions?.allowedNavigationUrls ?? []) {
            if (
                !this.allows(url, 'read') ||
                (this.guardOptions?.allowedOrigins &&
                    !this.guardOptions.allowedOrigins.includes(new URL(url).origin))
            ) {
                throw new Error(INVALID_CAPTURE_POLICY);
            }
        }
    }

    allows(url: string, action: Action): boolean {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return false;
        }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
            return false;
        }
        if (
            this.captureActions &&
            action === 'read' &&
            this.guardOptions?.allowedNavigationUrls &&
            !this.guardOptions.allowedNavigationUrls.includes(canonicalNavigationUrl(url))
        ) {
            return false;
        }
        if (isDeniedHost(url, this.guardOptions?.deniedHosts ?? [])) {
            return false;
        }
        return this.rules.some(
            (rule) =>
                rule.origin === parsed.origin &&
                (rule.path === undefined
                    ? pathMatches(parsed.pathname, rule.pathPrefix)
                    : parsed.pathname === rule.path) &&
                rule.actions.includes(action),
        );
    }

    assertUrl(url: string, action: Action): void {
        if (!this.allows(url, action)) {
            let location = '[invalid URL]';
            try {
                const parsed = new URL(url);
                location = `${parsed.origin}${parsed.pathname}`;
            } catch {
                // Do not include an unparsed URL in logs or model output.
            }
            throw new Error(`Browser policy denies ${action} on ${location}`);
        }
    }

    describeTool(name: string, currentUrl: string): BrowserToolPermission {
        const action = TOOL_ACTIONS[name];
        if (!action || !this.allows(currentUrl, 'read')) {
            return {allowed: false};
        }
        if (!this.captureActions) {
            return {allowed: this.allows(currentUrl, action)};
        }
        if (name === 'browser_navigate') {
            const combinations = (this.guardOptions?.allowedNavigationUrls ?? []).map((url) => ({
                url,
            }));
            return {allowed: combinations.length > 0, arguments: combinations};
        }
        if (action === 'read') {
            return {allowed: true};
        }
        const url = new URL(currentUrl);
        const combinations = this.captureActions
            .filter(
                (entry) =>
                    entry.tool === name &&
                    entry.origin === url.origin &&
                    entry.path === url.pathname,
            )
            .map(captureActionArguments);
        return {allowed: combinations.length > 0, arguments: combinations};
    }

    assertTool(name: string, args: Record<string, unknown>, currentUrl?: string): void {
        const action = TOOL_ACTIONS[name];
        if (!action) {
            throw new Error(`Browser tool is not allowed: ${name}`);
        }
        const url = name === 'browser_navigate' ? args.url : currentUrl;
        if (typeof url !== 'string') {
            throw new Error(`Browser policy cannot determine URL for ${name}`);
        }
        if (this.captureActions) {
            this.assertUrl(url, 'read');
            if (
                name === 'browser_navigate' &&
                !this.guardOptions?.allowedNavigationUrls?.includes(canonicalNavigationUrl(url))
            ) {
                throw new Error(CAPTURE_POLICY_REFUSED_NAVIGATION);
            }
            if (action !== 'read') {
                const parsed = new URL(url);
                const permitted = this.captureActions.some(
                    (entry) =>
                        entry.tool === name &&
                        entry.origin === parsed.origin &&
                        entry.path === parsed.pathname &&
                        matchesCaptureArguments(entry, args),
                );
                if (!permitted) {
                    throw new Error(CAPTURE_POLICY_REFUSED_TOOL);
                }
                return;
            }
        }
        this.assertUrl(url, action);
    }
}

export function createBrowserPolicy(targetUrl: string, configPath?: string): BrowserPolicy {
    const target = new URL(targetUrl);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
        throw new Error(`Invalid target URL: ${targetUrl}`);
    }

    if (configPath) {
        const config = policySchema.parse(JSON.parse(fs.readFileSync(configPath, 'utf8')));
        return new BrowserPolicy(
            config.rules,
            config.networkAllowedOrigins,
            config.readOnlyNetwork,
            config.capture,
        );
    }

    return new BrowserPolicy([{origin: target.origin, actions: ['read', 'act']}]);
}

// Opt in explicitly; the existing default BrowserPolicy remains source-compatible.
export function createCapturePolicy(
    targetUrl: string,
    options: CapturePolicyOptions = {},
): BrowserPolicy {
    const target = new URL(canonicalNavigationUrl(targetUrl));
    const parsed = capturePolicyOptionsSchema.parse(options);
    const navigationUrls = parsed.navigationUrls ?? [target.href];
    const origins = [
        ...new Set([
            target.origin,
            ...navigationUrls.map((url) => new URL(canonicalNavigationUrl(url)).origin),
        ]),
    ];
    return new BrowserPolicy(
        origins.map((origin) => ({origin, actions: ['read']})),
        (parsed.networkAllowedOrigins ?? origins).map(exactOrigin),
        undefined,
        {...parsed, navigationUrls},
    );
}
