// Zeus — engine/signals.ts
// Ported 1:1 from public/js/brain/signals.js (Phase 5A)
// Signal rendering
// [8B-rest] READS migrated to stateAccessors.

import { getTimezone } from '../services/stateAccessors'
import { el } from '../utils/dom'
import { _ZI } from '../constants/icons'
import { runBrainUpdate } from './brain'

const w = window as any // kept for w.brainThink calls

export function renderSignals(signals: any[], bullCount: number, bearCount: number): void {
  const grid = document.getElementById('sigGrid')
  const mega = document.getElementById('megaSigBox')
  const timeEl = document.getElementById('sigScanTime')
  if (!grid) return

  const now = new Date().toLocaleTimeString('ro-RO', { timeZone: getTimezone(), hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (timeEl) timeEl.textContent = 'UPD ' + now

  // Mega signal
  if (mega) {
    const total = bullCount + bearCount
    if (total >= 3) {
      const isBull = bullCount >= bearCount
      mega.innerHTML = `<div class="mega-sig ${isBull ? 'bull' : 'bear'}">
        <span class="mega-sig-ico">${isBull ? _ZI.tup : _ZI.drop}</span>
        <div class="mega-sig-txt">
          <div class="mega-type">${isBull ? 'SEMNAL BULLISH' : 'SEMNAL BEARISH'} (${isBull ? bullCount : bearCount}/${total})</div>
          <div class="mega-det">${isBull ? bullCount : bearCount} indicatori aliniati · Confluenta ${(isBull ? bullCount : bearCount) >= 4 ? 'PUTERNICA' : 'MEDIE'}</div>
        </div>
      </div>`
    } else {
      mega.innerHTML = ''
    }
  }

  if (!signals.length) {
    grid.innerHTML = '<div class="sig-row" style="justify-content:center;padding:12px;color:var(--dim);font-size:12px">Niciun semnal activ momentan</div>'
    return
  }

  grid.innerHTML = signals.map((s: any) => `
    <div class="sig-row">
      <div class="sig-dot ${s.dir}"></div>
      <div class="sig-txt">
        <div class="sig-name">${s.name}</div>
        <div class="sig-det">${s.det}</div>
      </div>
      <span class="sig-str ${s.dir}">${s.str}</span>
    </div>`).join('')
  if (typeof runBrainUpdate === 'function') runBrainUpdate()
  if (typeof w.brainThink === 'function') {
    w.brainThink(bullCount > bearCount ? 'ok' : bearCount > bullCount ? 'bad' : 'info',
      `Scan: ${signals.length} semnale | Bull:${bullCount} Bear:${bearCount} | Score:${el('confScore')?.textContent || '—'}`)
  }
}
