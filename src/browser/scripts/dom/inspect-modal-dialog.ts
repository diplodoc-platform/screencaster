export default (el: SVGElement | HTMLElement) => ({
    connected: el.isConnected,
    modal: el.getAttribute('aria-modal') === 'true' || el.matches(':modal'),
});
