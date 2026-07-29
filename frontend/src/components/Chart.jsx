import React, { useEffect, useRef, useState } from "react";
import { createChart } from "lightweight-charts";
import useWebSocket from "../hooks/useWebSocket";
import { fetchKlines, fetchSummary } from "../api";
import Alerts from "./Alerts";

function klineToCandle(k){
  return {
    time: Math.floor(k[0]/1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4])
  };
}

export default function Chart({symbol, interval}){
  const chartContainerRef = useRef();
  const candleSeriesRef = useRef();
  const [summary, setSummary] = useState("");
  const [triggeredAlerts, setTriggeredAlerts] = useState([]);
  const [clientWsUrl, setClientWsUrl] = useState("");

  useEffect(()=>{
    const chart = createChart(chartContainerRef.current, {width:800, height:400});
    const candleSeries = chart.addCandlestickSeries();
    candleSeriesRef.current = candleSeries;
    return ()=> chart.remove();
  }, []);

  useEffect(()=>{
    // load history
    let cancelled=false;
    fetchKlines(symbol, interval, 300).then(data=>{
      if(cancelled) return;
      const candles = data.map(klineToCandle);
      candleSeriesRef.current.setData(candles);
    });
    fetchSummary(symbol, interval).then(r=> setSummary(r.summary)).catch(()=>{});
    // open websocket to backend
    const host = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
    const wsProtocol = host.startsWith("https") ? "wss" : "ws";
    const backendHost = host.replace(/^https?:\/\//,'');
    setClientWsUrl(`${wsProtocol}://${backendHost}/ws/market?symbol=${symbol}`);
    return ()=> cancelled=true;
  }, [symbol, interval]);

  useWebSocket({
    url: clientWsUrl,
    onMessage: (msg)=>{
      if(msg.type === "kline"){
        const k = msg.kline;
        const candle = {
          time: Math.floor(k.openTime/1000),
          open: parseFloat(k.open),
          high: parseFloat(k.high),
          low: parseFloat(k.low),
          close: parseFloat(k.close)
        };
        // update last candle or append
        try {
          candleSeriesRef.current.update(candle);
        } catch (e) {
          // if update fails, setData fallback
          // Note: lightweight-charts may throw if series empty; handle gracefully
          candleSeriesRef.current.setData([candle]);
        }
      } else if (msg.type === "alert"){
        // show alert in UI
        setTriggeredAlerts(prev => [msg.alert, ...prev].slice(0,20));
        // simple visual/web-notification:
        try { window.alert(`ALERT ${msg.symbol}: ${msg.alert.type} ${msg.alert.value || JSON.stringify(msg.alert.params)}`); } catch {}
      }
    }
  });

  return (
    <div>
      <div ref={chartContainerRef} />
      <div style={{marginTop:10, padding:8, border:"1px solid #ddd", maxWidth:800}}>
        <strong>AI Summary (templated):</strong>
        <p>{summary}</p>
      </div>

      <Alerts defaultSymbol={symbol} onAlertsChange={()=>{}} />

      <div style={{marginTop:8}}>
        <strong>Recent triggered alerts</strong>
        <ul>
          {triggeredAlerts.map((a, i) => (
            <li key={i}>
              {a.type} {a.value} {a.params ? JSON.stringify(a.params) : ''} @ {a.triggered_at_close} — recurring: {a.recurring ? "yes":"no"}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
