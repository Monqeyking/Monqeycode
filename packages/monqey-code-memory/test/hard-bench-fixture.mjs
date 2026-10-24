import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
const require=createRequire(path.join(process.env.DSH_HOME,'profiles/web/package.json'));
const runtime=async name=>import(pathToFileURL(require.resolve(name)).href);
const {TypertRemoteService}=await runtime('@deepseek-ai/dsh-typert-protocol');
const {createUserMessage}=await runtime('@deepseek-ai/dsh-llm');
const {defineTool}=await runtime('@deepseek-ai/dsh-tools');
const {z}=await runtime('zod');
const bench=process.env.MONQEY_HB_DIR||fileURLToPath(new URL('./hard-bench/',import.meta.url));
const pairsPerArm=Number(process.env.MONQEY_HB_RUNS||5);
const usage=calls=>calls.reduce((sum,call)=>{for(const key of Object.keys(sum))sum[key]+=call.usage?.[key]||0;return sum;},{inputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:0});
const total=value=>Object.values(value).reduce((a,b)=>a+b,0);
export const inject=['llm','memory','skills','agents','agentPresets','workspaceRegistry','tools','systemPrompt','typert'];
const sessions=[
 {name:'money-helper',prompt:'Add `percentOf(cents, bps)` to `src/money.js` returning a whole number of cents. Add tests for it and run hb_test.',
  correction:'Please correct this: percentages of money must round half to even, not half up, and must use integer arithmetic only. Splitting an amount into parts must give back exactly the original total, so allocate the remainder instead of rounding each part. Add tie cases (5.00 at 1.5% and 7.00 at 1.5%) and a three-way split that sums exactly, then run hb_test and report what actually passed.'},
 {name:'settle',prompt:'Add `settle(store, items)` to a new file `src/settle.js` that applies several transfers using the existing `transfer` function and returns a report. Add tests and run hb_test.',
  correction:'Please correct this: from now on in this project, take a snapshot first and restore it if anything fails, and the report must say what happened and never throw for bad items. Every error code must be registered in `ERROR_CODES`. Read fee rates and account ids from `src/config.js`, never as literals. Report balances as two-decimal strings (use `formatCents`), not cents. Put the tests in `test/settle.test.js` using `node:test`. Run hb_test and report what actually passed.'},
];
export function apply(ctx){
 const route=JSON.parse(process.env.MONQEY_RECALL_LIVE_ROUTE),records=new Map(),calls=[],learningCalls=[],auxiliary=[];
 const allowed=new Set(['hb_list','hb_read','hb_write','hb_test','skill']);
 const started=Date.now();let active;
 const progress=value=>{
  const line=JSON.stringify(value)+'\n';fs.appendFileSync(path.join(process.env.DSH_HOME,'quality-progress.jsonl'),line);
  const archive=process.env.MONQEY_QUALITY_PROGRESS;
  if(archive)fs.appendFileSync(archive,line);
 };
 const stateFor=exec=>{const state=records.get(exec.agent?.id);if(!state)throw Error('No benchmark task context.');exec.signal.throwIfAborted();return state;};
 const inside=(cwd,file)=>{
  if(typeof file!=='string'||!file||path.isAbsolute(file)||file.includes('\0'))throw Error('Use a relative path inside the project.');
  const target=path.resolve(cwd,file);if(target!==cwd&&!target.startsWith(cwd+path.sep))throw Error('Path is outside the project.');
  if(target.split(path.sep).includes('node_modules'))throw Error('Path is not available.');return target;
 };
 const tool=(name,description,parameters,execute)=>ctx.tools.register(defineTool({name,description,parameters,output:{schema:{type:'string'},render:(_args,result)=>[{type:'text',text:result}]},isConcurrencySafe:()=>name!=='hb_write'&&name!=='hb_test',async execute(args,exec){return execute(args,stateFor(exec));}}));
 const walk=(dir,base=dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.name==='node_modules'?[]:item.isDirectory()?walk(path.join(dir,item.name),base):[path.relative(base,path.join(dir,item.name)).split(path.sep).join('/')]);
 tool('hb_list','List the files of this isolated project.',{},(_args,state)=>walk(state.cwd).sort().join('\n'));
 tool('hb_read','Read one project file.',{file:{type:'string',required:true}},(args,state)=>fs.readFileSync(inside(state.cwd,args.file),'utf8'));
 tool('hb_write','Create or replace one file under src/ or test/ with the complete content.',{file:{type:'string',required:true},content:{type:'string',required:true}},(args,state)=>{
  const target=inside(state.cwd,args.file),rel=path.relative(state.cwd,target).split(path.sep).join('/');
  if(!/^(src|test)\/.+\.(js|mjs)$/.test(rel))throw Error('Only .js or .mjs files under src/ or test/ can be written.');
  if(typeof args.content!=='string'||args.content.length>60000)throw Error('Supply at most 60000 characters.');
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,args.content);state.writes+=1;return `Saved ${rel}.`;
 });
 tool('hb_test','Run the project tests (node --test "test/**/*.test.js"). Returns the runner output.',{},(_args,state)=>{
  state.testRuns+=1;
  try{return execFileSync(process.execPath,['--test','test/**/*.test.js'],{cwd:state.cwd,encoding:'utf8',timeout:60000,maxBuffer:400000,windowsHide:true,env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP},stdio:['ignore','pipe','pipe']}).slice(-5000);}
  catch(error){throw Error(('Tests failed:\n'+(error.stdout||'')+(error.stderr||'')).slice(-5000));}
 });
 ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{
  const value=await next();return records.has(context.agent?.id)?{...value,tools:value.tools.filter(tool=>allowed.has(tool.name))}:value;
 });
 ctx.tools.guard(exec=>{
  if(!records.has(exec.agent?.id)||allowed.has(exec.name))return;
  records.get(exec.agent.id).scopeViolation=exec.name;return 'Benchmark scope: only the isolated project tools and native skill loader are permitted.';
 });
 ctx.on('tools/result',(exec,result)=>{
  const state=records.get(exec.agent?.id);
  if(state&&exec.name==='skill')state.skillResults.push({name:exec.arguments.name,ok:!result.isError});
 });
 ctx.on('agent/pre-step',({agent},next)=>{
  if(!records.has(agent.id))return next();
  active.steps++;
  if(active.steps>70||calls.length>900||total(usage(calls))>9000000||Date.now()-started>13000000){agent.cancel({kind:'hook',reason:'Hard benchmark budget reached.'});return Promise.resolve({kind:'reject'});}
  return next();
 });
 let markers=[];
 ctx.on('llm/stream',async function*(options,next){
  if(options.provider!==route.provider){yield* next();return;}
  const review=!!options.system?.startsWith('Extract at most three'),record={sessionId:options.sessionId,model:options.model,provider:options.provider,reasoningEffort:options.reasoningEffort,maxTokens:options.maxTokens,startedAt:Date.now()};calls.push(record);
  (review?learningCalls:active?.sessionId===options.sessionId?active.calls:auxiliary).push(record);
  if(!review&&active?.sessionId===options.sessionId&&active.memoryInPrompt===undefined)active.memoryInPrompt=markers.some(marker=>JSON.stringify([options.system,options.messages]).includes(marker));
  try{for await(const chunk of next()){
   if(chunk.type==='usage')record.usage=chunk.usage;
   if(review&&chunk.type==='text-delta')record.output=(record.output||'')+chunk.text;
   if(chunk.type==='finish')record.finish=chunk.reason;
   yield chunk;
  }}catch(error){record.error=String(error.message);throw error;}
  finally{record.ms=Date.now()-record.startedAt;}
 });
 async function runTurn(handle,text,label,limitMs){
  const agent=handle.agent,run={label,sessionId:agent.id,steps:0,calls:[],startedAt:Date.now()};active=run;
  const timer=setTimeout(()=>agent.cancel({kind:'hook',reason:'Hard benchmark turn timed out.'}),limitMs);
  try{agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text}]}));await agent.whenIdle();}
  finally{clearTimeout(timer);run.ms=Date.now()-run.startedAt;run.usage=usage(run.calls);run.totalTokens=total(run.usage);active=undefined;}
  const messages=agent.session.deriveMessages();
  run.tools=messages.flatMap(message=>message.content.filter(block=>block.type==='tool-call').map(block=>block.name));
  run.answer=[...messages].reverse().find(message=>message.role==='assistant'&&message.content.some(block=>block.type==='text'))?.content.filter(block=>block.type==='text').map(block=>block.text).join('\n')||'';
  run.metered=run.calls.length>0&&run.calls.every(call=>call.usage&&!call.error&&['stop','tool-calls'].includes(call.finish?.kind));
  run.completed=agent.session.ownEvents().filter(event=>event.type==='turn/end').at(-1)?.data.reason.kind==='completed';
  progress({...run,answer:run.answer.slice(0,600),calls:undefined,event:'turn-complete'});return run;
 }
 const grade=dir=>{
  const out=execFileSync(process.execPath,[path.join(bench,'grader','grade.mjs'),dir,'--json'],{encoding:'utf8',timeout:240000,maxBuffer:4000000,windowsHide:true});
  return JSON.parse(out);
 };
 class HardBench extends TypertRemoteService{
  constructor(owner){super(owner,'recallLive');}
  async run(){
   const verify=grade(path.join(bench,'template'));assert.equal(verify.A.passed,0,'Evaluator preflight: the starter must score 0 on A.');
   const modelCatalog=await ctx.llm.listModels(route.provider);assert.ok(modelCatalog.some(model=>model.id===route.model));await ctx.llm.resolveCallConfig(route);
   const configuration=ctx.memory.snapshot();await ctx.memory.configure({...configuration.settings,automatic:false},configuration.settingsRevision);
   const roots=[path.join(process.env.DSH_HOME,'project-a'),path.join(process.env.DSH_HOME,'project-b')];
   for(const cwd of roots)fs.mkdirSync(cwd);
   const learnedWorkspace=await ctx.workspaceRegistry.create(roots[0],'Ledger benchmark project'),controlWorkspace=await ctx.workspaceRegistry.create(roots[1],'Ledger benchmark project');
   const make=async(cwd,workspace,withTask)=>{
    fs.cpSync(path.join(bench,'template'),cwd,{recursive:true});
    if(!withTask)fs.rmSync(path.join(cwd,'TASK.md'));
    const handle=await ctx.agents.create({sessionId:randomUUID(),meta:{cwd,agentPreset:'standard'},agentOptions:{...route,maxTokens:12000},setup:agentCtx=>ctx.agentPresets.mount(agentCtx,'standard').then(()=>{})});
    assert.ok(cwd.startsWith(workspace.path+path.sep));
    records.set(handle.agent.id,{cwd,skillResults:[],writes:0,testRuns:0});handle.agent.session.append('sandbox/mode',{mode:'workspace-write'});return handle;
   };
   const task='Read TASK.md in this project and implement it. Use hb_list/hb_read to inspect the project, hb_write to write files, and hb_test to run the tests. When done, make sure the existing tests still pass and report what you verified.';
   const result={ok:false,provider:route.provider,model:route.model,training:[],runs:[],learningCalls,auxiliary,pairsPerArm,method:'Two real practice sessions, each with a human correction and the normal automatic post-turn review. Entries the reviewer saved for the learned project are kept; everything else is forgotten so the control workspace sees no memory. Then alternating control/learned runs of the held-out ledger task with identical TASK.md and starter. Hidden checks run after each run. Practice and review costs are retained.'};
   const finish=reason=>({...result,ok:!reason,reason,usage:usage(calls),totalTokens:total(usage(calls)),ms:Date.now()-started});
   for(const [index,session] of sessions.entries()){
    const training=await make(path.join(roots[0],`practice-${index+1}`),learnedWorkspace,false);
    const entry={name:session.name};
    try{
     const snap0=ctx.memory.snapshot();await ctx.memory.configure({...snap0.settings,automatic:false},snap0.settingsRevision);
     entry.initial=await runTurn(training,session.prompt,`${session.name}/initial`,420000);
     if(!entry.initial.metered||!entry.initial.completed){result.training.push(entry);return finish(`Practice ${session.name} did not complete with usable usage.`);}
     const snap=ctx.memory.snapshot();await ctx.memory.configure({...snap.settings,automatic:true,reviewProvider:route.provider,reviewModel:route.model,maxInputChars:24000,maxOutputTokens:1400},snap.settingsRevision);
     entry.feedback=await runTurn(training,session.correction,`${session.name}/correction`,420000);
     const deadline=Date.now()+90000;let after;
     do{await new Promise(resolve=>setTimeout(resolve,150));after=ctx.memory.snapshot();}while(Date.now()<deadline&&(!after.reviews.some(item=>item.sessionId===training.agent.id)||after.reviewing));
     entry.reviews=after.reviews.filter(item=>item.sessionId===training.agent.id);
     const stable=ctx.memory.snapshot();await ctx.memory.configure({...stable.settings,automatic:false},stable.settingsRevision);
     entry.files=walk(records.get(training.agent.id).cwd).sort();
     progress({event:'practice-complete',name:session.name,reviews:entry.reviews,initialTokens:entry.initial.totalTokens,feedbackTokens:entry.feedback.totalTokens});
     if(!entry.feedback.completed||!entry.feedback.metered){result.training.push(entry);return finish(`Practice ${session.name} correction did not complete.`);}
    }finally{records.delete(training.agent.id);await training.dispose();result.training.push(entry);}
   }
   const afterAll=ctx.memory.snapshot();
   const reviewed=afterAll.entries.filter(entry=>entry.workspaceId===learnedWorkspace.id&&entry.source.actor==='review');
   result.kept=reviewed;result.forgotten=afterAll.entries.filter(entry=>!reviewed.some(kept=>kept.id===entry.id)).map(entry=>({kind:entry.kind,scope:entry.scope,workspaceId:entry.workspaceId,title:entry.title,actor:entry.source?.actor}));
   if(!reviewed.length)return finish('Automatic learning saved nothing for the learned project; no memory was injected by hand.');
   for(const entry of afterAll.entries.filter(entry=>!reviewed.some(kept=>kept.id===entry.id)))ctx.memory.mutate({action:'forget',id:entry.id,revision:entry.revision});
   markers=reviewed.map(entry=>String(entry.title||'').slice(0,60)).filter(Boolean);
   progress({event:'learning-complete',kept:reviewed.map(entry=>({kind:entry.kind,scope:entry.scope,title:entry.title,content:entry.content})),forgottenCount:result.forgotten.length,practiceTokens:total(usage(calls))});
   if(pairsPerArm<1)return finish();
   for(let pair=1;pair<=pairsPerArm;pair++)for(const mode of pair%2?['control','learned']:['learned','control']){
    const index=mode==='learned'?0:1,cwd=path.join(roots[index],`ledger-${pair}`),workspace=index===0?learnedWorkspace:controlWorkspace;
    const handle=await make(cwd,workspace,true),state=records.get(handle.agent.id);
    try{
     const catalog=await ctx.skills.list({cwd,scope:handle.agent});
     const available=catalog.filter(item=>item.provider==='monqey-learned-workflows').map(item=>item.name);
     if(mode==='control')assert.equal(available.length,0,'Control isolation failed: a learned workflow is visible.');
     const run=await runTurn(handle,task,`ledger/${pair}/${mode}`,720000);
     const graded=grade(cwd);
     const callLog=run.calls.map(call=>({finish:call.finish,error:call.error,usage:call.usage,ms:call.ms}));
     if(process.env.MONQEY_HB_KEEP)fs.cpSync(cwd,path.join(process.env.MONQEY_HB_KEEP,`ledger-${pair}-${mode}`),{recursive:true,filter:src=>!src.split(path.sep).includes('node_modules')});
     Object.assign(run,{pair,mode,valid:run.metered&&run.completed,availableSkills:available,skillResults:state.skillResults,writes:state.writes,testRuns:state.testRuns,scopeViolation:state.scopeViolation,A:graded.A,B:graded.B,S:graded.S,existingTestsPass:graded.existingTestsPass,failed:graded.failed,files:walk(cwd).sort(),calls:callLog});
     result.runs.push(run);progress({event:'graded',label:run.label,valid:run.valid,A:run.A,B:run.B,S:run.S,existingTestsPass:run.existingTestsPass,failed:run.failed,totalTokens:run.totalTokens,ms:run.ms,memoryInPrompt:run.memoryInPrompt,skills:available.length,callLog});
     if(run.scopeViolation)return finish('Stopped on a scope violation.');
     if(result.runs.filter(item=>!item.valid).length>=3)return finish('Stopped after three incomplete or unmetered evaluation turns.');
    }finally{records.delete(handle.agent.id);await handle.dispose();}
   }
   if(auxiliary.length)return finish('Auxiliary model calls occurred.');
   return finish();
  }
 }
 new HardBench(ctx);
 ctx.typert.register({package:'hard-bench-fixture',face:'host',schemas:[],model:{services:[],objects:[],events:[]},invocations:[{id:'hard-bench-fixture#recallLive/run',service:'recallLive',namespace:'recallLive',method:'run',invocation:{kind:'direct'},parameters:[],result:{mode:'strict',typeSymbol:'hard-bench/result',schema:z.record(z.string(),z.unknown())}}]});
}
