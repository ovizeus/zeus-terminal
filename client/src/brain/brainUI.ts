// ZeuS Brain v7 — interfata (port [UI] + bucla principala), spec 7 si 8.
// startBrain(root) construieste DOM-ul din referinta in `root` si porneste bucla;
// intoarce functia de oprire. Fara niciunul din controalele demo ale referintei (spec 7).
import {
  STR, S, C, R, SEG, AX, AXD, N, GN, GND, MC, MX, PRE_MOODS, MIN_DEJAVU, LOW_SAMPLE, JOURNAL_SHOW,
  REC_HZ, LS_KEY, SAT_SLOT, PAGE, type Mood,
} from './brainStrings'
import { Derived, simil, type St } from './brainDerived'
import { BrainRenderer, rgba } from './brainRender'
import { Recorder, type Frame } from './brainRecorder'
import { brainStorage, type TradeRecord } from './brainStorage'
import { buildRawFromZeusState, switchMain } from './brainAdapter'

const STRIP = REC_HZ * 180

const CSS = `
.zb7{width:100%;max-width:420px;margin:0 auto;background:#040913;padding:12px 8px 14px;box-sizing:border-box;font-family:monospace;color:#9fb3c8}
.zb7 button{font-family:monospace;font-size:13px;padding:8px;border:1px solid;border-radius:8px;background:transparent;cursor:pointer}
.zb7 button:focus-visible{outline:2px solid #9fe8ff;outline-offset:2px}
.zb7 .row{display:flex;justify-content:space-between;padding:0 10px 2px;font-size:12px}
.zb7 .sec{padding:16px 10px 6px;font-size:12px;color:#9fb3c8;letter-spacing:2px}
.zb7-allm{position:fixed;inset:0;background:rgba(2,6,16,.97);z-index:10050;display:none;flex-direction:column;align-items:center;font-family:monospace}
.zb7-allm .in{width:100%;max-width:420px;height:100%;display:flex;flex-direction:column;padding:12px 8px;box-sizing:border-box}
.zb7-allm button{font-family:monospace;font-size:13px;padding:8px;border:1px solid;border-radius:8px;background:transparent;cursor:pointer}
.zb7-alll{flex:1;overflow-y:auto;font-size:12px;color:#7c8ea3}
`

const HTML = `
<canvas data-k="cv" style="width:100%;height:auto;display:block;cursor:pointer;" aria-label="Zeus brain radar"></canvas>
<div style="display:flex;justify-content:space-between;padding:6px 6px 3px;font-size:11px;color:#7c8ea3;"><span>MOOD · LAST 3 MIN</span><span data-k="rbar" style="color:#fff;cursor:pointer;"></span></div>
<canvas data-k="ms" style="width:100%;height:26px;display:block;cursor:pointer;" aria-label="Mood strip"></canvas>
<div data-k="info" style="min-height:36px;font-size:12px;color:#d8e4f0;padding:8px 8px 4px;line-height:1.45;"></div>
<div data-k="mood" style="text-align:center;font-size:18px;letter-spacing:4px;color:#7fb8d6;padding:2px 0 6px;cursor:pointer;">CALM</div>
<div class="row"><span data-k="mode" style="color:#39ff6a;">—</span><span data-k="conf" style="color:#9fb3c8;">CONF —</span></div>
<div class="row"><span data-k="gt" style="color:#9fb3c8;">GATES —</span><span data-k="ml" style="color:#c08bff;">ML —</span></div>
<div class="row"><span data-k="pos" style="color:#7c8ea3;">NO POSITION</span><span data-k="pnl"></span></div>
<div class="row" style="color:#7c8ea3;padding-bottom:6px;"><span data-k="cons">consensus 0/0</span><span style="color:#d8e4f0;">┄ intent <span style="color:#ffc85a;">╌ best</span></span></div>
<div data-k="dv" style="padding:6px 10px;font-size:12px;color:#9fb3c8;border-top:1px solid #142235;cursor:pointer;">DÉJÀ VU · …</div>
<div data-k="tp" style="padding:2px 10px 6px;font-size:12px;color:#9fb3c8;cursor:pointer;">TEMPLATE · …</div>
<div data-k="sig" style="text-align:center;font-size:13px;color:#7c8ea3;padding:4px 0 10px;">WAIT · building</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 8px;">
<button type="button" data-k="snd" style="color:#9fb3c8;border-color:#2a3a4d;">Sound + haptics: off</button>
<button type="button" data-k="foc" style="color:#9fb3c8;border-color:#2a3a4d;">Focus: off</button>
</div>
<div class="sec">TRADE JOURNAL</div>
<div data-k="jr" style="padding:0 8px;font-size:12px;color:#7c8ea3;"></div>
<div data-k="share" style="padding:0 8px;"></div>
<div data-k="prh" class="sec" style="cursor:pointer;">PSYCH REPORT</div>
<div data-k="pr" style="padding:0 10px;font-size:12px;color:#7c8ea3;"></div>
`

const MODAL = `<div class="in">
<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 4px 10px;border-bottom:1px solid #142235;">
<span data-k="allt" style="font-size:13px;color:#d8e4f0;letter-spacing:2px;">ALL TRADES</span>
<button type="button" data-k="allx" aria-label="Close" style="color:#d8e4f0;border-color:#2a3a4d;padding:4px 12px;font-size:16px;">✕</button></div>
<div data-k="alll" class="zb7-alll"></div></div>`

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

// ── sunet si vibratii (FX) ──
class Fx {
  snd = false
  ac: AudioContext | null = null
  reduced = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  tone(f1: number, f2: number, d: number, type: OscillatorType, v: number, dl = 0): void {
    if (!this.ac) return
    try {
      const o = this.ac.createOscillator(), g = this.ac.createGain(), t0 = this.ac.currentTime + dl
      o.type = type; o.frequency.setValueAtTime(f1, t0); o.frequency.exponentialRampToValueAtTime(f2, t0 + d)
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
      o.connect(g); g.connect(this.ac.destination); o.start(t0); o.stop(t0 + d + 0.05)
    } catch { /* fara sunet */ }
  }
  vib(p: number | number[]): void { try { if (navigator.vibrate) navigator.vibrate(p) } catch { /* iOS */ } }
  sound(k: string): void {
    if (!this.snd) return
    if (k === 'attack') { this.tone(660, 990, 0.12, 'triangle', 0.12); this.tone(990, 1320, 0.14, 'triangle', 0.12, 0.14); this.vib([40, 40, 40]) }
    else if (k === 'tp') { [523, 659, 784].forEach((f, i) => this.tone(f, f * 1.001, 0.2, 'sine', 0.12, i * 0.12)); this.vib(200) }
    else if (k === 'sl') { this.tone(220, 110, 0.45, 'sawtooth', 0.05); this.vib(300) }
    else if (k === 'close') { this.tone(440, 441, 0.15, 'sine', 0.08) }
    else if (k === 'hes') { this.tone(180, 160, 0.25, 'sine', 0.05); this.vib(15) }
    else if (k === 'wake') { this.tone(300, 600, 0.3, 'sine', 0.06); this.vib(30) }
  }
  enable(on: boolean): void {
    this.snd = on
    if (on && !this.ac) { try { const A = (window as any).AudioContext || (window as any).webkitAudioContext; this.ac = new A() } catch { this.ac = null } }
    if (this.ac && this.ac.state === 'suspended') void this.ac.resume()
  }
}

type Pref = { focus: boolean; snd: boolean; demo: boolean }
function loadPref(): Pref {
  let s: any = null
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { s = null }
  return {
    focus: s && typeof s.focus === 'boolean' ? s.focus : window.innerWidth < 600,
    snd: !!(s && s.snd),
    demo: !!(s && s.demo),
  }
}
function savePref(p: Pref): void { try { localStorage.setItem(LS_KEY, JSON.stringify(p)) } catch { /* privat */ } }

export function startBrain(root: HTMLElement): () => void {
  // ── DOM ──
  const style = document.createElement('style'); style.textContent = CSS
  const wrap = document.createElement('div'); wrap.className = 'zb7'; wrap.innerHTML = HTML
  root.appendChild(style); root.appendChild(wrap)
  const modal = document.createElement('div'); modal.className = 'zb7-allm'
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'All trades')
  modal.innerHTML = MODAL; document.body.appendChild(modal)
  const $ = (k: string) => (wrap.querySelector(`[data-k="${k}"]`) || modal.querySelector(`[data-k="${k}"]`)) as HTMLElement
  const cv = $('cv') as HTMLCanvasElement, ms = $('ms') as HTMLCanvasElement
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D, mx = ms.getContext('2d') as CanvasRenderingContext2D
  const dpr = window.devicePixelRatio || 1
  cv.width = S * dpr; cv.height = S * dpr; ctx.scale(dpr, dpr)
  ms.width = S * dpr; ms.height = 26 * dpr; mx.scale(dpr, dpr)

  const FX = new Fx()
  const pref = loadPref()
  const RS = new BrainRenderer(ctx)
  const DER = new Derived()
  const REC = new Recorder()
  REC.lastPreMood = () => DER.lastPreMood
  const snapCache = new Map<string, string>()
  const UI = {
    focus: pref.focus,
    demo: pref.demo,
    rep: null as null | { tr: TradeRecord; frames: Frame[]; idx: number },
    best: null as TradeRecord | null,
    infoUntil: 0,
    allShown: PAGE,
  }
  const info = (m: string, h?: { x: number; y: number; r: number }) => {
    $('info').textContent = m
    UI.infoUntil = performance.now() / 1000 + 8
    if (h) RS.hl = Object.assign(h, { t: performance.now() / 1000 })
  }
  $('info').textContent = STR.idle
  $('foc').textContent = 'Focus: ' + (UI.focus ? 'on' : 'off')
  // Sunetul cere o atingere a omului in fiecare sesiune (regula browserelor): starea se tine minte,
  // iar sunetul se rearmeaza la prima atingere.
  $('snd').textContent = 'Sound + haptics: ' + (pref.snd ? 'on' : 'off')
  const armOnce = () => { if (pref.snd && !FX.snd) FX.enable(true) }
  wrap.addEventListener('pointerdown', armOnce)

  // ── istoricul (doar live, sau si demo cu comutatorul) ──
  const hist = () => REC.trades.filter((t) => t.status === 'closed' && t.pnlPct != null && (UI.demo || !t.isDemo))
  function pickBest(): void {
    UI.best = hist().filter((h) => (h.pnlPct as number) > 0 && h.entryShape).sort((a, b) => (b.pnlPct as number) - (a.pnlPct as number) || (Number(b.confAtEntry) || 0) - (Number(a.confAtEntry) || 0))[0] || null
  }
  function updMatch(): void {
    const shaped = hist().filter((h) => h.entryShape)
    if (shaped.length < MIN_DEJAVU) $('dv').innerHTML = 'DÉJÀ VU · <span style="color:#56657a">' + STR.collecting(shaped.length, MIN_DEJAVU) + '</span>'
    else {
      const sc = shaped.map((h) => ({ h, s: simil(RS.drt, h.entryShape) })).sort((a, b) => b.s - a.s).slice(0, 2)
      $('dv').innerHTML = 'DÉJÀ VU · ' + sc.map((o) => `<span style="color:#d8e4f0">${Math.round(o.s * 100)}%</span> like <span style="color:${(o.h.pnlPct as number) > 0 ? '#39ff6a' : '#ff4d6d'}">#${esc(o.h.id)} ${esc(o.h.result)} ${(o.h.pnlPct as number) > 0 ? '+' : ''}${(o.h.pnlPct as number).toFixed(2)}%</span>`).join(' · ') + ` <span style="color:#56657a">n=${shaped.length}</span>`
    }
    $('tp').innerHTML = UI.best
      ? `TEMPLATE · match <span style="color:#ffc85a">${Math.round(simil(RS.drt, UI.best.entryShape) * 100)}%</span> with best trade <span style="color:#39ff6a">#${esc(UI.best.id)} +${(UI.best.pnlPct as number).toFixed(2)}%</span>`
      : 'TEMPLATE · <span style="color:#56657a">appears after your first winning trade</span>'
  }
  function renderPsych(): void {
    const H = hist()
    const rows = PRE_MOODS.map((m) => { const g = H.filter((h) => h.pre === m), w = g.filter((h) => (h.pnlPct as number) > 0).length; return { m, n: g.length, wr: g.length ? w / g.length : 0 } })
      .filter((r) => r.n).sort((a, b) => b.wr - a.wr)
    const demoN = H.filter((h) => h.isDemo).length
    $('pr').innerHTML = (rows.length
      ? rows.map((r) => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;"><span style="width:76px;color:${MC[r.m as Mood]};font-size:11px;">${r.m}</span><div style="flex:1;height:8px;background:#0e1a2a;border-radius:4px;overflow:hidden;"><div style="width:${Math.round(r.wr * 100)}%;height:100%;background:${r.wr >= 0.5 ? '#39ff6a' : '#ff4d6d'};opacity:.75;"></div></div><span style="width:104px;text-align:right;font-size:11px;color:#9fb3c8;">${Math.round(r.wr * 100)}% · n=${r.n}${r.n < LOW_SAMPLE ? ' <span style="color:#56657a">low</span>' : ''}</span></div>`).join('')
      : `<div style="padding:4px 0;">${UI.demo ? 'No closed trades yet.' : STR.noClosed}</div>`)
      + `<div style="padding:6px 0 0;font-size:11px;color:#56657a;">Win rate by mood before entry · ${H.length} trades${demoN ? ' (' + demoN + ' demo)' : ''} · display only, never used by the engine.</div>`
      + `<label style="display:flex;align-items:center;gap:8px;padding:8px 0 0;font-size:11px;color:#7c8ea3;cursor:pointer;"><input type="checkbox" data-k="incdemo" ${UI.demo ? 'checked' : ''}> ${STR.includeDemo}</label>`
  }
  function rowHTML(tr: TradeRecord): string {
    const c = tr.result === 'TP' ? '#39ff6a' : tr.result === 'SL' ? '#ff4d6d' : '#9fb3c8'
    const lbl = tr.result === 'MANUAL' ? 'CLOSED' : (tr.result || 'OTHER')
    const pct = tr.pnlPct == null ? '—' : (tr.pnlPct >= 0 ? '+' : '') + tr.pnlPct.toFixed(2) + '%'
    const snap = snapCache.get(tr.key)
    const img = snap
      ? `<img src="${snap}" alt="Brain at entry" style="width:56px;height:56px;border-radius:8px;border:1px solid #1d2c40;background:#040913;">`
      : `<div data-snap="${esc(tr.key)}" style="width:56px;height:56px;border-radius:8px;border:1px solid #1d2c40;"></div>`
    return `<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid #142235;">${img}<div style="flex:1;min-width:0;"><div style="color:${c};font-size:12px;">#${esc(tr.id)} ${esc(tr.symbol)} ${tr.side} · ${lbl} ${pct}${tr.isDemo ? ' <span style="color:#56657a">demo</span>' : ''}</div><div style="color:#7c8ea3;font-size:11px;">before entry: ${esc(tr.pre)} · conf ${tr.confAtEntry == null ? '—' : tr.confAtEntry}</div></div><div style="display:flex;flex-direction:column;gap:4px;"><button type="button" data-rp="${esc(tr.id)}" style="color:${tr.hasFrames ? '#d8e4f0' : '#56657a'};border-color:#2a3a4d;padding:4px 10px;font-size:11px;">Replay</button><button type="button" data-sh="${esc(tr.id)}" style="color:#ffc85a;border-color:#4d3d1d;padding:4px 10px;font-size:11px;">Share</button></div></div>`
  }
  /** Pozele se citesc din IndexedDB doar pentru randurile afisate. */
  function fillSnaps(scope: HTMLElement): void {
    scope.querySelectorAll('[data-snap]').forEach((el) => {
      const key = (el as HTMLElement).dataset.snap as string
      const tr = REC.trades.find((t) => t.key === key)
      if (!tr || !tr.hasSnapshot) return
      void brainStorage.getSnapshot(key).then((url) => {
        if (!url) return
        snapCache.set(key, url)
        const img = document.createElement('img'); img.src = url; img.alt = 'Brain at entry'
        img.style.cssText = 'width:56px;height:56px;border-radius:8px;border:1px solid #1d2c40;background:#040913;'
        el.replaceWith(img)
      })
    })
  }
  function renderJournal(): void {
    const T = REC.trades
    if (!T.length) { $('jr').textContent = STR.noTrades; return }
    $('jr').innerHTML = T.slice(0, JOURNAL_SHOW).map(rowHTML).join('')
      + (T.length > JOURNAL_SHOW ? `<button type="button" data-vall="1" style="width:100%;margin:8px 0 4px;color:#d8e4f0;border-color:#2a3a4d;">${STR.viewAll(T.length)}</button>` : '')
    fillSnaps($('jr'))
    if (modal.style.display === 'flex') renderAll()
  }
  function renderAll(): void {
    const T = REC.trades
    $('allt').textContent = STR.allTitle(T.length)
    $('alll').innerHTML = T.slice(0, UI.allShown).map(rowHTML).join('')
      + (T.length > UI.allShown ? `<button type="button" data-more="1" style="width:100%;margin:8px 0;color:#d8e4f0;border-color:#2a3a4d;">${STR.loadMore} (${T.length - UI.allShown})</button>` : '')
    fillSnaps($('alll'))
  }
  let prevOverflow = ''
  function openAll(): void { UI.allShown = PAGE; renderAll(); modal.style.display = 'flex'; prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; ($('allx') as HTMLButtonElement).focus() }
  function closeAll(): void { if (modal.style.display !== 'flex') return; modal.style.display = 'none'; document.body.style.overflow = prevOverflow }
  const refresh = () => { pickBest(); renderJournal(); renderPsych() }
  REC.onChange = refresh

  async function onListClick(e: Event): Promise<void> {
    const b = (e.target as HTMLElement).closest('[data-rp],[data-sh],[data-vall],[data-more]') as HTMLElement | null
    if (!b) return
    if (b.dataset.vall) { openAll(); return }
    if (b.dataset.more) { UI.allShown += PAGE; renderAll(); return }
    const id = b.dataset.rp || b.dataset.sh
    const tr = REC.trades.find((x) => x.id === id)
    if (!tr) return
    if (b.dataset.sh) { closeAll(); void makeCard(tr); info(STR.shareReady); return }
    const frames = tr.hasFrames ? ((await brainStorage.getFrames(tr.key)) as Frame[] | null) : null
    if (!frames || !frames.length) { info(STR.noReplay); return }
    closeAll(); UI.rep = { tr, frames, idx: 0 }; RS.prevSig = false; info(STR.replayStart(tr.id))
    try { wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* vechi */ }
  }
  $('jr').addEventListener('click', (e) => { void onListClick(e) })
  $('alll').addEventListener('click', (e) => { void onListClick(e) })
  $('allx').addEventListener('click', closeAll)
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll() }
  document.addEventListener('keydown', onKey)
  $('pr').addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement
    if (t && t.dataset.k === 'incdemo') { UI.demo = !!t.checked; pref.demo = UI.demo; savePref(pref); refresh() }
  })

  async function makeCard(tr: TradeRecord): Promise<void> {
    const W = 720, H = 900, c = document.createElement('canvas'); c.width = W; c.height = H
    const x = c.getContext('2d'); if (!x) return
    const col = (tr.pnlPct || 0) > 0 ? '#39ff6a' : '#ff4d6d', lbl = tr.result === 'MANUAL' ? 'CLOSED' : (tr.result || 'OTHER')
    const draw = (im: HTMLImageElement | null) => {
      x.fillStyle = '#040913'; x.fillRect(0, 0, W, H); x.strokeStyle = '#1d2c40'; x.lineWidth = 3; x.strokeRect(12, 12, W - 24, H - 24)
      x.fillStyle = '#e8eef6'; x.font = '500 52px serif'; x.fillText("ZEU'S", 48, 96); x.fillStyle = '#7c8ea3'; x.font = '500 20px monospace'; x.fillText('AI TRADING ANALYTICS', 50, 130)
      if (im) x.drawImage(im, 90, 160, 540, 540)
      x.fillStyle = '#d8e4f0'; x.font = '500 30px monospace'; x.fillText('#' + tr.id + ' ' + tr.symbol + ' ' + tr.side, 48, 752)
      x.fillStyle = col; x.font = '500 56px monospace'; x.fillText(lbl + ' ' + (tr.pnlPct == null ? '—' : (tr.pnlPct >= 0 ? '+' : '') + tr.pnlPct.toFixed(2) + '%'), 48, 818)
      x.fillStyle = '#7c8ea3'; x.font = '500 22px monospace'; x.fillText('mood before entry: ' + tr.pre + ' · conf ' + (tr.confAtEntry == null ? '—' : tr.confAtEntry), 48, 858)
      x.textAlign = 'right'; x.fillStyle = '#c08bff'; x.fillText('@zeusterminal', W - 48, 96)
      const url = c.toDataURL('image/png')
      const canShare = typeof navigator !== 'undefined' && typeof (navigator as any).canShare === 'function'
      $('share').innerHTML = `<div style="padding:10px 0;border-top:1px solid #142235;"><img src="${url}" alt="Share card for trade ${esc(tr.id)}" style="width:100%;border-radius:10px;display:block;"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:8px;font-size:11px;color:#7c8ea3;"><span>${STR.longPress}</span><span style="display:flex;gap:6px;">${canShare ? `<button type="button" data-k="shs" style="color:#ffc85a;border-color:#4d3d1d;padding:4px 10px;font-size:11px;">${STR.share}</button>` : ''}<button type="button" data-k="shx" style="color:#9fb3c8;border-color:#2a3a4d;padding:4px 10px;font-size:11px;">${STR.close}</button></span></div></div>`
      $('shx').addEventListener('click', () => { $('share').innerHTML = '' })
      const shs = $('shs')
      if (shs) shs.addEventListener('click', () => {
        c.toBlob((blob) => {
          if (!blob) return
          const file = new File([blob], `zeus-trade-${tr.id}.png`, { type: 'image/png' })
          try { if ((navigator as any).canShare({ files: [file] })) void (navigator as any).share({ files: [file], title: 'Zeus Terminal trade #' + tr.id }) } catch { /* anulat */ }
        }, 'image/png')
      })
    }
    const snap = snapCache.get(tr.key) || (tr.hasSnapshot ? await brainStorage.getSnapshot(tr.key) : null)
    if (snap) { const im = new Image(); im.onload = () => draw(im); im.onerror = () => draw(null); im.src = snap } else draw(null)
  }

  $('snd').addEventListener('click', () => {
    FX.enable(!FX.snd); pref.snd = FX.snd
    $('snd').textContent = 'Sound + haptics: ' + (FX.snd ? 'on' : 'off')
    if (FX.snd) FX.tone(880, 880, 0.08, 'sine', 0.06)
    savePref(pref)
  })
  $('foc').addEventListener('click', () => { UI.focus = !UI.focus; pref.focus = UI.focus; $('foc').textContent = 'Focus: ' + (UI.focus ? 'on' : 'off'); savePref(pref) })
  $('rbar').addEventListener('click', () => { if (UI.rep) { UI.rep = null; info(STR.back) } })
  $('mood').addEventListener('click', () => { const m = (RS.last ? RS.last.mood[0] : 'CALM') as Mood; info(m + ': ' + MX[m] + '. ' + STR.moodNote) })
  $('dv').addEventListener('click', () => info(STR.dv))
  $('tp').addEventListener('click', () => info(STR.tpl, { x: C, y: C, r: R * 0.8 }))
  $('prh').addEventListener('click', () => info(STR.psych))

  function drawStrip(src: Frame[], cur: number | null, slots?: number): void {
    mx.clearRect(0, 0, S, 26); mx.fillStyle = 'rgba(120,160,210,.07)'; mx.fillRect(0, 4, S, 18)
    const n = src.length; if (!n) return
    const w = S / (slots || n)
    for (let i = 0; i < n; i++) {
      const f = src[i], x = i * w
      mx.globalAlpha = 0.75; mx.fillStyle = f.mood[1]; mx.fillRect(x, 4, w + 0.6, 18); mx.globalAlpha = 1
      if (f.sig && (i === 0 || !src[i - 1].sig)) { mx.fillStyle = '#ffffff'; mx.fillRect(x, 0, 2, 26) }
      if (f.evt) { mx.fillStyle = f.evt === 'TP' ? '#39ff6a' : f.evt === 'SL' ? '#ff4d6d' : '#9fb3c8'; mx.fillRect(x, 0, 2, 26) }
    }
    if (cur != null) { mx.fillStyle = '#ffffff'; mx.fillRect(cur * S - 1, 0, 2, 26) }
  }
  ms.addEventListener('click', (e) => {
    const b = ms.getBoundingClientRect(), x = (e.clientX - b.left) * S / b.width
    if (UI.rep) {
      const L = UI.rep.frames.length, i = Math.max(0, Math.min(L - 1, Math.floor(x / S * L)))
      UI.rep.idx = i; RS.prevSig = UI.rep.frames[i].sig
      info('Jumped to ' + Math.round(i / REC_HZ) + 's in the replay: ' + UI.rep.frames[i].mood[0] + '.'); return
    }
    const src = REC.frames.slice(-STRIP), i = Math.floor(x / (S / STRIP))
    if (i >= src.length) { info('Mood strip: no history yet at this point. It fills from left to right.'); return }
    const f = src[i], age = Math.round((src.length - 1 - i) / REC_HZ)
    info((age ? age + 's ago' : 'now') + ': ' + f.mood[0] + ', conf ' + (f.conf == null ? STR.waiting : f.conf) + '. White ticks are entries, green and red are TP and SL.')
  })
  cv.addEventListener('click', (e) => {
    const b = cv.getBoundingClientRect(), x = (e.clientX - b.left) * S / b.width, y = (e.clientY - b.top) * S / b.height, vs = RS.last
    if (!vs) return
    for (let q = 0; q < vs.sats.length; q++) {
      const [sx, sy] = SAT_SLOT[q]
      if (Math.hypot(x - sx, y - sy) < 32) {
        const sc = vs.sats[q].sc == null ? '—' : vs.sats[q].sc
        if (UI.rep) { info(vs.sats[q].s + ' satellite, score ' + sc + '. Exit replay to switch.', { x: sx, y: sy, r: 30 }); return }
        switchMain(vs.sats[q].full)
        info('Main brain switched to ' + vs.sats[q].s + '. Satellites are the other scanned symbols; the brightest has the best score, beams show agreement.', { x: sx, y: sy, r: 30 }); return
      }
    }
    const dx = x - C, dy = y - C, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx), na = (((a + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    if (d < 32) {
      info('Core: heartbeat speed follows confluence (' + (vs.conf == null ? STR.waiting : vs.conf) + '). The ring fills toward the entry threshold (' + (vs.thr == null ? STR.waiting : vs.thr) + '). Amber and irregular means hesitating; slow and dim means sleeping. ' + STR.thrNote, { x: C, y: C, r: 26 }); return
    }
    if (Math.abs(d - (R + 12)) < 7) {
      const g = Math.floor(na / SEG) % 7, mid = -Math.PI / 2 + g * SEG + SEG / 2
      const hl = { x: C + Math.cos(mid) * (R + 12), y: C + Math.sin(mid) * (R + 12), r: 14 }
      if (g === 1 && vs.unk.includes(1)) { info(STR.spreadUnknown, hl); return }
      if (vs.unk.includes(g)) { info('Gate ' + GN[g] + ': UNKNOWN (' + GND[g] + '), ' + STR.waiting + ' for the engine.', hl); return }
      info('Gate ' + GN[g] + ': ' + (vs.fails.includes(g) ? 'FAILING' : 'PASS') + ' (' + GND[g] + '). Cracked red segments block entries.', hl); return
    }
    if (vs.pos && vs.pos.pnl != null && d > R + 16 && d < R + 38) {
      const v = vs.pos.pct
      info('Position aura: moves between the SL ring (inner, red) and TP ring (outer, green). Now ' + (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%') + '.' + (vs.pos.noTp ? ' ' + STR.noTpNote : ''), { x, y, r: 10 }); return
    }
    const i = Math.round(na / (2 * Math.PI / N)) % N
    if (d > R + 30) {
      const pc = (v: number | null | undefined) => (v == null ? STR.na : Math.round(v * 100) + '%')
      info(AX[i] + ' ' + pc(vs.rt[i]) + ': ' + AXD[i] + '. ML attention ' + (vs.att ? pc(vs.att[i]) : STR.attComingSoon) + ', slow lens ' + pc(vs.sl[i]) + '.', { x: C + Math.cos(-Math.PI / 2 + i * 2 * Math.PI / N) * (R + 50), y: C + Math.sin(-Math.PI / 2 + i * 2 * Math.PI / N) * (R + 50) + 2, r: 22 }); return
    }
    info(STR.shape + (vs.ml == null ? ' ' + STR.mlComingSoon : ''), { x, y, r: 14 })
  })

  // ── randul de text de sub radar (UI.dom) ──
  function dom(st: St): void {
    const md = $('mood'); md.textContent = st.mood[0] === 'SLEEPING' ? 'SLEEPING · zZ' : st.mood[0]; md.style.color = st.mood[1]
    const m = $('mode'); m.textContent = st.n; m.style.color = rgba(st.c, 1)
    $('conf').textContent = 'CONF ' + (st.conf == null ? STR.waiting : st.conf) + ' / ' + (st.thr == null ? STR.waiting : st.thr)
    const unk = (st.unk || []).length, known = 7 - unk, fails = st.fails.length
    const gt = $('gt')
    if (unk === 7) { gt.textContent = 'GATES ' + STR.waiting; gt.style.color = '#7c8ea3' }
    else { gt.textContent = 'GATES ' + (known - fails) + '/' + known + (unk ? ' · ' + unk + ' unknown' : ''); gt.style.color = fails ? '#ff5a6e' : '#9fb3c8' }
    $('ml').textContent = 'ML ' + (st.ml == null ? STR.comingSoon : Math.round(st.ml * 100) + '%')
    const ce = $('cons'); ce.textContent = 'consensus ' + st.cons + '/' + st.sats.length; ce.style.color = st.cons >= 2 ? rgba(RS.dcol, 1) : '#7c8ea3'
    const pe = $('pos'), pn = $('pnl')
    if (st.pos) {
      pe.textContent = 'POS ' + st.pos.sym + ' ' + (st.pos.dir > 0 ? 'LONG' : 'SHORT'); pe.style.color = st.pos.dir > 0 ? '#39ff6a' : '#ff4d6d'
      const v = st.pos.pct; pn.textContent = v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; pn.style.color = v == null ? '#7c8ea3' : v >= 0 ? '#39ff6a' : '#ff4d6d'
    } else if (st.posMsg) { pe.textContent = st.posMsg; pe.style.color = st.posMsg.startsWith('SL') ? '#ff4d6d' : '#39ff6a'; pn.textContent = '' }
    else { pe.textContent = 'NO POSITION'; pe.style.color = '#7c8ea3'; pn.textContent = '' }
    const s = $('sig')
    if (st.sig) { s.textContent = 'SIGNAL CONFIRMED · ENTERING'; s.style.color = rgba(RS.dcol, 1) }
    else if (st.zz) { s.textContent = 'MARKET DEAD · resting at 20fps'; s.style.color = '#5a6b85' }
    else if (st.hes) { s.textContent = 'HESITATING · ' + st.fails.map((g) => GN[g]).join(', ') + ' blocked'; s.style.color = '#ffb347' }
    else { s.textContent = 'WAIT · building'; s.style.color = '#7c8ea3' }
  }

  // ── bucla ──
  let raf = 0, lastT = 0, fN = 0, acc = 0, lastM = 0, running = !document.hidden, alive = true, lastEvtI = -1
  function loop(msT: number): void {
    if (!running || !alive) return
    const t = msT / 1000, dt = Math.min(0.05, lastT ? t - lastT : 0.016); lastT = t; fN++
    try {
      const nowMs = Date.now()
      const st = DER.build(buildRawFromZeusState(nowMs))
      REC.tick(nowMs, st)
      // Evenimentul de inchidere (TP/SL…) ajunge si in vederea live, o singura data.
      let view: St = st
      const lf = REC.frames[REC.frames.length - 1]
      if (lf && lf.evt && lf.i !== lastEvtI) { lastEvtI = lf.i; view = Object.assign({}, st, { evt: lf.evt, i: lf.i }) }
      let rp: { id: string } | null = null
      if (UI.rep) {
        UI.rep.idx += dt * REC_HZ * 4
        if (UI.rep.idx >= UI.rep.frames.length) { UI.rep = null; info(STR.replayEnd) }
        else { view = UI.rep.frames[Math.floor(UI.rep.idx)]; rp = { id: UI.rep.tr.id } }
      }
      acc += dt
      if (!(view.zz && RS.dz > 0.9 && fN % 3)) {
        RS.render(view, t, acc, rp, { focus: UI.focus, reduced: FX.reduced, best: UI.best, sound: (k) => FX.sound(k), info: (m) => info(m) })
        dom(view)
        acc = 0
      }
      if (t - lastM > 0.5) { lastM = t; updMatch() }
      if (UI.rep) { const L = UI.rep.frames.length; drawStrip(UI.rep.frames, UI.rep.idx / L); $('rbar').textContent = 'REPLAY #' + UI.rep.tr.id + ' · ' + Math.round(UI.rep.idx / REC_HZ) + 's / ' + Math.round(L / REC_HZ) + 's · exit ✕' }
      else if (fN % 2 === 0) { drawStrip(REC.frames.slice(-STRIP), null, STRIP); $('rbar').textContent = '' }
      REC.snap(nowMs, cv, !!UI.rep)
      if (UI.infoUntil > 0 && performance.now() / 1000 > UI.infoUntil) { UI.infoUntil = 0; $('info').textContent = STR.idle }
    } catch (e) {
      // un cadru stricat nu opreste bucla
      if (fN % 600 === 0) console.warn('[brain v7] frame failed:', (e as Error)?.message || e)
    }
    raf = requestAnimationFrame(loop)
  }
  const onVis = () => {
    running = !document.hidden
    if (running && alive) { lastT = performance.now() / 1000; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) }
  }
  document.addEventListener('visibilitychange', onVis)

  refresh()
  void REC.load().then(() => REC.reconcile()).then(refresh)
  raf = requestAnimationFrame(loop)

  return () => {
    alive = false
    cancelAnimationFrame(raf)
    document.removeEventListener('visibilitychange', onVis)
    document.removeEventListener('keydown', onKey)
    closeAll()
    try { modal.remove(); wrap.remove(); style.remove() } catch { /* deja scos */ }
  }
}
