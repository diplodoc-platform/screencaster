import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {z} from 'zod';

import {INSTRUCTION_FETCH_TIMEOUT_MS, MARKDOWN_ACCEPT_HEADER, MAX_SOURCE_BYTES} from './config.js';
import {
    EXPECTED_A_BOUNDED_MARKDOWN_FILE,
    INSTRUCTION_EXCEEDS_THE_SOURCE_SIZE_LIMIT,
    INSTRUCTION_LOADER_FAILED_CHECK_THE_CONFIGURED_SOURCE_PROVIDER,
    LOADER_MUST_RETURN_BOUNDED_MARKDOWN_TEXT,
    MARKDOWN_SOURCES_REQUIRE_AN_HTTP_S_URL_WITHOUT,
    SPECIFY_EXACTLY_ONE_INSTRUCTION_TEXT_FILE_OR_URL,
    THE_URL_RETURNED_HTML_CONFIGURE_A_CUSTOM_MARKDOWN,
} from './messages.js';
import {HTML_DOCUMENT_PATTERN, SHA256_DIGEST_PATTERN as SOURCE_PATTERN} from './patterns.js';

export type InstructionInput = {text: string} | {file: string} | {url: string};
export type LoadedMarkdown = {markdown: string; url?: string; title?: string};
export type InstructionLoader = (input: {
    url: string;
    signal?: AbortSignal;
}) => Promise<LoadedMarkdown>;

export const instructionSourceSchema = z.object({
    markdown: z.string().refine((value) => value.trim().length > 0, 'Markdown must not be empty'),
    sha256: z.string().regex(SOURCE_PATTERN),
    requestedUrl: z.string().url().optional(),
    url: z.string().url().optional(),
    title: z.string().optional(),
});
export type InstructionSource = z.infer<typeof instructionSourceSchema>;

export const fetchMarkdown: InstructionLoader = async ({url, signal}) => {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error(MARKDOWN_SOURCES_REQUIRE_AN_HTTP_S_URL_WITHOUT);
    }
    const response = await fetch(url, {
        signal: AbortSignal.any([
            AbortSignal.timeout(INSTRUCTION_FETCH_TIMEOUT_MS),
            ...(signal ? [signal] : []),
        ]),
        headers: {Accept: MARKDOWN_ACCEPT_HEADER},
    });
    if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(`Markdown request failed (HTTP ${response.status})`);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        let next = await reader.read();
        while (!next.done) {
            size += next.value.byteLength;
            if (size > MAX_SOURCE_BYTES) {
                throw new Error(INSTRUCTION_EXCEEDS_THE_SOURCE_SIZE_LIMIT);
            }
            chunks.push(next.value);
            next = await reader.read();
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
    const markdown = Buffer.concat(chunks).toString('utf8');
    const type = response.headers.get('content-type')?.split(';')[0].trim();
    if (type === 'text/html' || HTML_DOCUMENT_PATTERN.test(markdown)) {
        throw new Error(THE_URL_RETURNED_HTML_CONFIGURE_A_CUSTOM_MARKDOWN);
    }
    return {markdown, url: response.url || url};
};

export async function loadInstruction(
    input: InstructionInput,
    options: {loader?: InstructionLoader; signal?: AbortSignal} = {},
): Promise<InstructionSource> {
    options.signal?.throwIfAborted();
    if (Object.keys(input).length !== 1) {
        throw new Error(SPECIFY_EXACTLY_ONE_INSTRUCTION_TEXT_FILE_OR_URL);
    }
    let result: LoadedMarkdown;
    if ('text' in input) {
        result = {markdown: input.text};
    } else if ('file' in input) {
        const stat = await fs.stat(input.file);
        if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) {
            throw new Error(EXPECTED_A_BOUNDED_MARKDOWN_FILE);
        }
        result = {
            markdown: await fs.readFile(input.file, {encoding: 'utf8', signal: options.signal}),
        };
    } else {
        const loader = options.loader;
        if (loader) {
            try {
                result = await loader({
                    url: input.url,
                    signal: options.signal,
                });
            } catch {
                options.signal?.throwIfAborted();
                throw new Error(INSTRUCTION_LOADER_FAILED_CHECK_THE_CONFIGURED_SOURCE_PROVIDER);
            }
        } else {
            result = await fetchMarkdown({url: input.url, signal: options.signal});
        }
    }
    options.signal?.throwIfAborted();
    if (
        typeof result.markdown !== 'string' ||
        Buffer.byteLength(result.markdown) > MAX_SOURCE_BYTES
    ) {
        throw new Error(LOADER_MUST_RETURN_BOUNDED_MARKDOWN_TEXT);
    }
    return instructionSourceSchema.parse({
        ...result,
        ...('url' in input ? {requestedUrl: input.url} : {}),
        sha256: createHash('sha256').update(result.markdown).digest('hex'),
    });
}
