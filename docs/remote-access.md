# Remote-access foundation

Remote execution is not enabled. Local Electron still needs no Phosphor login.
The shared host handshake and control-directory schema are foundations, not a
running control plane or an exposed host API.

## Control-directory schema

`supabase/migrations/` holds versioned PostgreSQL migrations for three tables:

- `remote_access_accounts`: server-managed eligibility for remote access.
- `remote_hosts`: owner, display label, endpoint and revocation metadata.
- `remote_clients`: owner, client kind, display label and revocation metadata.

All tables have row-level security. Authenticated users can read only their own
eligibility. Eligible owners can read their host/client rows, including revoked
entries for access-management views. They cannot enroll, modify, reassign or
remove records directly. Anonymous roles have no table access. The server role
can mutate rows and bypasses RLS; a future server endpoint must separately
authorize every operation and check revocation. Directory visibility is not an
execution grant. Endpoint storage validation is not network authorization.

There are no prompts, filesystem paths, transcripts, artifacts or provider
credentials in these tables. Account deletion cascades through its directory
records only, not remote files. Applying a migration does not install an agent,
enable signup, or expose any execution service.

## Local validation

Docker is required. The pinned Supabase CLI uses project ID
`phosphor-control-test`, API port 54351 and database port 54352. It does not link
to a hosted project and must not reuse another application's stack.

```bash
npm run db:start
npm run test:control-db
CONTROL_DB=1 npm run validate
npm run db:stop
```

`db:stop` removes this disposable test stack and its data. Never put real
sessions or credentials in it. Other Supabase stacks are not stopped.
Local signup is disabled; tests insert synthetic users inside a transaction
and roll back. The pgTAP suite exercises real Supabase roles and `auth.uid()`,
including anonymous access, ownership isolation, disabled accounts, forbidden
client writes and server-role access. CI starts/tests/stops its own stack and
never receives hosted database credentials. Local CLI output includes test
keys; do not publish it as production setup information.

## Hosted directory

The provisioned `phosphor` project is `bzdbiswndlqvviiywsvj` in `us-west-1`.
Its directory tables have RLS enabled, no anonymous access and no direct client
mutation privileges. Provisioning the schema does not enroll users, hosts or clients.
Brigades is a separate product and is never a deployment target.

The checked-in migration version matches Supabase's migration ledger. MCP
assigns its own timestamp during application, so the initial migration filename
uses that returned version without changing its SQL. Later deployments must
reconcile the ledger before applying anything; do not replay an existing schema
under a second version. Hosted changes require explicit target verification.
Local test success does not imply deployment.
