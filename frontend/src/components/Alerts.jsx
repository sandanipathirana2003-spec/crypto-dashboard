import React, { useEffect, useState } from "react";
import axios from "axios";
const BACKEND = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

export default function Alerts({ defaultSymbol, onAlertsChange }) {
  const [symbol, setSymbol] = useState(defaultSymbol || "BTCUSDT");
  const [type, setType] = useState("price_above");
  const [value, setValue] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [smaShort, setSmaShort] = useState(10);
  const [smaLong, setSmaLong] = useState(50);
  const [macdDirection, setMacdDirection] = useState("above");

  async function loadAlerts() {
    const res = await axios.get(`${BACKEND}/api/alerts`, { params: { symbol } });
    setAlerts(res.data.alerts || []);
    onAlertsChange && onAlertsChange(res.data.alerts || []);
  }

  useEffect(()=> {
    loadAlerts();
  }, [symbol]);

  async function createAlert(e) {
    e.preventDefault();
    let payload = {
      symbol,
      type,
      recurring
    };
    if (type.startsWith("price") || type.startsWith("rsi")) {
      if (!value) return;
      payload.value = parseFloat(value);
    }
    if (type === "sma_cross_above" || type === "sma_cross_below") {
      payload.params = { short: parseInt(smaShort), long: parseInt(smaLong) };
    }
    if (type === "macd_cross") {
      // macd_cross_above or macd_cross_below
      payload.type = macdDirection === "above" ? "macd_cross_above" : "macd_cross_below";
    }
    try {
      await axios.post(`${BACKEND}/api/alerts`, payload);
      setValue("");
      loadAlerts();
    } catch (err) {
      alert("Error creating alert: " + (err?.response?.data?.detail || err.message));
    }
  }

  async function removeAlert(id) {
    await axios.delete(`${BACKEND}/api/alerts/${id}`);
    loadAlerts();
  }

  return (
    <div style={{border:"1px solid #ddd", padding:8, maxWidth:800, marginTop:12}}>
      <h4>Alerts</h4>
      <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:8}}>
        <input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} />
        <button onClick={loadAlerts}>Load</button>
      </div>
      <form onSubmit={createAlert} style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
        <select value={type} onChange={e=>setType(e.target.value)}>
          <option value="price_above">Price Above</option>
          <option value="price_below">Price Below</option>
          <option value="rsi_above">RSI Above</option>
          <option value="rsi_below">RSI Below</option>
          <option value="sma_cross_above">SMA Cross Above</option>
          <option value="sma_cross_below">SMA Cross Below</option>
          <option value="macd_cross">MACD Crossover</option>
        </select>

        {/* For price / rsi */}
        {(type.startsWith("price") || type.startsWith("rsi")) && (
          <input placeholder="value" value={value} onChange={e=>setValue(e.target.value)} />
        )}

        {/* For SMA crossover: show short/long inputs and choose direction */}
        {(type === "sma_cross_above" || type === "sma_cross_below") && (
          <>
            <input style={{width:80}} value={smaShort} onChange={e=>setSmaShort(e.target.value)} />
            <span> / </span>
            <input style={{width:80}} value={smaLong} onChange={e=>setSmaLong(e.target.value)} />
          </>
        )}

        {/* For MACD */}
        {type === "macd_cross" && (
          <>
            <select value={macdDirection} onChange={e=>setMacdDirection(e.target.value)}>
              <option value="above">MACD crosses above Signal</option>
              <option value="below">MACD crosses below Signal</option>
            </select>
          </>
        )}

        <label style={{display:"flex", gap:6, alignItems:"center"}}>
          <input type="checkbox" checked={recurring} onChange={e=>setRecurring(e.target.checked)} /> recurring
        </label>
        <button type="submit">Create</button>
      </form>

      <div style={{marginTop:12}}>
        <strong>Existing alerts for {symbol}:</strong>
        <ul>
          {alerts.map(a => (
            <li key={a.id} style={{marginBottom:6}}>
              #{a.id} — {a.type} {a.value ? a.value : ""} {a.params ? JSON.stringify(a.params) : ""} — recurring: {a.recurring ? "yes":"no"} — triggered: {a.triggered ? "yes":"no"}
              <button onClick={()=>removeAlert(a.id)} style={{marginLeft:8}}>delete</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
