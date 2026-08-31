import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true }
})

// login anonimo: 1 sesion por dispositivo
export async function ensureSession() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) return session
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return data.session
}

export function myId() {
  return supabase.auth.getUser().then(r => r.data.user?.id)
}
