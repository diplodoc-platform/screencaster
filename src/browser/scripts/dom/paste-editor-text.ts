export default function pasteEditorText(el: HTMLElement, text: string): boolean {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', text);
    return !el.dispatchEvent(
        new ClipboardEvent('paste', {
            clipboardData: clipboard,
            bubbles: true,
            cancelable: true,
        }),
    );
}
