import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRoom } from '../hooks/useRoom.js'
import { invokeGame, leaveRoom } from '../lib/rooms.js'
import { bestHand, winners as calcWinners } from '../lib/poker.js'
import Card from '../components/Card.jsx'
import Chips from '../components/Chips.jsx'
import DealCard from '../components/DealCard.jsx'
import Chat from '../components/Chat.jsx'

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

// posiciones relativas: yo siempre abajo-centro, resto rotan
const SLOTS = {
  2: ['bottom', 'top'],
  3: ['bottom', 'top-left', 'top-right'],
  4: ['bottom', 'left', 'top', 'right'],
}

export default function Table() {
  const { code } = useParams()
  const { room, players, state, messages, me, err, refetch, sendMessage, sendVoice, voiceUrl } = useRoom(code)
  const nav = useNavigate()
  const [betTo, setBetTo] = useState(0)
  const [busy, setBusy] = useState(false)
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
  }, [pub0?.currentBet, pub0?.turnUserId, pub0?.handNo])

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
      invokeGame('timeout', { code }).catch(() => {})
    }
  }, [now, g.status, g.deadline, code])

  // auto-siguiente mano a los 10s (lo dispara el anfitrión)
  const amHost = players[0]?.user_id === me
  useEffect(() => {
    if (g.status !== 'hand_over' || !g.nextHandAt || !amHost) return
    if (now > g.nextHandAt && nextHandSent.current !== g.nextHandAt) {
      nextHandSent.current = g.nextHandAt
      invokeGame('next_hand', { code }).catch(() => {})
    }
  }, [now, g.status, g.nextHandAt, amHost, code])

  const boardLen = g.board?.length || 0
  const shownBoard = useStagedReveal(boardLen)

  // "quema" una carta al repartir y en cada nueva calle
  const [burnTick, setBurnTick] = useState(0)
  const prevShown = useRef(shownBoard)
  const prevHand = useRef(g.handNo)
  useEffect(() => {
    if (shownBoard !== prevShown.current) {
      prevShown.current = shownBoard
      setBurnTick((t) => t + 1)
    }
  }, [shownBoard])
  useEffect(() => {
    if (g.handNo && g.handNo !== prevHand.current) {
      prevHand.current = g.handNo
      setBurnTick((t) => t + 1)
    }
  }, [g.handNo])

  // showdown calculado en el cliente (no depende de que el server mande `reveal`)
  const clientReveal = useMemo(() => {
    if (g.status !== 'hand_over' || boardLen !== 5 || !state?.hands) return []
    const ids = (g.order || []).filter(
      (id) => !g.folded?.[id] && Array.isArray(state.hands[id]) && state.hands[id].length === 2,
    )
    return ids.map((id) => ({ userId: id, ...bestHand(state.hands[id], g.board) }))
  }, [g.status, boardLen, g.board, g.folded, g.order, state?.hands])

  if (err) return <div className="screen"><p className="err">{err}</p></div>
  if (!room || !state) return <div className="screen"><p>Cargando mesa…</p></div>

  const myHand = state.hands?.[me] || []
  const turnId = g.turnUserId
  const myTurn = turnId === me && g.status === 'betting'
  const myBet = g.bets?.[me] || 0
  const toCall = (g.currentBet || 0) - myBet
  const slots = SLOTS[ordered.length] || SLOTS[4]
  const secsLeft = g.deadline ? Math.max(0, Math.ceil((g.deadline - now) / 1000)) : null
  const minRaiseTo = (g.currentBet || 0) + (g.minRaise || g.blind || 0)

  async function act(action, extra = {}) {
    if (busy) return
    setBusy(true)
    try { await invokeGame('act', { code, action, ...extra }); await refetch() }
    catch (e) { alert(String(e.message || e)); await refetch() }
    finally { setBusy(false) }
  }
  async function showMyCards() {
    try { await invokeGame('show', { code }); await refetch() }
    catch (e) { alert(String(e.message || e)) }
  }
  async function leave() {
    if (!confirm('¿Salir de la sala?')) return
    setBusy(true)
    await leaveRoom(code)
    nav('/')
  }

  const stackOf = (id) => g.stacks?.[id] ?? players.find((p) => p.user_id === id)?.stack ?? 0

  // sizing de apuesta por % del pozo
  const potForSizing = (g.pot || 0) + Object.values(g.bets || {}).reduce((a, b) => a + (b || 0), 0)
  const myMaxTotal = myBet + stackOf(me)
  const clampBet = (v) => Math.max(minRaiseTo, Math.min(myMaxTotal, Math.round(v)))
  const presetBet = (frac) => clampBet((g.currentBet || 0) + potForSizing * frac)
  const canRaise = myMaxTotal > minRaiseTo // tengo fichas para subir

  const boardReady = shownBoard >= boardLen
  const isShowdown = g.status === 'hand_over' && !!g.showdownDescr
  // en all-in: primero se ven las 2 manos, después se reparte la mesa de a poco
  const revealHoles = isShowdown
  const reveal = clientReveal.length ? clientReveal : (g.reveal || [])

  // ganadores: los del server, o calculados si el server no los mandó
  let winnerIds = g.winners || []
  if (!winnerIds.length && clientReveal.length && boardLen === 5) {
    const hm = {}
    clientReveal.forEach((r) => { hm[r.userId] = state.hands[r.userId] })
    winnerIds = calcWinners(hm, g.board, clientReveal.map((r) => r.userId))
  }

  const winnerNames = winnerIds
    .map((id) => players.find((p) => p.user_id === id)?.name)
    .filter(Boolean)

  const nextIn = g.nextHandAt ? Math.max(0, Math.ceil((g.nextHandAt - now) / 1000)) : null
  const iFolded = g.folded?.[me]
  const iRevealed = g.revealed?.includes(me)
  const tournamentOver = room?.status === 'done' || !!g.champion
  const championName = g.champion
    ? (players.find((p) => p.user_id === g.champion)?.name || '—')
    : null

  // set de cartas que forman la mano ganadora (para grisar el resto en el showdown)
  const winnerReveal = reveal.find((r) => winnerIds.includes(r.userId))
  const winSet = new Set(winnerReveal?.cards || [])
  const revealSetFor = (id) => new Set(reveal.find((r) => r.userId === id)?.cards || [])
  const dimEnabled =
    g.status === 'hand_over' && boardReady && !!g.showdownDescr &&
    reveal.length > 0 && winSet.size > 0

  // cartas quemadas al descarte: 1 pre-flop + 1 por cada calle mostrada
  const burned =
    (g.handNo ? 1 : 0) +
    (shownBoard >= 3 ? 1 : 0) + (shownBoard >= 4 ? 1 : 0) + (shownBoard >= 5 ? 1 : 0)
  const dealtTotal = (g.handNo ? ordered.length * 2 : 0) + burned + shownBoard
  const deckLeft = Math.max(0, 52 - dealtTotal)

  return (
    <div className="screen table-screen">
      <div className="table-top">
        <span className="table-code">Sala {room.code}</span>
        <button className="leave-btn" onClick={leave} disabled={busy}>Abandonar</button>
      </div>

      <div className="felt">
        {/* maso al costado que "reparte" */}
        <div className="deck" ref={deckRef}>
          <span /><span /><span /><span />
          <div className="deck-count">{deckLeft}</div>
        </div>
        {/* descarte (cartas quemadas, boca abajo) */}
        <div className="discard">
          <span /><span />
          <div className="discard-count">🗑 {burned}</div>
        </div>
        {/* carta quemada volando del maso al descarte */}
        <div className="burn-card" key={burnTick} aria-hidden="true" />

        {(g.pot || 0) > 0 && (
          <div className="pot" key={g.pot}>
            <Chips amount={g.pot} variant="pot" />
          </div>
        )}

        <div className="board">
          {[0, 1, 2, 3, 4].map((i) => {
            const dealt = g.board?.[i] && i < shownBoard
            // slot vacío = solo contorno, NO un dorso de carta
            if (!dealt) return <div key={`b${i}-slot`} className="board-slot" />
            const delay = i < 3 ? i * 130 : 0
            return (
              <DealCard key={`b${i}-${g.handNo}-${g.board[i]}`} originRef={deckRef} delay={delay}>
                <Card code={g.board[i]} dim={dimEnabled && !winSet.has(g.board[i])} />
              </DealCard>
            )
          })}
        </div>

        {ordered.map((p, idx) => {
          const isMe = p.user_id === me
          const res = g.results?.find((r) => r.userId === p.user_id)
          const oppHand = state.hands?.[p.user_id]
          const showOpp = !isMe && Array.isArray(oppHand) && (
            (revealHoles && !g.folded?.[p.user_id]) ||
            g.revealed?.includes(p.user_id)
          )
          const pSet = dimEnabled ? revealSetFor(p.user_id) : null
          return (
            <div
              key={p.user_id}
              className={`seat ${slots[idx]} ${p.user_id === turnId ? 'active' : ''} ${g.folded?.[p.user_id] ? 'folded' : ''}`}
            >
              <div className="seat-name">
                {p.user_id === g.button && '🔘 '}{p.name}{isMe && ' (vos)'}
              </div>
              <div className="seat-stack">
                <Chips amount={stackOf(p.user_id)} variant="stack" />
                <span>{stackOf(p.user_id)}{g.allIn?.[p.user_id] && ' · ALL-IN'}</span>
              </div>
              <div className="seat-cards">
                {isMe
                  ? myHand.map((c, i) => (
                      <DealCard key={`m${g.handNo}-${i}-${c}`} originRef={deckRef} delay={idx * 120 + i * 240}>
                        <Card code={c} small dim={pSet ? !pSet.has(c) : false} />
                      </DealCard>
                    ))
                  : showOpp
                    ? oppHand.map((c, i) => (
                        <Card key={`o${i}-${c}`} code={c} small animate dim={pSet ? !pSet.has(c) : false} />
                      ))
                    : [0, 1].map((i) => (
                        <DealCard key={`bk${g.handNo}-${p.user_id}-${i}`} originRef={deckRef} delay={idx * 120 + i * 240}>
                          <Card hidden small />
                        </DealCard>
                      ))}
              </div>
              {g.bets?.[p.user_id] > 0 && (
                <div className="seat-bet">
                  <Chips amount={g.bets[p.user_id]} variant="bet" />
                </div>
              )}
              {g.status === 'hand_over' && boardReady && winnerIds.includes(p.user_id) && <div className="seat-win">🏆</div>}
              {g.status === 'hand_over' && boardReady && res && (
                <div className={`seat-delta ${res.delta >= 0 ? 'pos' : 'neg'}`}>
                  {res.delta >= 0 ? '+' : ''}{res.delta}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {g.status === 'hand_over' && (
        tournamentOver ? (
          <div className="banner banner-champ">
            <div className="banner-trophy">🏆</div>
            <div className="banner-kicker">GANADOR DEL TORNEO</div>
            <div className="banner-name">{championName || winnerNames[0] || '—'}</div>
            <button onClick={() => nav('/')}>Volver al inicio</button>
          </div>
        ) : (
          <div className="banner">
            {boardReady ? (
              <>
                <div className="banner-trophy">🏆</div>
                <div className="banner-kicker">
                  {winnerNames.length > 1 ? 'EMPATE' : 'GANÓ'}
                </div>
                <div className="banner-name">
                  {winnerNames.length > 1 ? winnerNames.join(' y ') : (winnerNames[0] || '—')}
                </div>
                <div className="banner-sub">
                  {g.showdownDescr ? `con ${g.showdownDescr}` : 'los demás se retiraron'}
                  {g.potWon ? ` · +${g.potWon}` : ''}
                </div>
                {nextIn != null && (
                  <div className="banner-count">Próxima mano en {nextIn}s</div>
                )}
                {iFolded && !iRevealed && (
                  <button className="btn-show" onClick={showMyCards}>Mostrar mis cartas</button>
                )}
                {iFolded && iRevealed && <div className="banner-sub">Mostraste tus cartas ✓</div>}
              </>
            ) : (
              <div className="banner-kicker">Repartiendo la mesa…</div>
            )}
          </div>
        )
      )}

      {g.status === 'hand_over' && boardReady && reveal.length > 0 && (
        <div className="reveal-panel">
          <div className="reveal-title">Cartas ganadoras</div>
          {[...reveal]
            .sort((a, b) => (winnerIds.includes(b.userId) ? 1 : 0) - (winnerIds.includes(a.userId) ? 1 : 0))
            .map((r) => {
              const nm = players.find((p) => p.user_id === r.userId)?.name || '—'
              const won = winnerIds.includes(r.userId)
              return (
                <div key={r.userId} className={`reveal-row ${won ? 'win' : ''}`}>
                  <div className="reveal-head">
                    <span>{won ? '🏆 ' : ''}{nm}</span>
                    <span className="reveal-mano">{r.mano}</span>
                  </div>
                  <div className="reveal-cards">
                    {r.cards.map((c, i) => (
                      <span key={c} className="reveal-card" style={{ animationDelay: `${i * 90}ms` }}>
                        <Card code={c} small dim={!won && !winSet.has(c)} />
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
        </div>
      )}

      <div className="controls">
        {g.status === 'betting' && (
          <div className="turn-info">
            {myTurn
              ? <b>Tu turno{secsLeft != null && ` · ${secsLeft}s`}</b>
              : `Turno de ${players.find((p) => p.user_id === turnId)?.name || '…'}${secsLeft != null ? ` · ${secsLeft}s` : ''}`}
          </div>
        )}

        {myTurn && (
          <div className="bet-ui">
            <div className="bet-row">
              <button className="btn-fold" onClick={() => act('fold')} disabled={busy}>Me retiro</button>
              <button className="btn-call" onClick={() => act('call')} disabled={busy}>
                {toCall > 0 ? `Pagar ${toCall}` : 'Paso'}
              </button>
            </div>

            {canRaise && (
              <>
                <div className="bet-presets">
                  <button onClick={() => setBetTo(clampBet(minRaiseTo))} disabled={busy}>Mín</button>
                  <button onClick={() => setBetTo(presetBet(0.33))} disabled={busy}>⅓ pozo</button>
                  <button onClick={() => setBetTo(presetBet(0.5))} disabled={busy}>½ pozo</button>
                  <button onClick={() => setBetTo(presetBet(0.75))} disabled={busy}>¾ pozo</button>
                  <button onClick={() => setBetTo(presetBet(1))} disabled={busy}>Pozo</button>
                </div>
                <div className="bet-slider">
                  <input
                    type="range"
                    min={minRaiseTo}
                    max={myMaxTotal}
                    step={5}
                    value={Math.min(Math.max(betTo, minRaiseTo), myMaxTotal)}
                    onChange={(e) => setBetTo(+e.target.value)}
                  />
                  <div className="bet-amount">
                    <Chips amount={betTo} variant="bet" />
                    <b>{betTo}</b>
                  </div>
                </div>
                <button
                  className="btn-raise"
                  onClick={() => act(betTo >= myMaxTotal ? 'allin' : 'raise', { amount: betTo })}
                  disabled={busy}
                >
                  {betTo >= myMaxTotal ? 'Voy con todo' : `${g.currentBet > 0 ? 'Subir a' : 'Apostar'} ${betTo}`}
                </button>
              </>
            )}

            {!canRaise && (
              <button className="btn-raise" onClick={() => act('allin')} disabled={busy}>Voy con todo</button>
            )}
          </div>
        )}

      </div>

      <Chat
        messages={messages}
        me={me}
        myName={players.find((p) => p.user_id === me)?.name || localStorage.getItem('name') || 'Yo'}
        onSend={sendMessage}
        onSendVoice={sendVoice}
        voiceUrl={voiceUrl}
      />
    </div>
  )
}
