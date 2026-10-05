-- Identity and directory metadata only. Session data stays on execution hosts.
create table public.remote_access_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.remote_hosts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  -- Storage validation only. Clients must validate endpoints and host identity
  -- before sending credentials; the control plane never fetches this URL.
  endpoint text not null check (
    char_length(endpoint) between 9 and 2048 and endpoint like 'https://%'
  ),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create index remote_hosts_owner_idx on public.remote_hosts(owner_id);

create table public.remote_clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  kind text not null check (kind in ('desktop', 'web')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index remote_clients_owner_idx on public.remote_clients(owner_id);

alter table public.remote_access_accounts enable row level security;
alter table public.remote_hosts enable row level security;
alter table public.remote_clients enable row level security;

-- No direct client mutations, even for owners. Enrollment, revocation and
-- account eligibility will go through individually authorized server endpoints.
revoke all on public.remote_access_accounts, public.remote_hosts, public.remote_clients
  from public, anon, authenticated;
grant select on public.remote_access_accounts, public.remote_hosts, public.remote_clients
  to authenticated;
grant select, insert, update, delete
  on public.remote_access_accounts, public.remote_hosts, public.remote_clients
  to service_role;

create policy account_self_read on public.remote_access_accounts
  for select to authenticated using (user_id = (select auth.uid()));

create policy host_owner_read on public.remote_hosts
  for select to authenticated using (
    owner_id = (select auth.uid()) and exists (
      select 1 from public.remote_access_accounts a
      where a.user_id = (select auth.uid()) and a.enabled
    )
  );

create policy client_owner_read on public.remote_clients
  for select to authenticated using (
    owner_id = (select auth.uid()) and exists (
      select 1 from public.remote_access_accounts a
      where a.user_id = (select auth.uid()) and a.enabled
    )
  );
