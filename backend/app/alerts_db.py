import sqlite3
from typing import List, Dict, Optional
import threading
import os
import json

DB_PATH = os.path.join(os.path.dirname(__file__), "alerts.db")
_lock = threading.Lock()

def _get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with _lock:
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                type TEXT NOT NULL,
                value REAL,
                recurring INTEGER NOT NULL DEFAULT 0,
                triggered INTEGER NOT NULL DEFAULT 0,
                params TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()
        conn.close()

def add_alert(symbol: str, type_: str, value: Optional[float]=None, recurring: bool=False, params: Optional[Dict]=None) -> int:
    with _lock:
        conn = _get_conn()
        cur = conn.cursor()
        params_json = json.dumps(params) if params is not None else None
        cur.execute(
            "INSERT INTO alerts (symbol, type, value, recurring, params) VALUES (?, ?, ?, ?, ?)",
            (symbol.upper(), type_, None if value is None else float(value), int(bool(recurring)), params_json),
        )
        conn.commit()
        rowid = cur.lastrowid
        conn.close()
        return rowid

def list_alerts(symbol: Optional[str]=None) -> List[Dict]:
    with _lock:
        conn = _get_conn()
        cur = conn.cursor()
        if symbol:
            cur.execute("SELECT * FROM alerts WHERE symbol = ? ORDER BY id DESC", (symbol.upper(),))
        else:
            cur.execute("SELECT * FROM alerts ORDER BY id DESC")
        rows = cur.fetchall()
        conn.close()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("params"):
                try:
                    d["params"] = json.loads(d["params"])
                except Exception:
                    d["params"] = None
            else:
                d["params"] = None
            result.append(d)
        return result

def delete_alert(alert_id: int) -> None:
    with _lock:
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
        conn.commit()
        conn.close()

def mark_triggered(alert_id: int) -> None:
    with _lock:
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute("UPDATE alerts SET triggered = 1 WHERE id = ?", (alert_id,))
        conn.commit()
        conn.close()

def reset_triggered(alert_id: int) -> None:
    with _lock:
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute("UPDATE alerts SET triggered = 0 WHERE id = ?", (alert_id,))
        conn.commit()
        conn.close()
