import native from 'node:fs';
import path from 'node:path';
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import 'dotenv/config';

// Compatibility bridge for existing synchronous stores. No global fs patching.
const service: string = "swap";
const network = process.env[service === 'mesh' ? 'NETWORK' : 'CCTP_NETWORK'] || (service === 'mesh' ? 'chipnet' : 'testnet');
const root = path.resolve(process.env.DATA_DIR || (service === 'swap' && network === 'mainnet' ? 'data-mainnet' : 'data'));
const backend = process.env.STORAGE_BACKEND || 'file';
if (!['file', 'postgres'].includes(backend)) throw new Error('Invalid STORAGE_BACKEND');
const bodies = new Map<string, string>();
const pending = new Map<string, string>();
let commit: ((name: string, body: string, append?: boolean) => void) | undefined;
if (backend === 'postgres') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for PostgreSQL');
  const namespace = service + ':' + network;
  const { port1, port2 } = new MessageChannel();
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(path.resolve(process.cwd(), 'src/storage/postgres-worker.mjs'), { execArgv: [], workerData: { port: port2, signal, url: process.env.DATABASE_URL, namespace }, transferList: [port2] });
  const fatal = (): never => { console.error('[Persistence] PostgreSQL unavailable; stopping to protect execution state'); process.exit(1); };
  worker.on('error', fatal);
  worker.on('exit', fatal);
  function wait(): any {
    if (Atomics.wait(signal, 0, 0, 15000) === 'timed-out') return fatal();
    const result = receiveMessageOnPort(port1)?.message;
    Atomics.store(signal, 0, 0);
    if (!result || result.error) return fatal();
    return result;
  }
  for (const row of wait().rows) bodies.set(row.name, row.body);
  if (!bodies.size && process.env.STATE_IMPORT !== '1' && process.env.ALLOW_EMPTY_STATE !== 'true') throw new Error('Empty PostgreSQL namespace: import existing data or explicitly set ALLOW_EMPTY_STATE=true for a new service');
  commit = (name, body, append = false) => { port1.postMessage({ name, body, append }); wait(); };
  worker.unref(); port1.unref();
  console.log('[Persistence] PostgreSQL ready: ' + namespace + ', ' + bodies.size + ' documents');
}
function key(file: any): string | undefined {
  if (!commit || typeof file !== 'string') return;
  const rel = path.relative(root, path.resolve(file));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
  const name = rel.split(path.sep).join('/');
  // Signing keys are NEVER uploaded to this general-purpose state table.
  if (name.startsWith('treasury-keys/')) return;
  if (!/\.(json|jsonl)(\.tmp)?$/.test(name)) return;
  return name;
}
function text(data: any): string { return typeof data === 'string' ? data : Buffer.from(data).toString('utf8'); }
const fs = { ...native,
  existsSync(file: any) { const k = key(file); return k === undefined ? native.existsSync(file) : bodies.has(k) || pending.has(k); },
  readFileSync(file: any, options?: any): any {
    const k = key(file); if (k === undefined) return native.readFileSync(file, options);
    const body = pending.get(k) ?? bodies.get(k);
    if (body === undefined) throw Object.assign(new Error('State document missing: ' + k), { code: 'ENOENT' });
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding ? Buffer.from(body).toString(encoding) : Buffer.from(body);
  },
  writeFileSync(file: any, data: any, options?: any) {
    const k = key(file); if (k === undefined) return native.writeFileSync(file, data, options);
    const body = text(data);
    if (k.endsWith('.tmp')) { pending.set(k, body); return; }
    commit!(k, body); bodies.set(k, body);
  },
  appendFileSync(file: any, data: any, options?: any) {
    const k = key(file); if (k === undefined) return native.appendFileSync(file, data, options);
    const body = text(data); commit!(k, body, true); bodies.set(k, (bodies.get(k) || '') + body);
  },
  renameSync(from: any, to: any) {
    const a = key(from), b = key(to);
    if (a === undefined && b === undefined) return native.renameSync(from, to);
    if (!a || !b || !a.endsWith('.tmp') || !pending.has(a)) throw new Error('Unsupported state rename');
    const body = pending.get(a)!; commit!(b, body); bodies.set(b, body); pending.delete(a);
  },
} as typeof native;
export default fs;
export { root as dataRoot };

