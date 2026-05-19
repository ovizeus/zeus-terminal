/**
 * [Phase C 2026-05-19] Trailing-edge debounce.
 * Coalesces rapid calls into one execution after `delay` ms of quiet.
 * Used to dedupe config-save storms (settingsStore.loadFromServer,
 * aresStore.loadFromServer).
 */

export interface DebouncedFn<T extends (...args: any[]) => any> {
    (...args: Parameters<T>): void
    cancel(): void
}

export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): DebouncedFn<T> {
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastArgs: Parameters<T> | null = null

    const debounced = ((...args: Parameters<T>) => {
        lastArgs = args
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
            timer = null
            const a = lastArgs
            lastArgs = null
            if (a) fn(...a)
        }, delay)
    }) as DebouncedFn<T>

    debounced.cancel = () => {
        if (timer !== null) clearTimeout(timer)
        timer = null
        lastArgs = null
    }

    return debounced
}
