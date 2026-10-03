import { useCallback, useEffect, useRef, useState } from 'react'
import * as E from '../lib/demoEngine.js'

// Sala de prueba sin Supabase: misma forma que useRoom, pero el motor corre local
// y los demás asientos son bots. Para probar estilos, reparto, showdown y reacciones.
const ME = 'yo'
const NAMES = ['Queeflatifa', 'caronline', 'Ser2425', 'DasZ76', 'ramesh_777', 'Jack_Nine', 'rohrmosa88', 'Camacho']
const BUYIN = 1000
const SPEEDS = { lenta: 2200, normal: 1100, rapida: 450 }
const WIN_FACES = ['suertudo', 'risa', 'canchero', 'plata', 'aplausos']
const LOSE_FACES = ['enojado', 'frustrado', 'llorando', 'miedoso', 'rezando']
const pick = (a) => a[Math.floor(Math.random() * a.length)]

function newSim(n) {
  const players = [{ user_id: ME, name: 'Vos', stack: BUYIN }]
  for (let i = 1; i < n; i++) players.push({ user_id: `bot${i}`, name: NAMES[i - 1], stack: BUYIN })
  return {
    room: { code: 'DEMO', status: 'lobby', hand_no: 0, config: { startBlind: 10, playTimeout: 20, handsPerBlindUp: 5, buyin: BUYIN } },
    players,
    gs: null,
  }
}

export function useDemoRoom() {
  const [n, setN] = useState(4)
  const [speed, setSpeed] = useState('normal')
  const [autoMe, setAutoMe] = useState(false)
  const [allInMode, setAllInMode] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [reactions, setReactions] = useState({})
  const simRef = useRef(newSim(4))
  const [snap, setSnap] = useState(() => structuredClone(simRef.current))

  const publish = useCallback(() => setSnap(structuredClone(simRef.current)), [])

  const showReaction = useCallback((userId, key) => {
    const at = Date.now() + Math.random()
    setReactions((r) => ({ ...r, [userId]: { key, at } }))
    setTimeout(() => {
      setReactions((r) => (r[userId]?.at === at ? (({ [userId]: _, ...rest }) => rest)(r) : r))
    }, 3200)
  }, [])

  const deal = useCallback(() => {
    try { E.startHand(simRef.current) } catch { /* torneo terminado */ }
    publish()
  }, [publish])

  const reset = useCallback((count = n) => {
    simRef.current = newSim(count)
    publish()
    setTimeout(deal, 500)
  }, [n, deal, publish])

  // primera mano al entrar
  useEffect(() => {
    const t = setTimeout(deal, 600)
    return () => clearTimeout(t)
  }, [deal])

  const invoke = useCallback(async (op, payload = {}) => {
    const s = simRef.current
    if (op === 'act') E.act(s, ME, payload.action, payload.amount)
    else if (op === 'start' || op === 'next_hand') E.startHand(s)
    else if (op === 'timeout') E.timeout(s)
    else if (op === 'show') E.show(s, ME)
    publish()
    return { ok: true }
  }, [publish])

  // bots (y "yo" si está en automático) juegan solos
  const pub = snap.gs?.public
  useEffect(() => {
    if (!pub || pub.status !== 'betting' || !pub.turnUserId) return
    const uid = pub.turnUserId
    if (uid === ME && !autoMe) return
    const t = setTimeout(() => {
      const s = simRef.current
      const p = s.gs.public
      if (p.turnUserId !== uid || p.status !== 'betting') return
      let d = allInMode ? { action: 'allin' } : E.botDecision(p, s.gs.hands[uid], uid)
      try { E.act(s, uid, d.action, d.amount) } catch {
        try { E.act(s, uid, 'call') } catch { E.act(s, uid, 'fold') }
      }
      publish()
    }, SPEEDS[speed] * (0.7 + Math.random() * 0.6))
    return () => clearTimeout(t)
  }, [pub?.turnUserId, pub?.status, pub?.currentBet, pub?.handNo, pub?.board?.length, autoMe, allInMode, speed, publish])

  // bots reaccionan al terminar la mano
  useEffect(() => {
    if (!pub || pub.status !== 'hand_over') return
    const timers = []
    for (const r of pub.results || []) {
      if (r.userId === ME || Math.random() < 0.4) continue
      const key = r.delta > 0 ? pick(WIN_FACES) : r.delta < 0 ? pick(LOSE_FACES) : null
      if (key) timers.push(setTimeout(() => showReaction(r.userId, key), 1500 + Math.random() * 2500))
    }
    return () => timers.forEach(clearTimeout)
  }, [pub?.status, pub?.handNo, showReaction])

  const sendReaction = useCallback(async (key) => showReaction(ME, key), [showReaction])

  const btn = (on) => `demo-btn ${on ? 'on' : ''}`
  const extra = (
    <div className={`demo-panel ${panelOpen ? 'open' : ''}`}>
      <button className="demo-toggle" onClick={() => setPanelOpen((o) => !o)}>
        🤖 Modo prueba {panelOpen ? '▴' : '▾'}
      </button>
      {panelOpen && (
        <div className="demo-body">
          <div className="demo-row">
            <span>Jugadores</span>
            {[2, 3, 4, 5, 6, 9].map((k) => (
              <button key={k} className={btn(n === k)} onClick={() => { setN(k); reset(k) }}>{k}</button>
            ))}
          </div>
          <div className="demo-row">
            <span>Bots</span>
            {Object.keys(SPEEDS).map((k) => (
              <button key={k} className={btn(speed === k)} onClick={() => setSpeed(k)}>{k}</button>
            ))}
          </div>
          <div className="demo-row">
            <button className={btn(autoMe)} onClick={() => setAutoMe((v) => !v)}>Yo automático</button>
            <button className={btn(allInMode)} onClick={() => setAllInMode((v) => !v)}>Todos all-in</button>
          </div>
          <div className="demo-row">
            <button className="demo-btn" onClick={deal}>Nueva mano</button>
            <button className="demo-btn" onClick={() => reset()}>Reiniciar fichas</button>
            <button className="demo-btn" onClick={() => {
              const ids = simRef.current.players.map((p) => p.user_id).filter((id) => id !== ME)
              showReaction(pick(ids), pick([...WIN_FACES, ...LOSE_FACES]))
            }}>Reacción bot</button>
          </div>
        </div>
      )}
    </div>
  )

  return {
    room: snap.room,
    players: snap.players,
    state: snap.gs ?? { public: {}, hands: {} },
    messages: [],
    me: ME,
    err: '',
    refetch: async () => {},
    sendMessage: async () => {},
    sendVoice: async () => {},
    voiceUrl: () => '',
    reactions,
    sendReaction,
    invoke,
    leave: async () => {},
    extra,
    demo: true,
    restart: () => reset(),
  }
}
