import {
    AMPERSAND_PATTERN,
    DOUBLE_QUOTE_PATTERN,
    GREATER_THAN_PATTERN,
    LESS_THAN_PATTERN,
} from '../patterns.js';
const escapeHtml = (text: string) =>
    text
        .replace(AMPERSAND_PATTERN, '&amp;')
        .replace(LESS_THAN_PATTERN, '&lt;')
        .replace(GREATER_THAN_PATTERN, '&gt;')
        .replace(DOUBLE_QUOTE_PATTERN, '&quot;');
export function previewDocument(title: string, subtitle?: string): string {
    return `<!doctype html><meta charset="utf-8"><style>
            body { margin:0; background:#f4f5f7; color:#152036; font-family:system-ui,sans-serif; }
            main { padding:8%; } h1 { font-size:56px; overflow-wrap:anywhere; } p { font-size:28px; }
            </style><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle ?? '')}</p></main>`;
}
export function imagePreviewDocument(pngBase64: string): string {
    return (
        '<!doctype html><style>html,body{margin:0;overflow:hidden}img{display:block;width:100vw;height:100vh}</style>' +
        `<img src="data:image/png;base64,${pngBase64}">`
    );
}
