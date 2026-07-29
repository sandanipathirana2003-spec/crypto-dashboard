from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.responses import JSONResponse
import httpx
from . import binance_relay
from .indicators import to_df, sma, ema, rsi
from collections import deque
import asyncio
from . import alerts_db
import os
from pydantic import BaseModel
from typing import Optional, Dict

app = FastAPI()
BINANCE_REST_KLINES = "https://api.binance.com/api/v3/klines"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

class AlertCreate(BaseModel):
    symbol: str
    type: str
    value: Optional[float] = None
    recurring: bool = False
    params: Optional[Dict] = None

@app.on_event("startup")
async def startup():
    alerts_db.init_db()

@app.get("/api/klines")
async def klines(symbol: str = "BTCUSDT", interval: str = "1m", limit: int = 500):
    params = {"symbol": symbol.upper(), "interval": interval, "limit": limit}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(BINANCE_REST_KLINES, params=params)
        r.raise_for_status()
        return r.json()

@app.websocket("/ws/market")
async def ws_market(websocket: WebSocket, symbol: str = Query("BTCUSDT")):
    symbol_up = symbol.upper()
    await websocket.accept()
    try:
        await binance_relay.relay.register(symbol_up, websocket)
        while True:
            # keep the connection alive
            data = await websocket.receive_text()
            # echo or ignore
            await websocket.send_text(f'echo:{data}')
    except WebSocketDisconnect:
        await binance_relay.relay.unregister(symbol_up, websocket)
    except Exception:
        try:
            await binance_relay.relay.unregister(symbol_up, websocket)
        except Exception:
            pass

# Alerts endpoints
@app.post("/api/alerts")
async def create_alert(payload: AlertCreate):
    """
    Create alert.
    Supported types:
      - price_above, price_below, rsi_above, rsi_below
      - macd_cross_above, macd_cross_below
      - sma_cross_above, sma_cross_below (requires params: {"short": int, "long": int})
    payload example:
    {
      "symbol": "BTCUSDT",
      "type": "sma_cross_above",
      "params": {"short": 10, "long": 50},
      "recurring": false
    }
    """
    type_ = payload.type
    if type_ not in ("price_above", "price_below", "rsi_above", "rsi_below", "macd_cross_above", "macd_cross_below", "sma_cross_above", "sma_cross_below"):
        raise HTTPException(status_code=400, detail="invalid alert type")

    # validation for SMA crossover requires short < long
    if type_.startswith("sma_cross"):
        params = payload.params or {}
        if not params or 'short' not in params or 'long' not in params:
            raise HTTPException(status_code=400, detail="sma_cross requires params {short, long}")
        short_w = int(params.get('short'))
        long_w = int(params.get('long'))
        if short_w >= long_w:
            raise HTTPException(status_code=400, detail="sma_cross requires short < long")

    # macd types don't require value
    aid = alerts_db.add_alert(payload.symbol, payload.type, payload.value, payload.recurring, payload.params)
    return {"id": aid}

@app.get("/api/alerts")
async def list_alerts(symbol: str = None):
    items = alerts_db.list_alerts(symbol)
    return {"alerts": items}

@app.delete("/api/alerts/{alert_id}")
async def delete_alert(alert_id: int):
    alerts_db.delete_alert(alert_id)
    return {"ok": True}

@app.post("/api/alerts/{alert_id}/reset")
async def reset_alert(alert_id: int):
    alerts_db.reset_triggered(alert_id)
    return {"ok": True}

# Free templated summary (kept)
@app.post("/api/ai/summary")
async def ai_summary(symbol: str = "BTCUSDT", interval: str = "1m", limit: int = 100):
    params = {"symbol": symbol.upper(), "interval": interval, "limit": limit}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(BINANCE_REST_KLINES, params=params)
        r.raise_for_status()
        klines = r.json()
    df = to_df(klines)
    latest = float(df['close'].iloc[-1])
    prev = float(df['close'].iloc[-2])
    pct = (latest - prev) / prev * 100
    summary = f"{symbol.upper()} {interval} — latest close {latest:.2f} USD ({pct:+.2f}% vs prior candle)."
    df['sma_20'] = sma(df['close'], 20)
    df['rsi_14'] = rsi(df['close'], 14)
    rsi_val = None if len(df)<14 else df['rsi_14'].iloc[-1]
    sma_val = None if len(df)<20 else df['sma_20'].iloc[-1]
    if rsi_val:
        if rsi_val > 70:
            summary += f" RSI is {rsi_val:.1f} (overbought)."
        elif rsi_val < 30:
            summary += f" RSI is {rsi_val:.1f} (oversold)."
        else:
            summary += f" RSI is {rsi_val:.1f}."
    if sma_val:
        relation = "above" if latest > sma_val else "below"
        summary += f" Price is {relation} the 20-period SMA ({sma_val:.2f})."
    return {"summary": summary}

# OpenAI integration (optional)
@app.post("/api/ai/openai_summary")
async def openai_summary(symbol: str = "BTCUSDT", interval: str = "1m", limit: int = 100, model: str = "gpt-3.5-turbo"):
    """
    Generates an OpenAI-based summary. Requires OPENAI_API_KEY env var to be set.
    """
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured in environment")
    params = {"symbol": symbol.upper(), "interval": interval, "limit": limit}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(BINANCE_REST_KLINES, params=params)
        r.raise_for_status()
        klines = r.json()
        df = to_df(klines)
        # collect quick metrics
        latest = float(df['close'].iloc[-1])
        pct24 = None
        if len(df) >= 2:
            prev = float(df['close'].iloc[-2])
            pct24 = (latest - prev) / prev * 100
        df['rsi_14'] = rsi(df['close'], 14)
        rsi_val = None if len(df)<14 else float(df['rsi_14'].iloc[-1])
        # build prompt
        summary_prompt = f"""
You are a concise crypto market analyst. Provide a short analysis for {symbol.upper()} on {interval} timeframe.
Latest close: {latest:.2f}.
Recent RSI(14): {rsi_val if rsi_val else 'n/a'}.
Provide a short summary (2-4 sentences) and one simple actionable idea (e.g., \"watch support at X\" or \"consider long above Y\").
"""
        openai_url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": "You are a helpful crypto analyst."},
                {"role": "user", "content": summary_prompt}
            ],
            "max_tokens": 300,
            "temperature": 0.7
        }
        resp = await client.post(openai_url, json=payload, headers=headers, timeout=30)
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"OpenAI error: {resp.text}")
        j = resp.json()
        try:
            content = j["choices"][0]["message"]["content"]
        except Exception:
            content = str(j)
        return {"summary": content}
