'use client'

import { useMemo, useState } from 'react'
import { BookmarkPlus, Check, ShieldCheck, X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/format'
import { useTrades } from '@/hooks/use-trades'
import type { BtcTrend, CoinSignal } from '@/lib/types'
import { TIMEFRAMES } from '@/lib/types'

const MIN_CONFIDENCE = 90
const RISK_PCT = 0.01
const STOP_PCT = 0.012

function Gauge({ score }: { score: number }) {
  const color = score >= 90 ? 'text-bull' : score >= 75 ? 'text-warn' : 'text-muted-foreground'
  const r = 34
  const c = 2 * Math.PI * r
  const offset = c - (score / 100) * c
  return (
    <div className="relative flex size-24 items-center justify-center">
      <svg className="size-24 -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={color}
        />
      </svg>
      <div className="absolute text-center">
        <span className={cn('font-mono text-xl font-bold', color)}>{score}</span>
        <span className="text-muted-foreground block text-[9px] uppercase">score</span>
      </div>
    </div>
  )
}

function Condition({ label, passed }: { label: string; passed: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="text-foreground/90">{label}</span>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
          passed ? 'bg-bull/15 text-bull' : 'bg-bear/15 text-bear',
        )}
      >
        {passed ? <Check className="size-3" /> : <X className="size-3" />}
        {passed ? 'PASS' : 'FAIL'}
      </span>
    </li>
  )
}

export function BotPanel({ coin, btc }: { coin?: CoinSignal; btc?: BtcTrend }) {
  const [balance, setBalance] = useState(10000)
  const [logged, setLogged] = useState(false)
  const { addTrade } = useTrades()

  const direction = coin?.trend === 'BULLISH' ? 'LONG' : coin?.trend === 'BEARISH' ? 'SHORT' : 'FLAT'
  const isLong = direction === 'LONG'

  const conditions = useMemo(() => {
    if (!coin || !btc) return []
    const desired = coin.trend === 'BULLISH' ? 'BUY' : coin.trend === 'BEARISH' ? 'SELL' : 'NEUTRAL'
    const tfChecks = TIMEFRAMES.map((t) => ({
      label: `${t} = ${coin.timeframes[t]}`,
      passed: desired !== 'NEUTRAL' && coin.timeframes[t] === desired,
    }))
    return [
      { label: `BTC Master = ${btc.trend}`, passed: btc.trend === coin.trend && coin.trend !== 'NEUTRAL' },
      ...tfChecks,
      { label: `AI Score > ${MIN_CONFIDENCE}%`, passed: coin.score >= MIN_CONFIDENCE },
    ]
  }, [coin, btc])

  const allPass = conditions.length > 0 && conditions.every((c) => c.passed)

  const sizing = useMemo(() => {
    if (!coin) return null
    const entry = coin.price
    const risk = balance * RISK_PCT
    const notional = risk / STOP_PCT
    const qty = notional / entry
    const sl = isLong ? entry * (1 - STOP_PCT) : entry * (1 + STOP_PCT)
    const tp1 = isLong ? entry * (1 + STOP_PCT * 2) : entry * (1 - STOP_PCT * 2)
    const tp2 = isLong ? entry * (1 + STOP_PCT * 3) : entry * (1 - STOP_PCT * 3)
    return { entry, risk, notional, qty, sl, tp1, tp2 }
  }, [coin, balance, isLong])

  // Plain-language recommendation shown prominently.
  const recommendation = useMemo(() => {
    if (!coin) return { action: 'WAIT', detail: 'Select a coin.' }
    if (allPass && isLong) return { action: 'BUY / OPEN LONG', detail: `Enter near $${formatPrice(coin.price)}, take profit at TP1/TP2, stop below.` }
    if (allPass && !isLong) return { action: 'SELL / OPEN SHORT', detail: `Enter near $${formatPrice(coin.price)}, take profit at TP1/TP2, stop above.` }
    if (direction === 'LONG') return { action: 'HOLD — wait for confluence', detail: 'Bias is bullish but not all conditions align yet.' }
    if (direction === 'SHORT') return { action: 'HOLD — wait for confluence', detail: 'Bias is bearish but not all conditions align yet.' }
    return { action: 'NO TRADE', detail: 'Timeframes are mixed. Stay flat.' }
  }, [coin, allPass, isLong, direction])

  function logSetup() {
    if (!coin || !sizing || direction === 'FLAT') return
    addTrade({
      symbol: coin.symbol,
      side: isLong ? 'LONG' : 'SHORT',
      entry: sizing.entry,
      size: sizing.notional,
      stop: sizing.sl,
      target: sizing.tp1,
      notes: `${coin.score}% score · ${allPass ? 'all conditions passed' : 'manual'}`,
    })
    setLogged(true)
    setTimeout(() => setLogged(false), 1800)
  }

  return (
    <aside className="border-border bg-sidebar flex h-full flex-col overflow-y-auto border-l">
      <div className="border-border flex items-center gap-2 border-b p-3">
        <Zap className="text-primary size-4" />
        <h2 className="text-sm font-semibold">AI + Bot Engine</h2>
      </div>

      {/* Signal score */}
      <div className="border-border flex items-center gap-4 border-b p-3">
        <Gauge score={coin?.score ?? 0} />
        <div className="space-y-1">
          <p className="text-muted-foreground text-[11px] uppercase tracking-wide">Direction</p>
          <p
            className={cn(
              'font-mono text-lg font-bold',
              direction === 'LONG' ? 'text-bull' : direction === 'SHORT' ? 'text-bear' : 'text-muted-foreground',
            )}
          >
            {direction}
          </p>
          <p className="text-muted-foreground font-mono text-xs">{coin?.symbol ?? '—'}</p>
        </div>
      </div>

      {/* Recommendation */}
      <div className="border-border border-b p-3">
        <p className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wide">Recommendation</p>
        <p
          className={cn(
            'font-mono text-sm font-bold',
            recommendation.action.startsWith('BUY')
              ? 'text-bull'
              : recommendation.action.startsWith('SELL')
                ? 'text-bear'
                : 'text-warn',
          )}
        >
          {recommendation.action}
        </p>
        <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">{recommendation.detail}</p>
      </div>

      {/* Position sizing */}
      <div className="border-border border-b p-3">
        <p className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wide">Trade Setup</p>
        <label className="mb-2 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Account ($)</span>
          <input
            type="number"
            value={balance}
            min={0}
            onChange={(e) => setBalance(Math.max(0, Number(e.target.value)))}
            className="border-border bg-secondary/50 focus:ring-ring w-28 rounded-md border px-2 py-1 text-right font-mono outline-none focus:ring-2"
          />
        </label>
        {sizing ? (
          <dl className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
            <Row label="Risk (1%)" value={`$${formatPrice(sizing.risk)}`} />
            <Row label="Notional" value={`$${formatPrice(sizing.notional)}`} />
            <Row label="Entry" value={`$${formatPrice(sizing.entry)}`} />
            <Row label="Qty" value={sizing.qty.toFixed(4)} />
            <Row label="Stop Loss" value={`$${formatPrice(sizing.sl)}`} tone="bear" />
            <Row label="TP1 (1:2)" value={`$${formatPrice(sizing.tp1)}`} tone="bull" />
            <Row label="TP2 (1:3)" value={`$${formatPrice(sizing.tp2)}`} tone="bull" />
            <Row label="Margin" value="Isolated" />
          </dl>
        ) : (
          <p className="text-muted-foreground text-xs">Select a coin to size a trade.</p>
        )}
      </div>

      {/* Conditions gate */}
      <div className="border-border border-b p-3">
        <p className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wide">Execution Gate</p>
        <ul className="space-y-1.5">
          {conditions.length > 0 ? (
            conditions.map((c) => <Condition key={c.label} label={c.label} passed={c.passed} />)
          ) : (
            <li className="text-muted-foreground text-xs">Waiting for signal data…</li>
          )}
        </ul>
      </div>

      {/* Bot action */}
      <div className="p-3">
        <div
          className={cn(
            'rounded-md border p-3 text-center',
            allPass && isLong
              ? 'border-bull/40 bg-bull/10'
              : allPass && !isLong
                ? 'border-bear/40 bg-bear/10'
                : 'border-border bg-secondary/40',
          )}
        >
          <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">Bot Action</p>
          <p
            className={cn(
              'font-mono text-base font-bold',
              allPass && isLong ? 'text-bull' : allPass && !isLong ? 'text-bear' : 'text-muted-foreground',
            )}
          >
            {allPass ? `EXECUTE ${direction}` : 'STAND DOWN'}
          </p>
          <p className="text-muted-foreground font-mono text-xs">{coin ? `${coin.score}% confidence` : '—'}</p>
        </div>

        <button
          type="button"
          disabled={!allPass}
          className={cn(
            'mt-3 flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold transition-colors',
            allPass
              ? isLong
                ? 'bg-bull text-bull-foreground hover:opacity-90'
                : 'bg-bear text-bear-foreground hover:opacity-90'
              : 'bg-secondary text-muted-foreground cursor-not-allowed',
          )}
        >
          <Zap className="size-4" />
          {allPass ? `Send ${direction} to Bot` : 'Conditions Not Met'}
        </button>

        <button
          type="button"
          onClick={logSetup}
          disabled={!coin || direction === 'FLAT'}
          className={cn(
            'mt-2 flex w-full items-center justify-center gap-2 rounded-md border py-2 text-xs font-semibold transition-colors',
            !coin || direction === 'FLAT'
              ? 'border-border text-muted-foreground cursor-not-allowed'
              : 'border-primary/40 text-primary hover:bg-primary/10',
          )}
        >
          <BookmarkPlus className="size-3.5" />
          {logged ? 'Logged to Journal ✓' : 'Log Setup to Journal'}
        </button>

        <p className="text-muted-foreground mt-2 flex items-center justify-center gap-1 text-center text-[10px]">
          <ShieldCheck className="size-3" />
          SAFE MODE — no live orders are placed
        </p>
      </div>
    </aside>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' }) {
  return (
    <div className="bg-secondary/40 flex items-center justify-between rounded px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-semibold', tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : 'text-foreground')}>
        {value}
      </span>
    </div>
  )
}
