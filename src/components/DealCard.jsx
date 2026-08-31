import { useLayoutEffect, useRef, useState } from 'react'

// envuelve una carta y la anima desde `originRef` (el maso) hasta su lugar final
export default function DealCard({ originRef, delay = 0, children }) {
  const ref = useRef(null)
  const [style, setStyle] = useState({ opacity: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    const org = originRef?.current
    if (!el || !org) { setStyle({}); return }
    const a = el.getBoundingClientRect()
    const b = org.getBoundingClientRect()
    setStyle({
      '--dx': `${b.left + b.width / 2 - (a.left + a.width / 2)}px`,
      '--dy': `${b.top + b.height / 2 - (a.top + a.height / 2)}px`,
      animationDelay: `${delay}ms`,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ready = style['--dx'] !== undefined
  return (
    <span ref={ref} className={`deal-card ${ready ? 'go' : ''}`} style={style}>
      {children}
    </span>
  )
}
