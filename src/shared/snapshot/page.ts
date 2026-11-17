import {ACTIVE_PAGE_METADATA_IS_UNAVAILABLE_OR_AMBIGUOUS} from '../messages.js';
import {
    CRLF_PATTERN,
    CURRENT_TAB_PATTERN,
    OPEN_TABS_SECTION_PATTERN,
    PAGE_HEADER_END_PATTERN,
    PAGE_SECTION_PATTERN,
    REPORTED_PAGE_URL_PATTERN,
} from '../patterns.js';

export type SnapshotPage = {url: string; index?: number; corrected: boolean};

// MCP captures AX from currentTab(), but some versions render Page from tabs()[0].
// Only protocol headers before the AX body can supply active-page metadata.
export function snapshotPage(raw: string): {snapshot: string; page: SnapshotPage} {
    const text = raw.replace(CRLF_PATTERN, '\n');
    const header = text.split(PAGE_HEADER_END_PATTERN, 1)[0];
    const pageHeader = PAGE_SECTION_PATTERN.exec(header);
    const reportedUrl = REPORTED_PAGE_URL_PATTERN.exec(header)?.[1] ?? '';
    const tabs = OPEN_TABS_SECTION_PATTERN.exec(header)?.[1];
    if (tabs === undefined) {
        return {snapshot: text, page: {url: reportedUrl, corrected: false}};
    }
    const current = [...tabs.matchAll(CURRENT_TAB_PATTERN)];
    if (current.length !== 1 || !pageHeader) {
        throw new Error(ACTIVE_PAGE_METADATA_IS_UNAVAILABLE_OR_AMBIGUOUS);
    }
    const [, index, title, url] = current[0];
    const corrected = url !== reportedUrl;
    return {
        snapshot: text.replace(
            pageHeader[0],
            `### Page\n- Page URL: ${url}\n- Page Title: ${title}\n`,
        ),
        page: {url, index: Number(index), corrected},
    };
}
