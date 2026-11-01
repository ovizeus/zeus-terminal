import { chatCardHint, chatCardAriaLabel } from './chatCardText'

// [OMEGA CHAT CARD 2026-11-01] The way into the chat.
//
// It replaces a bar that was stuck to the bottom of the OMEGA page: it sat on
// top of the thought list (the operator's screenshot shows it covering a
// thought mid-sentence) and the only way to close it was to tap its header,
// which nothing said. "chatul e jos nu vezi de unde sa-l inchizi".
//
// So the chat stops being an overlay and becomes a place you go to: this tile,
// then a full sub-view with the page's own Back button — the same shape DOCTOR,
// RINGS and REPORT already use on this page.

const BASE = (import.meta as any).env?.BASE_URL || '/'
const EMBLEM = BASE + 'omega/emblem.jpg' // same gold alpha-omega as TheOrb

interface Props {
    count: number
    onOpen: () => void
}

export function OmegaChatCard({ count, onOpen }: Props) {
    return (
        <button
            type="button"
            className="omega-chat-card"
            onClick={onOpen}
            aria-label={chatCardAriaLabel(count)}
        >
            <span className="omega-chat-card-emblem" style={{ backgroundImage: `url(${EMBLEM})` }} aria-hidden="true" />
            <span className="omega-chat-card-title">OMEGA CHAT AI</span>
            <span className="omega-chat-card-hint">{chatCardHint(count)}</span>
        </button>
    )
}
