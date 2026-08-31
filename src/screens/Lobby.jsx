import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useRoom } from '../hooks/useRoom.js'
import { waLink, roomUrl, joinRoom, invokeGame, leaveRoom } from '../lib/rooms.js'
import Chat from '../components/Chat.jsx'

export default function Lobby() {
  const { code } = useParams()
  const nav = useNavigate()
  const { room, players, state, messages, me, err, sendMessage, sendVoice, voiceUrl } = useRoom(code)
  const [name, setName] = useState(localStorage.getItem('name') || '')
  const [busy, setBusy] = useState(false)
  const [joinErr, setJoinErr] = useState('')
  const [copied, setCopied] = useState(false)

  const amIn = me && players.some((p) => p.user_id === me)

  // auto-join si ya tengo nombre guardado y todavía no estoy en la sala
  useEffect(() => {
    if (!room || !me || amIn || busy) return
    const saved = localStorage.getItem('name')
    if (saved) doJoin(saved)
  }, [room, me, amIn])

  async function doJoin(n) {
    setBusy(true); setJoinErr('')
    try {
      await joinRoom(code, n.trim())
      localStorage.setItem('name', n.trim())
    } catch (e) { setJoinErr(String(e.message || e)) }
    finally { setBusy(false) }
  }

  async function start() {
    setBusy(true)
    try { await invokeGame('start', { code }); nav(`/mesa/${code}`) }
    catch (e) { alert(String(e.message || e)) }
    finally { setBusy(false) }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(roomUrl(code))
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch { prompt('Copiá el link:', roomUrl(code)) }
  }

  if (err) return <div className="screen"><p className="err">{err}</p></div>
  if (!room) return <div className="screen"><p>Cargando…</p></div>

  if (state?.status === 'betting' || state?.status === 'hand_over') {
    nav(`/mesa/${code}`)
    return null
  }

  // no estoy en la sala y no hay nombre guardado -> pedir nombre
  if (!amIn) {
    return (
      <div className="screen">
        <h1>Sala {room.code}</h1>
        <div className="card">
          <h2>Entrar como invitado</h2>
          <label>Tu nombre
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} placeholder="Diego" />
          </label>
          <button onClick={() => doJoin(name)} disabled={busy || !name.trim()}>Entrar</button>
          {joinErr && <p className="err">{joinErr}</p>}
        </div>
      </div>
    )
  }

  const isHost = players[0]?.user_id === me
  const canStart = players.length >= 2 && players.length <= 4

  return (
    <div className="screen lobby">
      <h1>Sala {room.code}</h1>

      <div className="card">
        <p>Buy-in: <b>{room.config.buyin} USD</b></p>
        <p>Ciega: <b>{room.config.startBlind} USD</b>, x2 cada {room.config.handsPerBlindUp} manos</p>
        <p>Tiempo por jugada: <b>{room.config.playTimeout}s</b></p>
      </div>

      <div className="card">
        <h2>Jugadores ({players.length}/4)</h2>
        <ul>
          {players.map((p) => (
            <li key={p.user_id}>
              {p.user_id === players[0]?.user_id && '👑 '}{p.name}{p.user_id === me && ' (vos)'}
            </li>
          ))}
        </ul>
      </div>

      <button onClick={copy}>{copied ? '¡Link copiado!' : 'Copiar link de la sala'}</button>
      <a className="btn wa" href={waLink(room.code)} target="_blank" rel="noreferrer">
        Invitar por WhatsApp
      </a>

      {isHost
        ? <button onClick={start} disabled={!canStart || busy}>
            {canStart ? 'Empezar partida' : 'Faltan jugadores (mín. 2)'}
          </button>
        : <p>Esperando que el anfitrión arranque…</p>}

      <button
        className="leave-btn wide"
        onClick={async () => { await leaveRoom(code); nav('/') }}
      >
        Abandonar sala
      </button>

      <Chat
        messages={messages}
        me={me}
        myName={players.find((p) => p.user_id === me)?.name || name || 'Yo'}
        onSend={sendMessage}
        onSendVoice={sendVoice}
        voiceUrl={voiceUrl}
      />
    </div>
  )
}
