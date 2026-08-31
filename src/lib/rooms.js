import { supabase, ensureSession } from './supabase.js'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function genCode(n = 5) {
  let s = ''
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return s
}

// config: { buyin, playTimeout, startBlind, handsPerBlindUp }
export async function createRoom(config, hostName) {
  await ensureSession()
  const code = genCode()
  const { data: room, error } = await supabase
    .from('rooms')
    .insert({ code, config, status: 'lobby' })
    .select()
    .single()
  if (error) throw error
  await joinRoom(code, hostName)
  return room
}

export async function joinRoom(code, name) {
  await ensureSession()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No se pudo iniciar sesión (activá Anonymous sign-ins en Supabase)')

  const { data: room, error } = await supabase
    .from('rooms').select('*').eq('code', code.toUpperCase()).single()
  if (error) throw new Error('Sala no encontrada')

  // ¿ya estoy en la sala? entonces no re-inserto (no piso mi stack)
  const { data: mine } = await supabase.from('players')
    .select('user_id').eq('room_id', room.id).eq('user_id', user.id).maybeSingle()
  if (mine) return room

  const { count } = await supabase.from('players')
    .select('user_id', { count: 'exact', head: true }).eq('room_id', room.id)
  if ((count ?? 0) >= 4) throw new Error('Sala llena (4/4)')
  if (room.status !== 'lobby') throw new Error('La partida ya empezó')

  const { error: e2 } = await supabase.from('players').insert({
    room_id: room.id,
    user_id: user.id,
    name,
    stack: room.config.buyin,
  })
  if (e2) throw e2
  return room
}

export function roomUrl(code) {
  return `${location.origin}/sala/${code}`
}

export function waLink(code) {
  const text = `Te invito a jugar al poker. Entrá a la sala ${code}: ${roomUrl(code)}`
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

export async function invokeGame(op, payload) {
  const { data, error } = await supabase.functions.invoke('game', {
    body: { op, ...payload },
  })
  if (error) {
    // extraer el mensaje real del body de la Edge Function
    let msg = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) msg = body.error
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}
