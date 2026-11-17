import {CURSOR_STYLE} from '../assets.js';
export default function injectCursor() {
    if (document.getElementById('__pw_cursor')) {
        return;
    }
    const cursor = document.createElement('div');
    cursor.id = '__pw_cursor';
    cursor.style.cssText = CURSOR_STYLE;
    document.body.appendChild(cursor);
    document.addEventListener(
        'mousemove',
        (e) => {
            cursor.style.left = e.clientX + 'px';
            cursor.style.top = e.clientY + 'px';
        },
        true,
    );
}
