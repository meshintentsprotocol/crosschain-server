import { workerData } from 'node:worker_threads';
import pg from 'pg';
const { port, signal, url, namespace } = workerData;
const notify = value => { port.postMessage(value); Atomics.store(signal, 0, 1); Atomics.notify(signal, 0); };
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 12000, keepAlive: true });
client.on('error', () => process.exit(1));
try {
  await client.connect();
  const lock = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', ['intent-state:' + namespace]);
  if (!lock.rows[0].locked) throw new Error('namespace already has a writer');
  await client.query('CREATE TABLE IF NOT EXISTS intent_state_documents (namespace text NOT NULL, name text NOT NULL, body text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(namespace, name))');
  const state = await client.query('SELECT name, body FROM intent_state_documents WHERE namespace=$1', [namespace]);
  notify({ rows: state.rows });
} catch { notify({ error: 'PostgreSQL initialization failed (connection, schema permissions, or writer lock)' }); }
port.on('message', async ({ name, body, append }) => {
  try {
    await client.query('INSERT INTO intent_state_documents(namespace,name,body) VALUES($1,$2,$3) ON CONFLICT(namespace,name) DO UPDATE SET body=' + (append ? 'intent_state_documents.body || EXCLUDED.body' : 'EXCLUDED.body') + ', updated_at=now()', [namespace, name, body]);
    notify({ ok: true });
  } catch { notify({ error: 'PostgreSQL commit failed' }); }
});
// A lost lock/session must stop the writer even between application writes.
setInterval(() => { client.query('SELECT 1').catch(() => process.exit(1)); }, 10000).unref();
