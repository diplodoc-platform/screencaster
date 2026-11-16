export default (el: SVGElement | HTMLElement, expected: Element) =>
    el === expected &&
    el.isConnected &&
    el.ownerDocument.defaultView === el.ownerDocument.defaultView?.top &&
    el.getRootNode() === el.ownerDocument;
