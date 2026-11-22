# Railway PostgreSQL cutover

This release stores existing JSON/JSONL state documents in PostgreSQL. It is a compatibility migration, not a normalized relational ledger. Existing cache retention limits and delayed saves still apply. Use one replica per service/network. A session advisory lock rejects concurrent writers, including overlapping deployments; expect a short maintenance window.

## Configuration

- STORAGE_BACKEND=postgres (file remains the explicit development default)
- DATABASE_URL: reference the PostgreSQL service's private connection URL. Do not commit credentials.
- DATA_DIR=/app/data (use the actual existing directory for export before changing it)
- NETWORK (Mesh) or CCTP_NETWORK (swap): must match the source data. Namespaces are mesh:<network> and swap:<network>.
- ALLOW_EMPTY_STATE=true only for a genuinely new service; remove after first state is written.

Use independent Postgres services in the current separate Railway projects, or move both applications into one project before sharing a private database. Existing projects do not share private networking.

## Subsequent deployments

Keep one application replica per service/network. Before a code redeployment, validate the build, stop the existing application deployment through Railway CLI, and then deploy the new artifact. Keep the PostgreSQL service running. The advisory lock rejects overlapping writers, so a normal rolling deployment can fail its healthcheck while the old application still owns the lock. Expect a maintenance window. Restarting the current deployment through Railway CLI has been verified on both services after migration.

## Migration

1. Back up the current data directory and treasury-keys securely BEFORE mounting/changing volumes or redeploying. Stop trading and drain in-flight work before the final export.
2. Provision PostgreSQL and enable automated backups/PITR as supported. Retain an encrypted independent backup and perform a restore drill.
3. With the same network variables and PostgreSQL URL, run npm run db:import -- /absolute/path/to/export. The importer validates JSON, refuses differing existing documents, and can be repeated after partial interruption. It excludes treasury keys. Import before starting the server; importer and server cannot own the namespace simultaneously.
4. Compare record counts, transaction references, settings, and balances. Deploy with the configuration above; startup refuses an empty namespace. Keep original exports for rollback.
5. Confirm health, restart, confirm state and pauses persist, and reconcile pending chain transactions before reopening trading.

## Operational limits

Writes commit before returning through a dedicated database worker. Database errors stop the process instead of allowing swallowed filesystem exceptions to continue execution. Calls block the application thread for database round trips, bounded to 15 seconds: benchmark latency and document sizes before enabling traffic. Temporary writes become a single database upsert on rename. Ordinary reads use the process snapshot protected by the writer lock.

Generated treasury keys stay on the protected persistent volume; this database does not back them up. Sanity remains the content CMS. This release does not change newsletter security or admin authentication.

Next work: normalized per-operation tables, atomic state transitions, complete history beyond cache limits, transaction attempt reconciliation and worker leases. This compatibility layer does not establish exactly-once on-chain execution. Do not scale trading workers horizontally.
