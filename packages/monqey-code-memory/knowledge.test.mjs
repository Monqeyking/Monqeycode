import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {usedKnowledge,knowledgeSummary} from './lib/knowledge.js';
import {MemoryStore} from './lib/store.js';

test('knowledge records actual context and successful reads, not advertised skills or failed calls',()=>{
  const fact={id:randomUUID(),revision:2,title:'Invoice API',kind:'fact'},skill={id:randomUUID(),revision:3,title:'Import',kind:'workflow'};
  const text=`Saved local memories:\nfact: Invoice API [${fact.id} r2]: Use Acme.\nWorkflow available: Import [${skill.id}]. Load skill learned-${skill.id} on demand.`;
  const system={role:'user',source:{kind:'plugin',plugin:'@deepseek-ai/dsh-system-prompt',form:'snapshot',sections:[{name:'monqey:local-memory',text}]},content:[{type:'text',text}]};
  assert.deepEqual(usedKnowledge([system],[fact,skill]),[{id:fact.id,revision:2,via:'context'}]);
  const call=(id,name,args)=>({role:'assistant',source:{kind:'model'},content:[{type:'tool-call',id,name,arguments:JSON.stringify(args)}]});
  const result=(id,text,isError=false)=>({role:'user',source:{kind:'tool',callId:id},content:[{type:'tool-result',toolCallId:id,isError,content:[{type:'text',text}]}]});
  const history=[system,call('read','memory_read',{id:fact.id}),result('read',JSON.stringify(fact)),call('skill','skill',{name:`learned-${skill.id}`}),result('skill',`Learned project workflow; revision 3. Memory reference: ${skill.id}.`),call('failed','memory_read',{id:fact.id}),result('failed',JSON.stringify(fact),true)];
  assert.equal(usedKnowledge(history,[fact,skill]).length,3);
  assert.deepEqual(usedKnowledge(history,[fact]),[{id:fact.id,revision:2,via:'context'},{id:fact.id,revision:2,via:'memory-read'}]);
  assert.deepEqual(usedKnowledge([{...system,source:{kind:'human'}}],[fact,skill]),[]);
  assert.deepEqual(usedKnowledge([call('mismatch','memory_read',{id:fact.id}),result('mismatch',JSON.stringify(skill))],[fact,skill]),[]);
});

test('knowledge activity persists as bounded references, deduplicates and hides forgotten or foreign entries',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'monqey-knowledge-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new MemoryStore(root,'test');store.initialize();const sessionId=randomUUID();
  const entry=store.save({kind:'preference',title:'Language',content:'Use English.',workspaceId:null},{actor:'user',sessionId:null,evidence:''}).entry;
  const ref={id:entry.id,revision:1,via:'context'};
  store.recordKnowledge(sessionId,1,'used',[ref]);const revision=store.read().revision;store.recordKnowledge(sessionId,1,'used',[ref]);assert.equal(store.read().revision,revision);
  store.recordKnowledge(sessionId,1,'used',[{...ref,via:'memory-read'}]);store.recordKnowledge(sessionId,1,'learned',[{...ref,via:'saved'}]);
  const events=[{type:'assistant/message',data:{turn:1,message:{id:'answer'}}}];
  const persisted=new MemoryStore(root,'test').read().knowledgeActivity;
  const summary=knowledgeSummary(persisted,events,[entry]);assert.equal(summary[0].used.length,1);assert.equal(summary[0].learned.length,1);assert.equal(summary[0].messageId,'answer');assert.equal(summary[0].used[0].content,undefined);
  assert.equal(knowledgeSummary(persisted,events,[])[0].used.length,0);
  for(let turn=2;turn<110;turn++)store.recordKnowledge(sessionId,turn,'used',[ref]);
  assert.equal(store.read().knowledgeActivity.length,100);assert.equal(store.read().knowledgeActivity[0].turn,10);
  store.forget(entry.id,1);assert.equal(knowledgeSummary(store.read().knowledgeActivity,events,store.read().entries).flatMap(item=>item.used).length,0);
});
