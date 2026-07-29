import asyncio
import json
import websockets
from collections import defaultdict, deque
from .indicators import to_df, sma, ema, rsi
import pandas as pd
from . import alerts_db

BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws"

class RelayManager:
    def __init__(self):
        self.clients = defaultdict(set)  # symbol -> set of websocket connections (FastAPI WebSocket)
        self.tasks = {}  # symbol -> asyncio.Task
        self.candle_cache = defaultdict(lambda: deque(maxlen=1000))  # symbol -> deque of candles
        alerts_db.init_db()

    async def start_symbol(self, symbol):
        sym = symbol.lower()
        if sym in self.tasks:
            return
        task = asyncio.create_task(self._run_binance_listener(sym))
        self.tasks[sym] = task

    async def stop_symbol_if_unused(self, symbol):
        if not self.clients[symbol] and symbol in self.tasks:
            self.tasks[symbol].cancel()
            del self.tasks[symbol]

    async def register(self, symbol, ws):
        self.clients[symbol].add(ws)
        await self.start_symbol(symbol)

    async def unregister(self, symbol, ws):
        if ws in self.clients[symbol]:
            self.clients[symbol].remove(ws)
        await self.stop_symbol_if_unused(symbol)

    async def _broadcast(self, symbol, message):
        to_remove = []
        for ws in list(self.clients[symbol]):
            try:
                await ws.send_text(message)
            except Exception:
                to_remove.append(ws)
        for ws in to_remove:
            self.clients[symbol].discard(ws)

    def _evaluate_alerts_for_symbol(self, symbol: str, latest: dict, prev: dict):
        """
        latest, prev: dicts with keys like 'close', 'rsi_14', 'sma_{n}', 'macd', 'macd_signal'
        Returns list of triggered alerts (dict)
        """
        triggered = []
        try:
            alerts = alerts_db.list_alerts(symbol)
            for a in alerts:
                # Skip already-triggered non-recurring alerts
                if a.get("triggered") and not a.get("recurring"):
                    continue
                t = a.get("type")
                params = a.get("params") or {}
                # price thresholds (existing types)
                if t == "price_above":
                    val = a.get("value")
                    if latest.get("close") is not None and latest["close"] > val:
                        triggered.append(a)
                elif t == "price_below":
                    val = a.get("value")
                    if latest.get("close") is not None and latest["close"] < val:
                        triggered.append(a)
                elif t == "rsi_above":
                    val = a.get("value")
                    if latest.get("rsi_14") is not None and latest["rsi_14"] > val:
                        triggered.append(a)
                elif t == "rsi_below":
                    val = a.get("value")
                    if latest.get("rsi_14") is not None and latest["rsi_14"] < val:
                        triggered.append(a)

                # MACD cross alerts: macd_cross_above, macd_cross_below
                elif t == "macd_cross_above":
                    # detect cross from below to above: prev.macd <= prev.signal and latest.macd > latest.signal
                    if prev and latest and "macd" in prev and "macd_signal" in prev and "macd" in latest and "macd_signal" in latest:
                        if prev["macd"] <= prev["macd_signal"] and latest["macd"] > latest["macd_signal"]:
                            triggered.append(a)
                elif t == "macd_cross_below":
                    if prev and latest and "macd" in prev and "macd_signal" in prev and "macd" in latest and "macd_signal" in latest:
                        if prev["macd"] >= prev["macd_signal"] and latest["macd"] < latest["macd_signal"]:
                            triggered.append(a)

                # SMA crossover: type sma_cross_above / sma_cross_below, params must include short and long window integers
                elif t in ("sma_cross_above", "sma_cross_below"):
                    short_w = int(params.get("short", 10))
                    long_w = int(params.get("long", 50))
                    k_short = f"sma_{short_w}"
                    k_long = f"sma_{long_w}"
                    if prev and latest and k_short in prev and k_long in prev and k_short in latest and k_long in latest:
                        # cross above: prev.short <= prev.long and latest.short > latest.long
                        if t == "sma_cross_above":
                            if prev[k_short] is not None and prev[k_long] is not None and latest[k_short] is not None and latest[k_long] is not None:
                                if prev[k_short] <= prev[k_long] and latest[k_short] > latest[k_long]:
                                    triggered.append(a)
                        else:  # sma_cross_below
                            if prev[k_short] is not None and prev[k_long] is not None and latest[k_short] is not None and latest[k_long] is not None:
                                if prev[k_short] >= prev[k_long] and latest[k_short] < latest[k_long]:
                                    triggered.append(a)
        except Exception:
            pass
        return triggered

    async def _run_binance_listener(self, symbol):
        url = f"{BINANCE_WS_BASE}/{symbol}@kline_1m"
        async for conn in websockets.connect(url):
            try:
                async with conn as websocket:
                    async for msg in websocket:
                        try:
                            data = json.loads(msg)
                            k = data.get("k", {})
                            candle = {
                                "openTime": k.get("t"),
                                "open": k.get("o"),
                                "high": k.get("h"),
                                "low": k.get("l"),
                                "close": k.get("c"),
                                "volume": k.get("v"),
                                "isFinal": k.get("x")
                            }
                            # append to cache
                            self.candle_cache[symbol].append([
                                candle["openTime"],
                                candle["open"],
                                candle["high"],
                                candle["low"],
                                candle["close"],
                                candle["volume"]
                            ])

                            latest_indicators = {"close": float(candle["close"]) }
                            prev_indicators = None

                            # compute indicators using dataframe once we have at least 3 rows
                            try:
                                df = to_df(list(self.candle_cache[symbol]))
                                # standard indicators
                                if len(df) >= 2:
                                    df['sma_10'] = sma(df['close'], 10)
                                    df['ema_21'] = ema(df['close'], 21)
                                    df['rsi_14'] = rsi(df['close'], 14)
                                    # MACD standard: EMA12 - EMA26 and signal(9)
                                    df['ema_12'] = ema(df['close'], 12)
                                    df['ema_26'] = ema(df['close'], 26)
                                    df['macd'] = df['ema_12'] - df['ema_26']
                                    df['macd_signal'] = df['macd'].ewm(span=9, adjust=False).mean()
                                # prepare latest and previous indicator dicts
                                if len(df) >= 2:
                                    last = df.iloc[-1].to_dict()
                                    prev = df.iloc[-2].to_dict()
                                    # collect values we may use in alerts
                                    latest_indicators = {
                                        "close": float(last.get('close')),
                                        "rsi_14": None if pd.isna(last.get('rsi_14')) else float(last.get('rsi_14')),
                                        "sma_10": None if pd.isna(last.get('sma_10')) else float(last.get('sma_10')),
                                        "ema_21": None if pd.isna(last.get('ema_21')) else float(last.get('ema_21')),
                                        "macd": None if pd.isna(last.get('macd')) else float(last.get('macd')),
                                        "macd_signal": None if pd.isna(last.get('macd_signal')) else float(last.get('macd_signal'))
                                    }
                                    prev_indicators = {
                                        "close": float(prev.get('close')),
                                        "rsi_14": None if pd.isna(prev.get('rsi_14')) else float(prev.get('rsi_14')),
                                        "sma_10": None if pd.isna(prev.get('sma_10')) else float(prev.get('sma_10')),
                                        "ema_21": None if pd.isna(prev.get('ema_21')) else float(prev.get('ema_21')),
                                        "macd": None if pd.isna(prev.get('macd')) else float(prev.get('macd')),
                                        "macd_signal": None if pd.isna(prev.get('macd_signal')) else float(prev.get('macd_signal'))
                                    }
                                else:
                                    # small df, use only close
                                    latest_indicators = {"close": float(df.iloc[-1]['close'])}
                                    prev_indicators = None
                            except Exception:
                                # fallback: simple close
                                latest_indicators = {"close": float(candle["close"])}
                                prev_indicators = None

                            payload = {
                                "type": "kline",
                                "symbol": symbol.upper(),
                                "kline": candle,
                                "indicators": latest_indicators
                            }

                            # evaluate alerts using latest and prev indicators
                            triggered = self._evaluate_alerts_for_symbol(symbol.upper(), latest_indicators, prev_indicators)
                            if triggered:
                                for a in triggered:
                                    alert_msg = {
                                        "type": "alert",
                                        "symbol": a.get("symbol"),
                                        "alert": {
                                            "id": a.get("id"),
                                            "type": a.get("type"),
                                            "value": a.get("value"),
                                            "recurring": bool(a.get("recurring")),
                                            "params": a.get("params"),
                                            "triggered_at_close": latest_indicators.get("close"),
                                            "indicators": latest_indicators
                                        }
                                    }
                                    if not a.get("recurring"):
                                        try:
                                            alerts_db.mark_triggered(a.get("id"))
                                        except Exception:
                                            pass
                                    await self._broadcast(symbol, json.dumps(alert_msg))

                            await self._broadcast(symbol, json.dumps(payload))
                        except Exception:
                            continue
            except Exception:
                await asyncio.sleep(1)
                continue

relay = RelayManager()
