export default (el: SVGElement | HTMLElement) => ({
    editable:
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        (el as HTMLElement).isContentEditable,
    richText: (el as HTMLElement).isContentEditable,
    codeEditor: el.tagName === 'TEXTAREA' && Boolean(el.closest('.monaco-editor')),
});
