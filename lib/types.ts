export type Signal = 'BUY' | 'SELL' | 'NEUTRAL'
export type Trend = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

export const TIMEFRAMES = ['1M', '3M', '5M', '15M', '1H'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

export interface CoinSignal {
  symbol: string
  name: string
  price: number
  change24h: number
  timeframes: Record<Timeframe, Signal>
  score: number
  trend: Trend
  sparkline: number[]
}

export interface IndicatorCheck {
  label: string
  passed: boolean
}

export interface BtcTrend {
  price: number
  change24h: number
  dominance: number
  fearGreed: number
  fearGreedLabel: string
  trend: Trend
  strength: number
  timeframes: Record<Timeframe, Signal>
  indicators: IndicatorCheck[]
  sparkline: number[]
}

export interface MarketResponse {
  btc: BtcTrend
  coins: CoinSignal[]
  updatedAt: number
  live: boolean
}

export type TradeSide = 'LONG' | 'SHORT'
export type TradeStatus = 'OPEN' | 'CLOSED'
// Why a trade closed: hit its stop, hit its target, or the user closed it manually.
export type CloseReason = 'SL' | 'TP' | 'MANUAL' | null

export interface Trade {
  id: string
  symbol: string
  side: TradeSide
  entry: number
  exit: number | null
  size: number // position size in quote currency (USDT notional)
  stop: number | null
  target: number | null
  status: TradeStatus
  notes: string
  openedAt: number
  closedAt: number | null
  closeReason: CloseReason
}
