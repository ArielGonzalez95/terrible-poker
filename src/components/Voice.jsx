import { useEffect, useRef, useState } from 'react'
import { toast } from '../lib/toast.js'

const MAX_SECS = 30
// wav vacío: sirve para "desbloquear" el <audio> en iOS con el primer toque
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']
  for (const t of opts) {
    if (window.MediaRecorder?.isTypeSupported?.(t)) return t
  }
  return ''
}

// reproduce solos, en orden, los audios nuevos de los demás (sin abrir ningún chat)
// devuelve el user_id de quien está sonando ahora (para marcar su asiento)
export function useVoicePlayer(messages, me, voiceUrl) {
  const [speaking, setSpeaking] = useState(null)
  const audioRef = useRef(null)
  const queueRef = useRef([])
  const playingRef = useRef(false)
  const seenRef = useRef(null)

  if (!audioRef.current && typeof Audio !== 'undefined') audioRef.current = new Audio()

  // iOS/Chrome solo dejan reproducir después de un gesto: desbloquear con el primer toque
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const unlock = () => {
      if (playingRef.current) return
      a.src = SILENT
      a.play().catch(() => {})
      window.removeEventListener('pointerdown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  useEffect(() => {
    const a = audioRef.current
    if (!a || !me) return
    // historial (lo mandado antes de entrar) no se reproduce
    if (seenRef.current === null) seenRef.current = { ids: new Set(), since: Date.now() - 15_000 }
    const seen = seenRef.current
    for (const m of messages) {
      if (seen.ids.has(m.id)) continue
      seen.ids.add(m.id)
      const fresh = new Date(m.created_at).getTime() > seen.since
      if (m.audio_path && m.user_id !== me && fresh) queueRef.current.push(m)
    }
    const next = () => {
      const m = queueRef.current.shift()
      if (!m) { playingRef.current = false; setSpeaking(null); return }
      playingRef.current = true
      setSpeaking(m.user_id)
      a.onended = next
      a.onerror = next
      a.src = voiceUrl(m.audio_path)
      a.play().catch(() => {
        toast(`🔊 ${m.name} mandó un audio (tocá la pantalla para activar el sonido)`)
        next()
      })
    }
    if (!playingRef.current) next()
  }, [messages, me, voiceUrl])

  useEffect(() => () => { audioRef.current?.pause() }, [])

  return speaking
}

// botón de mic: un toque graba, otro toque envía (no tapa la mesa ni frena tu jugada)
export function VoiceButton({ myName, onSendVoice, className = '' }) {
  const [rec, setRec] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [sending, setSending] = useState(false)
  const mrRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const cancelRef = useRef(false)

  useEffect(() => () => {
    clearInterval(timerRef.current)
    cancelRef.current = true
    if (mrRef.current?.state === 'recording') mrRef.current.stop()
  }, [])

  function stop(cancel = false) {
    clearInterval(timerRef.current)
    cancelRef.current = cancel
    if (mrRef.current && mrRef.current.state !== 'inactive') mrRef.current.stop()
    setRec(false)
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast('Micrófono no disponible (necesita HTTPS en el celu)', 'error')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickMime()
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      cancelRef.current = false
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (cancelRef.current) return
        const type = mr.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        const ext = type.includes('mp4') || type.includes('aac') ? 'mp4' : 'webm'
        if (blob.size < 800) return
        setSending(true)
        try { await onSendVoice(blob, myName, ext) }
        catch (err) { toast('No se pudo enviar: ' + (err.message || err), 'error') }
        finally { setSending(false) }
      }
      mrRef.current = mr
      mr.start()
      setRec(true)
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed((s) => {
          if (s + 1 >= MAX_SECS) stop()
          return s + 1
        })
      }, 1000)
    } catch {
      toast('No se pudo acceder al micrófono (necesita HTTPS y permiso)', 'error')
    }
  }

  return (
    <div className={`voice ${rec ? 'rec' : ''} ${className}`}>
      {rec && (
        <button className="voice-cancel" onClick={() => stop(true)} aria-label="Cancelar audio">✕</button>
      )}
      <button
        className="voice-btn"
        onClick={() => (rec ? stop() : start())}
        disabled={sending}
        aria-label={rec ? 'Enviar audio' : 'Grabar audio'}
      >
        {rec ? <span className="voice-time">0:{String(elapsed).padStart(2, '0')}</span> : sending ? '…' : '🎤'}
      </button>
      {rec && <span className="voice-hint">Tocá para enviar</span>}
    </div>
  )
}
