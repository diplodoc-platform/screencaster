export default function findEditableHost(el: SVGElement | HTMLElement) {
    let host = el;
    while (host.parentElement?.isContentEditable) {
        host = host.parentElement;
    }
    return host;
}
