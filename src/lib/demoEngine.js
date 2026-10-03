// Motor de Hold'em local para la mesa de prueba (/demo).
// Port de supabase/functions/game/index.ts sin base de datos: opera sobre un objeto
// { room, players, gs: { public, hands, private } } y lo muta.
import { Hand } from 'pokersolver'
import { freshDeck, shuffle, manoEs } from './poker.js'

const nz = (o, id) => o[id] ?? 0

function nextToAct(pub, fromId) {
  const n = pub.order.length
  const start = pub.order.indexOf(fromId)
  for (let k = 1; k <= n; k++) {
    const id = pub.order[(start + k) % n]
    if (!pub.folded[id] && !pub.allIn[id]) return id
  }
  return null
}
const activeIds = (pub) => pub.order.filter((id) => !pub.folded[id])
const canActIds = (pub) => pub.order.filter((id) => !pub.folded[id] && !pub.allIn[id])

function streetClosed(pub) {
  const live = canActIds(pub)
  if (live.length === 0) return true
  if (live.length === 1) return nz(pub.bets, live[0]) === pub.currentBet
  return live.every((id) => pub.acted[id] && nz(pub.bets, id) === pub.currentBet)
}

function postBlind(pub, id, amount) {
  const pay = Math.min(amount, pub.stacks[id])
  pub.stacks[id] -= pay
  pub.bets[id] = nz(pub.bets, id) + pay
  pub.committed[id] = nz(pub.committed, id) + pay
  if (pub.stacks[id] === 0) pub.allIn[id] = true
}

export function startHand(s) {
  const { room, players } = s
  const inHand = players.filter((p) => Number(p.stack) > 0)
  if (inHand.length < 2) throw new Error('se necesitan 2+ jugadores con fichas')
  const order = inHand.map((p) => p.user_id)

  const prev = s.gs?.public
  let button
  if (prev?.button && order.includes(prev.button)) {
    button = order[(order.indexOf(prev.button) + 1) % order.length]
  } else {
    button = order[0]
  }

  const handNo = (room.hand_no ?? 0) + 1
  const ups = Math.floor((handNo - 1) / room.config.handsPerBlindUp)
  const blind = room.config.startBlind * 2 ** ups
  const sb = Math.max(1, Math.floor(blind / 2))

  const stacks = {}
  for (const p of inHand) stacks[p.user_id] = Number(p.stack)

  const deck = shuffle(freshDeck())
  const hands = {}
  for (const id of order) hands[id] = [deck.shift(), deck.shift()]
  deck.shift() // quema
  const fullBoard = [deck.shift(), deck.shift(), deck.shift(), deck.shift(), deck.shift()]

  const pub = {
    status: 'betting', street: 'preflop', handNo, button, blind, sb, order,
    board: [], pot: 0, bets: {}, committed: {}, stacks,
    folded: {}, allIn: {}, acted: {},
    currentBet: 0, minRaise: blind, turnUserId: null,
    deadline: Date.now() + room.config.playTimeout * 1000,
    winners: [], showdownDescr: null, results: [],
  }

  const heads = order.length === 2
  const btnIdx = order.indexOf(button)
  const sbId = heads ? button : order[(btnIdx + 1) % order.length]
  const bbId = heads ? order[(btnIdx + 1) % order.length] : order[(btnIdx + 2) % order.length]
  postBlind(pub, sbId, sb)
  postBlind(pub, bbId, blind)
  pub.currentBet = blind
  pub.minRaise = blind
  pub.turnUserId = nextToAct(pub, bbId)

  s.gs = { status: 'betting', public: pub, hands, private: { fullBoard } }
  room.status = 'playing'
  room.hand_no = handNo
  if (!pub.turnUserId || streetClosed(pub)) advance(s)
}

export function applyAction(pub, uid, action, amount) {
  const toCall = pub.currentBet - nz(pub.bets, uid)
  if (action === 'fold') { pub.folded[uid] = true; pub.acted[uid] = true; return }
  if (action === 'call' || action === 'check') {
    if (toCall <= 0) { pub.acted[uid] = true; return }
    const pay = Math.min(toCall, pub.stacks[uid])
    pub.stacks[uid] -= pay
    pub.bets[uid] = nz(pub.bets, uid) + pay
    pub.committed[uid] = nz(pub.committed, uid) + pay
    if (pub.stacks[uid] === 0) pub.allIn[uid] = true
    pub.acted[uid] = true
    return
  }
  if (action === 'raise' || action === 'bet' || action === 'allin') {
    let target = action === 'allin' ? nz(pub.bets, uid) + pub.stacks[uid] : amount
    const maxTarget = nz(pub.bets, uid) + pub.stacks[uid]
    if (target > maxTarget) target = maxTarget
    const isAllIn = target === maxTarget
    const minTarget = pub.currentBet + pub.minRaise
    if (target < minTarget && !isAllIn) throw new Error(`subida mínima a ${minTarget}`)
    if (target <= pub.currentBet && !(isAllIn && target > nz(pub.bets, uid))) {
      throw new Error('la subida debe superar la apuesta actual')
    }
    const raiseSize = target - pub.currentBet
    const pay = target - nz(pub.bets, uid)
    pub.stacks[uid] -= pay
    pub.bets[uid] = target
    pub.committed[uid] = nz(pub.committed, uid) + pay
    if (pub.stacks[uid] === 0) pub.allIn[uid] = true
    if (raiseSize >= pub.minRaise) {
      pub.currentBet = target
      pub.minRaise = raiseSize
      pub.acted = { [uid]: true }
    } else {
      pub.currentBet = target
      pub.acted[uid] = true
    }
    return
  }
  throw new Error('acción inválida: ' + action)
}

export function act(s, uid, action, amount) {
  const pub = s.gs?.public
  if (!pub) throw new Error('mano no iniciada')
  if (pub.status !== 'betting') throw new Error('la mano no está en apuestas')
  if (pub.turnUserId !== uid) throw new Error('no es tu turno')
  applyAction(pub, uid, action, Number(amount) || 0)
  advance(s)
}

export function timeout(s) {
  const pub = s.gs?.public
  if (!pub || pub.status !== 'betting' || !pub.turnUserId) return
  if (Date.now() < pub.deadline) return
  const uid = pub.turnUserId
  applyAction(pub, uid, pub.currentBet - nz(pub.bets, uid) > 0 ? 'fold' : 'check', 0)
  advance(s)
}

export function show(s, uid) {
  const pub = s.gs?.public
  if (!pub || pub.status !== 'hand_over') return
  pub.revealed = pub.revealed ?? []
  if (!pub.revealed.includes(uid)) pub.revealed.push(uid)
}

function advance(s) {
  const { room, gs } = s
  const pub = gs.public
  const timeoutMs = room.config.playTimeout * 1000

  if (activeIds(pub).length === 1) return finishHand(s, [activeIds(pub)[0]])

  if (streetClosed(pub)) {
    for (const id of pub.order) pub.pot += nz(pub.bets, id)
    pub.bets = {}
    pub.acted = {}
    pub.currentBet = 0
    pub.minRaise = pub.blind
    const noMoreBetting = canActIds(pub).length <= 1
    for (;;) {
      if (pub.street === 'river') return showdown(s)
      pub.street = pub.street === 'preflop' ? 'flop' : pub.street === 'flop' ? 'turn' : 'river'
      pub.board = gs.private.fullBoard.slice(0, pub.street === 'flop' ? 3 : pub.street === 'turn' ? 4 : 5)
      if (!noMoreBetting) {
        pub.turnUserId = nextToAct(pub, pub.button)
        pub.deadline = Date.now() + timeoutMs
        return
      }
    }
  }

  pub.turnUserId = nextToAct(pub, pub.turnUserId)
  pub.deadline = Date.now() + timeoutMs
}

function showdown(s) {
  const { gs } = s
  const pub = gs.public
  const board = gs.private.fullBoard
  const contenders = activeIds(pub)
  const levels = [...new Set(Object.values(pub.committed).filter((v) => v > 0))].sort((a, b) => a - b)
  const payouts = {}
  let prev = 0
  const potWinners = new Set()

  for (const lvl of levels) {
    let amount = 0
    for (const id of pub.order) {
      const c = nz(pub.committed, id)
      if (c > prev) amount += Math.min(c, lvl) - prev
    }
    const eligible = contenders.filter((id) => nz(pub.committed, id) >= lvl)
    prev = lvl
    if (amount === 0 || eligible.length === 0) continue
    const solved = eligible.map((id) => ({ id, hand: Hand.solve([...gs.hands[id], ...board]) }))
    const best = Hand.winners(solved.map((x) => x.hand))
    const winIds = solved.filter((x) => best.includes(x.hand)).map((x) => x.id)
    winIds.forEach((w) => potWinners.add(w))
    const share = Math.floor(amount / winIds.length)
    let rem = amount - share * winIds.length
    const bi = pub.order.indexOf(pub.button)
    const rotated = [...pub.order.slice(bi + 1), ...pub.order.slice(0, bi + 1)]
    const oddOrder = rotated.filter((id) => winIds.includes(id))
    for (const id of winIds) payouts[id] = (payouts[id] ?? 0) + share
    for (let i = 0; rem > 0; i++, rem--) payouts[oddOrder[i % oddOrder.length]] += 1
  }

  const winners = [...potWinners]
  let descr = null
  if (winners.length) descr = manoEs(Hand.solve([...gs.hands[winners[0]], ...board]).descr)
  const toCode = (c) => String(c.toString ? c.toString() : c).replace(/^10/, 'T')
  pub.reveal = contenders.map((id) => {
    const h = Hand.solve([...gs.hands[id], ...board])
    return { userId: id, cards: h.cards.map(toCode), mano: manoEs(h.descr) }
  })
  return finishHand(s, winners, payouts, descr)
}

function finishHand(s, winners, payouts, descr) {
  const { room, players, gs } = s
  const pub = gs.public
  for (const id of pub.order) pub.pot += nz(pub.bets, id)
  pub.bets = {}
  if (!payouts) payouts = { [winners[0]]: pub.pot }
  for (const [id, amt] of Object.entries(payouts)) pub.stacks[id] = nz(pub.stacks, id) + amt
  pub.results = pub.order.map((id) => ({ userId: id, delta: (payouts[id] ?? 0) - nz(pub.committed, id) }))
  pub.status = 'hand_over'
  gs.status = 'hand_over'
  pub.turnUserId = null
  pub.winners = winners
  pub.showdownDescr = descr ?? pub.showdownDescr
  pub.deadline = 0
  pub.revealed = []
  pub.potWon = Math.max(...Object.values(payouts))
  for (const p of players) if (pub.order.includes(p.user_id)) p.stack = pub.stacks[p.user_id]

  const withChips = pub.order.filter((id) => pub.stacks[id] > 0)
  if (withChips.length <= 1) {
    pub.champion = withChips[0] ?? null
    pub.nextHandAt = undefined
    room.status = 'done'
  } else {
    pub.champion = null
    pub.nextHandAt = Date.now() + 6000
  }
}

// decisión simple de bot: según fuerza de mano + algo de azar
export function botDecision(pub, hand, uid) {
  const toCall = pub.currentBet - nz(pub.bets, uid)
  const stack = pub.stacks[uid]
  let strength = 0
  try {
    const h = Hand.solve([...hand, ...pub.board])
    strength = h.rank // 1 carta alta … 9 escalera de color
  } catch { /* nada */ }
  if (pub.board.length === 0) {
    const [a, b] = hand.map((c) => '23456789TJQKA'.indexOf(c[0]))
    strength = a === b ? 3 + a / 6 : Math.max(a, b) / 6 + (hand[0][1] === hand[1][1] ? 0.5 : 0)
  }
  const r = Math.random()
  if (toCall > 0 && strength < 1.4 && r < 0.45) return { action: 'fold' }
  const minTo = pub.currentBet + pub.minRaise
  if (strength >= 2.5 && r < 0.5 && stack + nz(pub.bets, uid) > minTo) {
    const pot = pub.pot + Object.values(pub.bets).reduce((x, y) => x + y, 0)
    const to = Math.min(nz(pub.bets, uid) + stack, Math.max(minTo, pub.currentBet + Math.round(pot * (0.5 + r))))
    return to >= nz(pub.bets, uid) + stack ? { action: 'allin' } : { action: 'raise', amount: to }
  }
  if (r > 0.97 && stack > 0) return { action: 'allin' }
  return { action: 'call' }
}
