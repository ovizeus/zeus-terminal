interface Props { visible: boolean; onClose: () => void }

const numInputStyle: React.CSSProperties = { width:'70px', background:'#0d1520', border:'1px solid #f0c04033', color:'#f0c040', fontSize:'7px', padding:'2px 4px', borderRadius:'2px', textAlign:'right' }
const colorInputStyle: React.CSSProperties = { width:'40px', height:'22px', border:'1px solid #f0c04033', background:'#0d1520', cursor:'pointer', borderRadius:'2px' }

export function OVIPanel({ visible, onClose }: Props) {
  return (
    <div id="oviPanel" style={{
      display: visible ? 'block' : 'none',
      position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', zIndex:9000,
      background:'#0a1018', border:'1px solid #f0c04033', borderRadius:'8px', padding:'16px',
      width:'320px', maxHeight:'80vh', overflowY:'auto', fontFamily:'var(--ff)',
      boxShadow:'0 0 24px #f0c04022'
    }}>
      <div style={{
        display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px',
        borderBottom:'1px solid #f0c04022', paddingBottom:'8px'
      }}>
        <div style={{color:'#f0c040', fontSize:'10px', fontWeight:700, letterSpacing:'2px'}}>OVI LIQUID</div>
        <button onClick={onClose} style={{
          background:'none', border:'none', color:'#f0c04066', fontSize:'14px', cursor:'pointer', padding:'0 4px'
        }}>✕</button>
      </div>

      {/* LIQUIDATION POCKETS */}
      <div style={{fontSize:'6px', color:'#f0c04055', letterSpacing:'1px', marginBottom:'8px'}}>LIQUIDATION POCKETS</div>

      <div style={{
        display:'grid', gridTemplateColumns:'1fr auto', gap:'5px 10px', alignItems:'center',
        fontSize:'7px', color:'#8899aa', marginBottom:'10px'
      }}>
        <span>Lookback Bars</span>
        <input type="number" id="oviLookback" defaultValue={400} min={100} max={1200} step={50} style={numInputStyle} onChange={() => (window as any).oviApplySettings?.()} />

        <span>Swing Width</span>
        <input type="number" id="oviPivotW" defaultValue={1} min={1} max={10} step={1} style={numInputStyle} onChange={() => (window as any).oviApplySettings?.()} />

        <span>Secondary Swing Width</span>
        <input type="number" id="oviSecW" defaultValue={1} min={0} max={10} step={1} style={numInputStyle} onChange={() => (window as any).oviApplySettings?.()} />

        <span>ATR Length</span>
        <input type="number" id="oviAtrLen" defaultValue={121} min={5} max={2000} step={1} style={numInputStyle} onChange={() => (window as any).oviApplySettings?.()} />

        <span>ATR Band %</span>
        <input type="number" id="oviAtrBand" defaultValue={1} min={0.05} max={5} step={0.05} style={numInputStyle} onChange={() => (window as any).oviApplySettings?.()} />

        <span>Extend Unhit (bars)</span>
        <input type="number" id="oviExtend" defaultValue={25} min={0} max={500} step={5} style={numInputStyle} onChange={() => (window as any).oviApplySettings?.()} />

        <span>Min Pocket Weight</span>
        <input type="number" id="oviMinW" defaultValue={5} min={0} max={100} step={1} style={numInputStyle} onChange={() => (window as any).oviApplySettings?.()} />

        <span>Heat Contrast</span>
        <input type="number" id="oviContrast" defaultValue={0.7} min={0.1} max={5} step={0.1} style={numInputStyle} onChange={() => (window as any).oviApplySettings?.()} />
      </div>

      {/* WEIGHT SOURCE */}
      <div style={{fontSize:'6px', color:'#f0c04055', letterSpacing:'1px', marginBottom:'6px'}}>WEIGHT SOURCE</div>
      <div id="oviWeightMode" style={{display:'flex', gap:'6px', marginBottom:'10px'}}>
        <label style={{fontSize:'7px', color:'#8899aa', display:'flex', alignItems:'center', gap:'4px', cursor:'pointer'}}>
          <input type="radio" name="oviWeightMode" defaultValue="Volume" style={{accentColor:'#f0c040'}} onChange={() => (window as any).oviApplySettings?.()} /> Volume
        </label>
        <label style={{fontSize:'7px', color:'#8899aa', display:'flex', alignItems:'center', gap:'4px', cursor:'pointer'}}>
          <input type="radio" name="oviWeightMode" defaultValue="Range" style={{accentColor:'#f0c040'}} onChange={() => (window as any).oviApplySettings?.()} /> Range
        </label>
        <label style={{fontSize:'7px', color:'#8899aa', display:'flex', alignItems:'center', gap:'4px', cursor:'pointer'}}>
          <input type="radio" name="oviWeightMode" defaultValue="Vol x Range" defaultChecked style={{accentColor:'#f0c040'}} onChange={() => (window as any).oviApplySettings?.()} /> Vol × Range
        </label>
      </div>

      {/* COLORS */}
      <div style={{fontSize:'6px', color:'#f0c04055', letterSpacing:'1px', marginBottom:'6px'}}>COLORS</div>
      <div style={{
        display:'grid', gridTemplateColumns:'1fr auto', gap:'5px 10px', alignItems:'center',
        fontSize:'7px', color:'#8899aa', marginBottom:'10px'
      }}>
        <span>Long Liq Color</span>
        <input type="color" id="oviLongCol" defaultValue="#01c4fe" style={colorInputStyle} onChange={() => (window as any).oviApplySettings?.()} />
        <span>Short Liq Color</span>
        <input type="color" id="oviShortCol" defaultValue="#ffe400" style={colorInputStyle} onChange={() => (window as any).oviApplySettings?.()} />
        <span>Touched Transparency</span>
        <input type="number" id="oviTouchT" defaultValue={8} min={0} max={100} step={1} style={numInputStyle} onChange={() => (window as any).oviApplySettings?.()} />
      </div>

      {/* DISPLAY */}
      <div style={{fontSize:'6px', color:'#f0c04055', letterSpacing:'1px', marginBottom:'6px'}}>DISPLAY</div>
      <div style={{display:'flex', flexDirection:'column', gap:'5px', marginBottom:'12px'}}>
        <label style={{fontSize:'7px', color:'#8899aa', display:'flex', alignItems:'center', gap:'6px', cursor:'pointer'}}>
          <input type="checkbox" id="oviShowScale" defaultChecked style={{accentColor:'#f0c040'}} onChange={() => (window as any).oviApplySettings?.()} /> Show Scale
        </label>
        <label style={{fontSize:'7px', color:'#8899aa', display:'flex', alignItems:'center', gap:'6px', cursor:'pointer'}}>
          <input type="checkbox" id="oviKeepTouched" defaultChecked style={{accentColor:'#f0c040'}} onChange={() => (window as any).oviApplySettings?.()} /> Keep Touched Pockets
        </label>
      </div>

      <button onClick={onClose} style={{
        width:'100%', padding:'6px', background:'#f0c04011', border:'1px solid #f0c04044',
        color:'#f0c040', fontSize:'8px', fontFamily:'var(--ff)', cursor:'pointer',
        borderRadius:'3px', letterSpacing:'1px'
      }} onClick={() => { (window as any).oviApplySettings?.(); onClose() }}>✓ APPLY &amp; REFRESH</button>
    </div>
  )
}
