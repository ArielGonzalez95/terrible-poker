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

-- ============ tabla de posiciones (torneos ganados por nombre) ============
create table if not exists standings (
  name text primary key,
  wins int not null default 0,
  last_win timestamptz
);
alter table standings enable row level security;
create policy standings_read on standings for select using (true);

create or replace function inc_win(p_name text) returns void
language sql security definer as $$
  insert into standings (name, wins, last_win) values (p_name, 1, now())
  on conflict (name) do update set wins = standings.wins + 1, last_win = now();
$$;

-- realtime
alter publication supabase_realtime add table rooms, players, game_state, messages;

-- bucket público para notas de voz
insert into storage.buckets (id, name, public) values ('voces', 'voces', true) on conflict (id) do nothing;

-- ============ datos restaurados del backup 2026-09-08 ============
insert into public.rooms (id, code, config, status, hand_no, created_at) values ('1e537fb8-ff27-41a8-8654-87b2be82dcd6','8G7T9','{"buyin": 100, "startBlind": 5, "playTimeout": 30, "handsPerBlindUp": 10}','done','4','2026-08-30 21:59:28.814639+00') on conflict do nothing;
insert into public.rooms (id, code, config, status, hand_no, created_at) values ('c2de0d70-96e3-4c95-a67f-be376a9089be','UX5RT','{"buyin": 500, "startBlind": 5, "playTimeout": 30, "handsPerBlindUp": 10}','playing','1','2026-08-30 22:36:41.165425+00') on conflict do nothing;
insert into public.rooms (id, code, config, status, hand_no, created_at) values ('d2ebd0ce-d43c-43a8-b2d6-760995d01632','4YQKA','{"buyin": 100, "startBlind": 5, "playTimeout": 60, "handsPerBlindUp": 10}','done','1','2026-08-30 22:37:46.136776+00') on conflict do nothing;
insert into public.rooms (id, code, config, status, hand_no, created_at) values ('6f531dab-6a2d-43a4-b8b9-6dd5ad0c5c3c','CVE8K','{"buyin": 100, "startBlind": 5, "playTimeout": 60, "handsPerBlindUp": 10}','playing','5','2026-08-30 22:41:39.669635+00') on conflict do nothing;
insert into public.rooms (id, code, config, status, hand_no, created_at) values ('d3fc105b-e5c9-46b1-8fd2-828fb5454344','5MDU8','{"buyin": 100, "startBlind": 5, "playTimeout": 60, "handsPerBlindUp": 10}','done','1','2026-08-30 23:55:20.910041+00') on conflict do nothing;
insert into public.rooms (id, code, config, status, hand_no, created_at) values ('fb586b9d-68aa-4aef-9275-fdf142a26ded','NG274','{"buyin": 100, "startBlind": 5, "playTimeout": 30, "handsPerBlindUp": 10}','playing','1','2026-08-30 23:57:44.260167+00') on conflict do nothing;
insert into public.rooms (id, code, config, status, hand_no, created_at) values ('a2e03bb0-6906-40e7-9547-5fe2e9e93389','MQT6A','{"buyin": 500, "startBlind": 5, "playTimeout": 60, "handsPerBlindUp": 10}','lobby','0','2026-08-31 00:26:48.65896+00') on conflict do nothing;
insert into public.rooms (id, code, config, status, hand_no, created_at) values ('371b0e4e-719f-4180-b3a2-26366a58962c','E4C5D','{"buyin": 500, "startBlind": 5, "playTimeout": 60, "handsPerBlindUp": 10}','playing','1','2026-08-31 00:27:16.028743+00') on conflict do nothing;
insert into public.rooms (id, code, config, status, hand_no, created_at) values ('061612bd-1656-498f-b2c2-21483e711bdd','W8S9P','{"buyin": 100, "startBlind": 5, "playTimeout": 30, "handsPerBlindUp": 10}','playing','1','2026-08-31 00:28:14.60943+00') on conflict do nothing;
insert into public.rooms (id, code, config, status, hand_no, created_at) values ('d751f734-a55d-4656-a8a9-417d1949b4f4','68UQ5','{"buyin": 100, "startBlind": 5, "playTimeout": 30, "handsPerBlindUp": 10}','done','1','2026-08-31 00:29:29.871198+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('1e537fb8-ff27-41a8-8654-87b2be82dcd6','04413078-1a82-4adf-a922-232adca69df7','Ariel',NULL,'200','2026-08-30 21:59:29.728003+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('1e537fb8-ff27-41a8-8654-87b2be82dcd6','826ace95-8b12-4174-91f7-b659259ffeb6','prueba',NULL,'0','2026-08-30 22:02:18.15761+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('c2de0d70-96e3-4c95-a67f-be376a9089be','04413078-1a82-4adf-a922-232adca69df7','Ariel',NULL,'498','2026-08-30 22:36:42.313706+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('c2de0d70-96e3-4c95-a67f-be376a9089be','826ace95-8b12-4174-91f7-b659259ffeb6','prueba',NULL,'502','2026-08-30 22:36:46.675611+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('d2ebd0ce-d43c-43a8-b2d6-760995d01632','04413078-1a82-4adf-a922-232adca69df7','Ariel',NULL,'200','2026-08-30 22:37:47.205717+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('d2ebd0ce-d43c-43a8-b2d6-760995d01632','826ace95-8b12-4174-91f7-b659259ffeb6','prueba',NULL,'0','2026-08-30 22:37:51.028111+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('6f531dab-6a2d-43a4-b8b9-6dd5ad0c5c3c','04413078-1a82-4adf-a922-232adca69df7','Ariel',NULL,'110','2026-08-30 22:41:40.891522+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('6f531dab-6a2d-43a4-b8b9-6dd5ad0c5c3c','826ace95-8b12-4174-91f7-b659259ffeb6','prueba',NULL,'90','2026-08-30 22:41:44.719103+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('d3fc105b-e5c9-46b1-8fd2-828fb5454344','04413078-1a82-4adf-a922-232adca69df7','Ariel',NULL,'0','2026-08-30 23:55:22.172015+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('d3fc105b-e5c9-46b1-8fd2-828fb5454344','826ace95-8b12-4174-91f7-b659259ffeb6','prueba',NULL,'0','2026-08-30 23:55:28.450188+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('d3fc105b-e5c9-46b1-8fd2-828fb5454344','35889b2c-ba7d-4317-b944-feb085b7cd85','prueba2',NULL,'300','2026-08-30 23:55:51.168025+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('fb586b9d-68aa-4aef-9275-fdf142a26ded','04413078-1a82-4adf-a922-232adca69df7','Ariel',NULL,'100','2026-08-30 23:57:45.335071+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('fb586b9d-68aa-4aef-9275-fdf142a26ded','35889b2c-ba7d-4317-b944-feb085b7cd85','prueba2',NULL,'98','2026-08-30 23:57:55.680281+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('fb586b9d-68aa-4aef-9275-fdf142a26ded','e4b466bb-4cc4-464e-adf6-0c58778341c4','prueba3',NULL,'100','2026-08-30 23:58:10.320743+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('a2e03bb0-6906-40e7-9547-5fe2e9e93389','9dd6411a-81c5-45b7-867e-2e44b1394d23','Ariel',NULL,'500','2026-08-31 00:26:49.911928+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('371b0e4e-719f-4180-b3a2-26366a58962c','9ef11204-b674-489d-b6d1-48eabe034fea','Prueba',NULL,'502','2026-08-31 00:27:27.37012+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('d751f734-a55d-4656-a8a9-417d1949b4f4','66ad903e-ec52-4524-9739-e78592898778','Ariel',NULL,'0','2026-08-31 00:29:31.094466+00') on conflict do nothing;
insert into public.players (room_id, user_id, name, seat, stack, joined_at) values ('d751f734-a55d-4656-a8a9-417d1949b4f4','5c7c4ed7-a965-4077-8a4b-dc0a2d851962','Gilda',NULL,'200','2026-08-31 00:30:10.309964+00') on conflict do nothing;
insert into public.game_state (room_id, status, public, hands, deck, private, updated_at) values ('c2de0d70-96e3-4c95-a67f-be376a9089be','hand_over','{"sb": 2, "pot": 7, "bets": {}, "acted": {"04413078-1a82-4adf-a922-232adca69df7": true}, "allIn": {}, "blind": 5, "board": [], "order": ["04413078-1a82-4adf-a922-232adca69df7", "826ace95-8b12-4174-91f7-b659259ffeb6"], "button": "04413078-1a82-4adf-a922-232adca69df7", "folded": {"04413078-1a82-4adf-a922-232adca69df7": true}, "handNo": 1, "stacks": {"04413078-1a82-4adf-a922-232adca69df7": 498, "826ace95-8b12-4174-91f7-b659259ffeb6": 502}, "status": "hand_over", "street": "preflop", "results": [{"delta": -2, "userId": "04413078-1a82-4adf-a922-232adca69df7"}, {"delta": 2, "userId": "826ace95-8b12-4174-91f7-b659259ffeb6"}], "winners": ["826ace95-8b12-4174-91f7-b659259ffeb6"], "deadline": 0, "minRaise": 5, "committed": {"04413078-1a82-4adf-a922-232adca69df7": 2, "826ace95-8b12-4174-91f7-b659259ffeb6": 5}, "currentBet": 5, "turnUserId": null, "showdownDescr": null}','{"04413078-1a82-4adf-a922-232adca69df7": ["3h", "Ad"], "826ace95-8b12-4174-91f7-b659259ffeb6": ["9c", "4s"]}','["6s", "Ah", "3c", "2c", "7c", "5s", "Td", "5d", "8d", "7h", "Qd", "8s", "9d", "Qh", "Js", "6d", "Th", "Jc", "Jd", "9h", "3d", "2d", "Qs", "Ac", "Ts", "9s", "7d", "6c", "As", "2h", "Kd", "8h", "2s", "8c", "4c", "6h", "7s", "Kh", "Ks", "5c", "Qc", "4d"]','{"fullBoard": ["Jh", "Kc", "3s", "4h", "5h"]}','2026-08-30 22:37:25.224+00') on conflict do nothing;
insert into public.game_state (room_id, status, public, hands, deck, private, updated_at) values ('1e537fb8-ff27-41a8-8654-87b2be82dcd6','hand_over','{"sb": 2, "pot": 200, "bets": {}, "acted": {}, "allIn": {"04413078-1a82-4adf-a922-232adca69df7": true, "826ace95-8b12-4174-91f7-b659259ffeb6": true}, "blind": 5, "board": ["7h", "Ks", "Kc", "6c", "9c"], "order": ["04413078-1a82-4adf-a922-232adca69df7", "826ace95-8b12-4174-91f7-b659259ffeb6"], "button": "826ace95-8b12-4174-91f7-b659259ffeb6", "folded": {}, "handNo": 4, "stacks": {"04413078-1a82-4adf-a922-232adca69df7": 200, "826ace95-8b12-4174-91f7-b659259ffeb6": 0}, "status": "hand_over", "street": "river", "results": [{"delta": 95, "userId": "04413078-1a82-4adf-a922-232adca69df7"}, {"delta": -95, "userId": "826ace95-8b12-4174-91f7-b659259ffeb6"}], "winners": ["04413078-1a82-4adf-a922-232adca69df7"], "deadline": 0, "minRaise": 5, "committed": {"04413078-1a82-4adf-a922-232adca69df7": 105, "826ace95-8b12-4174-91f7-b659259ffeb6": 95}, "currentBet": 0, "turnUserId": null, "showdownDescr": "Par de rey"}','{"04413078-1a82-4adf-a922-232adca69df7": ["8c", "Ad"], "826ace95-8b12-4174-91f7-b659259ffeb6": ["Ts", "3h"]}','["5h", "6s", "Qc", "5d", "7s", "4c", "Qs", "6d", "Qh", "Td", "Ac", "4h", "Jc", "Kd", "Th", "Tc", "8d", "Jh", "9s", "7c", "9d", "9h", "3d", "Js", "Kh", "6h", "8h", "2h", "Jd", "5s", "2d", "7d", "As", "4s", "Ah", "Qd", "2c", "5c", "4d", "2s", "3s", "8s"]','{"fullBoard": ["7h", "Ks", "Kc", "6c", "9c"]}','2026-08-30 22:13:50.675+00') on conflict do nothing;
insert into public.game_state (room_id, status, public, hands, deck, private, updated_at) values ('d2ebd0ce-d43c-43a8-b2d6-760995d01632','hand_over','{"sb": 2, "pot": 200, "bets": {}, "acted": {}, "allIn": {"04413078-1a82-4adf-a922-232adca69df7": true, "826ace95-8b12-4174-91f7-b659259ffeb6": true}, "blind": 5, "board": ["Ad", "8s", "Kc", "8h", "4h"], "order": ["04413078-1a82-4adf-a922-232adca69df7", "826ace95-8b12-4174-91f7-b659259ffeb6"], "button": "04413078-1a82-4adf-a922-232adca69df7", "folded": {}, "handNo": 1, "reveal": [{"mano": "Doble par: 8 y 4", "cards": ["8s", "8h", "4d", "4h", "Ad"], "userId": "04413078-1a82-4adf-a922-232adca69df7"}, {"mano": "Par de 8", "cards": ["8s", "8h", "Ad", "Kc", "Qs"], "userId": "826ace95-8b12-4174-91f7-b659259ffeb6"}], "stacks": {"04413078-1a82-4adf-a922-232adca69df7": 200, "826ace95-8b12-4174-91f7-b659259ffeb6": 0}, "status": "hand_over", "street": "river", "results": [{"delta": 100, "userId": "04413078-1a82-4adf-a922-232adca69df7"}, {"delta": -100, "userId": "826ace95-8b12-4174-91f7-b659259ffeb6"}], "winners": ["04413078-1a82-4adf-a922-232adca69df7"], "deadline": 0, "minRaise": 5, "committed": {"04413078-1a82-4adf-a922-232adca69df7": 100, "826ace95-8b12-4174-91f7-b659259ffeb6": 100}, "currentBet": 0, "turnUserId": null, "showdownDescr": "Doble par: 8 y 4 (desempata con el as)"}','{"04413078-1a82-4adf-a922-232adca69df7": ["Tc", "4d"], "826ace95-8b12-4174-91f7-b659259ffeb6": ["5c", "Qs"]}','["Ac", "6s", "Qc", "3s", "Td", "7c", "7h", "Ts", "5s", "2c", "7s", "Th", "9c", "3c", "2h", "6d", "Ah", "8d", "Kh", "6h", "9d", "9s", "5d", "8c", "Jd", "5h", "Jc", "Qh", "6c", "Qd", "7d", "Kd", "9h", "4c", "3d", "2s", "Ks", "As", "2d", "Js", "Jh", "4s"]','{"fullBoard": ["Ad", "8s", "Kc", "8h", "4h"]}','2026-08-30 22:38:30.414+00') on conflict do nothing;
insert into public.game_state (room_id, status, public, hands, deck, private, updated_at) values ('6f531dab-6a2d-43a4-b8b9-6dd5ad0c5c3c','hand_over','{"sb": 2, "pot": 50, "bets": {}, "acted": {}, "allIn": {}, "blind": 5, "board": ["Ah", "4h", "3h", "2s", "5s"], "order": ["04413078-1a82-4adf-a922-232adca69df7", "826ace95-8b12-4174-91f7-b659259ffeb6"], "button": "04413078-1a82-4adf-a922-232adca69df7", "folded": {}, "handNo": 5, "reveal": [{"mano": "Escalera al 5", "cards": ["5s", "4h", "3h", "2d", "1h"], "userId": "04413078-1a82-4adf-a922-232adca69df7"}, {"mano": "Escalera al 5", "cards": ["5c", "4h", "3s", "2s", "1h"], "userId": "826ace95-8b12-4174-91f7-b659259ffeb6"}], "stacks": {"04413078-1a82-4adf-a922-232adca69df7": 110, "826ace95-8b12-4174-91f7-b659259ffeb6": 90}, "status": "hand_over", "street": "river", "results": [{"delta": 0, "userId": "04413078-1a82-4adf-a922-232adca69df7"}, {"delta": 0, "userId": "826ace95-8b12-4174-91f7-b659259ffeb6"}], "winners": ["04413078-1a82-4adf-a922-232adca69df7", "826ace95-8b12-4174-91f7-b659259ffeb6"], "deadline": 0, "minRaise": 5, "committed": {"04413078-1a82-4adf-a922-232adca69df7": 25, "826ace95-8b12-4174-91f7-b659259ffeb6": 25}, "currentBet": 0, "turnUserId": null, "showdownDescr": "Escalera al 5"}','{"04413078-1a82-4adf-a922-232adca69df7": ["7s", "2d"], "826ace95-8b12-4174-91f7-b659259ffeb6": ["5c", "3s"]}','["Ad", "7d", "6c", "Kh", "Js", "4c", "9d", "6s", "5h", "Jc", "8d", "Kd", "Qd", "8h", "Tc", "Qs", "4d", "Ac", "9h", "Ts", "Th", "8c", "Qc", "Jh", "5d", "6d", "7c", "8s", "3d", "Jd", "3c", "Td", "9c", "2c", "Qh", "7h", "4s", "Ks", "6h", "2h", "Kc", "As"]','{"fullBoard": ["Ah", "4h", "3h", "2s", "5s"]}','2026-08-30 23:53:45.157+00') on conflict do nothing;
insert into public.game_state (room_id, status, public, hands, deck, private, updated_at) values ('fb586b9d-68aa-4aef-9275-fdf142a26ded','hand_over','{"sb": 2, "pot": 7, "bets": {}, "acted": {"04413078-1a82-4adf-a922-232adca69df7": true, "35889b2c-ba7d-4317-b944-feb085b7cd85": true, "e4b466bb-4cc4-464e-adf6-0c58778341c4": true}, "allIn": {}, "blind": 5, "board": [], "order": ["04413078-1a82-4adf-a922-232adca69df7", "35889b2c-ba7d-4317-b944-feb085b7cd85", "826ace95-8b12-4174-91f7-b659259ffeb6", "e4b466bb-4cc4-464e-adf6-0c58778341c4"], "button": "04413078-1a82-4adf-a922-232adca69df7", "folded": {"04413078-1a82-4adf-a922-232adca69df7": true, "35889b2c-ba7d-4317-b944-feb085b7cd85": true, "e4b466bb-4cc4-464e-adf6-0c58778341c4": true}, "handNo": 1, "stacks": {"04413078-1a82-4adf-a922-232adca69df7": 100, "35889b2c-ba7d-4317-b944-feb085b7cd85": 98, "826ace95-8b12-4174-91f7-b659259ffeb6": 102, "e4b466bb-4cc4-464e-adf6-0c58778341c4": 100}, "status": "hand_over", "street": "preflop", "results": [{"delta": 0, "userId": "04413078-1a82-4adf-a922-232adca69df7"}, {"delta": -2, "userId": "35889b2c-ba7d-4317-b944-feb085b7cd85"}, {"delta": 2, "userId": "826ace95-8b12-4174-91f7-b659259ffeb6"}, {"delta": 0, "userId": "e4b466bb-4cc4-464e-adf6-0c58778341c4"}], "winners": ["826ace95-8b12-4174-91f7-b659259ffeb6"], "deadline": 0, "minRaise": 5, "committed": {"35889b2c-ba7d-4317-b944-feb085b7cd85": 2, "826ace95-8b12-4174-91f7-b659259ffeb6": 5}, "currentBet": 5, "turnUserId": null, "showdownDescr": null}','{"04413078-1a82-4adf-a922-232adca69df7": ["4h", "Js"], "35889b2c-ba7d-4317-b944-feb085b7cd85": ["5s", "3s"], "826ace95-8b12-4174-91f7-b659259ffeb6": ["4d", "6s"], "e4b466bb-4cc4-464e-adf6-0c58778341c4": ["Kc", "Jd"]}','["4s", "5h", "9d", "3h", "9h", "3d", "Kd", "2c", "9c", "6c", "Jc", "5c", "As", "Ac", "7c", "5d", "Qs", "9s", "4c", "Jh", "Qh", "6h", "7s", "Qc", "Th", "Ks", "8h", "Ah", "Kh", "8s", "Tc", "2d", "3c", "Ad", "8c", "8d", "7h", "2s"]','{"fullBoard": ["7d", "Qd", "2h", "6d", "Ts"]}','2026-08-30 23:59:55.328+00') on conflict do nothing;
insert into public.game_state (room_id, status, public, hands, deck, private, updated_at) values ('d3fc105b-e5c9-46b1-8fd2-828fb5454344','hand_over','{"sb": 2, "pot": 300, "bets": {}, "acted": {}, "allIn": {"04413078-1a82-4adf-a922-232adca69df7": true, "35889b2c-ba7d-4317-b944-feb085b7cd85": true, "826ace95-8b12-4174-91f7-b659259ffeb6": true}, "blind": 5, "board": ["7h", "5h", "Kh", "7d", "Qh"], "order": ["04413078-1a82-4adf-a922-232adca69df7", "826ace95-8b12-4174-91f7-b659259ffeb6", "35889b2c-ba7d-4317-b944-feb085b7cd85"], "button": "04413078-1a82-4adf-a922-232adca69df7", "folded": {}, "handNo": 1, "reveal": [{"mano": "Color al rey", "cards": ["Kh", "Qh", "7h", "5h", "2h"], "userId": "04413078-1a82-4adf-a922-232adca69df7"}, {"mano": "Color al rey", "cards": ["Kh", "Qh", "7h", "6h", "5h", "3h"], "userId": "826ace95-8b12-4174-91f7-b659259ffeb6"}, {"mano": "Color al rey", "cards": ["Kh", "Qh", "Th", "7h", "5h"], "userId": "35889b2c-ba7d-4317-b944-feb085b7cd85"}], "stacks": {"04413078-1a82-4adf-a922-232adca69df7": 0, "35889b2c-ba7d-4317-b944-feb085b7cd85": 300, "826ace95-8b12-4174-91f7-b659259ffeb6": 0}, "status": "hand_over", "street": "river", "results": [{"delta": -100, "userId": "04413078-1a82-4adf-a922-232adca69df7"}, {"delta": -100, "userId": "826ace95-8b12-4174-91f7-b659259ffeb6"}, {"delta": 200, "userId": "35889b2c-ba7d-4317-b944-feb085b7cd85"}], "winners": ["35889b2c-ba7d-4317-b944-feb085b7cd85"], "deadline": 0, "minRaise": 5, "committed": {"04413078-1a82-4adf-a922-232adca69df7": 100, "35889b2c-ba7d-4317-b944-feb085b7cd85": 100, "826ace95-8b12-4174-91f7-b659259ffeb6": 100}, "currentBet": 0, "turnUserId": null, "showdownDescr": "Color al rey"}','{"04413078-1a82-4adf-a922-232adca69df7": ["2h", "As"], "35889b2c-ba7d-4317-b944-feb085b7cd85": ["9c", "Th"], "826ace95-8b12-4174-91f7-b659259ffeb6": ["3h", "6h"]}','["Tc", "9d", "3s", "5s", "2d", "6c", "5d", "Qs", "Td", "8h", "8s", "Ts", "4c", "3c", "2c", "8c", "Ac", "Qc", "Kd", "Jh", "Jc", "2s", "8d", "7s", "Ks", "9s", "5c", "6s", "Kc", "6d", "Jd", "4d", "4s", "Ad", "Js", "9h", "4h", "Ah", "7c", "3d"]','{"fullBoard": ["7h", "5h", "Kh", "7d", "Qh"]}','2026-08-30 23:57:15.048+00') on conflict do nothing;
insert into public.game_state (room_id, status, public, hands, deck, private, updated_at) values ('371b0e4e-719f-4180-b3a2-26366a58962c','hand_over','{"sb": 2, "pot": 7, "bets": {}, "acted": {"498c3aeb-5627-46ac-a450-0ad586d55258": true}, "allIn": {}, "blind": 5, "board": [], "order": ["498c3aeb-5627-46ac-a450-0ad586d55258", "9ef11204-b674-489d-b6d1-48eabe034fea"], "button": "498c3aeb-5627-46ac-a450-0ad586d55258", "folded": {"498c3aeb-5627-46ac-a450-0ad586d55258": true}, "handNo": 1, "potWon": 7, "stacks": {"498c3aeb-5627-46ac-a450-0ad586d55258": 498, "9ef11204-b674-489d-b6d1-48eabe034fea": 502}, "status": "hand_over", "street": "preflop", "results": [{"delta": -2, "userId": "498c3aeb-5627-46ac-a450-0ad586d55258"}, {"delta": 2, "userId": "9ef11204-b674-489d-b6d1-48eabe034fea"}], "winners": ["9ef11204-b674-489d-b6d1-48eabe034fea"], "champion": null, "deadline": 0, "minRaise": 5, "revealed": ["498c3aeb-5627-46ac-a450-0ad586d55258"], "committed": {"498c3aeb-5627-46ac-a450-0ad586d55258": 2, "9ef11204-b674-489d-b6d1-48eabe034fea": 5}, "currentBet": 5, "nextHandAt": 1788136095243, "turnUserId": null, "showdownDescr": null}','{"498c3aeb-5627-46ac-a450-0ad586d55258": ["Ah", "2c"], "9ef11204-b674-489d-b6d1-48eabe034fea": ["Jd", "7d"]}','["8d", "Js", "5d", "8c", "Kc", "Kh", "4d", "Qd", "4h", "3d", "9s", "5h", "9d", "3c", "5s", "4s", "Ad", "2s", "7h", "3h", "6c", "Jc", "8h", "7c", "7s", "2d", "Qs", "Jh", "9c", "8s", "6d", "Qc", "4c", "Ts", "Ac", "5c", "Qh", "2h", "6h", "Kd", "Ks", "9h"]','{"fullBoard": ["As", "6s", "Td", "3s", "Tc"]}','2026-08-31 00:28:09.982+00') on conflict do nothing;
insert into public.game_state (room_id, status, public, hands, deck, private, updated_at) values ('061612bd-1656-498f-b2c2-21483e711bdd','hand_over','{"sb": 2, "pot": 7, "bets": {}, "acted": {"498c3aeb-5627-46ac-a450-0ad586d55258": true}, "allIn": {}, "blind": 5, "board": [], "order": ["498c3aeb-5627-46ac-a450-0ad586d55258", "9ef11204-b674-489d-b6d1-48eabe034fea"], "button": "498c3aeb-5627-46ac-a450-0ad586d55258", "folded": {"498c3aeb-5627-46ac-a450-0ad586d55258": true}, "handNo": 1, "potWon": 7, "stacks": {"498c3aeb-5627-46ac-a450-0ad586d55258": 98, "9ef11204-b674-489d-b6d1-48eabe034fea": 102}, "status": "hand_over", "street": "preflop", "results": [{"delta": -2, "userId": "498c3aeb-5627-46ac-a450-0ad586d55258"}, {"delta": 2, "userId": "9ef11204-b674-489d-b6d1-48eabe034fea"}], "winners": ["9ef11204-b674-489d-b6d1-48eabe034fea"], "champion": null, "deadline": 0, "minRaise": 5, "revealed": [], "committed": {"498c3aeb-5627-46ac-a450-0ad586d55258": 2, "9ef11204-b674-489d-b6d1-48eabe034fea": 5}, "currentBet": 5, "nextHandAt": 1788136128648, "turnUserId": null, "showdownDescr": null}','{"498c3aeb-5627-46ac-a450-0ad586d55258": ["Kc", "Kd"], "9ef11204-b674-489d-b6d1-48eabe034fea": ["8c", "7h"]}','["Qs", "Th", "8s", "2d", "3s", "Ac", "2h", "7d", "6c", "3h", "3c", "5h", "9s", "7c", "2c", "Qd", "8d", "4c", "Ah", "6s", "2s", "9c", "Ts", "6h", "As", "9h", "6d", "Ad", "Tc", "4d", "Jd", "4s", "4h", "8h", "Td", "5d", "Ks", "9d", "5c", "5s", "Js", "Kh"]','{"fullBoard": ["Qh", "3d", "7s", "Qc", "Jh"]}','2026-08-31 00:28:38.648+00') on conflict do nothing;
insert into public.game_state (room_id, status, public, hands, deck, private, updated_at) values ('d751f734-a55d-4656-a8a9-417d1949b4f4','hand_over','{"sb": 2, "pot": 200, "bets": {}, "acted": {}, "allIn": {"5c7c4ed7-a965-4077-8a4b-dc0a2d851962": true, "66ad903e-ec52-4524-9739-e78592898778": true}, "blind": 5, "board": ["2d", "As", "8c", "3h", "5c"], "order": ["66ad903e-ec52-4524-9739-e78592898778", "5c7c4ed7-a965-4077-8a4b-dc0a2d851962"], "button": "66ad903e-ec52-4524-9739-e78592898778", "folded": {}, "handNo": 1, "potWon": 200, "reveal": [{"mano": "Par de 8", "cards": ["8d", "8c", "As", "9d", "5c"], "userId": "66ad903e-ec52-4524-9739-e78592898778"}, {"mano": "Escalera al 5", "cards": ["5c", "4h", "3h", "2d", "1s"], "userId": "5c7c4ed7-a965-4077-8a4b-dc0a2d851962"}], "stacks": {"5c7c4ed7-a965-4077-8a4b-dc0a2d851962": 200, "66ad903e-ec52-4524-9739-e78592898778": 0}, "status": "hand_over", "street": "river", "results": [{"delta": -100, "userId": "66ad903e-ec52-4524-9739-e78592898778"}, {"delta": 100, "userId": "5c7c4ed7-a965-4077-8a4b-dc0a2d851962"}], "winners": ["5c7c4ed7-a965-4077-8a4b-dc0a2d851962"], "champion": "5c7c4ed7-a965-4077-8a4b-dc0a2d851962", "deadline": 0, "minRaise": 5, "revealed": [], "committed": {"5c7c4ed7-a965-4077-8a4b-dc0a2d851962": 100, "66ad903e-ec52-4524-9739-e78592898778": 100}, "currentBet": 0, "turnUserId": null, "showdownDescr": "Escalera al 5"}','{"5c7c4ed7-a965-4077-8a4b-dc0a2d851962": ["4h", "4c"], "66ad903e-ec52-4524-9739-e78592898778": ["9d", "8d"]}','["2h", "Ah", "5d", "Jc", "Qh", "Jd", "5s", "6d", "5h", "6h", "Th", "6s", "4d", "3s", "7h", "7c", "4s", "9c", "2c", "9h", "Js", "7d", "7s", "Ks", "Kc", "Jh", "6c", "Tc", "Qd", "Td", "Kd", "Qs", "Ad", "Ts", "Qc", "Ac", "3d", "3c", "9s", "Kh", "8h", "2s"]','{"fullBoard": ["2d", "As", "8c", "3h", "5c"]}','2026-08-31 00:31:57.211+00') on conflict do nothing;
insert into public.standings (name, wins, last_win) values ('Gilda','1','2026-08-31 00:31:57.118232+00') on conflict do nothing;
