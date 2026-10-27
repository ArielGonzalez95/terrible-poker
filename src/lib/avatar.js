// avatar fijo por jugador (mismo id = mismo animal en mesa y sala)
const AVATARS = ['🐱', '🦊', '🐻', '🐼', '🦁', '🐯', '🐸', '🐵', '🐙', '🦉', '🐶', '🐨', '🦄', '🐧']
export function avatarOf(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATARS[h % AVATARS.length]
}
