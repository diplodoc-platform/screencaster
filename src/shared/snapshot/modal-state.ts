import {
    CRLF_PATTERN,
    MODAL_STATE_SECTION_PATTERN,
    NATIVE_DIALOG_PATTERN,
    SNAPSHOT_SECTION_PATTERN,
} from '../patterns.js';
// Only MCP protocol metadata can identify a native dialog; AX page text cannot.

export function nativeDialogType(snapshot: string): string | undefined {
    const header = snapshot.replace(CRLF_PATTERN, '\n').split(SNAPSHOT_SECTION_PATTERN, 1)[0];
    const modal = header.match(MODAL_STATE_SECTION_PATTERN)?.[1];
    return modal?.match(NATIVE_DIALOG_PATTERN)?.[1];
}

export function hasNativeDialog(snapshot: string): boolean {
    return Boolean(nativeDialogType(snapshot));
}
