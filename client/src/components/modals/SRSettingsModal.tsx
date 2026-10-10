import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { applySR } from '../../data/marketDataWS'

interface Props { visible: boolean; onClose: () => void }

// [R10 2026-10-10] This panel used to offer 21 controls. Exactly ONE of them was
// connected: applySR (marketDataWS.ts:582) reads the srEn checkbox and nothing
// else, then says "S/R settings applied".
//
// The controls were not merely unwired — most of them advertised a feature that
// was never built. renderSROverlay (marketDataOverlays.ts:408) is seventeen
// lines: the top three highs and bottom three lows of the last fifty candles,
// drawn with hardcoded colour, width and opacity. There are no pivots, no zones,
// no labels, no strength scoring and no volume filter, so Pivot Length, Max
// Levels, Min Strength, Zone Width, Show Labels, Width by Strength, Extend
// Lines, Show Touched, Hide Weak, Min Volume, the two opacities, the two widths,
// the two colours, the Timeframe row and the Display Period row described a
// product that does not exist. Two tells: the panel claimed "Max Levels: 8"
// while the engine always draws 6, and the colour pickers defaulted to the exact
// hardcoded colours, so they looked connected.
//
// On the operator's decision, the twenty dead controls are gone and the two that
// work remain. Nothing is lost, because nothing they promised was ever
// delivered. His one concern was whether this touched the chart's timeframes:
// it does not. The Timeframe row here was a private useState read only for a CSS
// class; the chart's timeframes live in marketDataFeeds.setTF and the .tfb
// buttons, and this file never referenced either. srPanelHonest.test.ts pins
// that, along with the removal.
//
// Building a real S/R engine — pivots, zones, strength — is separate work, not
// a repair, and would bring its own settings back with it.

export function SRSettingsModal({ visible, onClose }: Props) {
  return (
    <ModalOverlay id="msr" visible={visible} onClose={onClose} zIndex={9500}>
      <ModalHeader title="ZEUS S/R SETTINGS" onClose={onClose} />

      <div className="mbody" style={{ padding: '12px' }}>
        <label className="mchk"><input type="checkbox" id="srEn" defaultChecked /> Enable S/R</label>

        <div style={{ marginTop: '10px', fontSize: '9px', color: 'var(--dim, #5a6b7a)', lineHeight: 1.5 }}>
          Support and resistance are detected automatically from the last 50 candles.
        </div>

        <div style={{ marginTop: '12px', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <button className="hub-sbtn pri" onClick={() => { applySR?.(); onClose() }}>SAVE</button>
          <button className="hub-sbtn" onClick={onClose}>CLOSE</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
