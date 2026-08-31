// pila de fichas en perspectiva (montón), sin números
// variant: 'pot' | 'bet' | 'stack'
const CFG = {
  pot: { w: 34, cap: 12, step: 12, rise: 4, cols: 3, gap: 0.62 },
  bet: { w: 26, cap: 10, step: 8, rise: 4, cols: 1, gap: 0.6 },
  stack: { w: 20, cap: 10, step: 16, rise: 3.5, cols: 2, gap: 0.55 },
}

const COL_BASE = [4, 0, 2, 1] // desnivel entre columnas para que parezca montón

export default function Chips({ amount, variant = 'bet' }) {
  const amt = Math.round(amount || 0)
  if (amt <= 0) return null
  const c = CFG[variant] || CFG.bet
  const total = Math.max(1, Math.min(c.cap * c.cols, Math.round(amt / c.step)))

  const cols = Array.from({ length: c.cols }, () => 0)
  for (let i = 0; i < total; i++) cols[i % c.cols] += 1
  const maxPer = Math.max(...cols)
  const faceH = c.w * 0.42
  const h = faceH + 6 + (maxPer - 1) * c.rise + 6
  const width = c.w + (c.cols - 1) * c.w * c.gap

  return (
    <div className={`chips2 ${variant}`} style={{ width, height: h }}>
      {cols.map((count, ci) => (
        <div
          key={ci}
          className="chip-col"
          style={{ left: ci * c.w * c.gap, bottom: COL_BASE[ci] || 0, width: c.w, height: h }}
        >
          {Array.from({ length: count }).map((_, i) => (
            <span
              key={i}
              className="chip2"
              style={{ width: c.w, height: faceH, bottom: i * c.rise }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
