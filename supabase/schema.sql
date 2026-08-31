-- ============ Poker Argento - schema ============
-- correr en Supabase SQL editor

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  config jsonb not null,          -- {buyin, playTimeout, startBlind, handsPerBlindUp}
  status text not null default 'lobby',  -- lobby | playing | done
  hand_no int not null default 0,
  created_at timestamptz default now()
);

create table if not exists players (
  room_id uuid references rooms(id) on delete cascade,
  user_id uuid not null,          -- auth.uid() anonimo
  name text not null,
  seat int,
  stack numeric not null default 0,
  joined_at timestamptz default now(),
  primary key (room_id, user_id)
);

-- estado del juego. 'hands' NO se expone al cliente salvo lo propio (ver policy)
create table if not exists game_state (
  room_id uuid primary key references rooms(id) on delete cascade,
  status text not null,           -- betting | showdown | hand_over
  public jsonb not null default '{}',   -- pot, board, bets, turnUserId, folded, blind, winners...
  hands jsonb not null default '{}',    -- {userId: [c,c]}  <-- filtrar en RPC/función
  deck jsonb not null default '[]',     -- cartas sin repartir (server-only)
  private jsonb not null default '{}',  -- {fullBoard:[5]} server-only
  updated_at timestamptz default now()
);

alter table rooms enable row level security;
alter table players enable row level security;
alter table game_state enable row level security;

-- rooms: cualquiera autenticado lee/crea (juego ocasional)
create policy rooms_read on rooms for select using (true);
create policy rooms_insert on rooms for insert with check (true);
create policy rooms_update on rooms for update using (true);

-- players: lee todos los de la sala, se inserta/edita solo a si mismo
create policy players_read on players for select using (true);
create policy players_write on players for insert with check (auth.uid() = user_id);
create policy players_update on players for update using (auth.uid() = user_id);

-- game_state: escritura solo service_role (edge fn).
-- OJO: esta policy deja leer la tabla cruda (incl. 'hands' de otros). Para MVP sirve.
-- Endurecer: quitar select, y que la edge fn haga broadcast por realtime channel,
-- o guardar cada mano en fila propia con policy auth.uid()=user_id.
create policy gs_read on game_state for select using (true);

-- vista que oculta cartas ajenas (usar esta para leer):
create or replace view game_view as
  select room_id, status, public,
         jsonb_build_object(auth.uid()::text, hands -> auth.uid()::text) as hands,
         updated_at
  from game_state;

-- ============ chat ============
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  user_id uuid not null,
  name text not null,
  text text not null default '',
  audio_path text,                    -- ruta en Storage bucket 'voces' (nota de voz)
  created_at timestamptz default now()
);
create index if not exists messages_room_idx on messages(room_id, created_at);

alter table messages enable row level security;
create policy msg_read on messages for select using (true);
create policy msg_write on messages for insert with check (
  auth.uid() = user_id
  and (char_length(text) between 1 and 300 or audio_path is not null)
);

-- ============ Storage: bucket 'voces' para notas de voz ============
-- crear el bucket PÚBLICO desde el dashboard (Storage > New bucket > name: voces, Public)
-- luego estas policies:
create policy voces_read on storage.objects for select using (bucket_id = 'voces');
create policy voces_write on storage.objects for insert to authenticated
  with check (bucket_id = 'voces');

-- realtime
alter publication supabase_realtime add table rooms, players, game_state, messages;
