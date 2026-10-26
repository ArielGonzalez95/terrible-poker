// naipe dibujado en CSS, estilo mesa online: índice grande arriba-izq + palo grande abajo-der
// code = rango+palo, ej "Ah", "Td", "Ks". size: 'board' | 'hole' | 'seat' | 'sm'
const SUITS = { s: '♠', h: '♥', d: '♦', c: '♣' }

export function norm(code) {
  if (!code) return null
  let s = String(code).trim()
  s = s.replace(/^10/, 'T') // pokersolver escribe "10h"
  if (s.length < 2) return null
  const rank = s[0].toUpperCase()
  const suit = s[s.length - 1].toLowerCase()
  if (!'23456789TJQKA'.includes(rank) || !'shdc'.includes(suit)) return null
  return rank + suit
}

export const rankLabel = (r) => (r === 'T' ? '10' : r)
export const suitSym = (s) => SUITS[s] || ''

// flip: llega boca abajo y se da vuelta (flipDelay ms después de montarse)
export default function Card({ code, hidden, small, size, animate, dim, flip, flipDelay = 0 }) {
  const c = hidden ? null : norm(code)
  const sz = size || (small ? 'sm' : 'board')
  if (!c) return <div className={`pc back ${sz}`} />
  if (flip) {
    return (
      <div className={`pc-flip ${sz}`} style={{ '--flip-delay': `${flipDelay}ms` }}>
        <div className="pc-flip-inner">
          <Card code={code} size={sz} dim={dim} />
          <div className={`pc back ${sz} pc-flip-back`} />
        </div>
      </div>
    )
  }
  const [r, s] = c
  const cls = [
    'pc', sz,
    s === 'h' || s === 'd' ? 'red' : '',
    r === 'T' ? 'ten' : '',
    animate ? 'flip-in' : '',
    dim ? 'dim' : '',
  ].join(' ')
  return (
    <div className={cls}>
      <span className="pc-r">{rankLabel(r)}</span>
      <span className="pc-s">{SUITS[s]}</span>
      <span className="pc-big">{SUITS[s]}</span>
    </div>
  )
}
