export default (function codeEditorOwnsTextReceiver(el: Element, hit: Element): boolean {
    const editor = el.tagName === 'TEXTAREA' ? el.closest('.monaco-editor') : null;
    return Boolean(editor && editor.contains(hit));
});
