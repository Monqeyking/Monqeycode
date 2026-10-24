import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Checkpoints, inside } from '../lib/checkpoints.js';
import { browserDenial } from '../lib/browser.js';
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'monqey-checkpoints-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const folder=path.join(root,'project');fs.mkdirSync(folder);const workspace={id:randomUUID(),path:folder},sessionId='session-'+randomUUID(),store=new Checkpoints(root);
  const write=(name,text)=>{const file=path.join(folder,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
  return{root,folder,workspace,sessionId,store,write};
}
test('native/shell action snapshots restore changed files only, including creates/deletes; recovery remains available',t=>{
  const f=fixture(t);f.write('src/a.ts','old');f.write('src/deleted.ts','keep me');f.write('unrelated.ts','untouched');
  const row=f.store.capture(f.workspace,f.sessionId,'pwsh');f.write('src/a.ts','new');f.write('src/created.ts','created');fs.unlinkSync(path.join(f.folder,'src/deleted.ts'));f.store.finish(row);
  f.write('unrelated.ts','girlfriend edit');const preview=f.store.preview(f.workspace,f.sessionId,row.id);assert.equal(preview.files.length,3);assert.ok(preview.files.every(file=>!file.conflict));
  const restored=f.store.restore(f.workspace,f.sessionId,row.id,preview.files.map(file=>file.name));assert.equal(restored.restored,3);
  assert.equal(fs.readFileSync(path.join(f.folder,'src/a.ts'),'utf8'),'old');assert.equal(fs.readFileSync(path.join(f.folder,'src/deleted.ts'),'utf8'),'keep me');assert.equal(fs.existsSync(path.join(f.folder,'src/created.ts')),false);assert.equal(fs.readFileSync(path.join(f.folder,'unrelated.ts'),'utf8'),'girlfriend edit');
  f.store.restore(f.workspace,f.sessionId,restored.guardId,['src/a.ts']);assert.equal(fs.readFileSync(path.join(f.folder,'src/a.ts'),'utf8'),'new');
});
test('newer edits, deletions, shared-decision changes and cross-workspace access block before writes',t=>{
  const f=fixture(t);f.write('a.ts','old');f.write('b.ts','old');const row=f.store.capture(f.workspace,f.sessionId,'edit');f.write('a.ts','agent');f.write('b.ts','agent');f.store.finish(row);
  f.write('b.ts','girlfriend');assert.throws(()=>f.store.restore(f.workspace,f.sessionId,row.id,['a.ts','b.ts']),/Nothing was restored/);assert.equal(fs.readFileSync(path.join(f.folder,'a.ts'),'utf8'),'agent');
  fs.unlinkSync(path.join(f.folder,'b.ts'));assert.equal(f.store.preview(f.workspace,f.sessionId,row.id).files.find(file=>file.name==='b.ts').conflict,true);
  f.write('.monqey/project.json','{"revision":2}');assert.equal(f.store.preview(f.workspace,f.sessionId,row.id).sharedChanged,true);assert.throws(()=>f.store.restore(f.workspace,f.sessionId,row.id,['a.ts']),/Nothing was restored/);
  assert.throws(()=>f.store.preview({...f.workspace,id:randomUUID()},f.sessionId,row.id),/different/);assert.throws(()=>f.store.preview(f.workspace,randomUUID(),row.id),/different/);
});
test('retention is bounded, excluded files are never stored, and corrupt backups fail before any write',t=>{
  const f=fixture(t);f.write('.env','secret');f.write('.credentials.yaml','secret');f.write('node_modules/x.js','dependency');f.write('Assets/texture.png','image');f.write('Assets/large.asset',Buffer.alloc(9*1024*1024));f.write('a.ts','zero');
  for(let i=0;i<24;i++){const row=f.store.capture(f.workspace,f.sessionId,'write');assert.deepEqual(Object.keys(row.before),['a.ts']);f.write('a.ts',String(i));f.store.finish(row);}
  const rows=f.store.list(f.workspace.id,f.sessionId);assert.equal(rows.length,20);const row=rows[0];fs.writeFileSync(path.join(f.store.blobs,row.before['a.ts'].hash),'tampered');assert.throws(()=>f.store.restore(f.workspace,f.sessionId,row.id,['a.ts']),/damaged/);assert.equal(fs.readFileSync(path.join(f.folder,'a.ts'),'utf8'),'23');
});
test('path traversal, alternate streams, excluded metadata and link replacement are rejected',t=>{
  const f=fixture(t);for(const name of ['../escape','a/../../escape','a:stream','a\\b','.monqey/project.json','a/./b','a./b'])assert.throws(()=>inside(f.folder,name));
  f.write('dir/a.ts','old');const row=f.store.capture(f.workspace,f.sessionId,'edit');f.write('dir/a.ts','agent');f.store.finish(row);
  const external=path.join(f.root,'external');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'a.ts'),'outside');fs.renameSync(path.join(f.folder,'dir'),path.join(f.folder,'saved'));fs.symlinkSync(external,path.join(f.folder,'dir'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>f.store.restore(f.workspace,f.sessionId,row.id,['dir/a.ts']),/Nothing was restored|link/);assert.equal(fs.readFileSync(path.join(external,'a.ts'),'utf8'),'outside');
  fs.unlinkSync(path.join(f.folder,'dir'));
});
test('interrupted checkpoints are retained but cannot be restored',t=>{const f=fixture(t);f.write('a.ts','old');const row=f.store.capture(f.workspace,f.sessionId,'edit');f.write('a.ts','partial');assert.throws(()=>new Checkpoints(f.root).preview(f.workspace,f.sessionId,row.id),/interrupted/);});
test('special object-key filenames are tracked and exclusions ignore case',t=>{const f=fixture(t);f.write('__proto__','old');f.write('NODE_MODULES/ignored.js','dependency');const row=f.store.capture(f.workspace,f.sessionId,'write');assert.deepEqual(Object.keys(row.before),['__proto__']);f.write('__proto__','new');f.store.finish(row);f.store.restore(f.workspace,f.sessionId,row.id,['__proto__']);assert.equal(fs.readFileSync(path.join(f.folder,'__proto__'),'utf8'),'old');});
test('targeted file snapshots and recovery work without scanning the rest of the workspace',t=>{
  const f=fixture(t);f.write('src/a.ts','before');f.write('unrelated/b.ts','untouched');
  const row=f.store.capture(f.workspace,f.sessionId,'write',[path.join(f.folder,'src/a.ts')]);assert.deepEqual(Object.keys(row.before),['src/a.ts']);
  f.write('src/a.ts','after');f.store.finish(row);f.write('unrelated/b.ts','partner change');
  const diff=f.store.diff(f.workspace,f.sessionId,row.id,'src/a.ts');assert.equal(diff.before,'before');assert.equal(diff.current,'after');
  f.store.restore(f.workspace,f.sessionId,row.id,['src/a.ts']);assert.equal(fs.readFileSync(path.join(f.folder,'src/a.ts'),'utf8'),'before');assert.equal(fs.readFileSync(path.join(f.folder,'unrelated/b.ts'),'utf8'),'partner change');
  const created=f.store.capture(f.workspace,f.sessionId,'write',['src/new.ts']);f.write('src/new.ts','new');f.store.finish(created);f.store.restore(f.workspace,f.sessionId,created.id,['src/new.ts']);assert.equal(fs.existsSync(path.join(f.folder,'src/new.ts')),false);
});
test('browser actions require a writable agent; stop and list remain available',()=>{
  for(const name of ['bsk_page','bsk_inspect','bsk_interact','bsk_tabs','bsk_assist','bsk_session'])assert.match(browserDenial({name,agent:{},arguments:{action:'start'}},()=>false),/Read-only/);
  assert.equal(browserDenial({name:'bsk_session',arguments:{action:'stop'}},()=>false),undefined);assert.equal(browserDenial({name:'bsk_session',arguments:{action:'list'}},()=>false),undefined);assert.equal(browserDenial({name:'bsk_page',agent:{}},()=>true),undefined);
});
