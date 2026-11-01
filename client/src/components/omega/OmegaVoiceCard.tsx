import { voiceCardCount, voiceCardPreview, voiceCardAriaLabel } from './voiceCardText'

// [2026-11-01] Geamana casetei OMEGA CHAT AI, pentru fluxul de ganduri.
//
// Inainte, THE VOICE era o lista intr-un rand de grila cu inaltime fixa pe
// pagina principala. In LIVE primeste un gand la ~30 de secunde, deci cutia era
// mai mare decat ce avea de pus in ea, si de fiecare data ramanea un gol sau o
// felie de gand taiat. Operatorul a cerut sa o scoatem de acolo: acum e o
// caseta cat continutul ei, iar lista intreaga se deschide pe pagina ei, cu
// Back — exact ca la chat.

interface Props {
    count: number
    lastText?: string | null
    lastTime?: string | null
    onOpen: () => void
}

export function OmegaVoiceCard({ count, lastText, lastTime, onOpen }: Props) {
    const preview = voiceCardPreview(lastText)
    return (
        <button
            type="button"
            className="omega-entry-card omega-voice-card"
            onClick={onOpen}
            aria-label={voiceCardAriaLabel(count)}
        >
            <span className="omega-voice-card-glyph" aria-hidden="true">▸ ◂</span>
            <span className="omega-entry-card-title">THE VOICE</span>
            <span className="omega-entry-card-hint">
                {voiceCardCount(count)}
                {preview ? ` · ${lastTime ? lastTime + ' ' : ''}${preview}` : ''}
            </span>
        </button>
    )
}
