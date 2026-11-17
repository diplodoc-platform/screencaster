import type {Cookie} from 'playwright';

import {domScript} from './dom-script.js';
export const INJECT_CURSOR_JS = domScript('inject-cursor');
export const IS_LABEL_NOT_INPUT_JS = domScript('resolve-input-label');
export const INPUT_PREFLIGHT_JS = domScript('check-input-target');
export const FORM_FILL_PREFLIGHT_JS = domScript('check-form-target');
export const EDITABLE_TEXT_MATCHES_JS = domScript('editable-text-matches');
export const EDITABLE_SELECTION_STATE_JS = domScript('read-editable-selection');
export const PASTE_EDITOR_TEXT_JS = domScript('paste-editor-text');
export const INJECT_COOKIES_JS = (cookies: Partial<Cookie>[]) =>
    domScript('inject-cookies', cookies);
