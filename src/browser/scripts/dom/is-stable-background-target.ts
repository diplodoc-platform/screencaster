export default function isStableBackgroundTarget(el: SVGElement | HTMLElement, expected: Element) {
    return (
        el === expected &&
        el.isConnected &&
        el.ownerDocument.defaultView === el.ownerDocument.defaultView?.top &&
        el.getRootNode() === el.ownerDocument
    );
}
