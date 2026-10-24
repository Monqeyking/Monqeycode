import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gradeCode} from './test/import-grader.mjs';
import {casesFor} from './test/import-cases.mjs';
import {summarize} from './learning-quality-report.mjs';
import http from 'node:http';
import postJson from './test/live-rpc.cjs';
test('import evaluator rejects broken implementations and detects mutation on errors',()=>{
 const broken=gradeCode('module.exports={importData(){return []}}','vendors','private');assert.ok(broken.passed<broken.total);assert.equal(broken.hardFailure,false);
 const mutating=gradeCode('module.exports={importData(s,e){e.length=0;throw Error("bad")}}','inventory','private');assert.equal(mutating.hardFailure,true);
 const escaping=gradeCode('require("node:fs").writeFileSync("bad.txt","bad");','practice','public');assert.equal(escaping.passed,0);
});
test('import evaluator checks idempotence and task-specific duplicate policies',()=>{
 assert.ok(casesFor('vendors','private').some(item=>item.repeat));
 assert.ok(casesFor('vendors','private').find(item=>item.name==='duplicate ID rejected').throws);
 assert.deepEqual(casesFor('inventory','private').find(item=>item.name==='last duplicate wins').expected.at(-1),{code:'a',quantity:9,title:'Last',tag:'keep'});
 const basic='module.exports={importData(source,existing=[]){return JSON.parse(source).map(r=>({code:r.code,quantity:r.count,title:r.title||""}))}}';
 const grade=gradeCode(basic,'inventory','private');assert.ok(grade.results.find(item=>item.name==='basic inventory').pass);assert.ok(!grade.results.find(item=>item.name==='merge keeps fields').pass);
});
test('inventory evaluator accepts a complete reference implementation',()=>{
 const code=`module.exports={importData(source,existing=[]){
 if(typeof source!=='string')throw Error('text required');const rows=JSON.parse(source);if(!Array.isArray(rows))throw Error('array required');
 const original=new Map(existing.map(row=>[row.code,row]));const incoming=new Map();
 for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.code!=='string'||!row.code.trim()||typeof row.count!=='number'||!Number.isInteger(row.count)||row.count<0||!Number.isFinite(row.count)||('title'in row&&typeof row.title!=='string'))throw Error('invalid row');
 const code=row.code.trim();incoming.set(code,{code,quantity:row.count,title:'title'in row?row.title:(original.get(code)?.title??'')});}
 const out=existing.map(row=>({...row,...(incoming.get(row.code)||{})}));for(const [code,row]of incoming)if(!original.has(code))out.push(row);return out;}};`;
 const grade=gradeCode(code,'inventory','private');assert.equal(grade.allPass,true,JSON.stringify(grade.results.filter(item=>!item.pass)));
});
test('permission-restricted evaluator works through a preserved project junction',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'monqey-grader-link-')),link=path.join(root,'test');
 try{
  fs.symlinkSync(fileURLToPath(new URL('./test',import.meta.url)),link,process.platform==='win32'?'junction':'dir');
  const url=pathToFileURL(path.join(link,'import-grader.mjs')).href;
  const source=`import {gradeCode} from ${JSON.stringify(url)};const r=gradeCode('module.exports={importData(){return []}}','practice','public');if(r.error||r.results.length!==4)throw Error(JSON.stringify(r));console.log('ok');`;
  assert.match(execFileSync(process.execPath,['--preserve-symlinks','--input-type=module','--eval',source],{encoding:'utf8',windowsHide:true,timeout:20000}),/ok/);
 }finally{
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^monqey-grader-link-/);
  if(fs.existsSync(link)){assert.ok(fs.lstatSync(link).isSymbolicLink());fs.unlinkSync(link);}
  fs.rmSync(root,{recursive:true,force:true});
 }
});
test('quality summary separates unseen checks and includes the up-front learning cost',()=>{
 const call={usage:{inputTokens:10,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:0}};
 const result={ok:true,auxiliary:[],training:{initial:{calls:[call]},feedback:{calls:[call]}},learningCalls:[call],runs:[],totalTokens:150};
 for(const task of ['vendors','inventory'])for(const mode of ['control','learned'])for(let pair=1;pair<=3;pair++){
  const cases=casesFor(task,'private');result.runs.push({task,mode,pair,calls:[call],totalTokens:10,ms:100,loadedSkills:mode==='learned'?1:0,sentinelPreserved:true,publicValidationCurrent:true,publicValidation:{allPass:true},grade:{total:cases.length,passed:cases.length,results:cases.map(item=>({name:item.name,pass:true}))}});
 }
 const summary=summarize(result);assert.equal(summary.groups[0].unseenTotal,48);assert.equal(summary.groups[0].total,60);assert.equal(summary.accounting.learnedIncludingPracticeAndReview,90);assert.equal(summary.accounting.totalReportedTokens,150);
 result.runs[0].grade.results.find(item=>item.name==='zero remains zero').pass=false;result.runs[0].grade.passed--;
 assert.equal(summarize(result).groups[0].unseenPassed,47);assert.equal(summarize(result).groups[0].passed,59);
 result.runs[1].pair=1;assert.throws(()=>summarize(result),/Duplicate/);
});
test('live test RPC waits for its explicit deadline and reports bad JSON',async()=>{
 let invalid=false;
 const server=http.createServer((_request,response)=>setTimeout(()=>response.end(invalid?'not JSON':'{"ok":true}'),80));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const url=`http://127.0.0.1:${server.address().port}/`;
  assert.deepEqual(await postJson(url,{}, {'content-type':'application/json'},1000),{ok:true});
  await assert.rejects(postJson(url,{}, {},10),/abort/i);
  invalid=true;await assert.rejects(postJson(url,{}, {},1000),SyntaxError);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
