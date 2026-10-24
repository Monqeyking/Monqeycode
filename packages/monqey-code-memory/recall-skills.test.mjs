import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ConversationRecall, workspaceAt, safeExcerpt } from './lib/recall.js';
import { installWorkflowSkills, workflowSkillName } from './lib/workflow-skills.js';
import { MemoryStore, defaults } from './lib/store.js';
import { candidates } from './lib/learning.js';

test('history restricts native search before ranking, cites sources, bounds reads and rejects foreign sessions',async () => {
  const workspace = {id:randomUUID(),path:path.resolve('history-project')}, nested = {id:randomUUID(),path:path.join(workspace.path,'private-project')};
  const registry = {list:()=>[workspace,nested],get:id=>[workspace,nested].find(item=>item.id===id)};
  const own = {header:{id:'session-'+randomUUID(),cwd:path.join(workspace.path,'src')}}, foreign = {header:{id:'session-'+randomUUID(),cwd:nested.path}};
  const current = {header:{id:randomUUID(),cwd:workspace.path}}, worker = {header:{id:randomUUID(),cwd:workspace.path,origin:'subagent'}};
  let requested, read = 0;
  const recall = new ConversationRecall({
    listSessions:async()=>[own,foreign,current,worker],
    searchSessions:async request=>{ requested=request; return {items:[{...own,bestMatch:{seq:5,time:123,type:'user/message',snippet:'Our earlier deployment decision.'}}]}; },
    readTitleSnapshot:async()=>({title:{title:'Deploy review'}}),
    readEvent:async()=>{read++;return {session:own.header,events:[{type:'user/message',seq:5,time:1,data:{content:[{type:'text',text:'A'.repeat(10000)}]}},{type:'assistant/message',seq:6,time:2,data:{message:{content:[{type:'text',text:'B'.repeat(10000)}]}}},{type:'assistant/message',seq:7,time:3,data:{message:{content:[{type:'text',text:'C'.repeat(10000)}]}}}]};}
  },registry);
  assert.equal(workspaceAt(registry,nested.path).id,nested.id);
  const found=await recall.search({query:'deployment',workspaceId:workspace.id,excludeSessionId:current.header.id});
  assert.deepEqual(requested.sessionFilters[0].values,[own.header.id]);
  assert.equal(found.matches[0].title,'Deploy review');assert.equal(found.matches[0].seq,5);
  const excerpt=await recall.read({sessionId:own.header.id,seq:5,workspaceId:workspace.id});
  assert.equal(excerpt.messages.reduce((sum,item)=>sum+item.text.length,0),4000);
  await assert.rejects(recall.read({sessionId:foreign.header.id,seq:5,workspaceId:workspace.id}),/another workspace/);assert.equal(read,1);
  await assert.rejects(recall.search({query:'',workspaceId:workspace.id}),/search characters/);
  await assert.rejects(recall.read({sessionId:own.header.id,seq:Infinity,workspaceId:workspace.id}),/Invalid conversation/);
  assert.equal(safeExcerpt('api_key=abcdefgh123456789',320),'[Sensitive content omitted]');
  assert.equal(safeExcerpt('api_key=abcdefgh123456789',0),'');
});

test('combined recall returns cited matching text in one call within its shared budget',async () => {
  const workspace={id:randomUUID(),path:path.resolve('combined-project')},current=randomUUID();
  const sources=Array.from({length:3},()=>({header:{id:randomUUID(),cwd:workspace.path}}));
  const windows=[];
  const recall=new ConversationRecall({
    listSessions:async()=>[...sources,{header:{id:current,cwd:workspace.path}}],
    searchSessions:async request=>{assert.ok(!request.sessionFilters[0].values.includes(current));return {items:sources.slice(0,request.limit).map(source=>({...source,bestMatch:{seq:8,time:1,type:'user/message',snippet:'A cited match.'}}))};},
    readTitleSnapshot:async()=>({title:{title:'Earlier work'}}),
    readEvent:async request=>{windows.push(request);return {session:sources.find(source=>source.header.id===request.sessionId).header,events:[{type:'user/message',seq:7,time:1,data:{content:[{type:'text',text:'Neighbour should not be returned.'}]}},{type:'user/message',seq:8,time:2,data:{content:[{type:'text',text:'A'.repeat(1800)}]}}]};}
  },{list:()=>[workspace],get:id=>id===workspace.id?workspace:null});
  const result=await recall.recall({query:'cited',workspaceId:workspace.id,excludeSessionId:current,limit:3});
  assert.equal(result.matches.length,2);assert.equal(result.referenceOnly,true);
  assert.equal(result.matches.flatMap(hit=>hit.messages).reduce((sum,item)=>sum+item.text.length,0),2400);
  assert.ok(result.matches.every(hit=>hit.seq===8&&hit.messages[0].seq===8&&hit.messages[0].truncated));
  assert.ok(windows.every(window=>window.before===0&&window.after===0));
  await assert.rejects(recall.recall({query:'cited',workspaceId:workspace.id,limit:4}),/1–3/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(recall.recall({query:'cited',workspaceId:workspace.id,signal:controller.signal}),/abort/i);
});

test('combined recall rechecks source ownership and screens credentials',async () => {
  const workspace={id:randomUUID(),path:path.resolve('combined-private')},source={header:{id:randomUUID(),cwd:workspace.path}};
  let foreign=false,reads=0;
  const recall=new ConversationRecall({listSessions:async()=>[source],searchSessions:async()=>({items:[{...source,bestMatch:{seq:1,time:1,type:'user/message',snippet:'Found.'}}]}),readTitleSnapshot:async()=>({}),readEvent:async()=>{reads++;return {session:{...source.header,cwd:foreign?path.resolve('other-project'):workspace.path},events:[{type:'user/message',seq:1,time:1,data:{content:[{type:'text',text:'api_key=abcdefgh123456789'}]}}]};}},{list:()=>[workspace],get:id=>id===workspace.id?workspace:null});
  assert.equal((await recall.recall({query:'found',workspaceId:workspace.id})).matches[0].messages[0].text,'[Sensitive content omitted]');
  foreign=true;await assert.rejects(recall.recall({query:'found',workspaceId:workspace.id}),/another workspace/);assert.equal(reads,2);
});

test('learned skills are lazy, project-scoped, invalidated on change, and removed on disable/forget',async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'monqey-skills-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const workspace={id:randomUUID(),path:root}, store=new MemoryStore(root,'fixture');store.initialize();
  const source={actor:'review',sessionId:null,evidence:'Successful deployment check.'};
  let provider, invalidations=0;
  installWorkflowSkills({workspaceRegistry:{list:()=>[workspace]},skills:{registerProvider:create=>{provider=create({invalidate:()=>{invalidations++;}});}},effect(){}},{store,shared:{sync:()=>null}});
  const first=store.save({kind:'workflow',workspaceId:workspace.id,title:'Deploy safely',content:'When: Deploying this project.\nDo: Check the build before deploying.\nVerify: The build passed; deployment was not tested.'},source).entry;
  const options={cwd:root};const catalog=await provider.list(options);
  assert.equal(catalog[0].name,workflowSkillName(first));assert.equal(catalog[0].content,undefined);
  assert.equal(catalog[0].whenToUse,'Deploying this project.');
  assert.match((await provider.get(catalog[0],options)).content,/Check the build/);
  assert.equal((await provider.list({cwd:path.resolve(root,'..','other')})).length,0);
  const revised=store.save({...first,id:first.id,revision:1,content:'Run tests and check the build before deploying.'},source,{automatic:true}).entry;
  assert.equal(revised.revision,2);assert.equal(revised.history.length,1);assert.ok(invalidations>=2);
  assert.match((await provider.get(catalog[0],options)).content,/Run tests/);
  store.save({...revised,revision:2,content:'My manually corrected procedure.'},{...source,actor:'user'},{human:true});
  assert.equal(store.save({...revised,revision:3,content:'Overwrite human edit.'},source,{automatic:true}).skipped,true);
  store.configure({...defaults,enabled:false},0);assert.equal((await provider.list(options)).length,0);assert.equal(await provider.get(catalog[0],options),undefined);
  store.configure(defaults,1);store.forget(first.id,3);assert.equal((await provider.list(options)).length,0);assert.equal(await provider.get(catalog[0],options),undefined);
});

test('automatic workflow revisions require supplied identity, current version, correction and successful result',() => {
  const id=randomUUID(),workspace=randomUUID(),rows=[{id:'h',type:'human',text:'Correct the deployment order.'},{id:'t',type:'tool',success:true,text:'Validation passed.'}];
  const entry={id,revision:2,kind:'workflow',scope:'project',title:'Deploy',content:'Validate before deploy.',evidenceIds:['h','t']};
  const workflows=[{id,revision:2,title:'Deploy',manuallyEdited:false}];
  assert.equal(candidates(JSON.stringify({entries:[entry]}),rows,workspace,workflows)[0].id,id);
  assert.throws(()=>candidates(JSON.stringify({entries:[{...entry,revision:1}]}),rows,workspace,workflows),/current supplied/);
  assert.throws(()=>candidates(JSON.stringify({entries:[entry]}),rows,workspace,[{...workflows[0],manuallyEdited:true}]),/current supplied/);
  assert.throws(()=>candidates(JSON.stringify({entries:[{...entry,evidenceIds:['h']}]}),rows,workspace,workflows),/successful tool/);
  assert.throws(()=>candidates(JSON.stringify({entries:[entry]}),[rows[1],rows[0]],workspace,workflows),/after the user correction/);
});

test('shared projects expose confirmed workflow skills and keep legacy private workflows out',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'monqey-shared-skills-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const workspace={id:randomUUID(),path:root},store=new MemoryStore(root,'fixture');store.initialize();
  const source={actor:'review',sessionId:null,evidence:'Successful check.'};
  store.save({kind:'workflow',workspaceId:workspace.id,title:'Legacy private method',content:'Private project notes.'},source);
  const projectId=randomUUID(),decisionId=randomUUID();
  store.reconcileShared(workspace.id,{project:{id:projectId},decisions:[{conflict:false,versions:[{kind:'workflow',title:'Confirmed method',content:'Run the approved shared checks.',decisionId,version:randomUUID(),confirmedBy:'Test user'}]}]});
  let provider;installWorkflowSkills({workspaceRegistry:{list:()=>[workspace]},skills:{registerProvider:factory=>{provider=factory({invalidate(){}});}},effect(){}},{store,shared:{sync:()=>({snapshot:{project:{id:projectId}}})}});
  const catalog=await provider.list({cwd:root});assert.equal(catalog.length,1);assert.match(catalog[0].description,/Confirmed method/);
  assert.match((await provider.get(catalog[0],{cwd:root})).content,/approved shared checks/);
});
