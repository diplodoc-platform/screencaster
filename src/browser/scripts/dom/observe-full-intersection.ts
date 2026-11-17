export default function observeFullIntersection(el: SVGElement | HTMLElement) {
    return new Promise((resolve) => {
        const observer = new IntersectionObserver(([entry]) => {
            observer.disconnect();
            const rect = entry.boundingClientRect;
            const intersection = entry.intersectionRect;
            resolve(
                el.isConnected &&
                    entry.isIntersecting &&
                    rect.width > 0 &&
                    rect.height > 0 &&
                    intersection.width > 0 &&
                    intersection.height > 0 &&
                    intersection.width >= rect.width - 1 &&
                    intersection.height >= rect.height - 1,
            );
        });
        observer.observe(el);
    });
}
