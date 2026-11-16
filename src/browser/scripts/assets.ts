export const CURSOR_STYLE = [
    'width: 20px',
    'height: 20px',
    'position: fixed',
    'top: -100px',
    'left: -100px',
    'z-index: 2147483647',
    'pointer-events: none',
    'background: url("data:image/svg+xml,' +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M4 0L4 16L8.8 11.2L12.8 19.2L15.2 18L11.2 10L17.6 10Z" fill="black" stroke="white" stroke-width="1"/></svg>',
        ) +
        '") no-repeat',
].join(';');
