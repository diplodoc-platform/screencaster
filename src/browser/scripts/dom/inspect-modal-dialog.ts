export default function inspectModalDialog(el: SVGElement | HTMLElement) {
    return {
        connected: el.isConnected,
        modal: el.getAttribute('aria-modal') === 'true' || el.matches(':modal'),
    };
}
