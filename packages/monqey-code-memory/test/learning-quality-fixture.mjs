import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {tasks,starter,casesFor} from './import-cases.mjs';
import {gradeCode} from './import-grader.mjs';
const require=createRequire(path.join(process.env.DSH_HOME,'profiles/web/package.json'));
const runtime=async name=>import(pathToFileURL(require.resolve(name)).href);
const {TypertRemoteService}=await runtime('@deepseek-ai/dsh-typert-protocol');
const {createUserMessage}=await runtime('@deepseek-ai/dsh-llm');
const {defineTool}=await runtime('@deepseek-ai/dsh-tools');
const {z}=await runtime('zod');
const hash=value=>createHash('sha256').update(value).digest('hex');
const usage=calls=>calls.reduce((sum,call)=>{for(const key of Object.keys(sum))sum[key]+=call.usage?.[key]||0;return sum;},{inputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:0});
const total=value=>Object.values(value).reduce((a,b)=>a+b,0);
export const inject=['llm','memory','skills','agents','agentPresets','workspaceRegistry','tools','systemPrompt','typert'];
export function apply(ctx){
 const route=JSON.parse(process.env.MONQEY_RECALL_LIVE_ROUTE),records=new Map(),calls=[],learningCalls=[],auxiliary=[];
 const allowed=new Set(['benchmark_read','benchmark_write','benchmark_check','skill']);
 const started=Date.now();let active;
 const progress=value=>{
  const line=JSON.stringify(value)+'\n';fs.appendFileSync(path.join(process.env.DSH_HOME,'quality-progress.jsonl'),line);
  const archive=process.env.MONQEY_QUALITY_PROGRESS;
  if(archive)fs.appendFileSync(archive,line);
 };
 const stateFor=exec=>{const state=records.get(exec.agent?.id);if(!state)throw Error('No benchmark task context.');exec.signal.throwIfAborted();return state;};
 const tool=(name,description,parameters,execute)=>ctx.tools.register(defineTool({name,description,parameters,output:{schema:{type:'string'},render:(_args,result)=>[{type:'text',text:result}]},isConcurrencySafe:()=>name==='benchmark_read',async execute(args,exec){return execute(args,stateFor(exec));}}));
 tool('benchmark_read','Read a file in this isolated import task. Only README.md and importer.cjs are available.',{file:{type:'string',enum:['README.md','importer.cjs'],required:true}},(args,state)=>{
  if(!['README.md','importer.cjs'].includes(args.file))throw Error('File is outside this task.');return fs.readFileSync(path.join(state.cwd,args.file),'utf8');
 });
 tool('benchmark_write','Replace importer.cjs with the complete dependency-free CommonJS implementation. No other files can be changed.',{code:{type:'string',required:true}},(args,state)=>{
  if(typeof args.code!=='string'||args.code.length>22000)throw Error('Supply at most 22000 code characters.');
  fs.writeFileSync(path.join(state.cwd,'importer.cjs'),args.code);return 'Saved importer.cjs.';
 });
 tool('benchmark_check','Run the public import validation cases against the current importer.cjs. Failed cases include diagnostics. This does not run hidden acceptance tests.',{},(_args,state)=>{
  const code=fs.readFileSync(path.join(state.cwd,'importer.cjs'),'utf8'),suite=state.feedback?'feedback':'public';
  const grade=gradeCode(code,state.task,suite);state.lastCheck={...grade,codeHash:hash(code)};state.checks.push(state.lastCheck);
  if(!grade.allPass)throw Error('Public validation failed: '+JSON.stringify(grade));
  return `Validation checks passed: ${grade.passed}/${grade.total}. Suite ${suite}. `+grade.results.map(item=>item.name).join('; ');
 });
 ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{
  const value=await next();return records.has(context.agent?.id)?{...value,tools:value.tools.filter(tool=>allowed.has(tool.name))}:value;
 });
 ctx.tools.guard(exec=>{
  if(!records.has(exec.agent?.id)||allowed.has(exec.name))return;
  records.get(exec.agent.id).scopeViolation=exec.name;return 'Benchmark scope: only the isolated importer tools and native skill loader are permitted.';
 });
 ctx.on('tools/result',(exec,result)=>{
  const state=records.get(exec.agent?.id);
  if(state&&exec.name==='skill')state.skillResults.push({name:exec.arguments.name,ok:!result.isError});
 });
 ctx.on('agent/pre-step',({agent},next)=>{
  if(!records.has(agent.id))return next();
  active.steps++;
  if(active.steps>10||calls.length>150||total(usage(calls))>800000||Date.now()-started>1200000){agent.cancel({kind:'hook',reason:'Learning quality benchmark budget reached.'});return Promise.resolve({kind:'reject'});}
  return next();
 });
 ctx.on('llm/stream',async function*(options,next){
  if(options.provider!==route.provider){yield* next();return;}
  const review=!!options.system?.startsWith('Extract at most three'),record={sessionId:options.sessionId,model:options.model,provider:options.provider,reasoningEffort:options.reasoningEffort,maxTokens:options.maxTokens,startedAt:Date.now()};calls.push(record);
  (review?learningCalls:active?.sessionId===options.sessionId?active.calls:auxiliary).push(record);
  try{for await(const chunk of next()){
   if(chunk.type==='usage')record.usage=chunk.usage;
   if(review&&chunk.type==='text-delta')record.output=(record.output||'')+chunk.text;
   if(chunk.type==='finish')record.finish=chunk.reason;
   yield chunk;
  }}catch(error){record.error=String(error.message);throw error;}
  finally{record.ms=Date.now()-record.startedAt;}
 });
 async function runTurn(handle,text,label){
  const agent=handle.agent,run={label,sessionId:agent.id,steps:0,calls:[],startedAt:Date.now()};active=run;
  const timer=setTimeout(()=>agent.cancel({kind:'hook',reason:'Import task timed out.'}),150000);
  try{agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text}]}));await agent.whenIdle();}
  finally{clearTimeout(timer);run.ms=Date.now()-run.startedAt;run.usage=usage(run.calls);run.totalTokens=total(run.usage);active=undefined;}
  const messages=agent.session.deriveMessages();
  run.tools=messages.flatMap(message=>message.content.filter(block=>block.type==='tool-call').map(block=>block.name));
  run.answer=[...messages].reverse().find(message=>message.role==='assistant'&&message.content.some(block=>block.type==='text'))?.content.filter(block=>block.type==='text').map(block=>block.text).join('\n')||'';
  run.metered=run.calls.length>0&&run.calls.every(call=>call.usage&&!call.error&&['stop','tool-calls'].includes(call.finish?.kind));
  run.completed=agent.session.ownEvents().filter(event=>event.type==='turn/end').at(-1)?.data.reason.kind==='completed';
  progress({...run,event:'turn-complete'});return run;
 }
 class Quality extends TypertRemoteService{
  constructor(owner){super(owner,'recallLive');}
  async run(){
   const preflight=gradeCode(starter,'practice','public');assert.ok(!preflight.error&&preflight.results.length===casesFor('practice','public').length,'Evaluator preflight failed before any model call: '+JSON.stringify(preflight));
   const modelCatalog=await ctx.llm.listModels(route.provider);assert.ok(modelCatalog.some(model=>model.id===route.model));await ctx.llm.resolveCallConfig(route);
   const configuration=ctx.memory.snapshot();await ctx.memory.configure({...configuration.settings,automatic:false},configuration.settingsRevision);
   const roots=[path.join(process.env.DSH_HOME,'project-a'),path.join(process.env.DSH_HOME,'project-b')];
   for(const cwd of roots)fs.mkdirSync(cwd);
   const learnedWorkspace=await ctx.workspaceRegistry.create(roots[0],'Import benchmark project'),controlWorkspace=await ctx.workspaceRegistry.create(roots[1],'Import benchmark project');
   const make=async(task,cwd,workspace)=>{
    fs.mkdirSync(cwd,{recursive:true});fs.writeFileSync(path.join(cwd,'importer.cjs'),starter);fs.writeFileSync(path.join(cwd,'README.md'),tasks[task].spec+'\n\nPublic examples:\n'+JSON.stringify(casesFor(task,'public'),null,2));
    fs.writeFileSync(path.join(cwd,'existing-state.json'),'["sentinel: do not change"]\n');
    const handle=await ctx.agents.create({sessionId:randomUUID(),meta:{cwd,agentPreset:'standard'},agentOptions:{...route,maxTokens:2600},setup:agentCtx=>ctx.agentPresets.mount(agentCtx,'standard').then(()=>{})});
    // Memory/skills use the registered ancestor; native attachSession requires an exact cwd match.
    assert.ok(cwd.startsWith(workspace.path+path.sep));
    records.set(handle.agent.id,{task,cwd,checks:[],skillResults:[],feedback:false});handle.agent.session.append('sandbox/mode',{mode:'workspace-write'});return handle;
   };
   const request=task=>`${tasks[task].title}. Read README.md, implement importer.cjs, validate with benchmark_check and report what you actually checked. The README contains the complete functional requirements. Use only the isolated tools. Hidden tests are not available to you.`;
   const result={ok:false,provider:route.provider,model:route.model,training:{},runs:[],learningCalls,auxiliary,method:'One real practice episode plus simulated user correction, normal automatic post-turn review, then two unseen import tasks with three alternating pairs. Identical requirements and starter code. The learned project retains only automatically extracted workflows; control has no workflow. Raw practice history and hidden tests are inaccessible through benchmark tools. Public checks and hidden grading execute generated pure CommonJS functions in a separate permission-restricted Node process/VM; no arbitrary shell or project-file access. Cached/uncached tokens, practice and review costs are all retained.'};
   const finish=reason=>({...result,ok:!reason,reason,usage:usage(calls),totalTokens:total(usage(calls)),ms:Date.now()-started});
   const training=await make('practice',path.join(roots[0],'practice'),learnedWorkspace);
   try{
    result.training.initial=await runTurn(training,request('practice'),'practice');
    if(!result.training.initial.metered||!result.training.initial.completed)return finish('Practice turn did not complete with usable usage.');
    const snap=ctx.memory.snapshot();await ctx.memory.configure({...snap.settings,automatic:true,reviewProvider:route.provider,reviewModel:route.model,maxInputChars:24000,maxOutputTokens:1400},snap.settingsRevision);
    records.get(training.agent.id).feedback=true;
    result.training.feedback=await runTurn(training,'Please correct the validation approach: explicitly verify zero versus empty values, quoted delimiters and multiline fields, retrying an import, duplicate IDs, and an invalid later row without changing existing state. The practice check now includes those cases. Run benchmark_check, fix failures, and report the actual passing checks. For future import tasks carry forward a reusable validation workflow; each new task still defines its own duplicate policy.','practice-feedback');
    const state=records.get(training.agent.id),code=fs.readFileSync(path.join(state.cwd,'importer.cjs'),'utf8');
    result.training.validation=gradeCode(code,'practice','feedback');result.training.code=code;
    const deadline=Date.now()+60000;let snapAfter;
    do{await new Promise(resolve=>setTimeout(resolve,150));snapAfter=ctx.memory.snapshot();}while(Date.now()<deadline&&(!snapAfter.reviews.some(item=>item.sessionId===training.agent.id)||snapAfter.reviewing));
    result.training.reviews=snapAfter.reviews.filter(item=>item.sessionId===training.agent.id);
    const stable=ctx.memory.snapshot();await ctx.memory.configure({...stable.settings,automatic:false},stable.settingsRevision);
    if(!result.training.feedback.completed||!result.training.feedback.metered||!result.training.validation.allPass)return finish('Practice feedback did not produce a validated implementation.');
    result.workflows=snapAfter.entries.filter(entry=>entry.kind==='workflow'&&entry.workspaceId===learnedWorkspace.id&&entry.source.actor==='review');
    if(!result.workflows.length||!result.training.reviews.some(item=>item.status==='completed'))return finish('Automatic learning did not save a supported project workflow; no ideal workflow was injected.');
    for(const entry of snapAfter.entries.filter(entry=>!result.workflows.some(workflow=>workflow.id===entry.id)))ctx.memory.mutate({action:'forget',id:entry.id,revision:entry.revision});
    progress({event:'learning-complete',workflows:result.workflows,reviews:result.training.reviews,validation:result.training.validation});
   }finally{records.delete(training.agent.id);await training.dispose();}
   for(const task of ['vendors','inventory'])for(let pair=1;pair<=3;pair++)for(const mode of pair%2?['control','learned']:['learned','control']){
    const index=mode==='learned'?0:1,cwd=path.join(roots[index],`${task}-${pair}`),workspace=index===0?learnedWorkspace:controlWorkspace;
    const handle=await make(task,cwd,workspace),state=records.get(handle.agent.id);
    try{
     const catalog=await ctx.skills.list({cwd,scope:handle.agent});
     const available=catalog.filter(item=>item.provider==='monqey-learned-workflows').map(item=>item.name);
     assert.equal(available.length,mode==='learned'?result.workflows.length:0,'Project workflow isolation failed.');
     const run=await runTurn(handle,request(task),`${task}/${pair}/${mode}`);
     const code=fs.readFileSync(path.join(cwd,'importer.cjs'),'utf8');
     Object.assign(run,{task,pair,mode,code,availableSkills:available,skillResults:state.skillResults,loadedSkills:state.skillResults.filter(item=>item.ok).length,publicValidation:state.lastCheck,publicValidationCurrent:state.lastCheck?.codeHash===hash(code),grade:gradeCode(code,task,'private'),checks:state.checks});
     run.scopeViolation=state.scopeViolation;run.sentinelPreserved=fs.readFileSync(path.join(cwd,'existing-state.json'),'utf8')==='["sentinel: do not change"]\n';
     result.runs.push(run);progress({...run,event:'graded'});
     if(!run.metered||!run.completed)return finish('Stopped on an incomplete or unmetered evaluation turn.');
     if(run.grade.hardFailure||!run.sentinelPreserved||run.scopeViolation)return finish('Stopped on input mutation or a task scope/integrity violation.');
    }finally{records.delete(handle.agent.id);await handle.dispose();}
   }
   if(result.runs.length!==12||auxiliary.length||calls.some(call=>!call.usage||call.error||!['stop','tool-calls'].includes(call.finish?.kind)))return finish('Incomplete pairs, auxiliary calls or missing usage.');
   return finish();
  }
 }
 new Quality(ctx);
 ctx.typert.register({package:'learning-quality-fixture',face:'host',schemas:[],model:{services:[],objects:[],events:[]},invocations:[{id:'learning-quality-fixture#recallLive/run',service:'recallLive',namespace:'recallLive',method:'run',invocation:{kind:'direct'},parameters:[],result:{mode:'strict',typeSymbol:'learning-quality/result',schema:z.record(z.string(),z.unknown())}}]});
}
