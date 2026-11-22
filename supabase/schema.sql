-- SnapSet's database. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- The browser never talks to Supabase. Only server.js does, with the secret key.

create table public.logs (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,  -- hash of the visitor's log code, never the code itself
  machine text not null check (machine in ('Leg Press','Chest Press','Lat Pulldown',
    'Seated Row','Leg Extension','Shoulder Press')),
  date date not null,
  sets int not null default 1 check (sets between 1 and 20),
  reps int not null check (reps between 1 and 200),
  weight numeric not null check (weight between 0 and 2000),
  created_at timestamptz not null default now()
);

create index on public.logs (visitor_id, date, created_at);

-- No policies, on purpose: the public key can't do anything with this table.
alter table public.logs enable row level security;

-- RLS alone makes a blocked delete look like "success, 0 rows". This makes it an error.
revoke all on public.logs from anon, authenticated;

-- The server's secret key runs as service_role. (This is a role name, not a key.)
grant select, insert, update, delete on public.logs to service_role;

-- Check: every table listed must show true.
select tablename, rowsecurity from pg_tables where schemaname = 'public';
