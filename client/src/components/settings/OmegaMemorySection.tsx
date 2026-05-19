/**
 * [Sub-A omega chat 2026-05-19] Settings section for Omega chat persistence
 * controls. Currently only "Clear chat history" button (nuclear wipe per-user
 * + audit log). Future Sub-B/C will add user profile + memory facts here.
 */
import { useState } from 'react'
import { useOmegaChatStore } from '../../stores/omegaChatStore'
import { toast } from '../../data/marketDataHelpers'

export function OmegaMemorySection() {
    const [confirming, setConfirming] = useState(false)
    const [clearing, setClearing] = useState(false)
    const clearLocal = useOmegaChatStore((s) => s.clearLocal)
    const error = useOmegaChatStore((s) => s.error)
    const historyCount = useOmegaChatStore((s) => s.history.length)

    const handleClear = async () => {
        setClearing(true)
        try {
            const { deletedCount } = await clearLocal()
            if (deletedCount > 0) {
                toast(`Cleared ${deletedCount} chat messages`, 3000)
            } else if (error) {
                toast(`Could not clear: ${error}`, 4000)
            } else {
                toast('Nothing to clear', 2000)
            }
        } finally {
            setClearing(false)
            setConfirming(false)
        }
    }

    return (
        <div className="zr-settings-subsection">
            <h4>Omega chat memory</h4>
            <p className="zr-settings-desc">
                Omega keeps a per-user conversation history persisted in the database.
                History survives browser refresh and server restart. The button below
                permanently deletes your conversation history (your messages and Omega's
                replies). Brain narration thoughts and critical alerts are preserved.
            </p>
            <p className="zr-settings-meta">
                Currently loaded in this session: <strong>{historyCount}</strong> messages
            </p>
            {!confirming ? (
                <button className="zr-btn zr-btn-danger" onClick={() => setConfirming(true)}>
                    Clear chat history
                </button>
            ) : (
                <div className="zr-confirm-block">
                    <p>Are you sure? This cannot be undone.</p>
                    <button className="zr-btn zr-btn-danger" onClick={handleClear} disabled={clearing}>
                        {clearing ? 'Clearing…' : 'Yes, clear it'}
                    </button>
                    <button className="zr-btn" onClick={() => setConfirming(false)} disabled={clearing}>
                        Cancel
                    </button>
                </div>
            )}
        </div>
    )
}
