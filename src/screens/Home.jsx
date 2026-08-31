import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ensureSession } from '../lib/supabase.js'
import { createRoom, joinRoom } from '../lib/rooms.js'

const CHIPS = [5, 10, 20, 50, 100]

export default function Home() {
  const nav = useNavigate()
  const [name, setName] = useState(localStorage.getItem('name') || '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // config sala
  const [buyin, setBuyin] = useState(100)
  const [playTimeout, setPlayTimeout] = useState(30)
  const [startBlind, setStartBlind] = useState(5)
  const [handsPerBlindUp, setHandsPerBlindUp] = useState(10)

  useEffect(() => { ensureSession().catch(e => setErr(String(e))) }, [])

  const saveName = () => localStorage.setItem('name', name.trim())

  async function onCreate() {
    if (!name.trim()) return setErr('Poné tu nombre')
    setBusy(true); setErr(''); saveName()
    try {
      const room = await createRoom(
        { buyin, playTimeout, startBlind, handsPerBlindUp },
        name.trim()
      )
      nav(`/sala/${room.code}`)
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  async function onJoin() {
    if (!name.trim()) return setErr('Poné tu nombre')
    if (!code.trim()) return setErr('Poné el código')
    setBusy(true); setErr(''); saveName()
    try {
      await joinRoom(code.trim(), name.trim())
      nav(`/sala/${code.trim().toUpperCase()}`)
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div className="screen home">
      <h1>🇦🇷 Terrible Poker</h1>

      <label>Tu nombre
        <input value={name} onChange={e => setName(e.target.value)} maxLength={16} placeholder="Diego" />
      </label>

      <div className="card">
        <h2>Unirse a una sala</h2>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())}
          maxLength={5} placeholder="CÓDIGO" className="code-input" />
        <button onClick={onJoin} disabled={busy}>Entrar</button>
      </div>

      <div className="card">
        <h2>Armar sala nueva</h2>
        <label>Plata por jugador (USD, buy-in)
          <select value={buyin} onChange={e => setBuyin(+e.target.value)}>
            {[50, 100, 200, 500].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>Tiempo por jugada (seg)
          <select value={playTimeout} onChange={e => setPlayTimeout(+e.target.value)}>
            {[15, 20, 30, 45, 60].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>Ciega inicial (USD)
          <select value={startBlind} onChange={e => setStartBlind(+e.target.value)}>
            {CHIPS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>Sube ciega al doble cada X manos
          <select value={handsPerBlindUp} onChange={e => setHandsPerBlindUp(+e.target.value)}>
            {[5, 8, 10, 15, 20].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <button onClick={onCreate} disabled={busy}>Crear sala</button>
      </div>

      <button className="btn ghost" onClick={() => nav('/ranking')}>
        🏆 Tabla de posiciones
      </button>

      {err && <p className="err">{err}</p>}
    </div>
  )
}
