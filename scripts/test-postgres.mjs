import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const network = 'storage-test-' + randomUUID();
const service = "swap";
const env = { ...process.env, STORAGE_BACKEND: 'postgres', ALLOW_EMPTY_STATE: 'true', NETWORK: network, CCTP_NETWORK: network };
const setup = "import fs from './src/storage/stateFs.ts'; import path from 'node:path'; import assert from 'node:assert/strict'; const file=path.resolve(process.env.DATA_DIR||'data','integration.json');";
function run(code, overrides={}) {
 return spawnSync(process.execPath, ['--import','tsx','--input-type=module','-e',setup+code], { cwd:process.cwd(),env:{...env,...overrides},encoding:'utf8',timeout:25000 });
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
 await client.connect();
 const first = run("fs.writeFileSync(file+'.tmp', JSON.stringify({amount:'900719925474099312345',paused:true})); assert.equal(fs.existsSync(file),false); fs.renameSync(file+'.tmp',file); assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).paused,true); const child=(await import('node:child_process')).spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',\"await import('./src/storage/stateFs.ts')\"],{env:process.env,timeout:20000}); assert.equal(child.status,1); process.exit(0);");
 assert.equal(first.status,0,first.stderr);
 const second=run("assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).amount,'900719925474099312345'); assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).paused,true); const log=file.replace('.json','.jsonl'); fs.appendFileSync(log,JSON.stringify({id:1})+String.fromCharCode(10)); fs.appendFileSync(log,JSON.stringify({id:2})+String.fromCharCode(10)); assert.equal(fs.readFileSync(log,'utf8').trim().split(String.fromCharCode(10)).length,2); process.exit(0);");
 assert.equal(second.status,0,second.stderr);
 const third=run("assert.equal(fs.readFileSync(file.replace('.json','.jsonl'),'utf8').trim().split(String.fromCharCode(10)).length,2); process.exit(0);");
 assert.equal(third.status,0,third.stderr);
 assert.equal(run('process.exit(0)',{NETWORK:network+'-empty',CCTP_NETWORK:network+'-empty',ALLOW_EMPTY_STATE:'false'}).status,1);
 assert.equal(run('process.exit(0)',{DATABASE_URL:'postgresql://invalid:invalid@127.0.0.1:1/invalid'}).status,1);
 console.log('PASS: committed restart recovery, exact amounts, temporary rename, append recovery, writer exclusion, empty namespace and connection failure');
} finally { if (client._connected) await client.query('DELETE FROM intent_state_documents WHERE namespace=$1',[service+':'+network]).catch(()=>{}); await client.end(); }
