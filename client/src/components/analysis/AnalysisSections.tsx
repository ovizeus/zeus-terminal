export function AnalysisSections() {
  return (
    <>
      {/* ===== RSI MULTI-TIMEFRAME ===== */}
      <div className="sec">
        <div className="slbl">
          <span>&#9889; RSI MULTI-TIMEFRAME</span>
          <span id="rsiupd" style={{ fontSize: '7px', color: 'var(--dim)' }}></span>
        </div>
        <div className="rsig">
          <div className="rsic rsinow">
            <div className="rsitf">NOW (5m)</div>
            <div className="rsiv mid" id="rn">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb0" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
          <div className="rsic">
            <div className="rsitf">15m</div>
            <div className="rsiv mid" id="r15">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb1" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
          <div className="rsic">
            <div className="rsitf">1h</div>
            <div className="rsiv mid" id="r1h">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb2" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
          <div className="rsic">
            <div className="rsitf">3h</div>
            <div className="rsiv mid" id="r3h">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb3" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
          <div className="rsic">
            <div className="rsitf">4h</div>
            <div className="rsiv mid" id="r4h">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb4" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
          <div className="rsic">
            <div className="rsitf">1d</div>
            <div className="rsiv mid" id="r1d">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb5" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== FEAR & GREED INDEX ===== */}
      <div className="sec">
        <div className="slbl">&#128561; FEAR &amp; GREED INDEX</div>
        <div className="fgw">
          <div className="fgc">
            <svg viewBox="0 0 70 70" width="70" height="70">
              <circle cx="35" cy="35" r="28" fill="none" stroke="#1e2530" strokeWidth="8" />
              <circle
                cx="35" cy="35" r="28" fill="none" stroke="#f0c040" strokeWidth="8"
                strokeDasharray="175.93" strokeDashoffset="175.93" id="fgarc"
                strokeLinecap="round" transform="rotate(-90 35 35)"
                style={{ transition: 'stroke-dashoffset 1s, stroke 1s' }}
              />
            </svg>
            <div className="fgn" id="fgval">&mdash;</div>
          </div>
          <div className="fgi">
            <div className="fgl" id="fglbl" style={{ color: 'var(--ylw)' }}>Loading...</div>
            <div className="fgsub" id="fgsub">Crypto sentiment</div>
            <div className="fgbar">
              <div className="fgf" id="fgf" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7px', marginTop: '2px', color: 'var(--dim)' }}>
              <span>FEAR</span><span>GREED</span>
            </div>
            <div className="fgsub" id="fgch" style={{ marginTop: '3px' }}>Yesterday: &mdash; | Week: &mdash;</div>
          </div>
        </div>
      </div>

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

      {/* ===== LIQUIDITY MAGNET SCANNER ===== */}
      <div className="sec" id="magSec">
        <div className="slbl" style={{ justifyContent: 'space-between' }}>
          <span>MAGNET DE LICHIDITATE &mdash; RADAR</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span id="magUpdTime" style={{ fontSize: '7px', color: 'var(--dim)' }}>&mdash;</span>
            <button
              style={{
                fontSize: '7px', padding: '2px 7px', border: '1px solid #f0c04033',
                borderRadius: '2px', background: 'transparent', color: 'var(--gold)',
                cursor: 'pointer', fontFamily: 'var(--ff)'
              }}
            >&#8634;</button>
          </div>
        </div>

        {/* Magnet summary */}
        <div className="mag-summary" id="magSummary">
          <div className="mag-sum-item">
            <div className="mag-sum-lbl">MAGNET SUS</div>
            <div className="mag-sum-val" id="magNearAbove" style={{ color: 'var(--red)' }}>&mdash;</div>
          </div>
          <div className="mag-sum-item">
            <div className="mag-sum-lbl">BIAS</div>
            <div className="mag-bias neut" id="magBias">NEUTRAL</div>
          </div>
          <div className="mag-sum-item">
            <div className="mag-sum-lbl">MAGNET JOS</div>
            <div className="mag-sum-val" id="magNearBelow" style={{ color: 'var(--grn)' }}>&mdash;</div>
          </div>
        </div>

        <div className="mag-wrap">
          {/* Above price */}
          <div className="mag-title">
            <span><span className="z-dot z-dot--red"></span> REZISTENTA / MAGNETI SUS</span>
            <span id="magAboveCnt" style={{ color: 'var(--red)' }}>&mdash;</span>
          </div>
          <div className="mag-arrow" id="magAboveList">
            <div style={{ padding: '10px', textAlign: 'center', fontSize: '8px', color: 'var(--dim)' }}>Se incarca...</div>
          </div>

          {/* Separator = current price */}
          <div className="mag-separator" style={{ margin: '6px 0' }}>
            <div className="mag-sep-line"></div>
            <span>&#9679; <span id="magCurrentPrice">&mdash;</span> &#9679;</span>
            <div className="mag-sep-line"></div>
          </div>

          {/* Below price */}
          <div className="mag-title">
            <span><span className="z-dot z-dot--grn"></span> SUPORT / MAGNETI JOS</span>
            <span id="magBelowCnt" style={{ color: 'var(--grn)' }}>&mdash;</span>
          </div>
          <div className="mag-arrow" id="magBelowList">
            <div style={{ padding: '10px', textAlign: 'center', fontSize: '8px', color: 'var(--dim)' }}>Se incarca...</div>
          </div>
        </div>
      </div>

      {/* ===== MULTI-SYMBOL SCANNER TABLE ===== */}
      <div className="sec" id="mscanSec">
        <div className="slbl" style={{ justifyContent: 'space-between' }}>
          <span>MULTI-SYMBOL SCANNER &mdash; LIVE</span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span id="mscanUpdTime" style={{ fontSize: '7px', color: 'var(--dim)' }}>&mdash;</span>
            <span id="mscanOpps" style={{ fontSize: '7px', color: '#00ff88' }}>0 oportunitati</span>
            <button
              style={{
                fontSize: '7px', padding: '2px 7px', border: '1px solid #00b8d433',
                borderRadius: '2px', background: 'transparent', color: '#00b8d4',
                cursor: 'pointer', fontFamily: 'var(--ff)'
              }}
            >&#8634; SCAN</button>
          </div>
        </div>
        <div className="mscan-wrap">
          <table className="mscan-table">
            <thead>
              <tr>
                <th>SYM</th>
                <th>PRICE</th>
                <th>24H</th>
                <th>RSI(5m)</th>
                <th>MACD</th>
                <th>S.TREND</th>
                <th>ADX</th>
                <th>SCORE</th>
                <th>SIGNAL</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody id="mscanBody">
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '16px', color: 'var(--dim)', fontSize: '8px' }}>
                  Apasa SCAN sau asteapta Auto Trade sa porneasca...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== DAY / HOUR WIN RATE FILTER ===== */}
      <div className="sec" id="dhfSec">
        <div className="slbl" style={{ justifyContent: 'space-between' }}>
          <span>DAY / HOUR WIN RATE FILTER</span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span id="dhfCurrentSlot" style={{ fontSize: '8px', color: '#00ff88' }}>&mdash;</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '7px', cursor: 'pointer' }}>
              <input type="checkbox" id="dhfEnabled" defaultChecked />
              <span style={{ color: '#aa44ff' }}>Filtru activ</span>
            </label>
          </div>
        </div>
        <div style={{ fontSize: '7px', letterSpacing: '1px', color: 'var(--dim)', padding: '4px 10px' }}>
          ZILE SAPTAMANA &mdash; WR mediu pe simboluri
        </div>
        <div className="dhf-grid" id="dhfDayGrid">
          {/* filled by JS */}
        </div>
        <div style={{ fontSize: '7px', letterSpacing: '1px', color: 'var(--dim)', padding: '4px 10px' }}>
          ORE ROMANIA (UTC+2/+3) &mdash; Evita orele rosii
        </div>
        <div className="dhf-hours" id="dhfHourGrid">
          {/* filled by JS */}
        </div>
        <div style={{ padding: '4px 10px 8px', fontSize: '7px', color: 'var(--dim)' }}>
          <span style={{ color: '#00d97a' }}>&#9632;</span> WR&ge;60% &mdash; Tranzactioneaza &nbsp;
          <span style={{ color: '#f0c040' }}>&#9632;</span> WR 45-60% &mdash; Caution &nbsp;
          <span style={{ color: '#ff4466' }}>&#9632;</span> WR&lt;45% &mdash; Evita
        </div>
      </div>

      {/* ===== PERFORMANCE TRACKER — PER INDICATOR ===== */}
      <div className="sec" id="perfSec">
        <div className="slbl" style={{ justifyContent: 'space-between' }}>
          <span>PERFORMANCE TRACKER &mdash; PER INDICATOR</span>
          <span id="perfUpdTime" style={{ fontSize: '9px', color: 'var(--dim)' }}>Live din trades</span>
        </div>
        <div style={{ padding: '4px 10px 4px', fontSize: '9px', color: 'var(--dim)', display: 'flex', justifyContent: 'space-between' }}>
          <span>INDICATOR</span><span>WIN RATE | TRADES | WEIGHT AI</span>
        </div>
        <div id="perfTrackerBody">
          <div style={{ padding: '16px', textAlign: 'center', fontSize: '10px', color: 'var(--dim)' }}>
            Se colecteaza date din Auto Trade...
          </div>
        </div>
        <div style={{ padding: '6px 10px', fontSize: '9px', color: 'var(--dim)', borderTop: '1px solid #0d1520', lineHeight: 1.8 }}>
          Zeus Brain pondereaza automat Confluence Score bazat pe performanta reala a fiecarui indicator.<br />
          Indicatorii cu WR mare primesc greutate mai mare in decizia de intrare.
        </div>
      </div>

      {/* ===== BACKTEST ENGINE ===== */}
      <div className="sec" id="btSec">
        <div className="slbl" style={{ justifyContent: 'space-between' }}>
          <span>BACKTEST ENGINE &mdash; PRECIZIE INDICATORI</span>
          <span id="btLastRun" style={{ fontSize: '9px', color: 'var(--dim)' }}>Nerulatat</span>
        </div>
        <div className="bt-wrap">
          {/* Controls */}
          <div className="bt-controls">
            <button className="bt-btn bt-btn-run" id="btRunBtn">&#9654; RUN BACKTEST</button>
            <select className="bt-sel" id="btLookback" defaultValue="500">
              <option value="100">100 bare</option>
              <option value="200">200 bare</option>
              <option value="500">500 bare</option>
              <option value="1000">1000 bare (max)</option>
            </select>
            <select className="bt-sel" id="btFwdBars" defaultValue="5">
              <option value="3">+3 bare</option>
              <option value="5">+5 bare</option>
              <option value="10">+10 bare</option>
              <option value="20">+20 bare</option>
            </select>
            <select className="bt-sel" id="btMinMove" defaultValue="0.5">
              <option value="0.2">&ge;0.2% move</option>
              <option value="0.5">&ge;0.5% move</option>
              <option value="1.0">&ge;1.0% move</option>
            </select>
          </div>

          {/* Progress */}
          <div className="bt-progress" id="btProgress" style={{ display: 'none' }}>
            <div>Se calculeaza... <span id="btProgressPct">0</span>%</div>
            <div className="bt-progress-bar">
              <div className="bt-progress-fill" id="btProgressFill" style={{ width: '0%' }}></div>
            </div>
          </div>

          {/* Results */}
          <div id="btResults" style={{ display: 'none' }}>
            {/* Summary row */}
            <div className="bt-summary">
              <div className="bt-sum-cell">
                <div className="bt-sum-lbl">BEST INDICATOR</div>
                <div className="bt-sum-val" id="btBestInd" style={{ color: 'var(--gold)', fontSize: '11px' }}>&mdash;</div>
              </div>
              <div className="bt-sum-cell">
                <div className="bt-sum-lbl">MEDIE WIN RATE</div>
                <div className="bt-sum-val" id="btAvgWR" style={{ color: 'var(--whi)' }}>&mdash;</div>
              </div>
              <div className="bt-sum-cell">
                <div className="bt-sum-lbl">TOTAL SEMNALE</div>
                <div className="bt-sum-val" id="btTotalSig" style={{ color: 'var(--blu)' }}>&mdash;</div>
              </div>
              <div className="bt-sum-cell">
                <div className="bt-sum-lbl">CONFLUENCE WR</div>
                <div className="bt-sum-val" id="btConfWR" style={{ color: 'var(--pur)' }}>&mdash;</div>
              </div>
            </div>

            {/* Table header */}
            <div className="bt-ind-row hdr">
              <span>INDICATOR</span>
              <span>WIN RATE</span>
              <span style={{ textAlign: 'center' }}>SEMNALE</span>
              <span style={{ textAlign: 'right' }}>R:R</span>
              <span style={{ textAlign: 'center' }}>GRAD</span>
            </div>

            {/* Results rows */}
            <div className="bt-result-grid" id="btResultGrid"></div>

            {/* Equity curve */}
            <div className="bt-equity">
              <div className="bt-equity-lbl">CURBA ECHITATE &mdash; CONFLUENTA (simulat $1000)</div>
              <div className="bt-equity-chart">
                <svg className="bt-eq-svg" id="btEquitySvg" viewBox="0 0 400 50" preserveAspectRatio="none"></svg>
              </div>
            </div>

            {/* Detail note */}
            <div className="bt-detail" id="btDetailNote">
              <svg className="z-i" viewBox="0 0 16 16">
                <circle cx="8" cy="4" r="1" fill="currentColor" stroke="none" />
                <path d="M7 7h2v6H7z" fill="currentColor" stroke="none" />
              </svg> Backtestul verifica daca, dupa fiecare semnal detectat in istoric, pretul a confirmat directia in
              urmatoarele bare.
              Win Rate &gt; 55% = semnal util. Win Rate &gt; 65% = semnal excelent. Rezultatele sunt pe datele istorice
              disponibile.
            </div>
          </div>

          {/* Empty state */}
          <div id="btEmpty" style={{ padding: '16px', textAlign: 'center', fontSize: '9px', color: 'var(--dim)' }}>
            Apasa <strong style={{ color: 'var(--gold)' }}>&#9654; RUN BACKTEST</strong> pentru a analiza precizia indicatorilor pe
            datele istorice curente.
          </div>
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

      {/* ===== LIQUIDATIONS MONITOR ===== */}
      <div className="sec">
        <div className="slbl">
          <span>&#128165; LIQUIDATIONS MONITOR</span>
          <span id="calm" style={{ fontSize: '8px', padding: '1px 6px', borderRadius: '2px', background: '#1a1a1a', color: 'var(--dim)' }}>CALM</span>
        </div>
        <div className="lmcs">
          <div className="lmc lc">
            <div className="lmcl">LONG LIQS</div>
            <div className="lmcv cr" id="llc">0</div>
            <div className="lmcs2" id="llu">$0</div>
            <div className="lmcs2" id="lla">avg: &mdash;</div>
          </div>
          <div className="lmc sc">
            <div className="lmcl">SHORT LIQS</div>
            <div className="lmcv cgr" id="lsc">0</div>
            <div className="lmcs2" id="lsu">$0</div>
            <div className="lmcs2" id="lsa">avg: &mdash;</div>
          </div>
          <div className="lmc rc">
            <div className="lmcl">RATE</div>
            <div className="lmcv cg" id="lrate">0</div>
            <div className="lmcs2">per minute</div>
            <div className="lmcs2" id="lratio">&mdash;</div>
          </div>
          <div className="lmc ec">
            <div className="lmcl">EST. LOSSES</div>
            <div className="lmcv cr" id="lloss">$0</div>
            <div className="lmcs2">Total USD session</div>
          </div>
        </div>
        <div className="lmtf">
          <div>
            <span style={{ color: 'var(--dim)' }}>1m:</span>
            <span className="L" id="t1l"> 0L</span>
            <span className="S" id="t1s"> 0S</span>
            <span className="V" id="t1v"> $0</span>
          </div>
          <div>
            <span style={{ color: 'var(--dim)' }}>5m:</span>
            <span className="L" id="t5l"> 0L</span>
            <span className="S" id="t5s"> 0S</span>
            <span className="V" id="t5v"> $0</span>
          </div>
          <div>
            <span style={{ color: 'var(--dim)' }}>15m:</span>
            <span className="L" id="t15l"> 0L</span>
            <span className="S" id="t15s"> 0S</span>
            <span className="V" id="t15v"> $0</span>
          </div>
        </div>
        <div className="hz">
          <div className="hzt">&#128293; HOT ZONES &mdash; BTC LIQ CLUSTERS</div>
          <div id="hzc">
            <div style={{ fontSize: '9px', color: 'var(--dim)', textAlign: 'center', padding: '10px' }}>Accumulating data...</div>
          </div>
        </div>
        <div className="pr">
          <span style={{ fontSize: '8px', letterSpacing: '1.5px', color: 'var(--txt)', fontWeight: 600 }}>MARKET PRESSURE</span>
          <div className="pvv neut" id="pvv">NEUTRAL</div>
        </div>
      </div>

      {/* ===== ZEUS TRADER — AI METRICS ===== */}
      <div className="sec">
        <div className="slbl" style={{ justifyContent: 'space-between' }}>
          <span>ZEUS TRADER &mdash; AI METRICS</span>
        </div>
        <div className="dttabs">
          <div className="dtt act">1H</div>
          <div className="dtt">4H</div>
          <div className="dtt">12H</div>
          <div className="dtt">1D</div>
          <div className="dtt">1W</div>
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

      {/* ===== CONFLUENCE SCORE — ZEUS AI ===== */}
      <div className="sec">
        <div className="slbl">CONFLUENCE SCORE &mdash; ZEUS AI</div>
        <div className="conf-widget">
          <div className="conf-row">
            <div>
              <div className="conf-score" id="confScore" style={{ color: 'var(--dim)' }}>&mdash;</div>
              <div className="conf-label" id="confLabel">WAITING DATA</div>
            </div>
            <div style={{ flex: 1, paddingLeft: '12px' }}>
              <div style={{ fontSize: '7px', color: 'var(--dim)', letterSpacing: '1px', marginBottom: '4px' }}>CONFLUENTA</div>
              <div className="conf-meter">
                <div className="conf-fill" id="confFill" style={{ width: '0%', background: '#555' }}></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '6px', color: 'var(--dim)', marginTop: '2px' }}>
                <span>BEAR</span><span>NEUTRAL</span><span>BULL</span>
              </div>
            </div>
          </div>
          <div className="conf-bars" id="confBars" style={{ marginTop: '8px' }}>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbRSI" style={{ width: '0%', background: '#f5c842' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '28px' }}>RSI</span>
            </div>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbMACD" style={{ width: '0%', background: '#00e5ff' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '36px' }}>MACD</span>
            </div>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbST" style={{ width: '0%', background: '#ff8800' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '28px' }}>ST</span>
            </div>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbLS" style={{ width: '0%', background: '#aa44ff' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '28px' }}>L/S</span>
            </div>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbFR" style={{ width: '0%', background: '#f0c040' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '28px' }}>FR</span>
            </div>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbOI" style={{ width: '0%', background: '#00b8d4' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '28px' }}>OI</span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== LIQUIDATION OVERVIEW ===== */}
      <div className="sec">
        <div className="slbl">&#127777;&#65039; LIQUIDATION OVERVIEW</div>
        <div className="s4">
          <div className="st">
            <div className="stl">TOTAL 1H</div>
            <div className="stv cb" id="tv">$0</div>
          </div>
          <div className="st">
            <div className="stl">LONGS LIQ</div>
            <div className="stv cr" id="lv">$0</div>
          </div>
          <div className="st">
            <div className="stl">SHORTS LIQ</div>
            <div className="stv cgr" id="sv">$0</div>
          </div>
          <div className="st">
            <div className="stl">COUNT</div>
            <div className="stv cw" id="cv">0</div>
          </div>
        </div>
        <div className="hmw">
          <div className="hmg" id="hmg"></div>
          <div className="rbar">
            <div className="rfill" id="rfill" style={{ width: '50%' }}></div>
          </div>
          <div className="rlbl">
            <span id="lplbl">LONG 50%</span>
            <span id="splbl">SHORT 50%</span>
          </div>
        </div>
        {/* LIQ SOURCE METRICS */}
        <div className="liq-src-panel">
          <div className="liq-src-hdr">SOURCE CONTRIBUTION</div>
          <div className="liq-src-grid">
            <div className="liq-src-col">
              <div className="liq-src-lbl" style={{ color: 'var(--grn)' }}>BNB</div>
              <div className="liq-src-val" id="lm-bnb-cnt">0</div>
              <div className="liq-src-sub" id="lm-bnb-usd">$0</div>
              <div className="liq-src-pct" id="lm-bnb-pct">0%</div>
            </div>
            <div className="liq-src-col">
              <div className="liq-src-lbl" style={{ color: 'var(--ylw)' }}>BYB</div>
              <div className="liq-src-val" id="lm-byb-cnt">0</div>
              <div className="liq-src-sub" id="lm-byb-usd">$0</div>
              <div className="liq-src-pct" id="lm-byb-pct">0%</div>
            </div>
            <div className="liq-src-col">
              <div className="liq-src-lbl" style={{ color: 'var(--dim)' }}>LAST</div>
              <div className="liq-src-val" id="lm-last-src">&mdash;</div>
              <div className="liq-src-sub">DUP?</div>
              <div className="liq-src-pct" id="lm-dup-cnt">0</div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== LIVE FEED ===== */}
      <div className="sec">
        <div className="fdh">
          <span>&#9889; LIVE FEED</span>
          <span id="fcnt">0 events</span>
        </div>
        <div className="liq-filter-bar">
          <button className="liq-fbtn act" id="lf-all">ALL</button>
          <button className="liq-fbtn" id="lf-bnb">BNB</button>
          <button className="liq-fbtn" id="lf-byb">BYB</button>
        </div>
        <div className="feed">
          <div className="fdlist" id="fdlist"></div>
        </div>
      </div>

      {/* ===== TICKER WIDGET ===== */}
      <div className="tickw">
        <div className="tick" id="ticker">
          <span className="ti">ZeuS Terminal loading...</span>
          <span className="ti">ZeuS Terminal loading...</span>
        </div>
      </div>
    </>
  );
}
