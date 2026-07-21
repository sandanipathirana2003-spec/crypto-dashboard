import {
  type BtcTrend,
  type CoinSignal,
  type IndicatorCheck,
  type Signal,
  type Timeframe,
  TIMEFRAMES,
  type Trend,
} from './types'

// ---- Pure indicator helpers -------------------------------------------------

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0
  const k = 2 / (period + 1)
  let e = values[0]
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k)
  }
  return e
}

function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50
  let gains = 0
  let losses = 0
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  if (losses === 0) return 100
  const rs = gains / period / (losses / period)
  return 100 - 100 / (1 + rs)
}

function slope(values: number[]): number {
  if (values.length < 2) return 0
  const first = values[0]
  const last = values[values.length - 1]
  if (first === 0) return 0
  return ((last - first) / Math.abs(first)) * 100
}

function macd(values: number[]): { hist: number } {
  if (values.length < 26) return { hist: 0 }
  const fast = ema(values.slice(-24), 12)
  const slow = ema(values.slice(-52 > -values.length ? -values.length : -52), 26)
  return { hist: fast - slow }
}

// Windows over an hourly sparkline used as proxies for each timeframe.
const TF_WINDOWS: Record<Timeframe, number> = {
  '1M': 4,
  '3M': 8,
  '5M': 12,
  '15M': 24,
  '1H': 48,
}

// Multi-indicator confirmation per timeframe: a signal only fires when trend
// direction (slope + EMA cross), momentum (RSI), and MACD histogram agree.
function timeframeSignal(window: number[]): Signal {
  if (window.length < 3) return 'NEUTRAL'
  const pct = slope(window)
  const fast = ema(window, Math.max(2, Math.round(window.length / 4)))
  const slow = ema(window, Math.max(3, Math.round(window.length / 2)))
  const r = rsi(window, Math.min(14, window.length - 1))
  const m = macd(window).hist

  let bull = 0
  let bear = 0
  // Price slope
  if (pct > 0.12) bull++
  else if (pct < -0.12) bear++
  // EMA cross
  if (fast > slow) bull++
  else if (fast < slow) bear++
  // RSI momentum
  if (r >= 55) bull++
  else if (r <= 45) bear++
  // MACD histogram
  if (m > 0) bull++
  else if (m < 0) bear++

  // Require at least 3 of 4 confirmations to avoid noise.
  if (bull >= 3) return 'BUY'
  if (bear >= 3) return 'SELL'
  return 'NEUTRAL'
}

function timeframeSignals(prices: number[]): Record<Timeframe, Signal> {
  const out = {} as Record<Timeframe, Signal>
  for (const tf of TIMEFRAMES) {
    const w = TF_WINDOWS[tf]
    const window = prices.slice(Math.max(0, prices.length - w))
    out[tf] = timeframeSignal(window)
  }
  return out
}

function trendFromSignals(tfs: Record<Timeframe, Signal>): Trend {
  const buys = TIMEFRAMES.filter((t) => tfs[t] === 'BUY').length
  const sells = TIMEFRAMES.filter((t) => tfs[t] === 'SELL').length
  if (buys > sells && buys >= 3) return 'BULLISH'
  if (sells > buys && sells >= 3) return 'BEARISH'
  return 'NEUTRAL'
}

// Score 0-100: how aligned + healthy the setup is for the dominant direction.
function computeScore(prices: number[], tfs: Record<Timeframe, Signal>): number {
  const buys = TIMEFRAMES.filter((t) => tfs[t] === 'BUY').length
  const sells = TIMEFRAMES.filter((t) => tfs[t] === 'SELL').length
  const aligned = Math.max(buys, sells)
  const alignmentScore = (aligned / TIMEFRAMES.length) * 55

  const r = rsi(prices)
  const bullish = buys >= sells
  let rsiScore = 0
  if (bullish) rsiScore = r >= 55 && r <= 72 ? 20 : r > 50 ? 12 : 4
  else rsiScore = r <= 45 && r >= 28 ? 20 : r < 50 ? 12 : 4

  const e20 = ema(prices.slice(-40), 20)
  const e50 = ema(prices, 50)
  const emaAligned = bullish ? e20 >= e50 : e20 <= e50
  const emaScore = emaAligned ? 15 : 4

  const momentum = Math.min(10, Math.abs(slope(prices.slice(-48))) * 2)

  return Math.round(Math.min(99, alignmentScore + rsiScore + emaScore + momentum))
}

export function buildCoinSignal(input: {
  symbol: string
  name: string
  price: number
  change24h: number
  sparkline: number[]
}): CoinSignal {
  const prices = input.sparkline.length > 2 ? input.sparkline : [input.price, input.price]
  const timeframes = timeframeSignals(prices)
  const trend = trendFromSignals(timeframes)
  const score = computeScore(prices, timeframes)
  return {
    symbol: input.symbol,
    name: input.name,
    price: input.price,
    change24h: input.change24h,
    timeframes,
    score,
    trend,
    // keep last 40 points for compact chart rendering
    sparkline: prices.slice(-40),
  }
}

function fearGreedFromMomentum(change24h: number, strength: number): { value: number; label: string } {
  // Heuristic index derived from momentum + trend strength.
  const value = Math.max(4, Math.min(96, Math.round(50 + change24h * 4 + (strength - 50) * 0.4)))
  let label = 'Neutral'
  if (value >= 75) label = 'Extreme Greed'
  else if (value >= 60) label = 'Greed'
  else if (value >= 45) label = 'Neutral'
  else if (value >= 25) label = 'Fear'
  else label = 'Extreme Fear'
  return { value, label }
}

export function buildBtcTrend(input: {
  price: number
  change24h: number
  dominance: number
  sparkline: number[]
}): BtcTrend {
  const prices = input.sparkline.length > 2 ? input.sparkline : [input.price, input.price]
  const timeframes = timeframeSignals(prices)
  const trend = trendFromSignals(timeframes)
  const score = computeScore(prices, timeframes)

  const bullish = trend === 'BULLISH'
  const r = rsi(prices)
  const e20 = ema(prices.slice(-40), 20)
  const e50 = ema(prices, 50)
  const e200 = ema(prices, prices.length)
  const macdBull = ema(prices.slice(-24), 12) >= ema(prices.slice(-52), 26)
  const adx = Math.min(60, 18 + Math.abs(slope(prices.slice(-48))) * 6)

  const indicators: IndicatorCheck[] = [
    { label: 'EMA Alignment', passed: bullish ? e20 >= e50 && e50 >= e200 : e20 <= e50 },
    { label: 'MACD Bullish', passed: macdBull === bullish ? bullish : !bullish ? true : macdBull },
    { label: 'RSI Healthy', passed: r >= 45 && r <= 72 },
    { label: 'ADX > 25', passed: adx > 25 },
    { label: 'BOS Confirmed', passed: score >= 70 },
    { label: 'FVG Bullish', passed: bullish && input.change24h > 0 },
  ]

  const fg = fearGreedFromMomentum(input.change24h, score)

  return {
    price: input.price,
    change24h: input.change24h,
    dominance: input.dominance,
    fearGreed: fg.value,
    fearGreedLabel: fg.label,
    trend,
    strength: score,
    timeframes,
    indicators,
    sparkline: prices.slice(-40),
  }
}

// ---- Deterministic fallback synth (when the public API is unavailable) ------

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFromString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function synthSparkline(seed: number, base: number, drift: number): number[] {
  const rand = mulberry32(seed)
  const out: number[] = []
  let p = base
  for (let i = 0; i < 60; i++) {
    const noise = (rand() - 0.5) * base * 0.01
    p = p + noise + (drift * base) / 6000
    out.push(Math.max(p, base * 0.5))
  }
  return out
}

const FALLBACK_COINS: Array<{ symbol: string; name: string; base: number }> = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', base: 109245 },
  { symbol: 'ETHUSDT', name: 'Ethereum', base: 3980 },
  { symbol: 'SOLUSDT', name: 'Solana', base: 214 },
  { symbol: 'BNBUSDT', name: 'BNB', base: 712 },
  { symbol: 'XRPUSDT', name: 'XRP', base: 2.31 },
  { symbol: 'DOGEUSDT', name: 'Dogecoin', base: 0.38 },
  { symbol: 'ADAUSDT', name: 'Cardano', base: 1.04 },
  { symbol: 'AVAXUSDT', name: 'Avalanche', base: 44.2 },
  { symbol: 'LINKUSDT', name: 'Chainlink', base: 23.1 },
  { symbol: 'TONUSDT', name: 'Toncoin', base: 5.62 },
  { symbol: 'DOTUSDT', name: 'Polkadot', base: 8.4 },
  { symbol: 'MATICUSDT', name: 'Polygon', base: 0.58 },
  { symbol: 'LTCUSDT', name: 'Litecoin', base: 132 },
  { symbol: 'NEARUSDT', name: 'NEAR', base: 6.9 },
  { symbol: 'APTUSDT', name: 'Aptos', base: 12.4 },
  { symbol: 'ARBUSDT', name: 'Arbitrum', base: 1.12 },
  { symbol: 'OPUSDT', name: 'Optimism', base: 2.34 },
  { symbol: 'INJUSDT', name: 'Injective', base: 28.7 },
  { symbol: 'SUIUSDT', name: 'Sui', base: 4.31 },
  { symbol: 'SEIUSDT', name: 'Sei', base: 0.74 },
  { symbol: 'ATOMUSDT', name: 'Cosmos', base: 9.2 },
  { symbol: 'FILUSDT', name: 'Filecoin', base: 6.1 },
  { symbol: 'RNDRUSDT', name: 'Render', base: 9.8 },
  { symbol: 'TIAUSDT', name: 'Celestia', base: 7.4 },
  { symbol: 'HBARUSDT', name: 'Hedera', base: 0.29 },
  { symbol: 'SHIBUSDT', name: 'Shiba Inu', base: 0.0000246 },
  { symbol: 'TRXUSDT', name: 'TRON', base: 0.264 },
  { symbol: 'BCHUSDT', name: 'Bitcoin Cash', base: 512 },
  { symbol: 'UNIUSDT', name: 'Uniswap', base: 14.6 },
  { symbol: 'ICPUSDT', name: 'Internet Computer', base: 11.8 },
  { symbol: 'ETCUSDT', name: 'Ethereum Classic', base: 32.1 },
  { symbol: 'STXUSDT', name: 'Stacks', base: 2.18 },
  { symbol: 'IMXUSDT', name: 'Immutable', base: 1.94 },
  { symbol: 'AAVEUSDT', name: 'Aave', base: 342 },
  { symbol: 'GRTUSDT', name: 'The Graph', base: 0.31 },
  { symbol: 'ALGOUSDT', name: 'Algorand', base: 0.42 },
  { symbol: 'QNTUSDT', name: 'Quant', base: 118 },
  { symbol: 'FTMUSDT', name: 'Fantom', base: 1.12 },
  { symbol: 'THETAUSDT', name: 'Theta', base: 2.04 },
  { symbol: 'FLOWUSDT', name: 'Flow', base: 0.98 },
  { symbol: 'AXSUSDT', name: 'Axie Infinity', base: 8.6 },
  { symbol: 'SANDUSDT', name: 'The Sandbox', base: 0.62 },
  { symbol: 'MANAUSDT', name: 'Decentraland', base: 0.58 },
  { symbol: 'XLMUSDT', name: 'Stellar', base: 0.42 },
  { symbol: 'VETUSDT', name: 'VeChain', base: 0.058 },
  { symbol: 'EGLDUSDT', name: 'MultiversX', base: 42.3 },
  { symbol: 'EOSUSDT', name: 'EOS', base: 0.94 },
  { symbol: 'XTZUSDT', name: 'Tezos', base: 1.28 },
  { symbol: 'CHZUSDT', name: 'Chiliz', base: 0.124 },
  { symbol: 'CRVUSDT', name: 'Curve DAO', base: 0.94 },
  { symbol: 'LDOUSDT', name: 'Lido DAO', base: 2.86 },
  { symbol: 'MKRUSDT', name: 'Maker', base: 2140 },
  { symbol: 'SNXUSDT', name: 'Synthetix', base: 3.42 },
  { symbol: 'RUNEUSDT', name: 'THORChain', base: 6.8 },
  { symbol: 'KAVAUSDT', name: 'Kava', base: 0.86 },
  { symbol: 'MINAUSDT', name: 'Mina', base: 0.94 },
  { symbol: 'GALAUSDT', name: 'Gala', base: 0.048 },
  { symbol: 'DYDXUSDT', name: 'dYdX', base: 1.98 },
  { symbol: 'ZECUSDT', name: 'Zcash', base: 48.2 },
  { symbol: 'ENJUSDT', name: 'Enjin Coin', base: 0.32 },
  { symbol: '1INCHUSDT', name: '1inch', base: 0.46 },
  { symbol: 'COMPUSDT', name: 'Compound', base: 84.2 },
  { symbol: 'ZILUSDT', name: 'Zilliqa', base: 0.026 },
  { symbol: 'BATUSDT', name: 'Basic Attention', base: 0.28 },
  { symbol: 'ROSEUSDT', name: 'Oasis Network', base: 0.096 },
  { symbol: 'ONEUSDT', name: 'Harmony', base: 0.021 },
  { symbol: 'ANKRUSDT', name: 'Ankr', base: 0.038 },
  { symbol: 'WLDUSDT', name: 'Worldcoin', base: 2.64 },
  { symbol: 'PYTHUSDT', name: 'Pyth Network', base: 0.42 },
  { symbol: 'JUPUSDT', name: 'Jupiter', base: 1.14 },
  { symbol: 'JTOUSDT', name: 'Jito', base: 3.28 },
  { symbol: 'PENDLEUSDT', name: 'Pendle', base: 5.94 },
  { symbol: 'ONDOUSDT', name: 'Ondo', base: 1.42 },
  { symbol: 'ENAUSDT', name: 'Ethena', base: 0.86 },
  { symbol: 'WUSDT', name: 'Wormhole', base: 0.42 },
  { symbol: 'STRKUSDT', name: 'Starknet', base: 0.58 },
  { symbol: 'MANTAUSDT', name: 'Manta Network', base: 0.94 },
  { symbol: 'ALTUSDT', name: 'Altlayer', base: 0.18 },
  { symbol: 'DYMUSDT', name: 'Dymension', base: 1.86 },
  { symbol: 'PIXELUSDT', name: 'Pixels', base: 0.24 },
  { symbol: 'PEPEUSDT', name: 'Pepe', base: 0.0000182 },
  { symbol: 'WIFUSDT', name: 'dogwifhat', base: 2.86 },
  { symbol: 'BONKUSDT', name: 'Bonk', base: 0.0000324 },
  { symbol: 'FLOKIUSDT', name: 'Floki', base: 0.00021 },
  { symbol: 'BOMEUSDT', name: 'Book of Meme', base: 0.011 },
  { symbol: 'ORDIUSDT', name: 'Ordinals', base: 42.4 },
  { symbol: 'SATSUSDT', name: 'SATS', base: 0.00000042 },
  { symbol: '1000SATSUSDT', name: '1000SATS', base: 0.00042 },
  { symbol: 'FETUSDT', name: 'Fetch.ai', base: 1.42 },
  { symbol: 'AGIXUSDT', name: 'SingularityNET', base: 0.68 },
  { symbol: 'OCEANUSDT', name: 'Ocean Protocol', base: 0.72 },
  { symbol: 'ARKMUSDT', name: 'Arkham', base: 1.84 },
  { symbol: 'AIUSDT', name: 'Sleepless AI', base: 0.62 },
  { symbol: 'BLURUSDT', name: 'Blur', base: 0.34 },
  { symbol: 'MEMEUSDT', name: 'Memecoin', base: 0.018 },
  { symbol: 'GMXUSDT', name: 'GMX', base: 28.6 },
  { symbol: 'CAKEUSDT', name: 'PancakeSwap', base: 2.42 },
  { symbol: 'GMTUSDT', name: 'STEPN', base: 0.18 },
  { symbol: 'APEUSDT', name: 'ApeCoin', base: 1.12 },
  { symbol: 'KASUSDT', name: 'Kaspa', base: 0.16 },
]

export function synthMarket(now: number): {
  btc: BtcTrend
  coins: CoinSignal[]
} {
  const bucket = Math.floor(now / 15000) // shifts every 15s for gentle live feel
  const coins = FALLBACK_COINS.map((c) => {
    const seed = seedFromString(c.symbol) ^ bucket
    const rand = mulberry32(seed)
    const drift = (rand() - 0.45) * 10
    const spark = synthSparkline(seed, c.base, drift)
    const price = spark[spark.length - 1]
    const change24h = ((price - c.base) / c.base) * 100 + (rand() - 0.5) * 3
    return buildCoinSignal({
      symbol: c.symbol,
      name: c.name,
      price,
      change24h,
      sparkline: spark,
    })
  })

  const btcCoin = FALLBACK_COINS[0]
  const seed = seedFromString('BTC-MASTER') ^ bucket
  const rand = mulberry32(seed)
  const drift = (rand() - 0.35) * 12
  const spark = synthSparkline(seed, btcCoin.base, drift)
  const price = spark[spark.length - 1]
  const btc = buildBtcTrend({
    price,
    change24h: ((price - btcCoin.base) / btcCoin.base) * 100 + (rand() - 0.4) * 2,
    dominance: 58 + rand() * 6,
    sparkline: spark,
  })

  return { btc, coins }
}
