// keep-alive: Supabase free pausa el proyecto tras ~7 días sin actividad.
// Vercel Cron llama esto 1 vez por día (ver vercel.json) y hace una consulta liviana.
export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return res.status(500).json({ ok: false, error: 'faltan env vars de Supabase' })
  try {
    const r = await fetch(`${url}/rest/v1/standings?select=name&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, at: new Date().toISOString() })
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e) })
  }
}
