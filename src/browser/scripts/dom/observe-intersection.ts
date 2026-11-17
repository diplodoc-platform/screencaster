export default function observeIntersection(el: SVGElement | HTMLElement) {
    return new Promise((resolve) => {
        const observer = new IntersectionObserver(([entry]) => {
            observer.disconnect();
            resolve(
                entry.isIntersecting &&
                    entry.intersectionRect.width > 0 &&
                    entry.intersectionRect.height > 0,
            );
        });
        observer.observe(el);
    });
}
