// Edge Function: motor de poker Texas Hold'em (server-authoritative)
// deploy: npx supabase functions deploy game
import { createClient } from 'jsr:@supabase/supabase-js@2'
import * as PS from 'npm:pokersolver@2.1.4'
// pokersolver es CJS: el named export puede venir en default segun el loader
const Hand: any = (PS as any).Hand ?? (PS as any).default?.Hand
console.log('game fn v4 boot')

// ------------------------------------------------------------------ deck
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const SUITS = ['s', 'h', 'd', 'c']
const freshDeck = () => RANKS.flatMap((r) => SUITS.map((s) => r + s))
function shuffle(src: string[]) {
  const a = src.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ------------------------------------------------------------------ types
type Id = string
interface Pub {
  status: 'betting' | 'hand_over'
  street: 'preflop' | 'flop' | 'turn' | 'river'
  handNo: number
  button: Id
  blind: number
  sb: number
  order: Id[]              // asientos (orden de ingreso), solo los que juegan la mano
  board: string[]          // comunitarias reveladas
  pot: number              // fichas de calles anteriores
  bets: Record<Id, number> // fichas puestas ESTA calle
  committed: Record<Id, number> // fichas totales esta mano (side pots)
  stacks: Record<Id, number>
  folded: Record<Id, boolean>
  allIn: Record<Id, boolean>
  acted: Record<Id, boolean> // actuó en esta calle
  currentBet: number
  minRaise: number
  turnUserId: Id | null
  deadline: number         // epoch ms para timeout de jugada
  winners: Id[]
  showdownDescr: string | null
  results: { userId: Id; delta: number }[]
  reveal?: { userId: Id; cards: string[]; mano: string }[] // 5 cartas ganadoras por jugador
}

// ------------------------------------------------------------------ http
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const asUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
  )
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return json({ error: 'no auth' }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'body invalido' }, 400) }
  const { op, code } = body
  if (!code) return json({ error: 'falta code' }, 400)

  const { data: room } = await admin.from('rooms').select('*').eq('code', String(code).toUpperCase()).single()
  if (!room) return json({ error: 'sala no existe' }, 404)

  const { data: players } = await admin.from('players')
    .select('*').eq('room_id', room.id).order('joined_at', { ascending: true })
  if (!players?.length) return json({ error: 'sin jugadores' }, 400)

  try {
    switch (op) {
      case 'start':
      case 'next_hand':
        return json(await startHand(admin, room, players))
      case 'act':
        return json(await act(admin, room, players, user.id, body))
      case 'timeout':
        return json(await handleTimeout(admin, room, players))
      default:
        return json({ error: 'op desconocida: ' + op }, 400)
    }
  } catch (e) {
    return json({ error: String((e as Error).message) }, 400)
  }
})

// ------------------------------------------------------------------ helpers
const nz = (o: Record<Id, number>, id: Id) => o[id] ?? 0

/** siguiente jugador que puede actuar (no folded, no all-in, con fichas), empezando DESPUES de fromId */
function nextToAct(pub: Pub, fromId: Id): Id | null {
  const n = pub.order.length
  const start = pub.order.indexOf(fromId)
  for (let k = 1; k <= n; k++) {
    const id = pub.order[(start + k) % n]
    if (!pub.folded[id] && !pub.allIn[id]) return id
  }
  return null
}
function firstAfterButton(pub: Pub): Id | null {
  return nextToAct(pub, pub.button)
}
function activeIds(pub: Pub): Id[] {
  return pub.order.filter((id) => !pub.folded[id])
}
function canActIds(pub: Pub): Id[] {
  return pub.order.filter((id) => !pub.folded[id] && !pub.allIn[id])
}

/** true si la ronda de apuestas de la calle terminó */
function streetClosed(pub: Pub): boolean {
  const live = canActIds(pub)
  if (live.length === 0) return true // todos all-in / foldeados
  if (live.length === 1) {
    // un solo jugador con fichas: cierra apenas igualó la apuesta
    // (si debe fichas, NO cierra: tiene que pagar o retirarse)
    return nz(pub.bets, live[0]) === pub.currentBet
  }
  return live.every((id) => pub.acted[id] && nz(pub.bets, id) === pub.currentBet)
}

// ------------------------------------------------------------------ arrancar mano
async function startHand(admin: any, room: any, players: any[]) {
  // jugadores con fichas
  const inHand = players.filter((p) => Number(p.stack) > 0)
  if (inHand.length < 2) throw new Error('se necesitan 2+ jugadores con fichas')
  if (inHand.length > 4) throw new Error('máximo 4 jugadores')

  const order: Id[] = inHand.map((p) => p.user_id)

  // botón: primera mano = primer asiento; luego rota al siguiente con fichas
  const { data: prev } = await admin.from('game_state').select('public').eq('room_id', room.id).maybeSingle()
  let button: Id
  if (prev?.public?.button && order.includes(prev.public.button)) {
    const i = order.indexOf(prev.public.button)
    button = order[(i + 1) % order.length]
  } else {
    button = order[0]
  }

  const handNo = (room.hand_no ?? 0) + 1
  const ups = Math.floor((handNo - 1) / room.config.handsPerBlindUp)
  const blind = room.config.startBlind * 2 ** ups
  const sb = Math.max(1, Math.floor(blind / 2))

  const stacks: Record<Id, number> = {}
  for (const p of inHand) stacks[p.user_id] = Number(p.stack)

  // repartir
  const deck = shuffle(freshDeck())
  const hands: Record<Id, string[]> = {}
  for (const id of order) hands[id] = [deck.shift()!, deck.shift()!]
  deck.shift() // burn
  const fullBoard = [deck.shift()!, deck.shift()!, deck.shift()!, deck.shift()!, deck.shift()!]

  const pub: Pub = {
    status: 'betting', street: 'preflop', handNo, button, blind, sb, order,
    board: [], pot: 0, bets: {}, committed: {}, stacks,
    folded: {}, allIn: {}, acted: {},
    currentBet: 0, minRaise: blind, turnUserId: null,
    deadline: Date.now() + room.config.playTimeout * 1000,
    winners: [], showdownDescr: null, results: [],
  }

  // posiciones de ciegas
  const heads = order.length === 2
  const btnIdx = order.indexOf(button)
  const sbId = heads ? button : order[(btnIdx + 1) % order.length]
  const bbId = heads ? order[(btnIdx + 1) % order.length] : order[(btnIdx + 2) % order.length]

  postBlind(pub, sbId, sb)
  postBlind(pub, bbId, blind)
  pub.currentBet = blind
  pub.minRaise = blind
  // las ciegas NO cuentan como "acted" (tienen opción de subir)

  // primer turno preflop: siguiente que PUEDE actuar después del BB
  // (heads-up eso da el botón/SB; 3+ da UTG). nextToAct saltea all-in/folded.
  pub.turnUserId = nextToAct(pub, bbId)
  pub.deadline = Date.now() + room.config.playTimeout * 1000

  await admin.from('game_state').upsert({
    room_id: room.id, status: 'betting', public: pub, hands, deck,
    private: { fullBoard }, updated_at: new Date().toISOString(),
  })
  await admin.from('rooms').update({ status: 'playing', hand_no: handNo }).eq('id', room.id)

  // si nadie puede apostar (ciegas dejaron a todos all-in), correr la mano ya
  const gs = { private: { fullBoard }, hands }
  if (!pub.turnUserId || streetClosed(pub)) {
    await advance(admin, room, gs, pub)
  }
  return { ok: true, handNo, blind }
}

function postBlind(pub: Pub, id: Id, amount: number) {
  const pay = Math.min(amount, pub.stacks[id])
  pub.stacks[id] -= pay
  pub.bets[id] = nz(pub.bets, id) + pay
  pub.committed[id] = nz(pub.committed, id) + pay
  if (pub.stacks[id] === 0) pub.allIn[id] = true
}

// ------------------------------------------------------------------ acción de jugador
async function act(admin: any, room: any, players: any[], uid: Id, body: any) {
  const { data: gs } = await admin.from('game_state').select('*').eq('room_id', room.id).single()
  if (!gs) throw new Error('mano no iniciada')
  const pub: Pub = gs.public
  if (pub.status !== 'betting') throw new Error('la mano no está en apuestas')
  if (pub.turnUserId !== uid) throw new Error('no es tu turno')

  try {
    applyAction(pub, uid, body.action, Number(body.amount) || 0)
    await advance(admin, room, gs, pub)
  } catch (e) {
    console.error('act error', body.action, (e as Error).stack || e)
    throw e
  }
  return { ok: true }
}

function applyAction(pub: Pub, uid: Id, action: string, amount: number) {
  const toCall = pub.currentBet - nz(pub.bets, uid)

  if (action === 'fold') {
    pub.folded[uid] = true
    pub.acted[uid] = true
    return
  }

  if (action === 'call' || action === 'check') {
    if (toCall <= 0) { pub.acted[uid] = true; return } // check
    const pay = Math.min(toCall, pub.stacks[uid])
    pub.stacks[uid] -= pay
    pub.bets[uid] = nz(pub.bets, uid) + pay
    pub.committed[uid] = nz(pub.committed, uid) + pay
    if (pub.stacks[uid] === 0) pub.allIn[uid] = true
    pub.acted[uid] = true
    return
  }

  if (action === 'raise' || action === 'bet' || action === 'allin') {
    let target: number
    if (action === 'allin') {
      target = nz(pub.bets, uid) + pub.stacks[uid]
    } else {
      target = amount // total al que quiere llevar SU apuesta esta calle
    }
    const maxTarget = nz(pub.bets, uid) + pub.stacks[uid]
    if (target > maxTarget) target = maxTarget
    const isAllIn = target === maxTarget

    const minTarget = pub.currentBet + pub.minRaise
    if (target < minTarget && !isAllIn) {
      throw new Error(`subida mínima a ${minTarget}`)
    }
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
      // subida completa: reabre la ronda
      pub.currentBet = target
      pub.minRaise = raiseSize
      pub.acted = { [uid]: true }
    } else {
      // all-in por menos: sube el tope pero no reabre para los que ya igualaron
      pub.currentBet = target
      pub.acted[uid] = true
    }
    return
  }

  throw new Error('acción inválida: ' + action)
}

// ------------------------------------------------------------------ avance de estado
async function advance(admin: any, room: any, gs: any, pub: Pub) {
  const timeoutMs = room.config.playTimeout * 1000

  // 1) todos menos uno foldearon -> gana el pozo
  if (activeIds(pub).length === 1) {
    return finishHand(admin, room, gs, pub, [activeIds(pub)[0]])
  }

  // 2) ronda de calle cerrada?
  if (streetClosed(pub)) {
    // mover apuestas al pozo
    for (const id of pub.order) {
      pub.pot += nz(pub.bets, id)
    }
    pub.bets = {}
    pub.acted = {}
    pub.currentBet = 0
    pub.minRaise = pub.blind

    // si <=1 puede actuar todavía -> correr hasta el river sin apuestas
    const noMoreBetting = canActIds(pub).length <= 1

    while (true) {
      if (pub.street === 'river') {
        return showdown(admin, room, gs, pub)
      }
      // revelar siguiente calle
      pub.street = pub.street === 'preflop' ? 'flop' : pub.street === 'flop' ? 'turn' : 'river'
      pub.board = gs.private.fullBoard.slice(0, pub.street === 'flop' ? 3 : pub.street === 'turn' ? 4 : 5)

      if (!noMoreBetting) {
        // primer turno postflop: primer activo a la izquierda del botón
        pub.turnUserId = firstAfterButton(pub)
        pub.deadline = Date.now() + timeoutMs
        return save(admin, room.id, pub, gs)
      }
      // sin apuestas: seguir revelando
    }
  }

  // 3) sigue la ronda: pasar turno
  pub.turnUserId = nextToAct(pub, pub.turnUserId!)
  pub.deadline = Date.now() + timeoutMs
  return save(admin, room.id, pub, gs)
}

// ------------------------------------------------------------------ showdown + side pots
async function showdown(admin: any, room: any, gs: any, pub: Pub) {
  const board = gs.private.fullBoard
  const contenders = activeIds(pub)

  // side pots por niveles de 'committed'
  const levels = [...new Set(Object.values(pub.committed).filter((v) => v > 0))].sort((a, b) => a - b)
  const payouts: Record<Id, number> = {}
  let prev = 0
  const potWinners = new Set<Id>()

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
    const best = Hand.winners(solved.map((s) => s.hand))
    const winIds = solved.filter((s) => best.includes(s.hand)).map((s) => s.id)
    winIds.forEach((w) => potWinners.add(w))

    const share = Math.floor(amount / winIds.length)
    let rem = amount - share * winIds.length
    // fichas sueltas: al primero a la izquierda del botón
    const rotated = [...pub.order.slice(pub.order.indexOf(pub.button) + 1), ...pub.order.slice(0, pub.order.indexOf(pub.button) + 1)]
    const oddOrder = rotated.filter((id) => winIds.includes(id))
    for (const id of winIds) payouts[id] = (payouts[id] ?? 0) + share
    for (let i = 0; rem > 0; i++, rem--) payouts[oddOrder[i % oddOrder.length]] += 1
  }

  const winnersArr = [...potWinners]
  let descr: string | null = null
  if (winnersArr.length) {
    const wh = Hand.solve([...gs.hands[winnersArr[0]], ...board])
    descr = esMano(wh)
    if (winnersArr.length === 1) {
      const k = kickerEs(wh)
      if (k) descr += ` (desempata con ${k})`
    }
  }

  // cartas ganadoras de cada jugador que llegó al showdown
  // pokersolver escribe el 10 como "10x"; el maso usa "Tx"
  const toCode = (c: any) => String(c.toString ? c.toString() : c).replace(/^10/, 'T')
  pub.reveal = contenders.map((id) => {
    const h = Hand.solve([...gs.hands[id], ...board])
    return {
      userId: id,
      cards: h.cards.map(toCode),
      mano: esMano(h),
    }
  })

  return finishHand(admin, room, gs, pub, winnersArr, payouts, descr)
}

// carta que rompe el empate (kicker), en español; '' si no aplica
function kickerEs(hand: any): string {
  if (!['Pair', 'Two Pair', 'Three of a Kind', 'High Card'].includes(hand.name)) return ''
  const val = (v: string) => (({ T: 10, J: 11, Q: 12, K: 13, A: 14 } as any)[v] ?? Number(v))
  const RN: Record<number, string> = {
    14: 'el as', 13: 'el rey', 12: 'la reina', 11: 'la jota', 10: 'el 10',
    9: 'el 9', 8: 'el 8', 7: 'el 7', 6: 'el 6', 5: 'el 5', 4: 'el 4', 3: 'el 3', 2: 'el 2',
  }
  const counts: Record<string, number> = {}
  for (const c of hand.cards) counts[c.value] = (counts[c.value] ?? 0) + 1
  const paired = new Set(Object.keys(counts).filter((v) => counts[v] >= 2))
  const kickers = hand.cards
    .filter((c: any) => !paired.has(c.value))
    .sort((a: any, b: any) => val(b.value) - val(a.value))
  if (!kickers.length) return ''
  return RN[val(kickers[0].value)] ?? ''
}

// nombre de la jugada en español (traduce el `descr` de pokersolver)
function esMano(hand: any): string {
  const d = String(hand?.descr ?? hand?.name ?? '')
  const RN: Record<string, string> = {
    A: 'as', K: 'rey', Q: 'reina', J: 'jota', T: '10', '10': '10',
    '9': '9', '8': '8', '7': '7', '6': '6', '5': '5', '4': '4', '3': '3', '2': '2',
  }
  const rk = (s: string) => RN[(s || '').toUpperCase()] ?? s
  let m: RegExpMatchArray | null

  if (/royal flush/i.test(d)) return 'Escalera real'
  if ((m = d.match(/straight flush,\s*(\w+)/i))) return `Escalera de color al ${rk(m[1])}`
  if ((m = d.match(/four of a kind,\s*(\w+)'?s?/i))) return `Póker de ${rk(m[1])}`
  if ((m = d.match(/full house,\s*(\w+)'?s?\s*over\s*(\w+)'?s?/i))) return `Full: ${rk(m[1])} lleno de ${rk(m[2])}`
  if ((m = d.match(/flush,\s*(\w)/i))) return `Color al ${rk(m[1])}`
  if ((m = d.match(/straight,\s*(\w+)/i))) return `Escalera al ${rk(m[1])}`
  if ((m = d.match(/three of a kind,\s*(\w+)'?s?/i))) return `Trío de ${rk(m[1])}`
  if ((m = d.match(/two pair,\s*(\w+)'?s?\s*&\s*(\w+)'?s?/i))) return `Doble par: ${rk(m[1])} y ${rk(m[2])}`
  if ((m = d.match(/pair,\s*(\w+)'?s?/i))) return `Par de ${rk(m[1])}`
  if ((m = d.match(/high card,\s*(\w+)/i))) return `Carta alta: ${rk(m[1])}`
  return d
}

// ------------------------------------------------------------------ cerrar mano
async function finishHand(
  admin: any, room: any, gs: any, pub: Pub,
  winners: Id[], payouts?: Record<Id, number>, descr?: string | null,
) {
  // pozo total pendiente (calle actual + pot acumulado)
  for (const id of pub.order) pub.pot += nz(pub.bets, id)
  pub.bets = {}

  if (!payouts) {
    // gana uno solo por fold: se lleva todo el pozo
    payouts = { [winners[0]]: pub.pot }
  }

  // aplicar a stacks
  for (const [id, amt] of Object.entries(payouts)) {
    pub.stacks[id] = nz(pub.stacks, id) + amt
  }

  // delta de la mano = lo que se lleva - lo que puso
  pub.results = pub.order.map((id) => ({
    userId: id,
    delta: (payouts![id] ?? 0) - nz(pub.committed, id),
  }))

  pub.status = 'hand_over'
  pub.turnUserId = null
  pub.winners = winners
  pub.showdownDescr = descr ?? pub.showdownDescr
  pub.deadline = 0

  // persistir stacks en players
  for (const id of pub.order) {
    await admin.from('players').update({ stack: pub.stacks[id] }).eq('room_id', room.id).eq('user_id', id)
  }

  // ¿alguien se quedó sin fichas y solo queda 1 con fichas? -> torneo terminado
  const withChips = pub.order.filter((id) => pub.stacks[id] > 0)
  if (withChips.length <= 1) {
    await admin.from('rooms').update({ status: 'done' }).eq('id', room.id)
  }

  return save(admin, room.id, pub, gs)
}

async function save(admin: any, roomId: string, pub: Pub, gs: any) {
  await admin.from('game_state').update({
    status: pub.status, public: pub, updated_at: new Date().toISOString(),
  }).eq('room_id', roomId)
  return { ok: true }
}

// ------------------------------------------------------------------ timeout de jugada
async function handleTimeout(admin: any, room: any, players: any[]) {
  const { data: gs } = await admin.from('game_state').select('*').eq('room_id', room.id).single()
  if (!gs) throw new Error('sin mano')
  const pub: Pub = gs.public
  if (pub.status !== 'betting' || !pub.turnUserId) throw new Error('nada que expirar')
  if (Date.now() < pub.deadline) throw new Error('todavía no venció')

  const uid = pub.turnUserId
  const toCall = pub.currentBet - nz(pub.bets, uid)
  applyAction(pub, uid, toCall > 0 ? 'fold' : 'check', 0)
  await advance(admin, room, gs, pub)
  return { ok: true, timedOut: uid }
}
