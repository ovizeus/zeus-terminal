import { setDtTf } from '../../data/marketDataFeeds'

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

      {/* ===== ZEUS TRADER — AI METRICS ===== */}
      {/* [UI-COMPACT 2026-06-13] Moved 1:1 from AnalysisSections.tsx (was under RSI
          MULTI-TIMEFRAME). The 1H/4H/12H/1D/1W tabs were dead in React (onClick lost
          in migration) — re-wired here to setDtTf, which now drives the PRICE row's
          CHANGE/SIGNAL from real per-interval klines. bootstrapInit mvSec('.dttabs')
          removed in pair. */}
      <div className="sec">
        <div className="slbl" style={{ justifyContent: 'space-between' }}>
          <span>ZEUS TRADER &mdash; AI METRICS</span>
        </div>
        <div className="dttabs">
          <div className="dtt act" onClick={(e) => setDtTf('1H', e.currentTarget)}>1H</div>
          <div className="dtt" onClick={(e) => setDtTf('4H', e.currentTarget)}>4H</div>
          <div className="dtt" onClick={(e) => setDtTf('12H', e.currentTarget)}>12H</div>
          <div className="dtt" onClick={(e) => setDtTf('1D', e.currentTarget)}>1D</div>
          <div className="dtt" onClick={(e) => setDtTf('1W', e.currentTarget)}>1W</div>
        </div>
        <div style={{ fontSize: '7px', color: 'var(--dim)', letterSpacing: '0.5px', margin: '2px 0 4px' }}>
          Timeframe drives PRICE &amp; RSI (1H/4H/1D) · OI / FR / L-S are live
        </div>
        <div className="dttbl">
          <div className="dtrow hrow">
            <span>METRIC</span>
            <span style={{ textAlign: 'right' }}>CURRENT</span>
            <span style={{ textAlign: 'right' }}>CHANGE</span>
            <span style={{ textAlign: 'right' }}>SIGNAL</span>
          </div>
          <div className="dtrow">
            <span className="dtm">PRICE</span>
            <span className="dtc" id="dtp">&mdash;</span>
            <span className="dtch" id="dtpc">&mdash;</span>
            <span className="dts" id="dtps">&mdash;</span>
          </div>
          <div className="dtrow">
            <span className="dtm">OPEN INTEREST</span>
            <span className="dtc" id="dtoi">&mdash;</span>
            <span className="dtch" id="dtoic">&mdash;</span>
            <span className="dts" id="dtois">&mdash;</span>
          </div>
          <div className="dtrow">
            <span className="dtm">FUNDING RATE</span>
            <span className="dtc" id="dtfr">&mdash;</span>
            <span className="dtch" id="dtfrc">&mdash;</span>
            <span className="dts" id="dtfrs">&mdash;</span>
          </div>
          <div className="dtrow">
            <span className="dtm">LONG/SHORT</span>
            <span className="dtc" id="dtls">&mdash;</span>
            <span className="dtch" id="dtlsc">&mdash;</span>
            <span className="dts" id="dtlss">&mdash;</span>
          </div>
          <div className="dtrow">
            <span className="dtm">RSI</span>
            <span className="dtc" id="dtrsi">&mdash;</span>
            <span className="dtch" id="dtrsic">&mdash;</span>
            <span className="dts" id="dtrsis">&mdash;</span>
          </div>
        </div>
      </div>
    </>
  )
}
