import { NextResponse } from 'next/server'
import { buildBtcTrend, buildCoinSignal, synthMarket } from '@/lib/signals'
import type { CoinSignal, MarketResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface CoinGeckoMarket {
  id: string
  symbol: string
  name: string
  current_price: number
  market_cap: number
  price_change_percentage_24h: number | null
  sparkline_in_7d?: { price: number[] }
}

const CG_URL =
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h'

async function fetchLive(): Promise<MarketResponse | null> {
  try {
    const res = await fetch(CG_URL, {
      headers: { accept: 'application/json' },
      // Public endpoint is rate limited; cache briefly at the edge.
      next: { revalidate: 20 },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as CoinGeckoMarket[]
    if (!Array.isArray(data) || data.length === 0) return null

    const totalCap = data.reduce((sum, c) => sum + (c.market_cap ?? 0), 0)
    const btcRaw = data.find((c) => c.symbol.toLowerCase() === 'btc')

    const coins: CoinSignal[] = data.map((c) =>
      buildCoinSignal({
        symbol: `${c.symbol.toUpperCase()}USDT`,
        name: c.name,
        price: c.current_price ?? 0,
        change24h: c.price_change_percentage_24h ?? 0,
        sparkline: c.sparkline_in_7d?.price ?? [],
      }),
    )

    const btc = buildBtcTrend({
      price: btcRaw?.current_price ?? coins[0]?.price ?? 0,
      change24h: btcRaw?.price_change_percentage_24h ?? 0,
      dominance: totalCap > 0 && btcRaw ? (btcRaw.market_cap / totalCap) * 100 : 58,
      sparkline: btcRaw?.sparkline_in_7d?.price ?? [],
    })

    return { btc, coins, updatedAt: Date.now(), live: true }
  } catch {
    return null
  }
}

export async function GET() {
  const live = await fetchLive()
  if (live) return NextResponse.json(live)

  const now = Date.now()
  const { btc, coins } = synthMarket(now)
  const fallback: MarketResponse = { btc, coins, updatedAt: now, live: false }
  return NextResponse.json(fallback)
}
