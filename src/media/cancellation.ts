export function mediaCancelledError() {
    return new DOMException(
        'Media processing cancelled; raw and completed cache retained',
        'AbortError',
    );
}

export function throwIfMediaAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw mediaCancelledError();
    }
}
