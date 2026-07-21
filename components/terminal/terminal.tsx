'use client'

import { useEffect, useState } from 'react'
import { BookOpen, LineChart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMarket } from '@/hooks/use-market'
import { useTrades } from '@/hooks/use-trades'
import { BotPanel } from './bot-panel'
import { BtcSidebar } from './btc-sidebar'
import { CoinScanner } from './coin-scanner'
import { TimeframeGrid } from './timeframe-grid'
import { TopBar } from './top-bar'
import { TradeJournal } from './trade-journal'

type Tab = 'terminal' | 'journal'

export function Terminal() {
  const { market, isLoading } = useMarket()
  const { autoCheckTrades } = useTrades()
  const [selected, setSelected] = useState('BTCUSDT')
  const [tab, setTab] = useState<Tab>('terminal')

  // Every time fresh prices come in (every 15s), check open trades against
  // their locked stop/target and auto-close anything that's been hit.
  useEffect(() => {
    if (!market) return
    const prices: Record<string, number> = {}
    for (const c of market.coins) prices[c.symbol] = c.price
    autoCheckTrades(prices)
  }, [market, autoCheckTrades])

  // If the selected symbol is missing from the feed, fall back to the first coin.
  useEffect(() => {
    if (!market) return
    if (!market.coins.some((c) => c.symbol === selected) && market.coins[0]) {
      setSelected(market.coins[0].symbol)
    }
  }, [market, selected])

  const coin = market?.coins.find((c) => c.symbol === selected)

  return (
    <div className="bg-background flex h-dvh flex-col">
      <TopBar live={market?.live ?? false} updatedAt={market?.updatedAt} />

      <nav className="border-border bg-sidebar flex items-center gap-1 border-b px-3">
        <TabButton active={tab === 'terminal'} onClick={() => setTab('terminal')} icon={<LineChart className="size-4" />}>
          Live Terminal
        </TabButton>
        <TabButton active={tab === 'journal'} onClick={() => setTab('journal')} icon={<BookOpen className="size-4" />}>
          Trade Journal
        </TabButton>
      </nav>

      {isLoading && !market ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center font-mono text-sm">
          Loading market feed…
        </div>
      ) : tab === 'terminal' ? (
        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[21rem_minmax(0,1fr)_20rem]">
          <BtcSidebar btc={market?.btc} />

          <section className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
            <TimeframeGrid coin={coin} />
            <div className="flex min-h-0 flex-1 flex-col lg:min-h-[20rem]">
              <CoinScanner coins={market?.coins ?? []} selected={selected} onSelect={setSelected} />
            </div>
          </section>

          <BotPanel coin={coin} btc={market?.btc} />
        </main>
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <TradeJournal coins={market?.coins ?? []} />
        </main>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'text-muted-foreground hover:text-foreground border-transparent',
      )}
    >
      {icon}
      {children}
    </button>
  )
}
