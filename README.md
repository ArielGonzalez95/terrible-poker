# Terrible Poker 🇦🇷

App web mobile (PWA) para jugar poker Texas Hold'em de 2 a 4 personas. Invitación por WhatsApp.
React + Vite + Supabase. Sin login (auth anónima). Plata solo tracking, sin pagos.

## Stack
- **React 18 + Vite 5** — bundle liviano
- **react-router-dom** — links de sala `/sala/:code`
- **Supabase** — Postgres, Realtime, Auth anónima, Edge Functions (motor de poker)
- **pokersolver** — evaluación de manos (mejor 5 de 7)
- **vite-plugin-pwa** — instalable en iPhone / Galaxy S25 Ultra

## Setup
1. `npm install`
2. Crear proyecto en supabase.com. Habilitar **Anonymous sign-ins** (Auth > Providers).
3. Correr `supabase/schema.sql` en el SQL editor.
4. `cp .env.example .env` y completar `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
5. Deploy edge function:
   ```
   npx supabase functions deploy game
   npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
   ```
6. `npm run dev` — abrir en el celu (misma red, usa el host que muestra Vite).

## Flujo
- **Home**: nombre + crear sala (buy-in, tiempo de jugada, ciega inicial, manos por suba x2) o entrar con código.
- **Lobby**: lista de jugadores en tiempo real, botón "Invitar por WhatsApp", el anfitrión arranca.
- **Mesa**: felt ovalado, vos siempre abajo-centro, rivales rotados. Board, pozo, fichas, controles fold/call/raise.

## Config de sala
| campo | opciones |
|---|---|
| buy-in (USD) | 50 / 100 / 200 / 500 |
| tiempo por jugada | 15–60 s |
| ciega inicial (USD) | 5 / 10 / 20 / 50 / 100 |
| suba de ciega x2 | cada 5–20 manos |

## Estado / TODO
Funciona: sala + realtime + mesa + **motor de apuestas completo** en `supabase/functions/game/index.ts`:
Texas Hold'em 2-4, ciegas SB/BB, botón que rota, fold/check/call/raise/all-in, avance de
calles (preflop→flop→turn→river), opción de BB, subida mínima, **side pots**, evaluación con
pokersolver, reparto del pozo (fichas sueltas al primero tras el botón), suba de ciega x2,
timeout de jugada (auto check/fold, cualquier cliente lo dispara), fin de torneo cuando queda 1 con fichas.

**Falta / endurecer**:
- [ ] **Seguridad cartas**: `game_state` es legible crudo por RLS → un jugador vivo puede leer `hands`/`deck`/`private` ajenos. Endurecer: quitar `select` de `game_state`, leer solo `game_view`, y que la edge fn haga broadcast del estado público por Realtime channel. O fila por mano con `auth.uid() = user_id`.
- [ ] Reconexión / jugador que abandona a mitad de mano (hoy: su turno lo resuelve el timeout).
- [ ] Concurrencia: dos `act` casi simultáneos podrían pisarse. Agregar lock optimista (columna `version` + `update ... where version = x`).
- [ ] Íconos PWA y dorso de carta real (escudo AFA / copa).
- [ ] Liquidación final (quién le debe a quién) al terminar el torneo.
- [ ] Tests del motor (simulación de manos completas).

## Layout de asientos
`src/screens/Table.jsx` → `SLOTS`: reordena `players` para que el usuario actual quede en índice 0 = asiento `bottom`.
