// [2026-11-15] Alegerea fusului orar: o lista de tari, cu cautare, in locul celor
// cinci casute (RO / UTC / NY / Tokyo / London). Cerut de operator: „fiecare sa-si
// seteze zona lui, ca la aplicatiile institutionale". Grupata pe regiuni; fiecare
// rand arata ora de acum si decalajul fata de UTC.
import { useEffect, useMemo, useState } from 'react'
import { TZ_LIST, searchTz, utcOffsetLabel, normalizeTz, type TzEntry } from '../../core/timezones'

function clockIn(tz: string, now: number): string {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(now)) }
    catch { return '--:--' }
}

export function TimezonePicker({ value, onPick }: { value: string; onPick: (tz: string) => void }) {
    const current = normalizeTz(value)
    const [q, setQ] = useState('')
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(iv) }, [])

    const list = useMemo(() => searchTz(q), [q])
    const groups = useMemo(() => {
        const g: Array<[string, TzEntry[]]> = []
        for (const e of list) {
            const last = g[g.length - 1]
            if (last && last[0] === e.region) last[1].push(e); else g.push([e.region, [e]])
        }
        return g
    }, [list])
    const sel = TZ_LIST.find((e) => e.tz === current)

    return (
        <div className="ztz">
            <div className="ztz-cur">
                <div>
                    <div className="ztz-cur-l">Current</div>
                    <div className="ztz-cur-v">{sel ? sel.country : current.replace(/_/g, ' ')}</div>
                </div>
                <div className="ztz-cur-r">
                    <span className="ztz-clock">{clockIn(current, now)}</span>
                    <span className="ztz-off">{utcOffsetLabel(current, now)}</span>
                </div>
            </div>
            <input className="ztz-search" type="search" placeholder="Search country or city…" value={q}
                onChange={(e) => setQ(e.target.value)} aria-label="Search time zone" />
            <div className="ztz-list" role="listbox" aria-label="Time zones">
                {groups.length === 0 && <div className="ztz-empty">No match</div>}
                {groups.map(([region, items]) => (
                    <div key={region}>
                        <div className="ztz-region">{region}</div>
                        {items.map((e) => (
                            <button key={e.code} type="button" role="option" aria-selected={e.tz === current}
                                className={'ztz-row' + (e.tz === current ? ' act' : '')} onClick={() => onPick(e.tz)}>
                                <span className="ztz-code">{e.code}</span>
                                <span className="ztz-name">{e.country}</span>
                                <span className="ztz-time">{clockIn(e.tz, now)}</span>
                                <span className="ztz-off">{utcOffsetLabel(e.tz, now)}</span>
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    )
}
