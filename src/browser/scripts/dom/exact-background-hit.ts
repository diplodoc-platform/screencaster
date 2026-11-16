export default function exactBackgroundHit(this: Element, x: number, y: number): boolean {
    return (
        this.isConnected &&
        this.ownerDocument.defaultView === this.ownerDocument.defaultView?.top &&
        this === this.ownerDocument.elementFromPoint(x, y)
    );
}
