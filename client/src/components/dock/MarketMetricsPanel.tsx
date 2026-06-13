/** Market Metrics dock page view — [UI-COMPACT 2026-06-13]
 *  BTC MARKET METRICS + BTC ORDER BOOK — LIVE + ZeuS S/R LEVELS — AUTO moved 1:1
 *  from AnalysisSections.tsx (home scroll zone) into a dedicated dock icon,
 *  placed between Liquidations and Activity — operator request to shorten the
 *  home scroll, same pattern as the Liquidations page.
 *
 *  All three are filled by legacy JS strictly via getElementById (funding/OI/ATR/
 *  L-S via marketCoreReactor + stateAccessors; #askc/#bidc order book; .srgrid S/R
 *  levels) — position-agnostic. The dock panel wrapper stays in the DOM at all
 *  times (only CSS-hidden when the page is closed), so the imperative updaters
 *  keep filling the same ids with the panel closed. IDs preserved 1:1.
 *  Paired change: bootstrapInit.ts no longer mvSec()'s #frv / #askc / .srgrid.
 */

export function MarketMetricsPanel() {
  return (
    <>
      {/* ===== BTC MARKET METRICS ===== */}
      <div className="sec">
        <div className="slbl">&#9672; BTC MARKET METRICS</div>
        <div className="m4">
          <div className="mc4">
            <div className="ml">FUNDING RATE</div>
            <div className="mv cg" id="frv">&mdash;</div>
            <div className="ms" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span id="frs">next: &mdash;</span>
              <span className="fr-cd" id="frCd" style={{ display: 'none' }}>00:00</span>
            </div>
          </div>
          <div className="mc4">
            <div className="ml">OPEN INTEREST</div>
            <div className="mv cb" id="oiv">&mdash;</div>
            <div className="ms" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span id="ois">&mdash;</span>
              <span className="oi-delta" id="oiDelta5m" style={{ display: 'none' }}></span>
            </div>
          </div>
          <div className="mc4">
            <div className="ml">ATR (14)</div>
            <div className="mv cg" id="atrv">&mdash;</div>
            <div className="ms">1h volatility</div>
          </div>
          <div className="mc4">
            <div className="ml">L/S RATIO</div>
            <div className="mv cw" id="lsv">&mdash;</div>
            <div className="ms" id="lss">&mdash;</div>
          </div>
        </div>
      </div>

      {/* ===== BTC ORDER BOOK — LIVE ===== */}
      <div className="sec">
        <div className="slbl">&#128214; BTC ORDER BOOK &mdash; LIVE</div>
        <div className="obw">
          <div className="obh"><span>PRICE</span><span>QTY (BTC)</span><span>TOTAL</span></div>
          <div id="askc"></div>
          <div className="obsp" id="obsp">SPREAD &mdash;</div>
          <div id="bidc"></div>
        </div>
      </div>

      {/* ===== ZEUS S/R LEVELS — AUTO ===== */}
      <div className="sec">
        <div className="slbl">&#128305; ZeuS S/R LEVELS &mdash; AUTO</div>
        <div className="srgrid">
          <div className="srrow">
            <span className="srl slz">ZeuS &#8593;</span>
            <span className="srp" id="szh">&mdash;</span>
            <span className="srd ab" id="sdh">&mdash;</span>
          </div>
          <div className="srrow">
            <span className="srl slr">Z3</span>
            <span className="srp" id="sr3">&mdash;</span>
            <span className="srd ab" id="sd3">&mdash;</span>
          </div>
          <div className="srrow">
            <span className="srl slr">Z2</span>
            <span className="srp" id="sr2">&mdash;</span>
            <span className="srd ab" id="sd2">&mdash;</span>
          </div>
          <div className="srrow">
            <span className="srl slr">Z1</span>
            <span className="srp" id="sr1">&mdash;</span>
            <span className="srd ab" id="sd1">&mdash;</span>
          </div>
          <div className="srrow">
            <span className="srl sldt">DT/VWAP</span>
            <span className="srp" id="srdt">&mdash;</span>
            <span className="srd" id="sddt">&mdash;</span>
          </div>
          <div className="srrow">
            <span className="srl slnow">&#9679; NOW</span>
            <span className="srp" style={{ color: 'var(--gold)' }} id="srnow">&mdash;</span>
            <span className="srd" style={{ color: 'var(--dim)' }}>LIVE</span>
          </div>
          <div className="srrow">
            <span className="srl sldb">DB/PIVOT</span>
            <span className="srp" id="srdb">&mdash;</span>
            <span className="srd be" id="sddb">&mdash;</span>
          </div>
          <div className="srrow">
            <span className="srl sls">L1</span>
            <span className="srp" id="ss1">&mdash;</span>
            <span className="srd be" id="sds1">&mdash;</span>
          </div>
          <div className="srrow">
            <span className="srl sls">L2</span>
            <span className="srp" id="ss2">&mdash;</span>
            <span className="srd be" id="sds2">&mdash;</span>
          </div>
          <div className="srrow">
            <span className="srl sls">L3</span>
            <span className="srp" id="ss3">&mdash;</span>
            <span className="srd be" id="sds3">&mdash;</span>
          </div>
          <div className="srrow">
            <span className="srl slz">ZeuS &#8595;</span>
            <span className="srp" id="szl">&mdash;</span>
            <span className="srd be" id="sdl">&mdash;</span>
          </div>
        </div>
      </div>
    </>
  )
}
