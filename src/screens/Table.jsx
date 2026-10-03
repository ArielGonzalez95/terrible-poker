import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRoom } from '../hooks/useRoom.js'
import { invokeGame, leaveRoom } from '../lib/rooms.js'
import { bestHand, winners as calcWinners } from '../lib/poker.js'
import Card, { norm, rankLabel, suitSym } from '../components/Card.jsx'
import Chips, { fmt } from '../components/Chips.jsx'
import DealCard from '../components/DealCard.jsx'
import Chat from '../components/Chat.jsx'
import { toast } from '../lib/toast.js'
import '../table.css'

// revela cartas de la mesa de a poco: flop (3 juntas), luego turn y river 1x1
function useStagedReveal(targetLen) {
  const [shown, setShown] = useState(targetLen)
  const ref = useRef(targetLen)
  useEffect(() => {
    if (targetLen === ref.current) return
    if (targetLen < ref.current) { ref.current = targetLen; setShown(targetLen); return }
    let cur = ref.current
    const steps = []
    if (cur < 3 && targetLen >= 3) { cur = 3; steps.push(3) }
    while (cur < targetLen) { cur += 1; steps.push(cur) }
    ref.current = targetLen
    let i = 0
    const tick = () => {
      setShown(steps[i]); i += 1
      if (i < steps.length) setTimeout(tick, 850)
    }
    const first = setTimeout(tick, 350)
    return () => clearTimeout(first)
  }, [targetLen])
  return shown
}

// posiciones (% de la mesa) de cada asiento; yo siempre abajo-izquierda y el resto en sentido horario
const POS = {
  me: [18, 86],
  ll: [14, 61],
  lm: [13, 32],
  lu: [13, 19],
  tl: [28, 9],
  tc: [50, 8],
  tr: [72, 9],
  ru: [87, 19],
  rm: [87, 32],
  rl: [86, 61],
}
const LAYOUT = {
  2: ['me', 'tc'],
  3: ['me', 'lu', 'ru'],
  4: ['me', 'lm', 'tc', 'rm'],
  5: ['me', 'll', 'tl', 'tr', 'rl'],
  6: ['me', 'll', 'lu', 'tc', 'ru', 'rl'],
  7: ['me', 'll', 'lu', 'tl', 'tr', 'ru', 'rl'],
  8: ['me', 'll', 'lm', 'lu', 'tl', 'tr', 'ru', 'rl'],
  9: ['me', 'll', 'lm', 'lu', 'tl', 'tr', 'ru', 'rm', 'rl'],
}
const CENTER = [50, 47]
const lerp = ([x, y], t) => [x + (CENTER[0] - x) * t, y + (CENTER[1] - y) * t]
const pct = ([x, y]) => ({ left: `${x}%`, top: `${y}%` })

// reacciones: tocar tu avatar → elegir cara → la ven todos ~3s
const REACTIONS = {
  enojado: ['😡', 'Enojado'],
  frustrado: ['😤', 'Frustrado'],
  suertudo: ['🍀', 'Suertudo'],
  miedoso: ['😱', 'Miedoso'],
  risa: ['😂', 'Jajaja'],
  canchero: ['😎', 'Canchero'],
  pensando: ['🤔', 'Pensando'],
  llorando: ['😭', 'Llorando'],
  aburrido: ['🥱', 'Aburrido'],
  plata: ['🤑', 'Platita'],
  rezando: ['🙏', 'Rezando'],
  aplausos: ['👏', 'Bien jugado'],
}

const AVATARS = ['🐱', '🦊', '🐻', '🐼', '🦁', '🐯', '🐸', '🐵', '🐙', '🦉', '🐶', '🐨', '🦄', '🐧']
function avatarOf(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATARS[h % AVATARS.length]
}

// useData: fuente de la sala (useRoom = Supabase real; useDemoRoom = bots locales en /demo)
export default function Table({ useData = useRoom }) {
  const { code } = useParams()
  const data = useData(code)
  const { room, players, state, messages, me, err, refetch, sendMessage, sendVoice, voiceUrl, reactions, sendReaction } = data
  const invoke = data.invoke || invokeGame
  const doLeave = data.leave || leaveRoom
  const nav = useNavigate()
  const [betTo, setBetTo] = useState(0)
  const [busy, setBusy] = useState(false)
  const [leaveAsk, setLeaveAsk] = useState(false)
  const [raiseOpen, setRaiseOpen] = useState(false)
  const [revealOpen, setRevealOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const lastReactAt = useRef(0)
  const [now, setNow] = useState(Date.now())
  const timeoutSent = useRef(0)
  const nextHandSent = useRef(0)
  const deckRef = useRef(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  // al empezar mi turno (o cambiar la apuesta), resetear el monto a la subida mínima
  const pub0 = state?.public
  useEffect(() => {
    const mr = (pub0?.currentBet || 0) + (pub0?.minRaise || pub0?.blind || 0)
    setBetTo(mr)
    setRaiseOpen(false)
  }, [pub0?.currentBet, pub0?.turnUserId, pub0?.handNo])

  useEffect(() => { setRevealOpen(false) }, [pub0?.handNo])

  const g = state?.public || {}

  const ordered = useMemo(() => {
    if (!players.length) return []
    const seat = g.order?.length ? g.order : players.map((p) => p.user_id)
    const list = seat.map((id) => players.find((p) => p.user_id === id)).filter(Boolean)
    const i = list.findIndex((p) => p.user_id === me)
    return i < 0 ? list : [...list.slice(i), ...list.slice(0, i)]
  }, [players, me, g.order])

  // auto-timeout: cualquiera puede empujar la mano si venció el reloj
  useEffect(() => {
    if (g.status !== 'betting' || !g.deadline) return
    if (now > g.deadline + 1500 && timeoutSent.current !== g.deadline) {
      timeoutSent.current = g.deadline
      invoke('timeout', { code }).catch(() => {})
    }
  }, [now, g.status, g.deadline, code])

  // auto-siguiente mano a los 10s (lo dispara el anfitrión)
  const amHost = players[0]?.user_id === me
  useEffect(() => {
    if (g.status !== 'hand_over' || !g.nextHandAt || !amHost) return
    if (now > g.nextHandAt && nextHandSent.current !== g.nextHandAt) {
      nextHandSent.current = g.nextHandAt
      invoke('next_hand', { code }).catch(() => {})
    }
  }, [now, g.status, g.nextHandAt, amHost, code])

  const boardLen = g.board?.length || 0
  const shownBoard = useStagedReveal(boardLen)

  // showdown calculado en el cliente (no depende de que el server mande `reveal`)
  const clientReveal = useMemo(() => {
    if (g.status !== 'hand_over' || boardLen !== 5 || !state?.hands) return []
    const ids = (g.order || []).filter(
      (id) => !g.folded?.[id] && Array.isArray(state.hands[id]) && state.hands[id].length === 2,
    )
    return ids.map((id) => ({ userId: id, ...bestHand(state.hands[id], g.board) }))
  }, [g.status, boardLen, g.board, g.folded, g.order, state?.hands])

  // nombre de mi mano con las cartas que ya se ven
  const myHandRaw = state?.hands?.[me]
  const myHandName = useMemo(() => {
    if (!Array.isArray(myHandRaw) || myHandRaw.length !== 2) return ''
    const vis = (g.board || []).slice(0, shownBoard)
    if (vis.length < 3 && norm(myHandRaw[0])?.[0] !== norm(myHandRaw[1])?.[0]) return ''
    try { return bestHand(myHandRaw, vis).mano } catch { return '' }
  }, [myHandRaw, g.board, shownBoard])

  if (err) return <div className="screen"><p className="err">{err}</p></div>
  if (!room || !state) return <div className="screen"><p>Cargando mesa…</p></div>

  const myHand = state.hands?.[me] || []
  const turnId = g.turnUserId
  const myTurn = turnId === me && g.status === 'betting'
  const myBet = g.bets?.[me] || 0
  const toCall = (g.currentBet || 0) - myBet
  const layout = LAYOUT[ordered.length] || LAYOUT[9]
  const secsLeft = g.deadline ? Math.max(0, Math.ceil((g.deadline - now) / 1000)) : null
  const playTimeout = room.config?.playTimeout || 30
  const minRaiseTo = (g.currentBet || 0) + (g.minRaise || g.blind || 0)

  async function act(action, extra = {}) {
    if (busy) return
    setBusy(true)
    setRaiseOpen(false)
    try { await invoke('act', { code, action, ...extra }); await refetch() }
    catch (e) { toast(String(e.message || e), 'error'); await refetch() }
    finally { setBusy(false) }
  }
  function react(key) {
    setPickerOpen(false)
    if (Date.now() - lastReactAt.current < 1500) return // anti-spam
    lastReactAt.current = Date.now()
    sendReaction(key)
  }
  async function showMyCards() {
    try { await invoke('show', { code }); await refetch() }
    catch (e) { toast(String(e.message || e), 'error') }
  }
  async function leave() {
    if (!leaveAsk) { setLeaveAsk(true); return }
    setBusy(true)
    await doLeave(code)
    nav('/')
  }

  const stackOf = (id) => g.stacks?.[id] ?? players.find((p) => p.user_id === id)?.stack ?? 0
  const nameOf = (id) => players.find((p) => p.user_id === id)?.name || '…'

  // sizing de apuesta por % del pozo
  const betsSum = Object.values(g.bets || {}).reduce((a, b) => a + (b || 0), 0)
  const potForSizing = (g.pot || 0) + betsSum
  const myMaxTotal = myBet + stackOf(me)
  const clampBet = (v) => Math.max(minRaiseTo, Math.min(myMaxTotal, Math.round(v)))
  const presetBet = (frac) => clampBet((g.currentBet || 0) + potForSizing * frac)
  const canRaise = myMaxTotal > minRaiseTo // tengo fichas para subir

  const boardReady = shownBoard >= boardLen
  const isShowdown = g.status === 'hand_over' && !!g.showdownDescr
  const revealHoles = isShowdown
  const reveal = clientReveal.length ? clientReveal : (g.reveal || [])

  // ganadores: los del server, o calculados si el server no los mandó
  let winnerIds = g.winners || []
  if (!winnerIds.length && clientReveal.length && boardLen === 5) {
    const hm = {}
    clientReveal.forEach((r) => { hm[r.userId] = state.hands[r.userId] })
    winnerIds = calcWinners(hm, g.board, clientReveal.map((r) => r.userId))
  }
  const winnerNames = winnerIds.map((id) => players.find((p) => p.user_id === id)?.name).filter(Boolean)

  const nextIn = g.nextHandAt ? Math.max(0, Math.ceil((g.nextHandAt - now) / 1000)) : null
  const iFolded = g.folded?.[me]
  const iRevealed = g.revealed?.includes(me)
  const tournamentOver = room?.status === 'done' || !!g.champion
  const championName = g.champion ? (players.find((p) => p.user_id === g.champion)?.name || '—') : null
  const handOver = g.status === 'hand_over'

  // set de cartas que forman la mano ganadora (para grisar el resto en el showdown)
  const winnerReveal = reveal.find((r) => winnerIds.includes(r.userId))
  const winSet = new Set(winnerReveal?.cards || [])
  const revealFor = (id) => reveal.find((r) => r.userId === id)
  const dimEnabled = handOver && boardReady && !!g.showdownDescr && reveal.length > 0 && winSet.size > 0

  // ciegas: SB / BB (misma regla que el server)
  const order = g.order || []
  const btnIdx = order.indexOf(g.button)
  const heads = order.length === 2
  const sbId = btnIdx < 0 ? null : heads ? g.button : order[(btnIdx + 1) % order.length]
  const bbId = btnIdx < 0 ? null : heads ? order[(btnIdx + 1) % order.length] : order[(btnIdx + 2) % order.length]
  const hpb = room.config?.handsPerBlindUp
  const blindUpIn = hpb && g.handNo ? hpb - ((g.handNo - 1) % hpb) : null
  const avgStack = ordered.length
    ? Math.round(ordered.reduce((a, p) => a + stackOf(p.user_id) + (g.bets?.[p.user_id] || 0), 0) / ordered.length)
    : 0

  return (
    <div className="gg-screen">
      <div className="gg-wrap">
        <div className="gg-top">
          <div className="gg-pill teal">
            {myHand.map((c, i) => {
              const n = norm(c)
              if (!n) return null
              return (
                <span key={i} className={`gg-mini ${n[1] === 'h' || n[1] === 'd' ? 'red' : ''}`}>
                  <b>{suitSym(n[1])}</b>{rankLabel(n[0])}
                </span>
              )
            })}
          </div>
          <div className="gg-pill">Sala {room.code}</div>
          <div className="gg-top-right">
            {leaveAsk ? (
              <span className="gg-leave-ask">
                ¿Salir?
                <button onClick={leave} disabled={busy}>Sí</button>
                <button onClick={() => setLeaveAsk(false)}>No</button>
              </span>
            ) : (
              <button className="gg-icon-btn" onClick={leave} disabled={busy} aria-label="Abandonar">⏏</button>
            )}
          </div>
        </div>

        <div className="gg-table">
          <div className="gg-rail"><div className="gg-felt" /></div>
          <div className="gg-watermark">Terrible<br /><b>POKER</b></div>
          {/* punto de reparto (centro) */}
          <div className="gg-dealer-spot" ref={deckRef} />

          {(potForSizing > 0) && (
            <div className="gg-total">
              <span>Bote total</span>
              <b>{fmt(potForSizing)}</b>
            </div>
          )}

          <div className="gg-board">
            {[0, 1, 2, 3, 4].map((i) => {
              const dealt = g.board?.[i] && i < shownBoard
              if (!dealt) return null
              const delay = i < 3 ? i * 130 : 0
              return (
                <DealCard key={`b${i}-${g.handNo}-${g.board[i]}`} originRef={deckRef} delay={delay}>
                  <Card code={g.board[i]} size="board" dim={dimEnabled && !winSet.has(g.board[i])} />
                </DealCard>
              )
            })}
          </div>

          {(g.pot || 0) > 0 && (
            <div className="gg-pot" key={g.pot}>
              <Chips amount={g.pot} />
            </div>
          )}

          {!handOver && g.handNo > 0 && (
            <div className="gg-info">
              <p>Ciegas: {fmt(g.sb)}/{fmt(g.blind)}{blindUpIn ? ` - sube en ${blindUpIn} mano${blindUpIn > 1 ? 's' : ''}` : ''}</p>
              {blindUpIn && <p>Siguientes ciegas: {fmt(g.sb * 2)}/{fmt(g.blind * 2)}</p>}
              <p>Mano #{g.handNo} · Stack medio {fmt(avgStack)}</p>
              {g.status === 'betting' && (
                <p className="gg-turn">
                  {myTurn ? 'Tu turno' : `Turno de ${nameOf(turnId)}`}{secsLeft != null ? ` · ${secsLeft}s` : ''}
                </p>
              )}
            </div>
          )}

          {/* fichas apostadas en la calle actual */}
          {ordered.map((p, idx) => {
            const amt = g.bets?.[p.user_id] || 0
            if (amt <= 0) return null
            return (
              <div key={`bet-${p.user_id}`} className="gg-bet" style={pct(lerp(POS[layout[idx]], 0.42))}>
                <Chips amount={amt} />
              </div>
            )
          })}

          {/* botón de dealer */}
          {ordered.map((p, idx) => {
            if (p.user_id !== g.button) return null
            const [x, y] = lerp(POS[layout[idx]], 0.18)
            return <div key="dealer" className="gg-dealer" style={pct([x + (x < 50 ? 9 : -9), y])}>D</div>
          })}

          {ordered.map((p, idx) => {
            const id = p.user_id
            const isMe = id === me
            const pos = POS[layout[idx]]
            const folded = !!g.folded?.[id]
            const res = g.results?.find((r) => r.userId === id)
            const oppHand = state.hands?.[id]
            const inHand = g.handNo > 0 && !folded && order.includes(id)
            const showOpp = !isMe && Array.isArray(oppHand) && (
              (revealHoles && !folded) || g.revealed?.includes(id)
            )
            const rv = dimEnabled ? revealFor(id) : null
            const pSet = rv ? new Set(rv.cards) : null
            const active = id === turnId && g.status === 'betting'
            const won = handOver && boardReady && winnerIds.includes(id)
            const stack = stackOf(id)
            const timeFrac = active && secsLeft != null ? Math.min(1, secsLeft / playTimeout) : 0
            const badge = id === bbId ? 'BB' : id === sbId ? 'SB' : null
            const label = isMe
              ? myHandName
              : (handOver && boardReady && (showOpp || winnerIds.includes(id)) ? revealFor(id)?.mano : '')

            let cards = null
            if (isMe && myHand.length) {
              cards = myHand.map((c, i) => (
                <DealCard key={`m${g.handNo}-${i}-${c}`} originRef={deckRef} delay={idx * 120 + i * 240}>
                  <Card code={c} size="hole" dim={(pSet ? !pSet.has(c) : false) || folded} />
                </DealCard>
              ))
            } else if (showOpp) {
              cards = oppHand.map((c, i) => (
                <Card key={`o${i}-${c}`} code={c} size="seat" animate dim={pSet ? !pSet.has(c) : false} />
              ))
            } else if (inHand) {
              cards = [0, 1].map((i) => (
                <DealCard key={`bk${g.handNo}-${id}-${i}`} originRef={deckRef} delay={idx * 120 + i * 240}>
                  <Card hidden size="seat" />
                </DealCard>
              ))
            }

            return (
              <div
                key={id}
                className={`gg-seat ${isMe ? 'me' : ''} ${active ? 'active' : ''} ${folded ? 'folded' : ''} ${won ? 'won' : ''}`}
                style={pct(pos)}
              >
                <div
                  className={`gg-ava-wrap ${isMe ? 'tappable' : ''}`}
                  onClick={isMe ? () => setPickerOpen((o) => !o) : undefined}
                >
                  <div className="gg-ava">{avatarOf(id)}</div>
                  {cards && <div className={`gg-cards ${isMe ? 'mine' : ''}`}>{cards}</div>}
                  {badge && <span className="gg-badge">{badge}</span>}
                  <span className="gg-flag" />
                  {folded && !showOpp && <span className="gg-status">Retirado</span>}
                  {reactions[id] && REACTIONS[reactions[id].key] && (
                    <div className="gg-react" key={reactions[id].at}>
                      <span className="gg-react-emoji">{REACTIONS[reactions[id].key][0]}</span>
                      <span className="gg-react-label">{REACTIONS[reactions[id].key][1]}</span>
                    </div>
                  )}
                </div>
                <div className="gg-plate">
                  <div className="gg-name">{p.name}</div>
                  <div className="gg-stack">
                    {g.allIn?.[id] && stack === 0 ? 'ALL-IN' : fmt(stack)}
                  </div>
                </div>
                {active && (
                  <div className="gg-timer"><i style={{ width: `${timeFrac * 100}%` }} /></div>
                )}
                {label && <div className="gg-handname">{label}</div>}
                {handOver && boardReady && res && res.delta !== 0 && (
                  <div className={`gg-delta ${res.delta > 0 ? 'pos' : 'neg'}`}>
                    {res.delta > 0 ? '+' : ''}{fmt(res.delta)}
                  </div>
                )}
              </div>
            )
          })}

          {handOver && (
            tournamentOver ? (
              <div className="gg-banner champ">
                <div className="banner-trophy">🏆</div>
                <div className="banner-kicker">GANADOR DEL TORNEO</div>
                <div className="banner-name">{championName || winnerNames[0] || '—'}</div>
                {data.restart
                  ? <button onClick={data.restart}>Jugar de nuevo</button>
                  : <button onClick={() => nav('/')}>Volver al inicio</button>}
              </div>
            ) : (
              <div className="gg-banner">
                {boardReady ? (
                  <>
                    <div className="banner-kicker">{winnerNames.length > 1 ? 'EMPATE' : 'GANÓ'}</div>
                    <div className="banner-name">
                      {winnerNames.length > 1 ? winnerNames.join(' y ') : (winnerNames[0] || '—')}
                    </div>
                    <div className="banner-sub">
                      {g.showdownDescr ? `con ${g.showdownDescr}` : 'los demás se retiraron'}
                      {g.potWon ? ` · +${fmt(g.potWon)}` : ''}
                    </div>
                    {nextIn != null && <div className="banner-count">Próxima mano en {nextIn}s</div>}
                    <div className="gg-banner-btns">
                      {reveal.length > 0 && (
                        <button className="gg-small-btn" onClick={() => setRevealOpen(true)}>Ver manos</button>
                      )}
                      {iFolded && !iRevealed && (
                        <button className="gg-small-btn" onClick={showMyCards}>Mostrar mis cartas</button>
                      )}
                    </div>
                    {iFolded && iRevealed && <div className="banner-sub">Mostraste tus cartas ✓</div>}
                  </>
                ) : (
                  <div className="banner-kicker">Repartiendo la mesa…</div>
                )}
              </div>
            )
          )}

          {revealOpen && handOver && boardReady && reveal.length > 0 && (
            <div className="gg-reveal">
              <div className="gg-reveal-head">
                <span>Cartas ganadoras</span>
                <button onClick={() => setRevealOpen(false)} aria-label="Cerrar">✕</button>
              </div>
              {[...reveal]
                .sort((a, b) => (winnerIds.includes(b.userId) ? 1 : 0) - (winnerIds.includes(a.userId) ? 1 : 0))
                .map((r) => {
                  const won = winnerIds.includes(r.userId)
                  return (
                    <div key={r.userId} className={`reveal-row ${won ? 'win' : ''}`}>
                      <div className="reveal-head">
                        <span>{won ? '🏆 ' : ''}{nameOf(r.userId)}</span>
                        <span className="reveal-mano">{r.mano}</span>
                      </div>
                      <div className="reveal-cards">
                        {r.cards.map((c, i) => (
                          <span key={c} className="reveal-card" style={{ animationDelay: `${i * 90}ms` }}>
                            <Card code={c} size="sm" dim={!won && !winSet.has(c)} />
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
            </div>
          )}

          {pickerOpen && (
            <>
              <div className="gg-picker-backdrop" onClick={() => setPickerOpen(false)} />
              <div className="gg-picker">
                {Object.entries(REACTIONS).map(([key, [emoji, label]]) => (
                  <button key={key} onClick={() => react(key)}>
                    <span>{emoji}</span>
                    <small>{label}</small>
                  </button>
                ))}
              </div>
            </>
          )}

          {myTurn && raiseOpen && canRaise && (
            <div className="gg-raise">
              <div className="gg-raise-amt">{fmt(Math.min(Math.max(betTo, minRaiseTo), myMaxTotal))}</div>
              <div className="gg-presets">
                <button onClick={() => setBetTo(clampBet(minRaiseTo))} disabled={busy}>Mín</button>
                <button onClick={() => setBetTo(presetBet(0.33))} disabled={busy}>⅓</button>
                <button onClick={() => setBetTo(presetBet(0.5))} disabled={busy}>½</button>
                <button onClick={() => setBetTo(presetBet(0.75))} disabled={busy}>¾</button>
                <button onClick={() => setBetTo(presetBet(1))} disabled={busy}>Bote</button>
                <button onClick={() => setBetTo(myMaxTotal)} disabled={busy}>Todo</button>
              </div>
              <input
                type="range"
                min={minRaiseTo}
                max={myMaxTotal}
                step={5}
                value={Math.min(Math.max(betTo, minRaiseTo), myMaxTotal)}
                onChange={(e) => setBetTo(+e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="gg-controls">
          {myTurn ? (
            <div className="gg-actions">
              <button className="gg-act fold" onClick={() => act('fold')} disabled={busy}>Retirarse</button>
              <button className="gg-act call" onClick={() => act('call')} disabled={busy}>
                {toCall > 0 ? <>Pagar<small>{fmt(Math.min(toCall, stackOf(me)))}</small></> : 'Pasar'}
              </button>
              {canRaise ? (
                raiseOpen ? (
                  <button
                    className="gg-act raise"
                    onClick={() => act(betTo >= myMaxTotal ? 'allin' : 'raise', { amount: betTo })}
                    disabled={busy}
                  >
                    {betTo >= myMaxTotal ? 'All-in' : (g.currentBet > 0 ? 'Subir a' : 'Apostar')}
                    <small>{fmt(Math.min(Math.max(betTo, minRaiseTo), myMaxTotal))}</small>
                  </button>
                ) : (
                  <button className="gg-act raise" onClick={() => setRaiseOpen(true)} disabled={busy}>
                    {g.currentBet > 0 ? 'Subir' : 'Apostar'}
                  </button>
                )
              ) : (
                <button className="gg-act raise" onClick={() => act('allin')} disabled={busy}>All-in</button>
              )}
            </div>
          ) : (
            <div className="gg-wait">
              {g.status === 'betting' ? `Esperando a ${nameOf(turnId)}…` : ''}
            </div>
          )}
        </div>
      </div>

      {data.extra}

      {!data.demo && <Chat
        messages={messages}
        me={me}
        myName={players.find((p) => p.user_id === me)?.name || localStorage.getItem('name') || 'Yo'}
        onSend={sendMessage}
        onSendVoice={sendVoice}
        voiceUrl={voiceUrl}
      />}
    </div>
  )
}
