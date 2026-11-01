// [CHAT WIPE 2026-11-01] Pure merge for OMEGA chat history.
//
// `loadHistory()` used to do `set({ history: data.history })` — a straight
// REPLACE. The fetch is async, so anything the operator typed while it was in
// flight was thrown away when it landed, together with the reply that was being
// streamed into the placeholder row next to it.
//
// He reported it as "scriu si el nu raspunde", and the server proved him half
// right: ml_voice_log holds the replies OMEGA actually produced at 17:53, 17:59,
// 18:00 and 18:01. They were generated and logged. He simply never saw them,
// because the row they were streaming into had already been replaced.
//
// The window got much wider on 2026-11-01: the chat moved to its own page, so
// TalkWithMe now mounts at the moment he opens the chat and fires loadHistory
// right as he starts typing — exactly the overlap that loses the message.
//
// The server list is authoritative for the PAST. It cannot know about anything
// that happened after the request left, so those rows are kept.

export interface MergeableRow { ts?: unknown, role?: unknown }

/** A usable millisecond timestamp, or null. Strings and null are not timestamps. */
export function rowTs(row: MergeableRow | null | undefined): number | null {
    if (!row || typeof row !== 'object') return null
    const t = (row as any).ts
    // `Number(null) === 0` passes Number.isFinite, so the TYPE is checked first:
    // a row with no ts must read as "unknown", never as 1970.
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return null
    return t
}

/**
 * Server rows, plus any local row the fetch could not have known about.
 * @param serverRows what /api/omega/chat/history returned
 * @param localRows  what the store held when the response landed
 * @param startedAt  when the request was SENT (not when it landed)
 */
export function mergeChatHistory<T extends MergeableRow>(
    serverRows: T[] | null | undefined,
    localRows: T[] | null | undefined,
    startedAt: number,
): T[] {
    const server = Array.isArray(serverRows) ? serverRows : []
    const local = Array.isArray(localRows) ? localRows : []
    const cutoff = (typeof startedAt === 'number' && Number.isFinite(startedAt)) ? startedAt : Date.now()

    // Rows born after the request left: the server could not have them.
    const newer = local.filter((r) => {
        const t = rowTs(r)
        return t !== null && t >= cutoff
    })
    if (newer.length === 0) return server

    // Guard against the same row arriving both ways (a reply logged fast enough
    // to be in the response): drop a local row the server already reports.
    const seen = new Set(server.map((r) => `${String((r as any).role)}|${rowTs(r)}`))
    const kept = newer.filter((r) => !seen.has(`${String((r as any).role)}|${rowTs(r)}`))
    return server.concat(kept)
}
