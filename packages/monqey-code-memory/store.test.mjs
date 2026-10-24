import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { MemoryStore,defaults,hasSecret,automaticLimits } from './lib/store.js';
import { digest,shouldReview,candidates,reviewInput,reviewInstruction } from './lib/learning.js';
const source={actor:'user',sessionId:null,evidence:''};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'monqey-memory-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new MemoryStore(root,'user-a');store.initialize();return{root,store,workspace:randomUUID()};}
const note=(title='Language',content='Use English UI labels.')=>({kind:'preference',title,content,workspaceId:null});
test('memory persists across models, restart and relocation; another local user has a separate profile',t=>{
 const{root,store}=fixture(t);const profile=store.read().profileId;store.save(note(),source);
 assert.equal(new MemoryStore(root,'user-a').read().profileId,profile);
 const other=new MemoryStore(root,'user-b');other.initialize();assert.equal(other.search(null,'').length,0);assert.notEqual(other.read().profileId,profile);
 const relocated=path.join(root,'relocated');fs.cpSync(path.join(root,'storages'),path.join(relocated,'storages'),{recursive:true});
 assert.equal(new MemoryStore(relocated,'user-a').read().profileId,profile);assert.equal(new MemoryStore(relocated,'user-a').search(null,'English')[0].content,'Use English UI labels.');
});
test('project recall is isolated and injected context stays bounded',t=>{
 const{store,workspace}=fixture(t);const other= randomUUID();
 const first=store.save({...note('Project fact','Use the Acme invoicing API.'),kind:'fact',workspaceId:workspace},source).entry;
 store.save({...note('Foreign fact','Use the SecretWidgets API.'),kind:'fact',workspaceId:other},source);
 store.save(note(),source);
 assert.equal(store.search(other,'Acme').length,0);assert.throws(()=>store.get(first.id,other),/not found/);
 const text=store.prompt(workspace,'Acme');assert.ok(text.includes('Acme'));assert.ok(text.includes('English'));assert.ok(!text.includes('SecretWidgets'));
 for(let i=0;i<8;i++)store.save(note('Preference '+i,'P'.repeat(1500)),source);
 assert.ok(store.prompt(workspace,'Acme').length<3500);assert.ok(store.prompt(workspace,'Acme').includes('Acme'));
});
test('edits use revisions, automatic learning preserves user edits and forgetting prevents re-learning',t=>{
 const{store}=fixture(t);const first=store.save(note(),source).entry;
 const revised=store.save({...note('Language','Use Dutch explanations with English UI labels.'),id:first.id,revision:1},source,{human:true}).entry;
 assert.equal(revised.history[0].content,first.content);assert.equal(revised.revision,2);
 assert.throws(()=>store.save({...note(),id:first.id,revision:1},source),/changed/);
 assert.equal(store.save(note(),{...source,actor:'review'},{automatic:true}).skipped,true);
 store.forget(first.id,2);assert.equal(store.read().entries.length,0);assert.equal(store.save(note(),source,{automatic:true}).skipped,true);
 assert.equal(fs.readFileSync(store.file,'utf8').includes('Use Dutch'),false);
 assert.ok(store.save(note(),source,{human:true}).entry);
});
test('disabled memory is not recalled or saved by agents; corrupt storage is retained',t=>{
 const{store}=fixture(t);store.save(note(),source);store.configure({...defaults,enabled:false},0);
 assert.equal(store.prompt(null,'English'),'');assert.deepEqual(store.search(null,''),[]);assert.throws(()=>store.save(note('Other'),source),/disabled/);
 assert.throws(()=>store.configure(defaults,0),/changed/);const bytes=fs.readFileSync(store.file);assert.throws(()=>store.configure({...defaults,maxOutputTokens:9999},1),/budget/);assert.deepEqual(fs.readFileSync(store.file),bytes);
 fs.writeFileSync(store.file,'{broken');assert.throws(()=>store.read(),/retained/);assert.equal(fs.readFileSync(store.file,'utf8'),'{broken');
});
test('obvious credentials and path traversal identifiers are rejected',t=>{
 const{store}=fixture(t);assert.ok(hasSecret('api_key=sk-123456789012345678901234567890'));
 assert.throws(()=>store.save(note('Credential','Bearer 123456789012345678901234'),source),/credential/);
 assert.throws(()=>store.get('../../outside',null),/identifier/);assert.equal(store.read().entries.length,0);
});
test('learning uses bounded evidence and refuses assistant-only claims or fabricated evidence',()=>{
 const messages=[{id:'1',role:'user',source:{kind:'human'},content:[{type:'text',text:'Remember: I prefer short summaries.'}]},{id:'2',role:'assistant',source:{kind:'model'},content:[{type:'text',text:'Everything definitely passed.'}]},{id:'3',role:'user',source:{kind:'tool',callId:'call'},content:[{type:'tool-result',toolCallId:'call',content:[{type:'text',text:'3 tests passed'}]}]}];
 const rows=digest(messages,3000);assert.ok(shouldReview(rows));assert.equal(rows[2].success,true);
 const entry={kind:'preference',scope:'personal',title:'Concise',content:'Use short summaries.',evidenceIds:['e0']};assert.equal(candidates(JSON.stringify({entries:[entry]}),rows,null)[0].workspaceId,null);
 assert.throws(()=>candidates(JSON.stringify({entries:[{...entry,evidenceIds:['e1']}]}),rows,null),/user evidence/);
 assert.throws(()=>candidates(JSON.stringify({entries:[{...entry,evidenceIds:['invented']}]}),rows,null),/unknown evidence/);
 const workflow={...entry,kind:'workflow',scope:'project',evidenceIds:['e1']};assert.throws(()=>candidates(JSON.stringify({entries:[workflow]}),rows,randomUUID()),/tool evidence/);
 assert.ok(candidates(JSON.stringify({entries:[{...workflow,evidenceIds:['e2']}]}),rows,randomUUID())[0].evidence.includes('3 tests passed'));
 assert.ok(digest([{...messages[0],content:[{type:'text',text:'api_key=sk-123456789012345678901234567890'}]}]).length===0);
});
test('the local review gate skips routine chat and unresolved work, and selects preferences or verified recovery',()=>{
 const human=text=>({id:'human',role:'user',source:{kind:'human'},content:[{type:'text',text}]});
 for(const text of ['My usual style is concise task summaries.','Mijn uitleg mag kort en de UI is Engels.','We use English UI labels.'])assert.equal(shouldReview(digest([human(text)])),true);
 for(const text of ['Hello','Thanks','List this folder.','Fix this broken parser.'])assert.equal(shouldReview(digest([human(text)])),false);
 assert.equal(shouldReview([]),false);
 assert.equal(shouldReview(digest([human('   ')])),false);
 assert.equal(shouldReview(digest([{role:'assistant',source:{kind:'model'},content:[{type:'text',text:'The user likes short answers.'}]}])),false);
 const tool=(id,isError)=>({id,role:'user',source:{kind:'tool'},content:[{type:'tool-result',isError,content:[{type:'text',text:isError?'Check failed.':'Check passed.'}]}]});
 assert.equal(shouldReview(digest([human('Run the parser.'),tool('failed',true)])),false);
 assert.equal(shouldReview(digest([human('Run the parser.'),tool('pass',false)])),false);
 assert.equal(shouldReview(digest([human('Run the parser.'),tool('failed',true),tool('pass',false)])),true);
 assert.equal(shouldReview(digest([human('Correct the parser.'),tool('pass',false)])),true);
 assert.equal(shouldReview(digest([human('Correct the parser.'),tool('pass',false),tool('failed',true)])),false);
 assert.equal(shouldReview(digest([human('Correct the parser.'),tool('pass',false),human('Thanks')])),false);
 assert.deepEqual(digest([human('Correct the parser.'),tool('pass',false)],12000,'pass'),[]);
 assert.equal(shouldReview(digest([human('Always use English.'),tool('pass',false),human('Hello')],12000,'pass')),false);
});

test('automatic budget is profile-wide, persists before dispatch and survives restart without rewriting old memories',t=>{
 const {root,store}=fixture(t),now=100000000,session=randomUUID();
 store.save(note(),source);const entries=store.read().entries;
 assert.equal(store.read().reviewAttempts,undefined);
 for(let i=0;i<automaticLimits.reviews;i++)assert.equal(new MemoryStore(root,'user-a').reserveReview(i?randomUUID():session,'message-'+i,now+i),true);
 assert.equal(store.reserveReview(randomUUID(),'blocked',now+4),false);
 assert.equal(new MemoryStore(root,'user-a').learningBudget(now+4).used,3);
 assert.equal(store.reviewCursor(session),'message-0');
 assert.deepEqual(store.read().entries,entries);
 assert.equal(store.learningBudget(now+4).nextAt,now+automaticLimits.windowMs);
 assert.equal(store.reserveReview(randomUUID(),'after-expiry',now+automaticLimits.windowMs),true);
 assert.equal(store.learningBudget(now+automaticLimits.windowMs).used,3);
 assert.equal(store.learningBudget(now+automaticLimits.windowMs+3).used,1);
});

test('the full reviewer input is bounded and automatic lessons require ordered recovery evidence and specific structure',()=>{
 const rows=[{id:'h',type:'human',text:'Correct the importer.'},{id:'f',type:'tool',failed:true,text:'Invalid row changed existing data.'},{id:'p',type:'tool',success:true,text:'Rollback check passed.'}];
 const input=reviewInput(rows,Array.from({length:20},()=>({title:'x'.repeat(100)})),[{content:'x'.repeat(4000)}],8000);
 assert.ok(input);assert.ok(reviewInstruction.length+input.text.length<=8000);assert.ok(shouldReview(input.rows));
 assert.equal(reviewInput(rows,[],[],10),null);
 const workflow={kind:'workflow',scope:'project',title:'Atomic import',content:'When: An importer changes existing data before rejecting a row.\nDo: Validate all rows before applying changes.\nVerify: The rollback check passed; other cases were not tested.',evidenceIds:['f','p']};
 const read=item=>candidates(JSON.stringify({entries:[item]}),rows,randomUUID(),[],{automatic:true});
 assert.ok(read(workflow)[0].evidence.includes('Rollback check passed'));
 assert.throws(()=>read({...workflow,evidenceIds:['p']}),/failure or correction/);
 assert.throws(()=>read({...workflow,content:'Always test your code.'}),/applicability/);
 assert.throws(()=>read({...workflow,content:'x'.repeat(1601)}),/compact/);
 assert.throws(()=>candidates(JSON.stringify({entries:[workflow]}),[rows[2],rows[0],rows[1]],randomUUID(),[],{automatic:true}),/followed/);
});
