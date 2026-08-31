import { Hand } from 'pokersolver'

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A']
const SUITS = ['s','h','d','c'] // spades hearts diamonds clubs

export function freshDeck() {
  const d = []
  for (const r of RANKS) for (const s of SUITS) d.push(r + s)
  return d
}

// Fisher-Yates. Pasar rng para reproducibilidad server-side.
export function shuffle(deck, rng = Math.random) {
  const a = deck.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// reparte: {hands: {playerId: [c,c]}, board: [5], deck restante}
export function deal(deck, playerIds) {
  const d = deck.slice()
  const hands = {}
  for (const id of playerIds) hands[id] = []
  for (let round = 0; round < 2; round++)
    for (const id of playerIds) hands[id].push(d.shift())
  d.shift() // burn
  const flop = [d.shift(), d.shift(), d.shift()]
  d.shift() // burn
  const turn = d.shift()
  d.shift() // burn
  const river = d.shift()
  return { hands, board: [...flop, turn, river], deck: d }
}

// ganador(es) entre jugadores activos (no foldeados)
export function winners(hands, board, activeIds) {
  const solved = activeIds.map(id => ({
    id,
    hand: Hand.solve([...hands[id], ...board])
  }))
  const best = Hand.winners(solved.map(s => s.hand))
  return solved.filter(s => best.includes(s.hand)).map(s => s.id)
}

export function describe(cards) {
  return Hand.solve(cards).descr
}

// mejor mano de 5 cartas + nombre, con códigos en formato del maso ("Th" no "10h")
export function bestHand(holeCards, board) {
  const h = Hand.solve([...holeCards, ...board])
  return {
    cards: h.cards.map((c) => c.toString().replace(/^10/, 'T')),
    name: h.name,
    descr: h.descr,
    mano: manoEs(h.descr),
  }
}

const RN = {
  A: 'as', K: 'rey', Q: 'reina', J: 'jota', T: '10', 10: '10',
  9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
}
const rk = (s) => RN[(s || '').toUpperCase()] ?? s

export function manoEs(descr) {
  const d = String(descr || '')
  let m
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
