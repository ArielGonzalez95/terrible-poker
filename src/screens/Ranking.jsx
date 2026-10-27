import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { avatarOf } from '../lib/avatar.js'
import '../table.css'
import '../home.css'

const MEDALS = ['🥇', '🥈', '🥉']
const plural = (n) => (n === 1 ? 'torneo' : 'torneos')

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

  const podium = rows?.slice(0, 3) || []
  const rest = rows?.slice(3) || []
  // orden visual del podio: 2º - 1º - 3º
  const podiumView = [podium[1], podium[0], podium[2]].map((r, i) => r && { r, pos: [2, 1, 3][i] }).filter(Boolean)

  return (
    <div className="hm-screen">
      <div className="hm-wrap">
        <header className="rk-head">
          <div className="rk-trophy" aria-hidden="true">🏆</div>
          <h1 className="hm-title">Tabla de <b>posiciones</b></h1>
          <p className="hm-sub">Torneos ganados por jugador</p>
        </header>

        {err && <p className="hm-err" role="alert">{err}</p>}
        {!rows && !err && <p className="hm-sub rk-center">Cargando…</p>}

        {rows && rows.length === 0 && (
          <section className="hm-panel rk-empty">
            <span aria-hidden="true">🃏</span>
            <p>Todavía nadie ganó un torneo.<br />¡El primero se lleva la gloria!</p>
          </section>
        )}

        {podiumView.length > 0 && (
          <section className="rk-podium">
            {podiumView.map(({ r, pos }) => (
              <div key={r.name} className={`rk-step p${pos}`}>
                <div className="rk-ava">
                  {avatarOf(r.name)}
                  <span className="rk-medal">{MEDALS[pos - 1]}</span>
                </div>
                <div className="rk-name">{r.name}</div>
                <div className="rk-block">
                  <b>{r.wins}</b>
                  <small>{plural(r.wins)}</small>
                </div>
              </div>
            ))}
          </section>
        )}

        {rest.length > 0 && (
          <section className="hm-panel rk-list">
            {rest.map((r, i) => (
              <div key={r.name} className="rk-row">
                <span className="rk-pos">{i + 4}</span>
                <span className="rk-mini">{avatarOf(r.name)}</span>
                <span className="rk-rname">{r.name}</span>
                <span className="rk-wins"><b>{r.wins}</b> {plural(r.wins)}</span>
              </div>
            ))}
          </section>
        )}

        <button className="hm-cta" onClick={() => nav('/')}>Volver al inicio</button>
      </div>
    </div>
  )
}
