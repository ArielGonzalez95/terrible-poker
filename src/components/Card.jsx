// naipes SVG (Tek Eye, dominio público). code = rango+palo, ej "Ah", "Td", "Ks"
const BACK = '/cards/_back.svg'

function norm(code) {
  if (!code) return null
  let s = String(code).trim()
  s = s.replace(/^10/, 'T') // pokersolver escribe "10h"
  if (s.length < 2) return null
  const rank = s[0].toUpperCase()
  const suit = s[s.length - 1].toLowerCase()
  if (!'23456789TJQKA'.includes(rank) || !'shdc'.includes(suit)) return null
  return rank + suit
}

export default function Card({ code, hidden, small, animate, dim }) {
  const c = hidden ? null : norm(code)
  const src = c ? `/cards/${c}.svg` : BACK
  const cls = [
    'card-img',
    small ? 'sm' : '',
    animate ? 'flip-in' : '',
    dim ? 'dim' : '',
  ].join(' ')
  return (
    <img
      className={cls}
      src={src}
      alt=""
      draggable="false"
      onError={(e) => { if (e.currentTarget.src.indexOf('_back') === -1) e.currentTarget.src = BACK }}
    />
  )
}
