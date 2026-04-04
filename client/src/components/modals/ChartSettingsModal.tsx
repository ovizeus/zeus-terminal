import { useState } from 'react'
import { ModalOverlay, ModalHeader } from './ModalOverlay'

interface Props { visible: boolean; onClose: () => void }

export function ChartSettingsModal({ visible, onClose }: Props) {
  const [tab, setTab] = useState('csm')

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
        <div className="mrow"><span className="mlbl">Bull candle color</span><input type="color" defaultValue="#00d97a" id="ccBull" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Bear candle color</span><input type="color" defaultValue="#ff3355" id="ccBear" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Bull wick color</span><input type="color" defaultValue="#00d97a" id="ccBullW" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Bear wick color</span><input type="color" defaultValue="#ff3355" id="ccBearW" onChange={() => {}} /></div>
        <div className="msec">CANDLE STYLE</div>
        <div className="qbs">
          <div className="qb act" onClick={() => {}}>Candlestick</div>
          <div className="qb" onClick={() => {}}>Bar</div>
          <div className="qb" onClick={() => {}}>Hollow</div>
        </div>
        <div className="msec">CULORI PRICE AXIS</div>
        <div className="mrow"><span className="mlbl">Culoare text preturi</span><input type="color" defaultValue="#7a9ab8" id="ccPriceText" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Background chart</span><input type="color" defaultValue="#0a0f16" id="ccPriceBg" onChange={() => {}} /></div>
        <div className="msec">LATIME PRICE AXIS</div>
        <div className="mrow"><span className="mlbl">Latimea zonei preturi (px)</span>
          <select id="ccPriceWidth" defaultValue="60" onChange={() => {}} style={{ minWidth: '100px' }}>
            <option value="45">45px (slim)</option>
            <option value="60">60px (default)</option>
            <option value="80">80px (wide)</option>
            <option value="100">100px (extra)</option>
          </select>
        </div>
        <div className="srow">
          <button className="sbtn2 pri" onClick={() => {}}><svg className="z-i" viewBox="0 0 16 16">
              <path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" />
            </svg> APPLY</button>
          <button className="sbtn2 sec" onClick={onClose}>CLOSE</button>
        </div>
      </div>

      {/* TIMEZONE TAB */}
      <div className="mbody" id="cst" style={{ display: tab === 'cst' ? 'block' : 'none' }}>
        <div className="msec">TIMEZONE</div>
        <div className="qbs">
          <div className="qb act" onClick={() => {}}><span style={{ color: '#f0c040', fontWeight: 700 }}>RO</span> Romania</div>
          <div className="qb" onClick={() => {}}>UTC</div>
          <div className="qb" onClick={() => {}}><span style={{ color: '#00d97a', fontWeight: 700 }}>US</span> NY</div>
          <div className="qb" onClick={() => {}}><span style={{ color: '#ff44aa', fontWeight: 700 }}>JP</span> Tokyo</div>
          <div className="qb" onClick={() => {}}><span style={{ color: '#4488ff', fontWeight: 700 }}>UK</span> London</div>
        </div>
        <div className="mrow" style={{ marginTop: '10px' }}><span className="mlbl">Current time (Romania):</span><span style={{ color: 'var(--gold)' }} id="roTimeDisplay">—</span></div>
        <div className="mrow"><span className="mlbl">UTC offset:</span><span style={{ color: 'var(--txt)' }} id="roOffsetDisplay">UTC+2/+3</span></div>
        <div className="msec">CLOCK</div>
        <label className="mchk"><input type="checkbox" defaultChecked id="show24h" onChange={() => {}} /> 24-hour format</label>
        <label className="mchk"><input type="checkbox" defaultChecked id="showRoFlag" onChange={() => {}} /> Show Romania timezone</label>
      </div>

      {/* HEATMAP TAB */}
      <div className="mbody" id="csh" style={{ display: tab === 'csh' ? 'block' : 'none' }}>
        <div className="msec">LIQUIDATION HEATMAP SETTINGS</div>
        <div className="mrow"><span className="mlbl">Lookback Bars</span><input type="number" defaultValue="400" min="100" max="1200" id="hmLookback" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Swing Width (pivot)</span><input type="number" defaultValue="1" min="1" max="10" id="hmPivotW" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">ATR Length</span><input type="number" defaultValue="121" min="5" max="500" id="hmAtrLen" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">ATR Band %</span><input type="number" defaultValue="0.05" min="0.01" max="1" step="0.01" id="hmAtrBand" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Extend Unhit Bars</span><input type="number" defaultValue="30" min="0" max="200" id="hmExtend" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Heat Contrast</span><input type="number" defaultValue="0.3" min="0.1" max="5" step="0.1" id="hmContrast" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Long Liq Color</span><input type="color" defaultValue="#01c4fe" id="hmLongCol" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Short Liq Color</span><input type="color" defaultValue="#ffe400" id="hmShortCol" onChange={() => {}} /></div>
        <label className="mchk"><input type="checkbox" defaultChecked id="hmKeepTouched" onChange={() => {}} /> Keep Touched Pockets</label>
        <div className="srow">
          <button className="sbtn2 pri" onClick={() => {}}><svg className="z-i" viewBox="0 0 16 16">
              <path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" />
            </svg> APPLY &amp; REDRAW</button>
          <button className="sbtn2 sec" onClick={onClose}>CLOSE</button>
        </div>
      </div>

      {/* PRICE AXIS TAB */}
      <div className="mbody" id="csc" style={{ display: tab === 'csc' ? 'block' : 'none' }}>
        <div className="msec">CULORI PRICE AXIS</div>
        <div className="mrow"><span className="mlbl">Culoare text preturi</span><input type="color" defaultValue="#7a9ab8" id="ccPriceText2" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Background chart</span><input type="color" defaultValue="#0a0f16" id="ccPriceBg2" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Grid orizontal</span><input type="color" defaultValue="#1a2530" id="ccGridH" onChange={() => {}} /></div>
        <div className="mrow"><span className="mlbl">Grid vertical</span><input type="color" defaultValue="#1a2530" id="ccGridV" onChange={() => {}} /></div>
        <div className="msec">LATIMEA LISTEI DE PRETURI</div>
        <div className="qbs">
          <div className="qb" onClick={() => {}}>Slim 40px</div>
          <div className="qb act" onClick={() => {}}>Normal 60px</div>
          <div className="qb" onClick={() => {}}>Wide 80px</div>
          <div className="qb" onClick={() => {}}>Extra 100px</div>
        </div>
        <div className="srow" style={{ marginTop: '10px' }}>
          <button className="sbtn2 pri" onClick={() => {}}><svg className="z-i" viewBox="0 0 16 16">
              <path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" />
            </svg> APPLY</button>
          <button className="sbtn2 sec" onClick={onClose}>CLOSE</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
