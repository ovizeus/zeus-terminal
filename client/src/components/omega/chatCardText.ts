// [OMEGA CHAT CARD 2026-11-01] Pure text helpers for the chat entry card.
//
// Why a separate file: the card is a tile the operator taps to open the chat,
// and the ONLY thing it tells him beyond its own name is how much conversation
// is waiting inside. That sentence is worth testing on its own, away from any
// DOM — plurals and the empty case are where this kind of label usually lies.
//
// UI strings are English (R-P-10); only comments and the Book are Romanian.

/** The small line under the title: how much conversation is in there. */
export function chatCardHint(count: unknown): string {
    // `Number(null) === 0` passes Number.isFinite, and so does a boolean, so the
    // type is checked before the value — a non-number must read as "no history",
    // never as "0 messages" dressed up as truth.
    const n = typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : 0
    if (n <= 0) return 'tap to chat'
    if (n === 1) return '1 message — tap to open'
    return `${n} messages — tap to open`
}

/** Accessible label for the tile, so the tap target is not just a picture. */
export function chatCardAriaLabel(count: unknown): string {
    return `Open OMEGA chat — ${chatCardHint(count)}`
}
