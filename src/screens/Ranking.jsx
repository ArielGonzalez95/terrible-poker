import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function Ranking() {
  const nav = useNavigate()
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('standings')
      .select('*')
      .order('wins', { ascending: false })
      .order('last_win', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) setErr(String(error.message || error))
        else setRows(data || [])
      })
  }, [])

  return (
    <div className="screen">
      <h1>🏆 Tabla de posiciones</h1>
      <p className="rank-sub">Torneos ganados por jugador</p>

      {err && <p className="err">{err}</p>}
      {!rows && !err && <p>Cargando…</p>}

      {rows && rows.length === 0 && (
        <div className="card"><p>Todavía no terminó ningún torneo.</p></div>
      )}

      {rows && rows.length > 0 && (
        <div className="card rank-table">
          {rows.map((r, i) => (
            <div key={r.name} className={`rank-row ${i < 3 ? 'top' : ''}`}>
              <span className="rank-pos">{i + 1}</span>
              <span className="rank-name">{['🥇', '🥈', '🥉'][i] || ''} {r.name}</span>
              <span className="rank-wins">{r.wins}</span>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => nav('/')}>Volver</button>
    </div>
  )
}
