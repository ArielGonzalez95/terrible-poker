import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useRoom } from '../hooks/useRoom.js'
import { waLink, roomUrl, joinRoom, invokeGame, leaveRoom } from '../lib/rooms.js'
import { VoiceButton, useVoicePlayer } from '../components/Voice.jsx'
import { toast } from '../lib/toast.js'
import { avatarOf } from '../lib/avatar.js'
import Card from '../components/Card.jsx'
import { fmt } from '../components/Chips.jsx'
import '../table.css'
import '../home.css'

const SEATS = 4

export default function Lobby() {
  const { code } = useParams()
  const nav = useNavigate()
  const { room, players, state, messages, me, err, sendVoice, voiceUrl } = useRoom(code)
  const [name, setName] = useState(localStorage.getItem('name') || '')
  const [busy, setBusy] = useState(false)
  const [joinErr, setJoinErr] = useState('')
  const [copied, setCopied] = useState(false)
  const speaking = useVoicePlayer(messages, me, voiceUrl)

  const amIn = me && players.some((p) => p.user_id === me)
  const playing = state?.status === 'betting' || state?.status === 'hand_over'

  useEffect(() => { if (playing && amIn) nav(`/mesa/${code}`) }, [playing, amIn, code, nav])

  async function doJoin() {
    if (!name.trim()) return setJoinErr('Poné tu nombre')
    setBusy(true); setJoinErr('')
    try {
      await joinRoom(code, name.trim())
      localStorage.setItem('name', name.trim())
    } catch (e) { setJoinErr(String(e.message || e)) }
    finally { setBusy(false) }
  }

  async function start() {
    setBusy(true)
    try { await invokeGame('start', { code }); nav(`/mesa/${code}`) }
    catch (e) { toast(String(e.message || e), 'error') }
    finally { setBusy(false) }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(roomUrl(code))
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch { toast(roomUrl(code)) }
  }

  async function leave() {
    setBusy(true)
    await leaveRoom(code)
    nav('/')
  }

  if (err || !room) {
    return (
      <div className="hm-screen">
        <div className="hm-wrap hm-center">
          {err ? (
            <>
              <p className="hm-err" role="alert">{err}</p>
              <button className="hm-cta" onClick={() => nav('/')}>Ir al inicio</button>
            </>
          ) : <p className="hm-sub">Buscando la sala…</p>}
        </div>
      </div>
    )
  }

  const cfg = room.config || {}
  const hostId = players[0]?.user_id
  const isHost = hostId === me
  const canStart = players.length >= 2 && players.length <= SEATS
  const full = players.length >= SEATS
  const closed = room.status !== 'lobby'

  return (
    <div className="hm-screen">
      <div className="hm-wrap">
        <header className="lb-head">
          <div className="hm-logo-cards lb-cards" aria-hidden="true">
            <Card code="As" size="sm" />
            <Card code="Kh" size="sm" />
          </div>
          <div>
            <div className="lb-kicker">{amIn ? 'Tu sala' : 'Te invitaron a jugar'}</div>
            <h1 className="lb-code">{room.code}</h1>
          </div>
        </header>

        <div className="lb-stats">
          <div><small>Buy-in</small><b>{fmt(cfg.buyin)}</b><span>USD</span></div>
          <div><small>Ciegas</small><b>{fmt(Math.max(1, Math.floor(cfg.startBlind / 2)))}/{fmt(cfg.startBlind)}</b><span>x2 cada {cfg.handsPerBlindUp}</span></div>
          <div><small>Turno</small><b>{cfg.playTimeout}s</b><span>por jugada</span></div>
        </div>

        <section className="hm-panel">
          <div className="hm-choice-head">
            <span>Jugadores</span>
            <small>{players.length}/{SEATS}</small>
          </div>
          <ul className="lb-seats">
            {Array.from({ length: SEATS }, (_, i) => {
              const p = players[i]
              if (!p) return <li key={i} className="lb-seat empty"><i>+</i><span>Libre</span></li>
              return (
                <li key={p.user_id} className={`lb-seat ${p.user_id === me ? 'me' : ''}`}>
                  <i className={speaking === p.user_id ? 'talking' : ''}>{avatarOf(p.user_id)}</i>
                  <span>{p.name}</span>
                  {p.user_id === hostId && <em>anfitrión</em>}
                  {p.user_id === me && p.user_id !== hostId && <em>vos</em>}
                </li>
              )
            })}
          </ul>
        </section>

        {!amIn ? (
          <section className="hm-panel">
            {closed || full ? (
              <p className="hm-note lb-note">{closed ? 'La partida ya empezó en esta sala.' : 'La sala está llena (4/4).'}</p>
            ) : (
              <>
                <label className="hm-field">
                  <span>Tu nombre</span>
                  <input
                    value={name}
                    onChange={(e) => { setName(e.target.value); setJoinErr('') }}
                    onKeyDown={(e) => { if (e.key === 'Enter') doJoin() }}
                    maxLength={16}
                    placeholder="¿Cómo te ven en la mesa?"
                    autoComplete="nickname"
                  />
                </label>
                <button className="hm-cta" onClick={doJoin} disabled={busy}>
                  {busy ? 'Entrando…' : 'Sentarme en la mesa'}
                </button>
              </>
            )}
            {joinErr && <p className="hm-err" role="alert">{joinErr}</p>}
          </section>
        ) : (
          <>
            <div className="lb-share">
              <a className="lb-wa" href={waLink(room.code)} target="_blank" rel="noreferrer">Invitar por WhatsApp</a>
              <button className="lb-copy" onClick={copy}>{copied ? '¡Copiado!' : 'Copiar link'}</button>
            </div>

            {isHost ? (
              <button className="hm-cta" onClick={start} disabled={!canStart || busy}>
                {busy ? 'Repartiendo…' : canStart ? 'Empezar partida' : 'Falta al menos 1 jugador'}
              </button>
            ) : (
              <div className="lb-wait"><span className="lb-dot" />Esperando que {players[0]?.name || 'el anfitrión'} arranque…</div>
            )}
            <p className="hm-note lb-note">🎤 Tocá el micrófono para mandar un audio: a los demás les suena solo.</p>
          </>
        )}

        <nav className="hm-links lb-links">
          {amIn
            ? <button onClick={leave} disabled={busy}>Abandonar sala</button>
            : <button onClick={() => nav('/')}>Ir al inicio</button>}
        </nav>
      </div>

      {amIn && (
        <VoiceButton
          className="on-lobby"
          myName={players.find((p) => p.user_id === me)?.name || name || 'Yo'}
          onSendVoice={sendVoice}
        />
      )}
    </div>
  )
}
