// mini toaster: alert() no anda bien en mobile/PWA
let listeners = []

export function toast(msg, type = 'info') {
  const t = { id: Date.now() + Math.random(), msg: String(msg), type }
  listeners.forEach((l) => l(t))
}

export function onToast(fn) {
  listeners.push(fn)
  return () => { listeners = listeners.filter((x) => x !== fn) }
}
