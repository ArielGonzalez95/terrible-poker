import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, ensureSession } from '../lib/supabase.js'

// suscribe a room + players + game_state + chat por realtime, con refetch manual
export function useRoom(code) {
  const [room, setRoom] = useState(null)
  const [players, setPlayers] = useState([])
  const [state, setState] = useState(null)
  const [messages, setMessages] = useState([])
  const [me, setMe] = useState(null)
  const [err, setErr] = useState('')
  const [reactions, setReactions] = useState({})
  const roomIdRef = useRef(null)
  const aliveRef = useRef(true)
  const reactChanRef = useRef(null)

  const refetch = useCallback(async () => {
    const roomId = roomIdRef.current
    if (!roomId) return
    const { data: pl } = await supabase.from('players')
      .select('*').eq('room_id', roomId).order('joined_at', { ascending: true })
    if (aliveRef.current && pl) setPlayers(pl)
    const { data: gs } = await supabase.from('game_state')
      .select('*').eq('room_id', roomId).maybeSingle()
    if (aliveRef.current) setState(gs || null)
  }, [])

  const loadMessages = useCallback(async () => {
    const roomId = roomIdRef.current
    if (!roomId) return
    const { data } = await supabase.from('messages')
      .select('*').eq('room_id', roomId).order('created_at', { ascending: true }).limit(80)
    if (aliveRef.current && data) setMessages(data)
  }, [])

  const sendMessage = useCallback(async (text, name) => {
    const roomId = roomIdRef.current
    const t = text.trim().slice(0, 300)
    if (!roomId || !t) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('messages').insert({ room_id: roomId, user_id: user.id, name, text: t })
  }, [])

  const sendVoice = useCallback(async (blob, name, ext) => {
    const roomId = roomIdRef.current
    if (!roomId || !blob) return
    const { data: { user } } = await supabase.auth.getUser()
    const path = `${roomId}/${crypto.randomUUID()}.${ext || 'webm'}`
    const { error } = await supabase.storage.from('voces').upload(path, blob, {
      contentType: blob.type || 'audio/webm',
      upsert: false,
    })
    if (error) throw error
    await supabase.from('messages').insert({ room_id: roomId, user_id: user.id, name, audio_path: path })
  }, [])

  // reacciones efímeras (caras) por broadcast, sin tocar la DB
  const showReaction = useCallback((userId, key) => {
    const at = Date.now()
    setReactions((r) => ({ ...r, [userId]: { key, at } }))
    setTimeout(() => {
      setReactions((r) => (r[userId]?.at === at ? (({ [userId]: _, ...rest }) => rest)(r) : r))
    }, 3200)
  }, [])

  const sendReaction = useCallback(async (key) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    showReaction(user.id, key)
    reactChanRef.current?.send({ type: 'broadcast', event: 'react', payload: { userId: user.id, key } })
  }, [showReaction])

  const voiceUrl = useCallback((path) => {
    return supabase.storage.from('voces').getPublicUrl(path).data.publicUrl
  }, [])

  useEffect(() => {
    aliveRef.current = true
    let chan
    let reactChan
    let cancelled = false
    ;(async () => {
      try {
        const s = await ensureSession()
        if (aliveRef.current) setMe(s.user.id)
        const { data: r, error } = await supabase
          .from('rooms').select('*').eq('code', code.toUpperCase()).single()
        if (error) throw new Error('Sala no encontrada')
        if (!aliveRef.current) return
        roomIdRef.current = r.id
        setRoom(r)
        await refetch()
        await loadMessages()

        chan = supabase.channel(`room:${r.id}:${Math.random().toString(36).slice(2)}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${r.id}` }, refetch)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${r.id}` }, (p) => setRoom(p.new))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: `room_id=eq.${r.id}` }, refetch)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${r.id}` }, (p) => {
            setMessages((m) => (m.some((x) => x.id === p.new.id) ? m : [...m, p.new].slice(-80)))
          })
          .subscribe()

        // topic compartido por sala (el de arriba es único por cliente, no sirve para broadcast)
        if (!cancelled) {
          reactChan = supabase.channel(`react:${r.id}`, { config: { broadcast: { self: false } } })
            .on('broadcast', { event: 'react' }, ({ payload }) => {
              if (payload?.userId && payload?.key) showReaction(payload.userId, payload.key)
            })
            .subscribe()
          reactChanRef.current = reactChan
        }
      } catch (e) { if (aliveRef.current) setErr(String(e.message || e)) }
    })()

    // fallback: si realtime falla, refrescar cada 3s
    const poll = setInterval(() => { refetch(); loadMessages() }, 3000)

    return () => {
      aliveRef.current = false
      cancelled = true
      clearInterval(poll)
      if (chan) supabase.removeChannel(chan)
      if (reactChan) supabase.removeChannel(reactChan)
      if (reactChanRef.current === reactChan) reactChanRef.current = null
    }
  }, [code, refetch, loadMessages, showReaction])

  return { room, players, state, messages, me, err, refetch, sendMessage, sendVoice, voiceUrl, reactions, sendReaction }
}
