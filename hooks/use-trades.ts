'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Trade } from '@/lib/types'

const KEY = 'v0-trade-journal'
const EVT = 'v0-trades-changed'

function load(): Trade[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Trade[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function save(trades: Trade[]) {
  window.localStorage.setItem(KEY, JSON.stringify(trades))
  window.dispatchEvent(new Event(EVT))
}

/**
 * Local-first trade journal. Trades are persisted to localStorage and synced
 * across components/tabs via a custom event + the native `storage` event.
 */
export function useTrades() {
  const [trades, setTrades] = useState<Trade[]>([])

  useEffect(() => {
    setTrades(load())
    const sync = () => setTrades(load())
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const addTrade = useCallback((trade: Omit<Trade, 'id' | 'openedAt' | 'status' | 'exit' | 'closedAt' | 'closeReason'>) => {
    const next: Trade = {
      ...trade,
      id: crypto.randomUUID(),
      status: 'OPEN',
      exit: null,
      closedAt: null,
      openedAt: Date.now(),
      closeReason: null,
    }
    save([next, ...load()])
  }, [])

  const closeTrade = useCallback((id: string, exit: number) => {
    save(
      load().map((t) =>
        t.id === id ? { ...t, exit, status: 'CLOSED' as const, closedAt: Date.now(), closeReason: 'MANUAL' as const } : t,
      ),
    )
  }, [])

  const removeTrade = useCallback((id: string) => {
    save(load().filter((t) => t.id !== id))
  }, [])

  const clearAll = useCallback(() => save([]), [])

  /**
   * Auto-close any OPEN trade whose stop or target has been crossed by the
   * current live price. Runs against a symbol -> price map on every market
   * refresh. Exit is recorded at the exact stop/target level (not the live
   * price the moment we happened to poll), so P&L reflects what the signal
   * actually promised. Stop is checked before target on the same tick to be
   * conservative if both were somehow crossed between polls.
   */
  const autoCheckTrades = useCallback((prices: Record<string, number>) => {
    const current = load()
    let changed = false
    const next = current.map((t) => {
      if (t.status !== 'OPEN') return t
      const price = prices[t.symbol]
      if (!price) return t
      const isLong = t.side === 'LONG'

      const hitStop = t.stop != null && (isLong ? price <= t.stop : price >= t.stop)
      const hitTarget = t.target != null && (isLong ? price >= t.target : price <= t.target)

      if (hitStop) {
        changed = true
        return { ...t, exit: t.stop, status: 'CLOSED' as const, closedAt: Date.now(), closeReason: 'SL' as const }
      }
      if (hitTarget) {
        changed = true
        return { ...t, exit: t.target, status: 'CLOSED' as const, closedAt: Date.now(), closeReason: 'TP' as const }
      }
      return t
    })
    if (changed) save(next)
  }, [])

  return { trades, addTrade, closeTrade, removeTrade, clearAll, autoCheckTrades }
}

/** Realized P&L in quote currency for a closed trade (notional-based). */
export function tradePnl(t: Trade): number {
  if (t.exit === null) return 0
  const pct = t.side === 'LONG' ? (t.exit - t.entry) / t.entry : (t.entry - t.exit) / t.entry
  return pct * t.size
}

export function tradePnlPct(t: Trade): number {
  if (t.exit === null) return 0
  return (t.side === 'LONG' ? (t.exit - t.entry) / t.entry : (t.entry - t.exit) / t.entry) * 100
}
