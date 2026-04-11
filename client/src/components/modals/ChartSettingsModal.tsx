import { useState } from 'react'
import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { toast } from '../../data/marketDataHelpers'
import { renderOviLiquid } from '../../ui/panels'

const w = window as any
interface Props { visible: boolean; onClose: () => void }

export function ChartSettingsModal({ visible, onClose }: Props) {
  const [tab, setTab] = useState('csm')
  const [candleStyle, setCandleStyle] = useState('Candlestick')
  const [tz, setTz] = useState('RO')
  const [axisWidth, setAxisWidth] = useState(60)

  function applyCandles() {
    const bull = (document.getElementById('ccBull') as HTMLInputElement)?.value || '#00d97a'
    const bear = (document.getElementById('ccBear') as HTMLInputElement)?.value || '#ff3355'
    const bullW = (document.getElementById('ccBullW') as HTMLInputElement)?.value || '#00d97a'
    const bearW = (document.getElementById('ccBearW') as HTMLInputElement)?.value || '#ff3355'
    if (w.cSeries) {
      w.cSeries.applyOptions({ upColor: bull, downColor: bear, borderUpColor: bull, borderDownColor: bear, wickUpColor: bullW, wickDownColor: bearW })
    }
    toast('Candle colors applied')
  }

  function applyTimezone(zone: string) {
    setTz(zone)
    if (typeof w.setTZ === 'function') w.setTZ(zone)
  }

  function applyHeatmap() {
    if (w.S) {
      w.S.heatmapSettings = {
        lookback: +(document.getElementById('hmLookback') as HTMLInputElement)?.value || 400,
        pivotWidth: +(document.getElementById('hmPivotW') as HTMLInputElement)?.value || 1,
        atrLen: +(document.getElementById('hmAtrLen') as HTMLInputElement)?.value || 121,
        atrBandPct: +(document.getElementById('hmAtrBand') as HTMLInputElement)?.value || 0.05,
        extendUnhit: +(document.getElementById('hmExtend') as HTMLInputElement)?.value || 30,
        heatContrast: +(document.getElementById('hmContrast') as HTMLInputElement)?.value || 0.3,
        longCol: (document.getElementById('hmLongCol') as HTMLInputElement)?.value || '#01c4fe',
        shortCol: (document.getElementById('hmShortCol') as HTMLInputElement)?.value || '#ffe400',
        keepTouched: (document.getElementById('hmKeepTouched') as HTMLInputElement)?.checked !== false,
        minWeight: 0,
      }
    }
    if (w.S?.oviOn) renderOviLiquid()
    toast('Heatmap settings applied')
  }

  function applyPriceAxis() {
    const textCol = (document.getElementById('ccPriceText2') as HTMLInputElement)?.value || '#7a9ab8'
    const bgCol = (document.getElementById('ccPriceBg2') as HTMLInputElement)?.value || '#0a0f16'
    const gridH = (document.getElementById('ccGridH') as HTMLInputElement)?.value || '#1a2530'
    const gridV = (document.getElementById('ccGridV') as HTMLInputElement)?.value || '#1a2530'
    if (w.mainChart) {
      w.mainChart.applyOptions({
        layout: { background: { color: bgCol }, textColor: textCol },
        grid: { horzLines: { color: gridH }, vertLines: { color: gridV } },
        rightPriceScale: { width: axisWidth },
      })
    }
    if (w.cvdChart) w.cvdChart.applyOptions({ rightPriceScale: { width: axisWidth } })
    toast('Price axis applied')
  }

  return (
    <ModalOverlay id="mcharts" visible={visible} onClose={onClose}>
      <ModalHeader title="CHART SETTINGS" onClose={onClose} />

      <div className="mtabs">
        <div className={`mtab${tab === 'csm' ? ' act' : ''}`} onClick={() => setTab('csm')}>CANDLES</div>
        <div className={`mtab${tab === 'cst' ? ' act' : ''}`} onClick={() => setTab('cst')}>TIMEZONE</div>
        <div className={`mtab${tab === 'csh' ? ' act' : ''}`} onClick={() => setTab('csh')}>HEATMAP</div>
        <div className={`mtab${tab === 'csc' ? ' act' : ''}`} onClick={() => setTab('csc')}>PRICE AXIS</div>
      </div>

      {/* CANDLES TAB */}
      <div className={`mbody${tab === 'csm' ? ' act' : ''}`} id="csm" style={{ display: tab === 'csm' ? 'block' : 'none' }}>
        <div className="msec">CANDLE COLORS</div>
        <div className="mrow"><span className="mlbl">Bull candle color</span><input type="color" defaultValue="#00d97a" id="ccBull" /></div>
        <div className="mrow"><span className="mlbl">Bear candle color</span><input type="color" defaultValue="#ff3355" id="ccBear" /></div>
        <div className="mrow"><span className="mlbl">Bull wick color</span><input type="color" defaultValue="#00d97a" id="ccBullW" /></div>
        <div className="mrow"><span className="mlbl">Bear wick color</span><input type="color" defaultValue="#ff3355" id="ccBearW" /></div>
        <div className="msec">CANDLE STYLE</div>
        <div className="qbs">
          {['Candlestick', 'Bar', 'Hollow'].map(s => (
            <div key={s} className={`qb${candleStyle === s ? ' act' : ''}`} onClick={() => setCandleStyle(s)}>{s}</div>
          ))}
        </div>
        <div className="srow">
          <button className="sbtn2 pri" onClick={applyCandles}><svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" /></svg> APPLY</button>
          <button className="sbtn2 sec" onClick={onClose}>CLOSE</button>
        </div>
      </div>

      {/* TIMEZONE TAB */}
      <div className="mbody" id="cst" style={{ display: tab === 'cst' ? 'block' : 'none' }}>
        <div className="msec">TIMEZONE</div>
        <div className="qbs">
          {[
            { k: 'RO', label: 'Romania', color: '#f0c040' },
            { k: 'UTC', label: 'UTC', color: '#ccc' },
            { k: 'US', label: 'NY', color: '#00d97a' },
            { k: 'JP', label: 'Tokyo', color: '#ff44aa' },
            { k: 'UK', label: 'London', color: '#4488ff' },
          ].map(z => (
            <div key={z.k} className={`qb${tz === z.k ? ' act' : ''}`} onClick={() => applyTimezone(z.k)}>
              <span style={{ color: z.color, fontWeight: 700 }}>{z.k}</span> {z.label}
            </div>
          ))}
        </div>
        <div className="mrow" style={{ marginTop: '10px' }}><span className="mlbl">Current time:</span><span style={{ color: 'var(--gold)' }} id="roTimeDisplay">—</span></div>
        <div className="mrow"><span className="mlbl">UTC offset:</span><span style={{ color: 'var(--txt)' }} id="roOffsetDisplay">UTC+2/+3</span></div>
      </div>

      {/* HEATMAP TAB */}
      <div className="mbody" id="csh" style={{ display: tab === 'csh' ? 'block' : 'none' }}>
        <div className="msec">LIQUIDATION HEATMAP SETTINGS</div>
        <div className="mrow"><span className="mlbl">Lookback Bars</span><input type="number" defaultValue={400} min={100} max={1200} id="hmLookback" /></div>
        <div className="mrow"><span className="mlbl">Swing Width (pivot)</span><input type="number" defaultValue={1} min={1} max={10} id="hmPivotW" /></div>
        <div className="mrow"><span className="mlbl">ATR Length</span><input type="number" defaultValue={121} min={5} max={500} id="hmAtrLen" /></div>
        <div className="mrow"><span className="mlbl">ATR Band %</span><input type="number" defaultValue={0.05} min={0.01} max={1} step={0.01} id="hmAtrBand" /></div>
        <div className="mrow"><span className="mlbl">Extend Unhit Bars</span><input type="number" defaultValue={30} min={0} max={200} id="hmExtend" /></div>
        <div className="mrow"><span className="mlbl">Heat Contrast</span><input type="number" defaultValue={0.3} min={0.1} max={5} step={0.1} id="hmContrast" /></div>
        <div className="mrow"><span className="mlbl">Long Liq Color</span><input type="color" defaultValue="#01c4fe" id="hmLongCol" /></div>
        <div className="mrow"><span className="mlbl">Short Liq Color</span><input type="color" defaultValue="#ffe400" id="hmShortCol" /></div>
        <label className="mchk"><input type="checkbox" defaultChecked id="hmKeepTouched" /> Keep Touched Pockets</label>
        <div className="srow">
          <button className="sbtn2 pri" onClick={applyHeatmap}><svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" /></svg> APPLY &amp; REDRAW</button>
          <button className="sbtn2 sec" onClick={onClose}>CLOSE</button>
        </div>
      </div>

      {/* PRICE AXIS TAB */}
      <div className="mbody" id="csc" style={{ display: tab === 'csc' ? 'block' : 'none' }}>
        <div className="msec">CULORI PRICE AXIS</div>
        <div className="mrow"><span className="mlbl">Culoare text preturi</span><input type="color" defaultValue="#7a9ab8" id="ccPriceText2" /></div>
        <div className="mrow"><span className="mlbl">Background chart</span><input type="color" defaultValue="#0a0f16" id="ccPriceBg2" /></div>
        <div className="mrow"><span className="mlbl">Grid orizontal</span><input type="color" defaultValue="#1a2530" id="ccGridH" /></div>
        <div className="mrow"><span className="mlbl">Grid vertical</span><input type="color" defaultValue="#1a2530" id="ccGridV" /></div>
        <div className="msec">LATIMEA LISTEI DE PRETURI</div>
        <div className="qbs">
          {[{ px: 40, l: 'Slim 40px' }, { px: 60, l: 'Normal 60px' }, { px: 80, l: 'Wide 80px' }, { px: 100, l: 'Extra 100px' }].map(o => (
            <div key={o.px} className={`qb${axisWidth === o.px ? ' act' : ''}`} onClick={() => setAxisWidth(o.px)}>{o.l}</div>
          ))}
        </div>
        <div className="srow" style={{ marginTop: '10px' }}>
          <button className="sbtn2 pri" onClick={applyPriceAxis}><svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" /></svg> APPLY</button>
          <button className="sbtn2 sec" onClick={onClose}>CLOSE</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
