import { useEffect, useState } from 'react'
import { onToast } from '../lib/toast.js'

export default function Toaster() {
  const [items, setItems] = useState([])

  useEffect(() => {
    return onToast((t) => {
      setItems((xs) => [...xs, t])
      setTimeout(() => {
        setItems((xs) => xs.filter((x) => x.id !== t.id))
      }, 3800)
    })
  }, [])

  if (!items.length) return null
  return (
    <div className="toaster">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.type}`}
          onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}
