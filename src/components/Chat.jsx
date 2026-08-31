import { useEffect, useRef, useState } from 'react'
import { toast } from '../lib/toast.js'

function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']
  for (const t of opts) {
    if (window.MediaRecorder?.isTypeSupported?.(t)) return t
  }
  return ''
}

export default function Chat({ messages, me, myName, onSend, onSendVoice, voiceUrl }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [seen, setSeen] = useState(0)
  const [rec, setRec] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const listRef = useRef(null)
  const mrRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const unread = open ? 0 : Math.max(0, messages.length - seen)

  useEffect(() => {
    if (open) {
      setSeen(messages.length)
      listRef.current?.scrollTo(0, listRef.current.scrollHeight)
    }
  }, [messages.length, open])

  function send(e) {
    e.preventDefault()
    if (!text.trim()) return
    onSend(text, myName)
    setText('')
  }

  async function startRec() {
    if (rec || !navigator.mediaDevices?.getUserMedia) {
      if (!navigator.mediaDevices?.getUserMedia) toast('Micrófono no disponible (necesita HTTPS en el celu)', 'error')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickMime()
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const type = mr.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        const ext = type.includes('mp4') || type.includes('aac') ? 'mp4' : 'webm'
        if (blob.size > 800) {
          try { await onSendVoice(blob, myName, ext) }
          catch (err) { toast('No se pudo enviar: ' + (err.message || err), 'error') }
        }
      }
      mrRef.current = mr
      mr.start()
      setRec(true)
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed((s) => {
          if (s >= 59) stopRec()
          return s + 1
        })
      }, 1000)
    } catch {
      toast('No se pudo acceder al micrófono (necesita HTTPS y permiso)', 'error')
    }
  }

  function stopRec() {
    clearInterval(timerRef.current)
    if (mrRef.current && mrRef.current.state !== 'inactive') mrRef.current.stop()
    setRec(false)
  }

  return (
    <>
      <button className="chat-fab" onClick={() => setOpen((o) => !o)}>
        {open ? '✕' : '💬'}
        {unread > 0 && <span className="chat-badge">{unread}</span>}
      </button>

      {open && (
        <div className="chat-panel">
          <div className="chat-list" ref={listRef}>
            {messages.length === 0 && <p className="chat-empty">Sin mensajes todavía</p>}
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg ${m.user_id === me ? 'mine' : ''}`}>
                <span className="chat-who">{m.user_id === me ? 'Vos' : m.name}</span>
                {m.audio_path
                  ? <audio className="chat-audio" controls preload="none" src={voiceUrl(m.audio_path)} />
                  : <span className="chat-text">{m.text}</span>}
              </div>
            ))}
          </div>

          <form className="chat-input" onSubmit={send}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={rec ? `Grabando… 0:${String(elapsed).padStart(2, '0')}` : 'Escribí…'}
              maxLength={300}
              disabled={rec}
            />
            <button
              type="button"
              className={`chat-mic ${rec ? 'recording' : ''}`}
              onPointerDown={startRec}
              onPointerUp={stopRec}
              onPointerLeave={stopRec}
              onContextMenu={(e) => e.preventDefault()}
            >
              {rec ? '⏺' : '🎤'}
            </button>
            <button type="submit" disabled={rec}>Enviar</button>
          </form>
          {rec && <div className="chat-rec-hint">Soltá para enviar</div>}
        </div>
      )}
    </>
  )
}
