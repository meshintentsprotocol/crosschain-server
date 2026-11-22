import native from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
if (process.env.STORAGE_BACKEND !== 'postgres') throw new Error('Set STORAGE_BACKEND=postgres');
process.env.STATE_IMPORT = '1';
const { default: state, dataRoot } = await import('../src/storage/stateFs.js');
const source = path.resolve(process.argv[2] || dataRoot);
// Validate everything before committing anything. Never overwrite existing DB state.
const files = native.readdirSync(source, { withFileTypes: true }).filter(e => e.isFile() && /\.(json|jsonl)$/.test(e.name));
const rows = files.map(e => {
  const body = native.readFileSync(path.join(source, e.name), 'utf8');
  if (body.trim()) { if (e.name.endsWith('.jsonl')) body.trim().split('\n').forEach(line => JSON.parse(line)); else JSON.parse(body); }
  return { name: e.name, body };
});
for (const row of rows) {
  const target = path.join(dataRoot, row.name);
  if (state.existsSync(target) && state.readFileSync(target, 'utf8') !== row.body) throw new Error('Conflicting existing database document: ' + row.name);
}
for (const row of rows) state.writeFileSync(path.join(dataRoot, row.name), row.body, 'utf8');
console.log('Verified/imported ' + rows.length + ' state documents. Treasury key files excluded; retain protected volume.');
