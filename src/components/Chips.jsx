// pila de fichas de colores por denominación + monto en píldora
const DENOMS = [
  [5000, 'maroon'],
  [1000, 'yellow'],
  [500, 'purple'],
  [100, 'black'],
  [25, 'green'],
  [5, 'red'],
  [1, 'white'],
]

const MAX_COLS = 6
const MAX_PER_COL = 5

export const fmt = (n) => Math.round(n || 0).toLocaleString('en-US')

function breakdown(amount) {
  let left = Math.round(amount)
  const cols = []
  for (const [v, color] of DENOMS) {
    const n = Math.floor(left / v)
    if (n > 0) {
      cols.push({ color, count: Math.min(MAX_PER_COL, n) })
      left -= n * v
    }
  }
  return cols.slice(0, MAX_COLS)
}

export default function Chips({ amount, label = true }) {
  const amt = Math.round(amount || 0)
  if (amt <= 0) return null
  const cols = breakdown(amt)
  return (
    <div className="gg-chips">
      <div className="gg-chip-row">
        {cols.map((col, ci) => (
          <span key={ci} className="gg-chip-col" style={{ height: 18 + (col.count - 1) * 3 }}>
            {Array.from({ length: col.count }).map((_, i) => (
              <i key={i} className={`gg-chip ${col.color}`} style={{ bottom: i * 3 }} />
            ))}
          </span>
        ))}
      </div>
      {label && <span className="gg-amt">{fmt(amt)}</span>}
    </div>
  )
}
