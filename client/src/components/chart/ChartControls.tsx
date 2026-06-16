import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useMarketStore, useUiStore } from '../../stores'
import { setTF } from '../../data/marketDataFeeds'
import { togInd as togIndFn } from '../../ui/dom2'
import { togOvr as togOvrFn } from '../../data/marketDataOverlays'
import { toggleSession as toggleSessionFn, toggleVWAP as toggleVWAPFn, applyVWAPRestore } from '../../ui/panels'
import { toggleFS as toggleFSFn } from '../../data/marketDataFeeds'
import { setSymbol } from '../../data/marketDataWS'
import { openIndSettings } from '../../engine/indicators'
import { CANDLE_TYPES, applyCandleType, type CandleType } from '../../ui/candleTypeSwitcher'
import { USER_SETTINGS } from '../../core/config'
import { IND_ICONS } from '../../constants/indicatorIcons'

const TIMEFRAMES = ['1m','3m','5m','15m','30m','1h','2h','4h','5h','6h','12h','1d','3d','1w','1M']

const SYMBOLS: { label: string; items: { value: string; label: string }[] }[] = [
  { label: '★ Majors', items: [
    { value: 'BTCUSDT', label: 'BTC/USDT' },
    { value: 'ETHUSDT', label: 'ETH/USDT' },
    { value: 'BNBUSDT', label: 'BNB/USDT' },
    { value: 'SOLUSDT', label: 'SOL/USDT' },
    { value: 'XRPUSDT', label: 'XRP/USDT' },
    { value: 'DOGEUSDT', label: 'DOGE/USDT' },
    { value: 'ADAUSDT', label: 'ADA/USDT' },
    { value: 'TRXUSDT', label: 'TRX/USDT' },
    { value: 'LTCUSDT', label: 'LTC/USDT' },
    { value: 'BCHUSDT', label: 'BCH/USDT' },
  ] },
  { label: 'Layer 1', items: [
    { value: 'AVAXUSDT', label: 'AVAX/USDT' },
    { value: 'DOTUSDT', label: 'DOT/USDT' },
    { value: 'NEARUSDT', label: 'NEAR/USDT' },
    { value: 'ATOMUSDT', label: 'ATOM/USDT' },
    { value: 'APTUSDT', label: 'APT/USDT' },
    { value: 'SUIUSDT', label: 'SUI/USDT' },
    { value: 'SEIUSDT', label: 'SEI/USDT' },
    { value: 'TIAUSDT', label: 'TIA/USDT' },
    { value: 'INJUSDT', label: 'INJ/USDT' },
    { value: 'ICPUSDT', label: 'ICP/USDT' },
    { value: 'ALGOUSDT', label: 'ALGO/USDT' },
    { value: 'EGLDUSDT', label: 'EGLD/USDT' },
    { value: 'HBARUSDT', label: 'HBAR/USDT' },
    { value: 'XLMUSDT', label: 'XLM/USDT' },
    { value: 'XTZUSDT', label: 'XTZ/USDT' },
    { value: 'KASUSDT', label: 'KAS/USDT' },
    { value: 'TONUSDT', label: 'TON/USDT' },
    { value: 'FLOWUSDT', label: 'FLOW/USDT' },
    { value: 'KAVAUSDT', label: 'KAVA/USDT' },
    { value: 'MINAUSDT', label: 'MINA/USDT' },
    { value: 'ZILUSDT', label: 'ZIL/USDT' },
    { value: 'ONTUSDT', label: 'ONT/USDT' },
    { value: 'QTUMUSDT', label: 'QTUM/USDT' },
    { value: 'ROSEUSDT', label: 'ROSE/USDT' },
    { value: 'CELOUSDT', label: 'CELO/USDT' },
    { value: 'IOTAUSDT', label: 'IOTA/USDT' },
    { value: 'NEOUSDT', label: 'NEO/USDT' },
    { value: 'VETUSDT', label: 'VET/USDT' },
    { value: 'DASHUSDT', label: 'DASH/USDT' },
    { value: 'XMRUSDT', label: 'XMR/USDT' },
    { value: 'ZECUSDT', label: 'ZEC/USDT' },
    { value: 'CFXUSDT', label: 'CFX/USDT' },
  ] },
  { label: 'Layer 2 & Scaling', items: [
    { value: 'POLUSDT', label: 'POL/USDT' },
    { value: 'ARBUSDT', label: 'ARB/USDT' },
    { value: 'OPUSDT', label: 'OP/USDT' },
    { value: 'STRKUSDT', label: 'STRK/USDT' },
    { value: 'ZKUSDT', label: 'ZK/USDT' },
    { value: 'MANTAUSDT', label: 'MANTA/USDT' },
    { value: 'METISUSDT', label: 'METIS/USDT' },
    { value: 'IMXUSDT', label: 'IMX/USDT' },
    { value: 'SKLUSDT', label: 'SKL/USDT' },
    { value: 'TAIKOUSDT', label: 'TAIKO/USDT' },
    { value: 'ZROUSDT', label: 'ZRO/USDT' },
  ] },
  { label: 'DeFi', items: [
    { value: 'UNIUSDT', label: 'UNI/USDT' },
    { value: 'AAVEUSDT', label: 'AAVE/USDT' },
    { value: 'CRVUSDT', label: 'CRV/USDT' },
    { value: 'LDOUSDT', label: 'LDO/USDT' },
    { value: 'SNXUSDT', label: 'SNX/USDT' },
    { value: 'COMPUSDT', label: 'COMP/USDT' },
    { value: 'SUSHIUSDT', label: 'SUSHI/USDT' },
    { value: '1INCHUSDT', label: '1INCH/USDT' },
    { value: 'DYDXUSDT', label: 'DYDX/USDT' },
    { value: 'GMXUSDT', label: 'GMX/USDT' },
    { value: 'CAKEUSDT', label: 'CAKE/USDT' },
    { value: 'RUNEUSDT', label: 'RUNE/USDT' },
    { value: 'PENDLEUSDT', label: 'PENDLE/USDT' },
    { value: 'ENAUSDT', label: 'ENA/USDT' },
    { value: 'JUPUSDT', label: 'JUP/USDT' },
    { value: 'JTOUSDT', label: 'JTO/USDT' },
    { value: 'CVXUSDT', label: 'CVX/USDT' },
    { value: 'SPELLUSDT', label: 'SPELL/USDT' },
    { value: 'YFIUSDT', label: 'YFI/USDT' },
    { value: 'BANDUSDT', label: 'BAND/USDT' },
    { value: 'UMAUSDT', label: 'UMA/USDT' },
    { value: 'KNCUSDT', label: 'KNC/USDT' },
    { value: 'ZRXUSDT', label: 'ZRX/USDT' },
    { value: 'ANKRUSDT', label: 'ANKR/USDT' },
    { value: 'ETHFIUSDT', label: 'ETHFI/USDT' },
    { value: 'AEROUSDT', label: 'AERO/USDT' },
    { value: 'MORPHOUSDT', label: 'MORPHO/USDT' },
  ] },
  { label: 'Meme', items: [
    { value: 'WIFUSDT', label: 'WIF/USDT' },
    { value: 'BOMEUSDT', label: 'BOME/USDT' },
    { value: 'MEMEUSDT', label: 'MEME/USDT' },
    { value: 'ORDIUSDT', label: 'ORDI/USDT' },
    { value: 'DOGSUSDT', label: 'DOGS/USDT' },
    { value: 'NEIROUSDT', label: 'NEIRO/USDT' },
    { value: 'POPCATUSDT', label: 'POPCAT/USDT' },
    { value: 'MEWUSDT', label: 'MEW/USDT' },
    { value: 'BRETTUSDT', label: 'BRETT/USDT' },
    { value: 'TURBOUSDT', label: 'TURBO/USDT' },
    { value: 'PNUTUSDT', label: 'PNUT/USDT' },
    { value: 'ACTUSDT', label: 'ACT/USDT' },
    { value: 'MOODENGUSDT', label: 'MOODENG/USDT' },
    { value: 'GOATUSDT', label: 'GOAT/USDT' },
    { value: '1000SATSUSDT', label: '1000SATS/USDT' },
    { value: 'PEOPLEUSDT', label: 'PEOPLE/USDT' },
  ] },
  { label: 'AI & Data', items: [
    { value: 'FETUSDT', label: 'FET/USDT' },
    { value: 'RENDERUSDT', label: 'RENDER/USDT' },
    { value: 'TAOUSDT', label: 'TAO/USDT' },
    { value: 'WLDUSDT', label: 'WLD/USDT' },
    { value: 'AKTUSDT', label: 'AKT/USDT' },
    { value: 'ARKMUSDT', label: 'ARKM/USDT' },
    { value: 'NMRUSDT', label: 'NMR/USDT' },
    { value: 'GRTUSDT', label: 'GRT/USDT' },
    { value: 'THETAUSDT', label: 'THETA/USDT' },
    { value: 'AIXBTUSDT', label: 'AIXBT/USDT' },
    { value: 'GRIFFAINUSDT', label: 'GRIFFAIN/USDT' },
  ] },
  { label: 'Gaming & Meta', items: [
    { value: 'SANDUSDT', label: 'SAND/USDT' },
    { value: 'MANAUSDT', label: 'MANA/USDT' },
    { value: 'AXSUSDT', label: 'AXS/USDT' },
    { value: 'GALAUSDT', label: 'GALA/USDT' },
    { value: 'APEUSDT', label: 'APE/USDT' },
    { value: 'ENJUSDT', label: 'ENJ/USDT' },
    { value: 'GMTUSDT', label: 'GMT/USDT' },
    { value: 'MAGICUSDT', label: 'MAGIC/USDT' },
    { value: 'PIXELUSDT', label: 'PIXEL/USDT' },
    { value: 'PORTALUSDT', label: 'PORTAL/USDT' },
    { value: 'ACEUSDT', label: 'ACE/USDT' },
    { value: 'BIGTIMEUSDT', label: 'BIGTIME/USDT' },
    { value: 'ILVUSDT', label: 'ILV/USDT' },
    { value: 'YGGUSDT', label: 'YGG/USDT' },
    { value: 'CHRUSDT', label: 'CHR/USDT' },
    { value: 'ALICEUSDT', label: 'ALICE/USDT' },
    { value: 'TLMUSDT', label: 'TLM/USDT' },
  ] },
  { label: 'Infra & Oracle', items: [
    { value: 'LINKUSDT', label: 'LINK/USDT' },
    { value: 'FILUSDT', label: 'FIL/USDT' },
    { value: 'ARUSDT', label: 'AR/USDT' },
    { value: 'QNTUSDT', label: 'QNT/USDT' },
    { value: 'CKBUSDT', label: 'CKB/USDT' },
    { value: 'STORJUSDT', label: 'STORJ/USDT' },
    { value: 'API3USDT', label: 'API3/USDT' },
    { value: 'PYTHUSDT', label: 'PYTH/USDT' },
    { value: 'TRBUSDT', label: 'TRB/USDT' },
  ] },
  { label: 'Exchange & CeFi', items: [
    { value: 'WOOUSDT', label: 'WOO/USDT' },
  ] },
  { label: 'Payments & RWA', items: [
    { value: 'ONDOUSDT', label: 'ONDO/USDT' },
    { value: 'RSRUSDT', label: 'RSR/USDT' },
  ] },
  { label: 'A — Z (all)', items: [
    { value: '0GUSDT', label: '0G/USDT' },
    { value: '1000000BOBUSDT', label: '1000000BOB/USDT' },
    { value: '1000000MOGUSDT', label: '1000000MOG/USDT' },
    { value: '1000BONKUSDT', label: '1000BONK/USDT' },
    { value: '1000CATUSDT', label: '1000CAT/USDT' },
    { value: '1000CHEEMSUSDT', label: '1000CHEEMS/USDT' },
    { value: '1000FLOKIUSDT', label: '1000FLOKI/USDT' },
    { value: '1000LUNCUSDT', label: '1000LUNC/USDT' },
    { value: '1000PEPEUSDT', label: '1000PEPE/USDT' },
    { value: '1000RATSUSDT', label: '1000RATS/USDT' },
    { value: '1000SHIBUSDT', label: '1000SHIB/USDT' },
    { value: '1000XECUSDT', label: '1000XEC/USDT' },
    { value: '1MBABYDOGEUSDT', label: '1MBABYDOGE/USDT' },
    { value: '2ZUSDT', label: '2Z/USDT' },
    { value: '4USDT', label: '4/USDT' },
    { value: 'ACHUSDT', label: 'ACH/USDT' },
    { value: 'ACUUSDT', label: 'ACU/USDT' },
    { value: 'ACXUSDT', label: 'ACX/USDT' },
    { value: 'AERGOUSDT', label: 'AERGO/USDT' },
    { value: 'AEVOUSDT', label: 'AEVO/USDT' },
    { value: 'AGLDUSDT', label: 'AGLD/USDT' },
    { value: 'AGTUSDT', label: 'AGT/USDT' },
    { value: 'AIAUSDT', label: 'AIA/USDT' },
    { value: 'AIGENSYNUSDT', label: 'AIGENSYN/USDT' },
    { value: 'AINUSDT', label: 'AIN/USDT' },
    { value: 'AIOTUSDT', label: 'AIOT/USDT' },
    { value: 'AIOUSDT', label: 'AIO/USDT' },
    { value: 'AKEUSDT', label: 'AKE/USDT' },
    { value: 'ALCHUSDT', label: 'ALCH/USDT' },
    { value: 'ALLOUSDT', label: 'ALLO/USDT' },
    { value: 'ALLUSDT', label: 'ALL/USDT' },
    { value: 'ALPINEUSDT', label: 'ALPINE/USDT' },
    { value: 'ALTUSDT', label: 'ALT/USDT' },
    { value: 'ANIMEUSDT', label: 'ANIME/USDT' },
    { value: 'APRUSDT', label: 'APR/USDT' },
    { value: 'ARCUSDT', label: 'ARC/USDT' },
    { value: 'ARIAUSDT', label: 'ARIA/USDT' },
    { value: 'ARKUSDT', label: 'ARK/USDT' },
    { value: 'ARPAUSDT', label: 'ARPA/USDT' },
    { value: 'ASRUSDT', label: 'ASR/USDT' },
    { value: 'ASTERUSDT', label: 'ASTER/USDT' },
    { value: 'ASTRUSDT', label: 'ASTR/USDT' },
    { value: 'ATHUSDT', label: 'ATH/USDT' },
    { value: 'ATUSDT', label: 'AT/USDT' },
    { value: 'AUCTIONUSDT', label: 'AUCTION/USDT' },
    { value: 'AUSDT', label: 'A/USDT' },
    { value: 'AVAAIUSDT', label: 'AVAAI/USDT' },
    { value: 'AVAUSDT', label: 'AVA/USDT' },
    { value: 'AVNTUSDT', label: 'AVNT/USDT' },
    { value: 'AWEUSDT', label: 'AWE/USDT' },
    { value: 'AXLUSDT', label: 'AXL/USDT' },
    { value: 'AZTECUSDT', label: 'AZTEC/USDT' },
    { value: 'B2USDT', label: 'B2/USDT' },
    { value: 'BABYUSDT', label: 'BABY/USDT' },
    { value: 'BANANAS31USDT', label: 'BANANAS31/USDT' },
    { value: 'BANANAUSDT', label: 'BANANA/USDT' },
    { value: 'BANKUSDT', label: 'BANK/USDT' },
    { value: 'BANUSDT', label: 'BAN/USDT' },
    { value: 'BARDUSDT', label: 'BARD/USDT' },
    { value: 'BASEDUSDT', label: 'BASED/USDT' },
    { value: 'BASUSDT', label: 'BAS/USDT' },
    { value: 'BATUSDT', label: 'BAT/USDT' },
    { value: 'BBUSDT', label: 'BB/USDT' },
    { value: 'BEAMXUSDT', label: 'BEAMX/USDT' },
    { value: 'BEATUSDT', label: 'BEAT/USDT' },
    { value: 'BELUSDT', label: 'BEL/USDT' },
    { value: 'BERAUSDT', label: 'BERA/USDT' },
    { value: 'BICOUSDT', label: 'BICO/USDT' },
    { value: 'BILLUSDT', label: 'BILL/USDT' },
    { value: 'BIOUSDT', label: 'BIO/USDT' },
    { value: 'BIRBUSDT', label: 'BIRB/USDT' },
    { value: 'BLESSUSDT', label: 'BLESS/USDT' },
    { value: 'BLUAIUSDT', label: 'BLUAI/USDT' },
    { value: 'BLURUSDT', label: 'BLUR/USDT' },
    { value: 'BMTUSDT', label: 'BMT/USDT' },
    { value: 'BNTUSDT', label: 'BNT/USDT' },
    { value: 'BREVUSDT', label: 'BREV/USDT' },
    { value: 'BROCCOLI714USDT', label: 'BROCCOLI714/USDT' },
    { value: 'BROCCOLIF3BUSDT', label: 'BROCCOLIF3B/USDT' },
    { value: 'BRUSDT', label: 'BR/USDT' },
    { value: 'BSBUSDT', label: 'BSB/USDT' },
    { value: 'BSVUSDT', label: 'BSV/USDT' },
    { value: 'BTCDOMUSDT', label: 'BTCDOM/USDT' },
    { value: 'BTRUSDT', label: 'BTR/USDT' },
    { value: 'BTWUSDT', label: 'BTW/USDT' },
    { value: 'BULLAUSDT', label: 'BULLA/USDT' },
    { value: 'BUSDT', label: 'B/USDT' },
    { value: 'C98USDT', label: 'C98/USDT' },
    { value: 'CARVUSDT', label: 'CARV/USDT' },
    { value: 'CATIUSDT', label: 'CATI/USDT' },
    { value: 'CCUSDT', label: 'CC/USDT' },
    { value: 'CELRUSDT', label: 'CELR/USDT' },
    { value: 'CETUSUSDT', label: 'CETUS/USDT' },
    { value: 'CFGUSDT', label: 'CFG/USDT' },
    { value: 'CGPTUSDT', label: 'CGPT/USDT' },
    { value: 'CHILLGUYUSDT', label: 'CHILLGUY/USDT' },
    { value: 'CHIPUSDT', label: 'CHIP/USDT' },
    { value: 'CHZUSDT', label: 'CHZ/USDT' },
    { value: 'CLANKERUSDT', label: 'CLANKER/USDT' },
    { value: 'CLOUSDT', label: 'CLO/USDT' },
    { value: 'COAIUSDT', label: 'COAI/USDT' },
    { value: 'COLLECTUSDT', label: 'COLLECT/USDT' },
    { value: 'COOKIEUSDT', label: 'COOKIE/USDT' },
    { value: 'COTIUSDT', label: 'COTI/USDT' },
    { value: 'COWUSDT', label: 'COW/USDT' },
    { value: 'CROSSUSDT', label: 'CROSS/USDT' },
    { value: 'CTKUSDT', label: 'CTK/USDT' },
    { value: 'CTRUSDT', label: 'CTR/USDT' },
    { value: 'CTSIUSDT', label: 'CTSI/USDT' },
    { value: 'CUSDT', label: 'C/USDT' },
    { value: 'CVCUSDT', label: 'CVC/USDT' },
    { value: 'CYBERUSDT', label: 'CYBER/USDT' },
    { value: 'CYSUSDT', label: 'CYS/USDT' },
    { value: 'DEEPUSDT', label: 'DEEP/USDT' },
    { value: 'DEXEUSDT', label: 'DEXE/USDT' },
    { value: 'DIAUSDT', label: 'DIA/USDT' },
    { value: 'DODOXUSDT', label: 'DODOX/USDT' },
    { value: 'DOLOUSDT', label: 'DOLO/USDT' },
    { value: 'DOODUSDT', label: 'DOOD/USDT' },
    { value: 'DRIFTUSDT', label: 'DRIFT/USDT' },
    { value: 'DUSKUSDT', label: 'DUSK/USDT' },
    { value: 'DYMUSDT', label: 'DYM/USDT' },
    { value: 'EDENUSDT', label: 'EDEN/USDT' },
    { value: 'EDGEUSDT', label: 'EDGE/USDT' },
    { value: 'EDUUSDT', label: 'EDU/USDT' },
    { value: 'EIGENUSDT', label: 'EIGEN/USDT' },
    { value: 'ELSAUSDT', label: 'ELSA/USDT' },
    { value: 'ENSOUSDT', label: 'ENSO/USDT' },
    { value: 'ENSUSDT', label: 'ENS/USDT' },
    { value: 'EPICUSDT', label: 'EPIC/USDT' },
    { value: 'ERAUSDT', label: 'ERA/USDT' },
    { value: 'ESPORTSUSDT', label: 'ESPORTS/USDT' },
    { value: 'ESPUSDT', label: 'ESP/USDT' },
    { value: 'ETCUSDT', label: 'ETC/USDT' },
    { value: 'ETHWUSDT', label: 'ETHW/USDT' },
    { value: 'EULUSDT', label: 'EUL/USDT' },
    { value: 'EVAAUSDT', label: 'EVAA/USDT' },
    { value: 'FARTCOINUSDT', label: 'FARTCOIN/USDT' },
    { value: 'FFUSDT', label: 'FF/USDT' },
    { value: 'FHEUSDT', label: 'FHE/USDT' },
    { value: 'FIDAUSDT', label: 'FIDA/USDT' },
    { value: 'FIGHTUSDT', label: 'FIGHT/USDT' },
    { value: 'FLOCKUSDT', label: 'FLOCK/USDT' },
    { value: 'FLUIDUSDT', label: 'FLUID/USDT' },
    { value: 'FLUXUSDT', label: 'FLUX/USDT' },
    { value: 'FOGOUSDT', label: 'FOGO/USDT' },
    { value: 'FOLKSUSDT', label: 'FOLKS/USDT' },
    { value: 'FORMUSDT', label: 'FORM/USDT' },
    { value: 'FRAXUSDT', label: 'FRAX/USDT' },
    { value: 'FUSDT', label: 'F/USDT' },
    { value: 'GASUSDT', label: 'GAS/USDT' },
    { value: 'GENIUSUSDT', label: 'GENIUS/USDT' },
    { value: 'GIGGLEUSDT', label: 'GIGGLE/USDT' },
    { value: 'GLMUSDT', label: 'GLM/USDT' },
    { value: 'GPSUSDT', label: 'GPS/USDT' },
    { value: 'GRASSUSDT', label: 'GRASS/USDT' },
    { value: 'GTCUSDT', label: 'GTC/USDT' },
    { value: 'GUAUSDT', label: 'GUA/USDT' },
    { value: 'GUNUSDT', label: 'GUN/USDT' },
    { value: 'GUSDT', label: 'G/USDT' },
    { value: 'GWEIUSDT', label: 'GWEI/USDT' },
    { value: 'HAEDALUSDT', label: 'HAEDAL/USDT' },
    { value: 'HANAUSDT', label: 'HANA/USDT' },
    { value: 'HEIUSDT', label: 'HEI/USDT' },
    { value: 'HEMIUSDT', label: 'HEMI/USDT' },
    { value: 'HFTUSDT', label: 'HFT/USDT' },
    { value: 'HIVEUSDT', label: 'HIVE/USDT' },
    { value: 'HMSTRUSDT', label: 'HMSTR/USDT' },
    { value: 'HOLOUSDT', label: 'HOLO/USDT' },
    { value: 'HOMEUSDT', label: 'HOME/USDT' },
    { value: 'HOTUSDT', label: 'HOT/USDT' },
    { value: 'HUMAUSDT', label: 'HUMA/USDT' },
    { value: 'HUSDT', label: 'H/USDT' },
    { value: 'HYPERUSDT', label: 'HYPER/USDT' },
    { value: 'HYPEUSDT', label: 'HYPE/USDT' },
    { value: 'ICNTUSDT', label: 'ICNT/USDT' },
    { value: 'ICXUSDT', label: 'ICX/USDT' },
    { value: 'IDOLUSDT', label: 'IDOL/USDT' },
    { value: 'IDUSDT', label: 'ID/USDT' },
    { value: 'INITUSDT', label: 'INIT/USDT' },
    { value: 'INUSDT', label: 'IN/USDT' },
    { value: 'INXUSDT', label: 'INX/USDT' },
    { value: 'IOSTUSDT', label: 'IOST/USDT' },
    { value: 'IOTXUSDT', label: 'IOTX/USDT' },
    { value: 'IOUSDT', label: 'IO/USDT' },
    { value: 'IPUSDT', label: 'IP/USDT' },
    { value: 'IRYSUSDT', label: 'IRYS/USDT' },
    { value: 'JASMYUSDT', label: 'JASMY/USDT' },
    { value: 'JCTUSDT', label: 'JCT/USDT' },
    { value: 'JELLYJELLYUSDT', label: 'JELLYJELLY/USDT' },
    { value: 'JOEUSDT', label: 'JOE/USDT' },
    { value: 'JSTUSDT', label: 'JST/USDT' },
    { value: 'KAIAUSDT', label: 'KAIA/USDT' },
    { value: 'KAITOUSDT', label: 'KAITO/USDT' },
    { value: 'KATUSDT', label: 'KAT/USDT' },
    { value: 'KERNELUSDT', label: 'KERNEL/USDT' },
    { value: 'KGENUSDT', label: 'KGEN/USDT' },
    { value: 'KITEUSDT', label: 'KITE/USDT' },
    { value: 'KMNOUSDT', label: 'KMNO/USDT' },
    { value: 'KOMAUSDT', label: 'KOMA/USDT' },
    { value: 'KSMUSDT', label: 'KSM/USDT' },
    { value: 'LABUSDT', label: 'LAB/USDT' },
    { value: 'LAUSDT', label: 'LA/USDT' },
    { value: 'LAYERUSDT', label: 'LAYER/USDT' },
    { value: 'LIGHTUSDT', label: 'LIGHT/USDT' },
    { value: 'LINEAUSDT', label: 'LINEA/USDT' },
    { value: 'LISTAUSDT', label: 'LISTA/USDT' },
    { value: 'LITUSDT', label: 'LIT/USDT' },
    { value: 'LPTUSDT', label: 'LPT/USDT' },
    { value: 'LQTYUSDT', label: 'LQTY/USDT' },
    { value: 'LSKUSDT', label: 'LSK/USDT' },
    { value: 'LUMIAUSDT', label: 'LUMIA/USDT' },
    { value: 'LUNA2USDT', label: 'LUNA2/USDT' },
    { value: 'LYNUSDT', label: 'LYN/USDT' },
    { value: 'MAGMAUSDT', label: 'MAGMA/USDT' },
    { value: 'MANTRAUSDT', label: 'MANTRA/USDT' },
    { value: 'MASKUSDT', label: 'MASK/USDT' },
    { value: 'MAVIAUSDT', label: 'MAVIA/USDT' },
    { value: 'MAVUSDT', label: 'MAV/USDT' },
    { value: 'MEGAUSDT', label: 'MEGA/USDT' },
    { value: 'MELANIAUSDT', label: 'MELANIA/USDT' },
    { value: 'MERLUSDT', label: 'MERL/USDT' },
    { value: 'METUSDT', label: 'MET/USDT' },
    { value: 'MEUSDT', label: 'ME/USDT' },
    { value: 'MIRAUSDT', label: 'MIRA/USDT' },
    { value: 'MITOUSDT', label: 'MITO/USDT' },
    { value: 'MMTUSDT', label: 'MMT/USDT' },
    { value: 'MOCAUSDT', label: 'MOCA/USDT' },
    { value: 'MONUSDT', label: 'MON/USDT' },
    { value: 'MOVEUSDT', label: 'MOVE/USDT' },
    { value: 'MOVRUSDT', label: 'MOVR/USDT' },
    { value: 'MTLUSDT', label: 'MTL/USDT' },
    { value: 'MUBARAKUSDT', label: 'MUBARAK/USDT' },
    { value: 'MUSDT', label: 'M/USDT' },
    { value: 'MYXUSDT', label: 'MYX/USDT' },
    { value: 'NAORISUSDT', label: 'NAORIS/USDT' },
    { value: 'NEWTUSDT', label: 'NEWT/USDT' },
    { value: 'NFPUSDT', label: 'NFP/USDT' },
    { value: 'NIGHTUSDT', label: 'NIGHT/USDT' },
    { value: 'NILUSDT', label: 'NIL/USDT' },
    { value: 'NOMUSDT', label: 'NOM/USDT' },
    { value: 'NOTUSDT', label: 'NOT/USDT' },
    { value: 'NXPCUSDT', label: 'NXPC/USDT' },
    { value: 'OGNUSDT', label: 'OGN/USDT' },
    { value: 'OGUSDT', label: 'OG/USDT' },
    { value: 'ONEUSDT', label: 'ONE/USDT' },
    { value: 'ONGUSDT', label: 'ONG/USDT' },
    { value: 'ONUSDT', label: 'ON/USDT' },
    { value: 'OPENUSDT', label: 'OPEN/USDT' },
    { value: 'OPGUSDT', label: 'OPG/USDT' },
    { value: 'OPNUSDT', label: 'OPN/USDT' },
    { value: 'ORCAUSDT', label: 'ORCA/USDT' },
    { value: 'ORDERUSDT', label: 'ORDER/USDT' },
    { value: 'PARTIUSDT', label: 'PARTI/USDT' },
    { value: 'PAXGUSDT', label: 'PAXG/USDT' },
    { value: 'PENGUUSDT', label: 'PENGU/USDT' },
    { value: 'PHAROSUSDT', label: 'PHAROS/USDT' },
    { value: 'PHAUSDT', label: 'PHA/USDT' },
    { value: 'PIEVERSEUSDT', label: 'PIEVERSE/USDT' },
    { value: 'PIPPINUSDT', label: 'PIPPIN/USDT' },
    { value: 'PLAYUSDT', label: 'PLAY/USDT' },
    { value: 'PLUMEUSDT', label: 'PLUME/USDT' },
    { value: 'POLYXUSDT', label: 'POLYX/USDT' },
    { value: 'POWERUSDT', label: 'POWER/USDT' },
    { value: 'POWRUSDT', label: 'POWR/USDT' },
    { value: 'PRLUSDT', label: 'PRL/USDT' },
    { value: 'PROMPTUSDT', label: 'PROMPT/USDT' },
    { value: 'PROMUSDT', label: 'PROM/USDT' },
    { value: 'PROVEUSDT', label: 'PROVE/USDT' },
    { value: 'PTBUSDT', label: 'PTB/USDT' },
    { value: 'PUMPBTCUSDT', label: 'PUMPBTC/USDT' },
    { value: 'PUMPUSDT', label: 'PUMP/USDT' },
    { value: 'PUNDIXUSDT', label: 'PUNDIX/USDT' },
    { value: 'QUSDT', label: 'Q/USDT' },
    { value: 'RAREUSDT', label: 'RARE/USDT' },
    { value: 'RAVEUSDT', label: 'RAVE/USDT' },
    { value: 'RAYSOLUSDT', label: 'RAYSOL/USDT' },
    { value: 'RECALLUSDT', label: 'RECALL/USDT' },
    { value: 'REDUSDT', label: 'RED/USDT' },
    { value: 'RESOLVUSDT', label: 'RESOLV/USDT' },
    { value: 'REZUSDT', label: 'REZ/USDT' },
    { value: 'RIFUSDT', label: 'RIF/USDT' },
    { value: 'RIVERUSDT', label: 'RIVER/USDT' },
    { value: 'RLCUSDT', label: 'RLC/USDT' },
    { value: 'ROBOUSDT', label: 'ROBO/USDT' },
    { value: 'RONINUSDT', label: 'RONIN/USDT' },
    { value: 'RPLUSDT', label: 'RPL/USDT' },
    { value: 'RVNUSDT', label: 'RVN/USDT' },
    { value: 'SAFEUSDT', label: 'SAFE/USDT' },
    { value: 'SAGAUSDT', label: 'SAGA/USDT' },
    { value: 'SAHARAUSDT', label: 'SAHARA/USDT' },
    { value: 'SANTOSUSDT', label: 'SANTOS/USDT' },
    { value: 'SAPIENUSDT', label: 'SAPIEN/USDT' },
    { value: 'SCRTUSDT', label: 'SCRT/USDT' },
    { value: 'SCRUSDT', label: 'SCR/USDT' },
    { value: 'SENTUSDT', label: 'SENT/USDT' },
    { value: 'SFPUSDT', label: 'SFP/USDT' },
    { value: 'SHELLUSDT', label: 'SHELL/USDT' },
    { value: 'SIGNUSDT', label: 'SIGN/USDT' },
    { value: 'SIRENUSDT', label: 'SIREN/USDT' },
    { value: 'SKRUSDT', label: 'SKR/USDT' },
    { value: 'SKYAIUSDT', label: 'SKYAI/USDT' },
    { value: 'SKYUSDT', label: 'SKY/USDT' },
    { value: 'SLPUSDT', label: 'SLP/USDT' },
    { value: 'SLXUSDT', label: 'SLX/USDT' },
    { value: 'SOLVUSDT', label: 'SOLV/USDT' },
    { value: 'SOMIUSDT', label: 'SOMI/USDT' },
    { value: 'SONICUSDT', label: 'SONIC/USDT' },
    { value: 'SOONUSDT', label: 'SOON/USDT' },
    { value: 'SOPHUSDT', label: 'SOPH/USDT' },
    { value: 'SPACEUSDT', label: 'SPACE/USDT' },
    { value: 'SPKUSDT', label: 'SPK/USDT' },
    { value: 'SPORTFUNUSDT', label: 'SPORTFUN/USDT' },
    { value: 'SPXUSDT', label: 'SPX/USDT' },
    { value: 'SQDUSDT', label: 'SQD/USDT' },
    { value: 'SSVUSDT', label: 'SSV/USDT' },
    { value: 'STABLEUSDT', label: 'STABLE/USDT' },
    { value: 'STARUSDT', label: 'STAR/USDT' },
    { value: 'STBLUSDT', label: 'STBL/USDT' },
    { value: 'STEEMUSDT', label: 'STEEM/USDT' },
    { value: 'STGUSDT', label: 'STG/USDT' },
    { value: 'STOUSDT', label: 'STO/USDT' },
    { value: 'STXUSDT', label: 'STX/USDT' },
    { value: 'SUNUSDT', label: 'SUN/USDT' },
    { value: 'SUPERUSDT', label: 'SUPER/USDT' },
    { value: 'SUSDT', label: 'S/USDT' },
    { value: 'SWARMSUSDT', label: 'SWARMS/USDT' },
    { value: 'SXTUSDT', label: 'SXT/USDT' },
    { value: 'SYNUSDT', label: 'SYN/USDT' },
    { value: 'SYRUPUSDT', label: 'SYRUP/USDT' },
    { value: 'TACUSDT', label: 'TAC/USDT' },
    { value: 'TAGUSDT', label: 'TAG/USDT' },
    { value: 'TAKEUSDT', label: 'TAKE/USDT' },
    { value: 'TAUSDT', label: 'TA/USDT' },
    { value: 'THEUSDT', label: 'THE/USDT' },
    { value: 'TNSRUSDT', label: 'TNSR/USDT' },
    { value: 'TOSHIUSDT', label: 'TOSHI/USDT' },
    { value: 'TOWNSUSDT', label: 'TOWNS/USDT' },
    { value: 'TRADOORUSDT', label: 'TRADOOR/USDT' },
    { value: 'TREEUSDT', label: 'TREE/USDT' },
    { value: 'TRIAUSDT', label: 'TRIA/USDT' },
    { value: 'TRUMPUSDT', label: 'TRUMP/USDT' },
    { value: 'TRUSTUSDT', label: 'TRUST/USDT' },
    { value: 'TRUTHUSDT', label: 'TRUTH/USDT' },
    { value: 'TSTUSDT', label: 'TST/USDT' },
    { value: 'TURTLEUSDT', label: 'TURTLE/USDT' },
    { value: 'TUSDT', label: 'T/USDT' },
    { value: 'TUTUSDT', label: 'TUT/USDT' },
    { value: 'TWTUSDT', label: 'TWT/USDT' },
    { value: 'UAIUSDT', label: 'UAI/USDT' },
    { value: 'UBUSDT', label: 'UB/USDT' },
    { value: 'USDCUSDT', label: 'USDC/USDT' },
    { value: 'USELESSUSDT', label: 'USELESS/USDT' },
    { value: 'USTCUSDT', label: 'USTC/USDT' },
    { value: 'USUALUSDT', label: 'USUAL/USDT' },
    { value: 'USUSDT', label: 'US/USDT' },
    { value: 'VANAUSDT', label: 'VANA/USDT' },
    { value: 'VANRYUSDT', label: 'VANRY/USDT' },
    { value: 'VELODROMEUSDT', label: 'VELODROME/USDT' },
    { value: 'VELVETUSDT', label: 'VELVET/USDT' },
    { value: 'VICUSDT', label: 'VIC/USDT' },
    { value: 'VIRTUALUSDT', label: 'VIRTUAL/USDT' },
    { value: 'VTHOUSDT', label: 'VTHO/USDT' },
    { value: 'VVVUSDT', label: 'VVV/USDT' },
    { value: 'WALUSDT', label: 'WAL/USDT' },
    { value: 'WAXPUSDT', label: 'WAXP/USDT' },
    { value: 'WCTUSDT', label: 'WCT/USDT' },
    { value: 'WETUSDT', label: 'WET/USDT' },
    { value: 'WLFIUSDT', label: 'WLFI/USDT' },
    { value: 'WUSDT', label: 'W/USDT' },
    { value: 'XAIUSDT', label: 'XAI/USDT' },
    { value: 'XANUSDT', label: 'XAN/USDT' },
    { value: 'XAUTUSDT', label: 'XAUT/USDT' },
    { value: 'XNYUSDT', label: 'XNY/USDT' },
    { value: 'XPINUSDT', label: 'XPIN/USDT' },
    { value: 'XPLUSDT', label: 'XPL/USDT' },
    { value: 'XVGUSDT', label: 'XVG/USDT' },
    { value: 'XVSUSDT', label: 'XVS/USDT' },
    { value: 'YBUSDT', label: 'YB/USDT' },
    { value: 'ZAMAUSDT', label: 'ZAMA/USDT' },
    { value: 'ZBTUSDT', label: 'ZBT/USDT' },
    { value: 'ZENUSDT', label: 'ZEN/USDT' },
    { value: 'ZEREBROUSDT', label: 'ZEREBRO/USDT' },
    { value: 'ZESTUSDT', label: 'ZEST/USDT' },
    { value: 'ZETAUSDT', label: 'ZETA/USDT' },
    { value: 'ZKCUSDT', label: 'ZKC/USDT' },
    { value: 'ZKPUSDT', label: 'ZKP/USDT' },
    { value: 'ZORAUSDT', label: 'ZORA/USDT' },
    { value: '币安人生USDT', label: '币安人生/USDT' },
    { value: '我踏马来了USDT', label: '我踏马来了/USDT' },
    { value: '龙虾USDT', label: '龙虾/USDT' },
  ] },
]

/** Indicator definitions — 1:1 from INDICATORS in config.js lines 70-88 */
// [batch3-A] IND_LIST extended with settingsModal/isOverlay/modalOnly flags.
// [batch3-B] hasGenericSettings → gear opens openIndSettings(id) modal from engine/indicators.
// settingsModal       : openModal(key) to show the gear panel for this indicator (custom UI).
// hasGenericSettings  : gear opens the shared openIndSettings modal driven by IND_SETTINGS[id].
// isOverlay           : toggle routes through togOvr (overlays.* store) instead of togInd.
// modalOnly           : indicator has no on/off toggle, just a modal entry (e.g. OVI).
type IndMeta = { id: string; ico: string; name: string; desc: string; settingsModal?: string; hasGenericSettings?: boolean; isOverlay?: boolean; modalOnly?: boolean }
const IND_LIST: IndMeta[] = [
  // [2026-06-16] Dedicated, distinct icon per indicator (no recycled emoji).
  { id: 'ema',      ico: '📈', name: 'EMA 50/200',      desc: 'Exponential Moving Average',   hasGenericSettings: true },
  { id: 'wma',      ico: '〰️', name: 'WMA 20/50',       desc: 'Weighted Moving Average',      hasGenericSettings: true },
  { id: 'st',       ico: '🚦', name: 'Supertrend',      desc: 'Trend + dynamic Stop Loss',    hasGenericSettings: true },
  { id: 'vp',       ico: '📶', name: 'Volume Profile',  desc: 'Volume by price levels',       hasGenericSettings: true },
  { id: 'cvd',      ico: '🌊', name: 'CVD',             desc: 'Cumulative Volume Delta',      hasGenericSettings: true },
  { id: 'macd',     ico: '🔀', name: 'MACD',            desc: 'Moving Avg Convergence Div',   hasGenericSettings: true },
  { id: 'bb',       ico: '🎈', name: 'Bollinger Bands', desc: 'Volatility and trend',         hasGenericSettings: true },
  { id: 'stoch',    ico: '🎚️', name: 'Stochastic RSI',  desc: 'RSI smoothed with Stoch',      hasGenericSettings: true },
  { id: 'obv',      ico: '🧮', name: 'OBV',             desc: 'On-Balance Volume',            hasGenericSettings: true },
  { id: 'atr',      ico: '📏', name: 'ATR',             desc: 'Average True Range - volat',   hasGenericSettings: true },
  { id: 'vwap',     ico: '💲', name: 'VWAP',            desc: 'Volume Weighted Avg Price',    hasGenericSettings: true },
  { id: 'ichimoku', ico: '☁️', name: 'Ichimoku Cloud',  desc: 'Full Japanese system',         hasGenericSettings: true },
  { id: 'fib',      ico: '🌀', name: 'Fibonacci',       desc: 'Auto retracement on swing',    hasGenericSettings: true },
  { id: 'pivot',    ico: '🎯', name: 'Pivot Points',    desc: 'Daily Support/Resistance',     hasGenericSettings: true },
  { id: 'rsi14',    ico: '⚡', name: 'RSI 14',          desc: 'Relative Strength Index',      hasGenericSettings: true },
  { id: 'mfi',      ico: '💰', name: 'Money Flow Index',desc: 'Volume-weighted RSI',          hasGenericSettings: true },
  { id: 'cci',      ico: '🧲', name: 'CCI',             desc: 'Commodity Channel Index',      hasGenericSettings: true },
  // [2026-06-16] New overlays — batch 1
  { id: 'sma',      ico: '➖', name: 'SMA',             desc: 'Simple Moving Average',        hasGenericSettings: true },
  { id: 'hma',      ico: '💨', name: 'Hull MA',         desc: 'Hull Moving Average (low lag)', hasGenericSettings: true },
  { id: 'psar',     ico: '🔄', name: 'Parabolic SAR',   desc: 'Trend + trailing stop dots',   hasGenericSettings: true },
  { id: 'kc',       ico: '🛟', name: 'Keltner Channels',desc: 'ATR volatility bands',         hasGenericSettings: true },
  { id: 'dc',       ico: '📦', name: 'Donchian Channels',desc: 'Breakout high/low bands',     hasGenericSettings: true },
  // [2026-06-16] New oscillators — batch 2 (separate panes)
  { id: 'adx',      ico: '💪', name: 'ADX',             desc: 'Trend strength (+DI / -DI)',   hasGenericSettings: true },
  { id: 'willr',    ico: '🪝', name: 'Williams %R',      desc: 'Overbought / oversold',        hasGenericSettings: true },
  { id: 'roc',      ico: '🚀', name: 'ROC',             desc: 'Rate of Change momentum',      hasGenericSettings: true },
  { id: 'cmf',      ico: '💵', name: 'CMF',             desc: 'Chaikin Money Flow (volume)',  hasGenericSettings: true },
  { id: 'ao',       ico: '📊', name: 'Awesome Oscillator',desc: 'Momentum histogram (5/34)',  hasGenericSettings: true },
  // [2026-06-16] New indicators — batch 3
  { id: 'vwma',     ico: '🏋️', name: 'VWMA',            desc: 'Volume-Weighted Moving Avg',   hasGenericSettings: true },
  { id: 'aroon',    ico: '🧭', name: 'Aroon',           desc: 'Trend onset (Up / Down)',      hasGenericSettings: true },
  { id: 'trix',     ico: '➿', name: 'TRIX',            desc: 'Triple-smoothed momentum',     hasGenericSettings: true },
  { id: 'uo',       ico: '🏆', name: 'Ultimate Oscillator',desc: 'Multi-timeframe momentum',  hasGenericSettings: true },
  { id: 'chop',     ico: '🪚', name: 'Choppiness Index', desc: 'Trending vs ranging',         hasGenericSettings: true },
  // [2026-06-16] KERAUNOS — Zeus original adaptive conviction ribbon (main chart)
  { id: 'kera',     ico: '⚡', name: 'KERAUNOS',         desc: 'Adaptive conviction ribbon (Zeus original)', hasGenericSettings: true },
  { id: 'aether',   ico: '🌪️', name: 'AETHER',           desc: 'Volatility squeeze → breakout (Zeus original)', hasGenericSettings: true },
  // Moved from Row 2/Row 3 — overlays + OVI (modal-only). Each keeps its own custom modal.
  { id: 'ovi', ico: '💧', name: 'OVI LIQUID', desc: 'Liquidation pockets',      settingsModal: 'ovi',      isOverlay: true },
  { id: 'liq', ico: '💥', name: 'LIQ Heatmap', desc: 'Liquidation levels',      settingsModal: 'liq',      isOverlay: true },
  { id: 'zs',  ico: '👑', name: 'SUPREMUS',    desc: 'Zone Supremus S/R',       settingsModal: 'supremus', isOverlay: true },
  { id: 'sr',  ico: '📐', name: 'S/R Levels',  desc: 'Auto support/resistance', settingsModal: 'sr',       isOverlay: true },
  { id: 'llv', ico: '💢', name: 'LLV Volume', desc: 'Large Liquidation Vols',  settingsModal: 'llv',      isOverlay: true },
]

export function ChartControls() {
  const symbol = useMarketStore((s) => s.market.symbol)
  const chartTf = useMarketStore((s) => s.market.chartTf)
  const indicators = useMarketStore((s) => s.market.indicators)
  const overlays = useMarketStore((s) => s.market.overlays)
  const patch = useMarketStore((s) => s.patch)
  const openModal = useUiStore((s) => s.openModal)

  const [tfOpen, setTfOpen] = useState(false)
  const [ctOpen, setCtOpen] = useState(false)
  const [symOpen, setSymOpen] = useState(false)
  const [symSearch, setSymSearch] = useState('')
  const symRef = useRef<HTMLDivElement>(null)
  const [candleType, setCandleType] = useState<CandleType>(
    ((USER_SETTINGS?.chart?.candleType as CandleType) || 'candles'),
  )
  const ctRef = useRef<HTMLDivElement>(null)
  const [indPanelOpen, setIndPanelOpen] = useState(false)
  const [fsMode, setFsMode] = useState(false)
  // [Pack D.1 + D.2] Read initial state with FOUR fallback layers because
  // module load order isn't guaranteed: panels.ts IIFE may run BEFORE
  // state.ts assigns `w.S = S` (panels.ts has no import-side dep on
  // state.ts; both rely on `window.S` directly), in which case IIFE bails
  // at `if (!w.S) return` and `w.S.sessions` stays undefined. We MUST
  // also fall back to reading localStorage directly here, then SYNC the
  // value into `w.S.sessions` so toggleSession on click sees the right
  // state. Without the sync, the first click would `!S.sessions[k]` =
  // `!undefined` = true (toggle ON looks correct), but the second click
  // would `!true` = false (toggle OFF) — desync between React and `w.S`.
  const _initSessions = (() => {
    try {
      const wAny: any = window
      if (wAny.S && wAny.S.sessions) {
        return { asia: !!wAny.S.sessions.asia, london: !!wAny.S.sessions.london, ny: !!wAny.S.sessions.ny }
      }
      // Fallback: read localStorage directly (panels.ts IIFE may have bailed)
      const raw = localStorage.getItem('zeus_chart_sessions')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          const restored = { asia: !!parsed.asia, london: !!parsed.london, ny: !!parsed.ny }
          // Sync back into w.S.sessions so toggleSession reads the correct
          // value on the next click. Init w.S if missing (state.ts hasn't
          // run yet — extremely rare but possible).
          try { if (!wAny.S) wAny.S = {}; wAny.S.sessions = { ...restored } } catch (_) { /* */ }
          return restored
        }
      }
    } catch (_) { /* */ }
    return { asia: false, london: false, ny: false }
  })()
  const _initVwapOn = (() => {
    try {
      const wAny: any = window
      if (wAny.S && typeof wAny.S.vwapOn !== 'undefined') return !!wAny.S.vwapOn
      const raw = localStorage.getItem('zeus_chart_vwap_on')
      if (raw === '1' || raw === 'true') {
        try { if (!wAny.S) wAny.S = {}; wAny.S.vwapOn = true } catch (_) { /* */ }
        return true
      }
    } catch (_) { /* */ }
    return false
  })()
  const [_sessions, setSessions] = useState(_initSessions)
  const [_vwapOn, setVwapOn] = useState(_initVwapOn)
  // [Pack E] Read tsOn + drawingsVisible from localStorage so the button
  // visual states (act / on classes) match the underlying restored state
  // after refresh. The actual T&S panel content is auto-restored by the
  // _restoreCheck loop in timeSales.ts:187 (~10s budget); this useState
  // init only addresses the React-side button class.
  const _initTsOn = (() => {
    try { return localStorage.getItem('zeus_ts_open') === '1' } catch (_) { return false }
  })()
  const _initDrawingsVisible = (() => {
    try { return localStorage.getItem('zeus_drawings_vis') !== '0' } catch (_) { return true }
  })()
  const [tsOn, setTsOn] = useState(_initTsOn)
  const [drawTool, setDrawTool] = useState<string | null>(null)
  const [drawingsVisible, setDrawingsVisible] = useState(_initDrawingsVisible)
  const [activeInds, setActiveInds] = useState<Record<string, boolean>>({})
  const tfRef = useRef<HTMLDivElement>(null)

  // Sync activeInds + overlays from legacy w.S on mount + after bridge loads.
  // [batch3-C] overlays added so the React toggle ALWAYS mirrors the legacy store
  // (the source of truth for render gating) — prevents ghost-ON toggles where
  // React says true but S.overlays.* still false and nothing renders.
  useEffect(() => {
    function sync() {
      const w = window as any
      if (w.S?.activeInds) setActiveInds({ ...w.S.activeInds })
      if (w.S?.overlays) {
        const cur = useMarketStore.getState().market.overlays
        const legacy = w.S.overlays as Record<string, boolean>
        const curRec = cur as unknown as Record<string, boolean>
        const keys = new Set([...Object.keys(curRec), ...Object.keys(legacy)])
        let diverged = false
        for (const k of keys) { if (!!curRec[k] !== !!legacy[k]) { diverged = true; break } }
        if (diverged) patch({ overlays: { ...curRec, ...legacy } as unknown as typeof cur })
      }
    }
    sync()
    const id = setInterval(sync, 2000)
    return () => clearInterval(id)
  }, [patch])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (tfRef.current && !tfRef.current.contains(e.target as Node)) setTfOpen(false)
      if (ctRef.current && !ctRef.current.contains(e.target as Node)) setCtOpen(false)
      // sym dropdown is portaled to <body> (keyboard-safe fixed panel) — closed via
      // its own backdrop, not this handler (it lives outside symRef in the DOM).
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // [Pack D.1 + D.3] If any session was restored as active on mount,
  // poll until the chart is fully ready (mainChart + cSeries + klines
  // loaded), then call _renderSessionOverlays() to draw the boxes.
  // Without polling, a single 200ms timeout fired BEFORE the chart had
  // finished loading klines and `_renderSessionOverlays` early-exited at
  // the `if (!w.mainChart || !S.klines)` guard, so boxes never appeared
  // even though the toggle state was correctly restored. Polling ensures
  // we hit the right moment regardless of network speed (klines REST
  // typically returns 200-2000ms after page render). Caps at 10s of
  // attempts to avoid infinite polling.
  useEffect(() => {
    if (!_initSessions.asia && !_initSessions.london && !_initSessions.ny) return
    const wAny: any = window
    let attempts = 0
    const MAX_ATTEMPTS = 40 // 40 × 250ms = 10 s budget
    const pollId = setInterval(() => {
      attempts++
      const chartReady = wAny.mainChart && wAny.cSeries
        && typeof wAny.cSeries.priceToCoordinate === 'function'
        && wAny.S && Array.isArray(wAny.S.klines) && wAny.S.klines.length > 0
      if (chartReady && typeof wAny._renderSessionOverlays === 'function') {
        try { wAny._renderSessionOverlays() } catch (_) { /* */ }
        // Verify a box was actually drawn — host innerHTML non-empty
        const host = document.getElementById('zsess-overlay')
        if (host && host.children.length > 0) {
          clearInterval(pollId)
          return
        }
      }
      if (attempts >= MAX_ATTEMPTS) clearInterval(pollId)
    }, 250)
    return () => clearInterval(pollId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // [Pack E] If VWAP was restored as ON, draw the bands once chart is
  // ready. We can't call toggleVWAP() (would flip state); instead use
  // applyVWAPRestore() exported from panels.ts which idempotently
  // re-renders if S.vwapOn is true (no flip).
  useEffect(() => {
    if (!_initVwapOn) return
    const wAny: any = window
    let attempts = 0
    const MAX_ATTEMPTS = 40 // 10s budget
    const pollId = setInterval(() => {
      attempts++
      const chartReady = wAny.mainChart && wAny.cSeries
        && typeof wAny.cSeries.priceToCoordinate === 'function'
        && wAny.S && Array.isArray(wAny.S.klines) && wAny.S.klines.length > 0
      if (chartReady) {
        try { applyVWAPRestore() } catch (_) { /* */ }
        clearInterval(pollId)
        return
      }
      if (attempts >= MAX_ATTEMPTS) clearInterval(pollId)
    }, 250)
    return () => clearInterval(pollId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // [Pack D.4] Restore chartTf on mount. Same pattern as sessions: read
  // `zeus_chart_tf` localStorage as the fast-path (written on every
  // setTF call); if found and != default '5m', poll until chart is ready
  // then re-apply via setTF() so klines are fetched for the right TF AND
  // marketStore + dropdown UI sync up. The existing USER_SETTINGS.chart.tf
  // → S.chartTf restore at config.ts:1868 only updates legacy state; it
  // doesn't trigger setTF, so the chart kept showing 5m klines even
  // though S.chartTf had been set to e.g. '1h'.
  useEffect(() => {
    let restoredTf: string | null = null
    try {
      const raw = localStorage.getItem('zeus_chart_tf')
      if (raw && typeof raw === 'string' && raw.trim() && raw !== '5m') {
        restoredTf = raw.trim()
      }
    } catch (_) { /* */ }
    if (!restoredTf) return
    const wAny: any = window
    let attempts = 0
    const MAX_ATTEMPTS = 40 // 40 × 250ms = 10 s budget
    const pollId = setInterval(() => {
      attempts++
      const chartReady = wAny.mainChart && wAny.cSeries
        && typeof wAny.cSeries.priceToCoordinate === 'function'
      if (chartReady && restoredTf) {
        // setTF is imported at top of file; calling it directly is safer
        // than reaching through window because the export name might be
        // tree-shaken away from the global scope in production bundles.
        try { setTF(restoredTf, null) } catch (_) { /* */ }
        // Patch marketStore so the dropdown label + active class show
        // the restored TF (Zustand store is React's source of truth).
        try { patch({ chartTf: restoredTf }) } catch (_) { /* */ }
        clearInterval(pollId)
        return
      }
      if (attempts >= MAX_ATTEMPTS) clearInterval(pollId)
    }, 250)
    return () => clearInterval(pollId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pickCandleType(t: CandleType) {
    setCandleType(t)
    setCtOpen(false)
    try { applyCandleType(t) } catch (e) { console.warn('[candleType]', e) }
  }

  function pickTf(tf: string) {
    if (typeof setTF === 'function') setTF(tf, null)
    patch({ chartTf: tf })
    setTfOpen(false)
  }

  function togInd(key: string) {
    const w = window as any
    if (typeof togIndFn === 'function') {
      togIndFn(key, null)
    }
    // Sync React state from old JS after toggle
    if (w.S?.activeInds) setActiveInds({ ...w.S.activeInds })
    // Also update React store for the 4 React-managed indicators
    if (key in indicators) {
      const ind = indicators as unknown as Record<string, boolean>
      patch({ indicators: { ...indicators, [key]: !ind[key] } })
    }
  }

  function togOvr(key: keyof typeof overlays) {
    // [batch3-C] Trust the legacy store as source of truth — togOvrFn mutates
    // w.S.overlays[key] and calls the overlay's render/clear. Read the NEW value
    // back from w.S AFTER the call so React state stays in lock-step, even if
    // togOvrFn internally coerces (e.g. ovi→oviOn mirror) or the legacy start
    // value was already-true (persisted) and React was still false.
    const wRef = window as any
    let newVal: boolean | null = null
    if (typeof togOvrFn === 'function') {
      const btn = document.getElementById('b' + key)
      try {
        togOvrFn(key, btn)
        if (wRef.S?.overlays) newVal = !!wRef.S.overlays[key]
      } catch (e) { console.warn('[togOvr]', key, 'error:', (e as Error).message) }
    }
    if (newVal === null) newVal = !overlays[key]
    patch({ overlays: { ...overlays, [key]: newVal } })
  }

  function handleSymbolChange(val: string) {
    const w = window as any
    if (typeof w.setSymbol === 'function') w.setSymbol(val); else setSymbol(val)
    patch({ symbol: val })
  }

  // Fullscreen — delegate to old JS toggleFS (handles chart canvas resize too)
  function toggleFS() {
    toggleFSFn()
    const sec = document.getElementById('csec')
    setFsMode(sec ? sec.classList.contains('fsm') : false)
  }

  // Session toggles — delegate to old JS toggleSession(sess, btn)
  function handleSession(key: 'asia' | 'london' | 'ny', btn: HTMLButtonElement) {
    if (typeof toggleSessionFn === 'function') {
      toggleSessionFn(key, btn)
    } else {
      btn.classList.toggle('act')
    }
    setSessions(s => ({ ...s, [key]: !s[key] }))
  }

  // VWAP toggle — delegate to old JS toggleVWAP(btn)
  function handleVWAP(btn: HTMLButtonElement) {
    if (typeof toggleVWAPFn === 'function') {
      toggleVWAPFn(btn)
    } else {
      btn.classList.toggle('act')
    }
    setVwapOn(v => !v)
  }

  // T&S toggle — delegate to old JS (starts trade stream + renders tape)
  function toggleTimeSales() {
    const w = window as any
    if (typeof w.toggleTimeSales === 'function') {
      w.toggleTimeSales()
    } else {
      const wrap = document.getElementById('ts-wrap')
      if (wrap) wrap.style.display = tsOn ? 'none' : 'block'
    }
    setTsOn(t => !t)
  }

  // Drawing tools — delegate to old JS drawingTools.js
  function handleDrawTool(tool: string) {
    const w = window as any
    if (typeof w.drawToolActivate === 'function') {
      w.drawToolActivate(drawTool === tool ? null : tool)
    }
    setDrawTool(drawTool === tool ? null : tool)
  }
  function handleDrawToggleVis() {
    const w = window as any
    if (typeof w.drawToolToggleVis === 'function') w.drawToolToggleVis()
    // [Pack E] localStorage write is also done by drawingTools.ts inside
    // _toggleVisibility; this is just to keep the React-side button class
    // declarative via setDrawingsVisible (drawingTools owns the source of
    // truth for actual line visibility).
    setDrawingsVisible(v => !v)
  }
  function handleDrawClearAll() {
    const w = window as any
    if (typeof w.drawToolClearAll === 'function') w.drawToolClearAll()
    setDrawTool(null)
  }

  return (
    <>
      {/* ── Section label ── */}
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>&#128200; <span id="chartTitleLbl">{symbol}</span> &#8212; LIVE CHART</span>
        <span id="chartTZLbl" style={{ color: '#44aaff', fontSize: '7px' }}><span style={{ fontWeight: 700 }}>RO</span></span>
      </div>

      {/* ── Controls container ── */}
      <div className="ctrls">
        {/* Row 1: Timeframe + Settings + Symbol */}
        <div className="crow">
          <div className={`ztf-wrap${tfOpen ? ' open' : ''}`} id="ztfWrap" ref={tfRef}>
            <button className="ztf-trigger" id="ztfTrigger" onClick={() => setTfOpen(!tfOpen)}>
              <span id="ztfLabel">{chartTf}</span> <span className="ztf-arrow">&#9662;</span>
            </button>
            <div className="ztf-dropdown" id="ztfDropdown">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  className={`ztf-item${chartTf === tf ? ' act' : ''}`}
                  onClick={() => pickTf(tf)}
                >{tf}</button>
              ))}
            </div>
          </div>
          <span style={{ width: '4px' }}></span>
          <button className="tfb ztf-sibling" id="fsbtn" title="Fullscreen" onClick={toggleFS}>{fsMode ? '\u2291' : '\u26F6'}</button>
          <button className="tfb ztf-sibling" title="Chart Settings" onClick={() => openModal('charts')}>&#9881;</button>
          <div className={`ztf-wrap${ctOpen ? ' open' : ''}`} ref={ctRef} style={{ position: 'relative' }}>
            <button className="tfb ztf-sibling" title="Chart Type" onClick={() => setCtOpen(o => !o)}>
              {CANDLE_TYPES.find(c => c.id === candleType)?.icon || '▮'}
            </button>
            {ctOpen && (
              <div className="ztf-dropdown" style={{ display: 'block', minWidth: 170, right: 'auto' }}>
                {CANDLE_TYPES.map((c) => (
                  <button
                    key={c.id}
                    className={`ztf-item${candleType === c.id ? ' act' : ''}`}
                    style={{ textAlign: 'left', padding: '6px 10px' }}
                    onClick={() => pickCandleType(c.id)}
                  >
                    <span style={{ display: 'inline-block', width: 18, color: 'var(--gold)' }}>{c.icon}</span> {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="tfb ztf-sibling" title="Add Indicator" onClick={() => setIndPanelOpen(true)}>&#9776;</button>
          <span style={{ width: '8px' }}></span>
          {/* [2026-06-13] Custom symbol dropdown (was a native <select> whose coin
              list popup is unstyleable on mobile webview). Themeable amethyst list. */}
          <div className={`ztf-wrap sym-wrap${symOpen ? ' open' : ''}`} ref={symRef} style={{ position: 'relative' }}>
            <button id="symSel" className="tfb ztf-sibling" title="Symbol" onClick={() => setSymOpen(o => { const n = !o; if (n) setSymSearch(''); return n })} style={{ minWidth: '92px', display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
              <span>{SYMBOLS.flatMap(g => g.items).find(i => i.value === symbol)?.label || symbol}</span>
              <span className="ztf-arrow">&#9662;</span>
            </button>
            {symOpen && createPortal(
              <>
                <div className="sym-backdrop" onClick={() => setSymOpen(false)} />
                <div className="sym-dropdown" role="dialog" aria-label="Select symbol">
                  <div className="sym-search">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
                    <input value={symSearch} onChange={(e) => setSymSearch(e.target.value)} placeholder="Search coin…" spellCheck={false} />
                    {symSearch
                      ? <span className="sym-clear" onClick={() => setSymSearch('')}>&#10005;</span>
                      : <span className="sym-clear" onClick={() => setSymOpen(false)}>&#10005;</span>}
                  </div>
                  <div className="sym-list">
                    {(() => {
                      const q = symSearch.trim().toUpperCase()
                      const groups = q
                        ? SYMBOLS.map(g => ({ label: g.label, items: g.items.filter(s => s.value.includes(q) || s.label.toUpperCase().includes(q)) })).filter(g => g.items.length)
                        : SYMBOLS
                      if (!groups.length) return <div className="sym-empty">No coin matches “{symSearch}”</div>
                      return groups.map((g) => (
                        <div key={g.label}>
                          <div className="sym-group">{g.label.replace(/─/g, '').trim()}</div>
                          {g.items.map((s) => (
                            <button
                              key={s.value}
                              className={`sym-item${symbol === s.value ? ' act' : ''}`}
                              onClick={() => { handleSymbolChange(s.value); setSymOpen(false) }}
                            >{s.label}</button>
                          ))}
                        </div>
                      ))
                    })()}
                  </div>
                </div>
              </>,
              document.body,
            )}
          </div>
          <button className="tfb ztf-sibling expo-toggle-btn" id="expoToggleBtn" title="Exposure Dashboard" onClick={() => openModal('exposure')}>EXP</button>
        </div>

        {/* Exposure inline panel (hidden by default) */}
        <div id="expoInlinePanel" className="expo-inline" style={{ display: 'none' }}>
          <div id="expoInlineContent" style={{ padding: '8px 10px', fontSize: '10px', color: '#888', lineHeight: 1.7 }}></div>
        </div>

        {/* Row 2: Sessions + VWAP — [batch3-A] OVI moved to SELECT INDICATOR panel */}
        <div className="crow">
          {/* [Pack D.1] className now declarative: React syncs the `on`
              class from _sessions.X state so on-mount restored values
              from w.S.sessions show as ON (gold underline) without
              requiring a re-toggle. The imperative classList.toggle in
              toggleSession (panels.ts) still runs, but React's next
              render reconciles and keeps both in sync via setSessions. */}
          <button className={`sess-btn asia${_sessions.asia ? ' on' : ''}`} id="sessAsia" title="Asia Session" onClick={(e) => handleSession('asia', e.currentTarget)}><span className="z-badge z-badge--cyan" style={{ padding: 0, border: 0, background: 'none', fontSize: 'inherit', letterSpacing: 'inherit' }}>ASI</span> ASIA</button>
          <button className={`sess-btn london${_sessions.london ? ' on' : ''}`} id="sessLondon" title="London Session" onClick={(e) => handleSession('london', e.currentTarget)}><span style={{ fontSize: '8px', fontWeight: 700, color: '#4488ff' }}>UK</span> LON</button>
          <button className={`sess-btn ny${_sessions.ny ? ' on' : ''}`} id="sessNY" title="New York Session" onClick={(e) => handleSession('ny', e.currentTarget)}><span style={{ fontSize: '8px', fontWeight: 700, color: '#00d97a' }}>US</span> NY</button>
          {/* [Pack E] VWAP button now declarative `on` class via React
              state so restored vwapOn surfaces visually on mount.
              toggleVWAP (panels.ts) still imperatively classList.toggles,
              setVwapOn keeps both layers in sync. */}
          <button className={`vwap-btn${_vwapOn ? ' on' : ''}`} id="vwapBtn" title="VWAP + Bands" onClick={(e) => handleVWAP(e.currentTarget)}>VWAP</button>
        </div>

        {/* Row 3: Indicators + Drawing Tools — [batch3-A] LIQ/SUPREMUS/S/R/LLV moved to SELECT INDICATOR panel */}
        <div className="crow">
          {/* [M11] Operator-precedence fix — `?? : ?:` was parsed as
              `activeInds.X ?? (indicators.X ? ' act' : '')`, so when
              activeInds.X = true the template literal coerced to
              "indbtrue" / "indbfalse" instead of "indb act". Adding
              parens around `(activeInds.X ?? indicators.X)` forces
              "is this truthy" → " act" / "" semantics on every button.
              Also passes `e.currentTarget` to togInd so the imperative
              class toggle in dom2.ts:235 fires (UI sync robustness). */}
          <button className={`indb${(activeInds.ema ?? indicators.ema) ? ' act' : ''}`} id="bema" onClick={(e) => togInd('ema', e.currentTarget)}>EMA</button>
          <button className={`indb${(activeInds.wma ?? indicators.wma) ? ' act' : ''}`} id="bwma" onClick={(e) => togInd('wma', e.currentTarget)}>WMA</button>
          <button className={`indb${(activeInds.st ?? indicators.st) ? ' act' : ''}`} id="bst" onClick={(e) => togInd('st', e.currentTarget)}>ST</button>
          <button className={`indb${(activeInds.vp ?? indicators.vp) ? ' act' : ''}`} id="bvp" onClick={(e) => togInd('vp', e.currentTarget)}>VOLP</button>
          <span style={{ width: '8px' }}></span>
          <button className={`ovrb${tsOn ? ' act' : ''}`} id="ts-toggle-btn" title="Time &amp; Sales tape (T)" onClick={toggleTimeSales}>&#128200; T&amp;S</button>
          <span style={{ width: '8px' }}></span>
          <span className="dt-sep">|</span>
          <button className={`dt-btn${drawTool === 'hline' ? ' act' : ''}`} id="dt-hline" title="Horizontal Line (H)" onClick={() => handleDrawTool('hline')}>&#9473;</button>
          <button className={`dt-btn${drawTool === 'tline' ? ' act' : ''}`} id="dt-tline" title="Trendline (click 2 points)" onClick={() => handleDrawTool('tline')}>&#9585;</button>
          <button className={`dt-btn${drawTool === 'eraser' ? ' act' : ''}`} id="dt-eraser" title="Eraser (click near line)" onClick={() => handleDrawTool('eraser')}>&#9003;</button>
          <button className={`dt-btn${!drawingsVisible ? ' act' : ''}`} id="dt-eye" title="Toggle drawings visibility" onClick={handleDrawToggleVis}>&#128065;</button>
          <button className="dt-btn" title="Clear all drawings" style={{ color: 'var(--red, #ff3355)' }} onClick={handleDrawClearAll}>&#128465;</button>
        </div>
      </div>

      {/* ── Indicator Panel (bottom sheet) — 1:1 from indOverlay + indPanel in index.html ── */}
      {/* [BUG-UI-CMP-8] Guard: only close if click hits overlay itself, not bubbled from panel content */}
      <div className={`ind-panel-overlay${indPanelOpen ? ' open' : ''}`} id="indOverlay" onClick={(e) => { if (e.target === e.currentTarget) setIndPanelOpen(false) }}></div>
      <div className={`ind-panel${indPanelOpen ? ' open' : ''}`} id="indPanel">
        <div className="ind-panel-hdr">
          <span className="ind-panel-title">SELECT INDICATOR</span>
          <span style={{ cursor: 'pointer', color: 'var(--dim)', fontSize: '14px' }} onClick={() => setIndPanelOpen(false)}>✕</span>
        </div>
        <div className="ind-panel-body" id="indPanelBody">
          {/* [2026-06-16] Active indicators float to the top so the operator sees what's
              on at a glance. Stable sort (V8) keeps the original order within each group. */}
          {[...IND_LIST].sort((a, b) => {
            const on = (m: IndMeta) => (m.modalOnly ? 0 : ((m.isOverlay ? ((overlays as unknown as Record<string, boolean>)[m.id] ?? false) : (activeInds[m.id] ?? (indicators as unknown as Record<string, boolean>)[m.id] ?? false)) ? 1 : 0))
            return on(b) - on(a)
          }).map((ind) => {
            // [batch3-A] Route on/off state + toggle through the correct store:
            //   isOverlay → overlays[id]   (togOvr)
            //   modalOnly → no toggle, just a gear/OPEN button (OVI pattern)
            //   default   → indicators[id] or activeInds[id]   (togInd)
            const isOn = ind.modalOnly
              ? false
              : ind.isOverlay
                ? ((overlays as unknown as Record<string, boolean>)[ind.id] ?? false)
                : (activeInds[ind.id] ?? (indicators as unknown as Record<string, boolean>)[ind.id] ?? false)
            return (
              <div key={ind.id} className="ind-row">
                <div className="ind-row-l">
                  {IND_ICONS[ind.id]
                    ? <span className="ind-row-ico" dangerouslySetInnerHTML={{ __html: IND_ICONS[ind.id] }} />
                    : <span className="ind-row-ico">{ind.ico}</span>}
                  <div>
                    <div className="ind-row-name">{ind.name}</div>
                    <div className="ind-row-desc">{ind.desc}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {(ind.settingsModal || ind.hasGenericSettings) && (
                    <span
                      className="gear"
                      style={{ cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', border: '1px solid #f0c04033', fontSize: '11px', color: '#f0c040' }}
                      title={`${ind.name} Settings`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (ind.settingsModal) openModal(ind.settingsModal as Parameters<typeof openModal>[0])
                        else if (ind.hasGenericSettings) openIndSettings(ind.id)
                      }}
                    >&#9881;&#65039;</span>
                  )}
                  {ind.modalOnly ? (
                    <button
                      style={{ fontSize: '9px', padding: '3px 10px', borderRadius: '3px', background: '#1a1a1a', color: '#f0c040', border: '1px solid #f0c04044', cursor: 'pointer', fontWeight: 600, letterSpacing: '0.5px' }}
                      onClick={() => openModal(ind.settingsModal as Parameters<typeof openModal>[0])}
                    >OPEN</button>
                  ) : (
                    /* [BUG-UI-CMP-3] Semantic switch button (native keyboard a11y, no manual onKeyDown to avoid double-toggle) */
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isOn}
                      className={`ind-toggle${isOn ? ' on' : ''}`}
                      onClick={() => ind.isOverlay ? togOvr(ind.id as keyof typeof overlays) : togInd(ind.id)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      <span className="ind-toggle-dot" aria-hidden="true"></span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
