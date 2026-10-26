import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ensureSession } from '../lib/supabase.js'
import { createRoom, joinRoom } from '../lib/rooms.js'
import Card from '../components/Card.jsx'
import { fmt } from '../components/Chips.jsx'
import '../table.css'
import '../home.css'

const OPTS = {
  buyin: [100, 500, 1000, 2500, 5000, 10000],
  startBlind: [5, 10, 25, 50, 100, 250, 500],
  playTimeout: [15, 20, 30, 45, 60],
  handsPerBlindUp: [5, 8, 10, 15, 20],
}

// fila de opciones tipo ficha (reemplaza los <select>)
function Choice({ label, hint, value, options, unit = '', onChange }) {
  return (
    <div className="hm-choice">
      <div className="hm-choice-head">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="hm-chips" role="radiogroup" aria-label={label}>
        {options.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            className={`hm-chip ${value === v ? 'on' : ''}`}
            onClick={() => onChange(v)}
          >
            {fmt(v)}{unit}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  const nav = useNavigate()
  const [name, setName] = useState(localStorage.getItem('name') || '')
  const [code, setCode] = useState('')
  const [tab, setTab] = useState('crear')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // config sala
  const [buyin, setBuyin] = useState(100)
  const [playTimeout, setPlayTimeout] = useState(30)
  const [startBlind, setStartBlind] = useState(5)
  // al cambiar el buy-in, sugerir ciega ~1% (la más cercana de la lista)
  const pickBuyin = (v) => {
    setBuyin(v)
    const target = v / 100
    setStartBlind(OPTS.startBlind.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)))
  }
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
    if (code.trim().length < 5) return setErr('El código tiene 5 letras')
    setBusy(true); setErr(''); saveName()
    try {
      await joinRoom(code.trim(), name.trim())
      nav(`/sala/${code.trim().toUpperCase()}`)
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div className="hm-screen">
      <div className="hm-wrap">
        <header className="hm-hero">
          <div className="hm-logo" aria-hidden="true">
            <div className="hm-logo-felt" />
            <div className="hm-logo-cards">
              <Card code="As" size="sm" />
              <Card code="Kh" size="sm" />
            </div>
          </div>
          <h1 className="hm-title">Terrible <b>Poker</b></h1>
          <p className="hm-sub">Texas Hold'em entre amigos · 2 a 4 jugadores</p>
        </header>

        <label className="hm-field">
          <span>Tu nombre</span>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setErr('') }}
            maxLength={16}
            placeholder="¿Cómo te ven en la mesa?"
            autoComplete="nickname"
          />
        </label>

        <div className="hm-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'crear'} className={tab === 'crear' ? 'on' : ''} onClick={() => { setTab('crear'); setErr('') }}>
            Crear sala
          </button>
          <button role="tab" aria-selected={tab === 'unirme'} className={tab === 'unirme' ? 'on' : ''} onClick={() => { setTab('unirme'); setErr('') }}>
            Unirme
          </button>
        </div>

        {tab === 'unirme' ? (
          <section className="hm-panel">
            <label className="hm-field">
              <span>Código de la sala</span>
              <input
                className="hm-code"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setErr('') }}
                maxLength={5}
                placeholder="ABCDE"
                autoCapitalize="characters"
                autoComplete="off"
                inputMode="text"
              />
            </label>
            <p className="hm-note">Te lo pasa quien creó la sala, o entrá directo desde el link de WhatsApp.</p>
            <button className="hm-cta" onClick={onJoin} disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar a la mesa'}
            </button>
          </section>
        ) : (
          <section className="hm-panel">
            <Choice label="Plata por jugador" hint="buy-in" unit=" USD" value={buyin} options={OPTS.buyin} onChange={pickBuyin} />
            <Choice label="Ciega inicial" value={startBlind} options={OPTS.startBlind} onChange={setStartBlind} />
            <Choice label="Tiempo por jugada" unit="s" value={playTimeout} options={OPTS.playTimeout} onChange={setPlayTimeout} />
            <Choice label="La ciega se duplica cada" hint="manos" value={handsPerBlindUp} options={OPTS.handsPerBlindUp} onChange={setHandsPerBlindUp} />
            <div className="hm-summary">
              Cada uno entra con <b>{fmt(buyin)} USD</b> · ciegas <b>{fmt(Math.max(1, Math.floor(startBlind / 2)))}/{fmt(startBlind)}</b>, x2 cada {handsPerBlindUp} manos
            </div>
            <button className="hm-cta" onClick={onCreate} disabled={busy}>
              {busy ? 'Creando…' : 'Crear sala'}
            </button>
          </section>
        )}

        {err && <p className="hm-err" role="alert">{err}</p>}

        <nav className="hm-links">
          <button onClick={() => nav('/ranking')}>🏆 Tabla de posiciones</button>
          <button onClick={() => nav('/demo')}>🤖 Probar la mesa</button>
        </nav>
      </div>
    </div>
  )
}
