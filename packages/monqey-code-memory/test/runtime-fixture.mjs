import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { SharedProjectStore } from '../lib/shared-store.js';
const require=createRequire(path.join(process.env.DSH_HOME,'profiles/web/package.json'));
const {TypertRemoteService}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-protocol')).href);
const {LlmAdapter,createUserMessage}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
const {z}=await import(pathToFileURL(require.resolve('zod')).href);
const {defineTool}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);
export const inject=['memory','sharedProject','agents','tools','agentPresets','workspaceRegistry','llm','typert','skills'];
export function apply(ctx){
 const calls=[];let holdReview=false,heldSignal,policyMode='normal',duringPolicy,lateChange,mutations=0;
 class Adapter extends LlmAdapter{
  async listModels(provider){return[{provider,id:'fixture',name:'Fixture',contextWindow:32768}];}
  async *stream(options){
   calls.push(options);let text='Fixture answer.';
   if(options.system?.includes('Extract at most three')&&holdReview){heldSignal=options.signal;await new Promise((_resolve,reject)=>{if(options.signal.aborted)reject(new Error('Cancelled'));else options.signal.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true});});}
   if(options.system?.startsWith('Check a proposed agent tool action')){
    if(policyMode==='error')throw Error('Fixture reviewer unavailable.');
    const input=JSON.parse(options.messages[0].content[0].text),conflict=input.decisions.some(item=>item.content.includes('cannot be edited'))&&JSON.stringify(input.action).includes('allow edits');
    if(duringPolicy){const change=duringPolicy;duringPolicy=null;change();}
    text=policyMode==='invalid'?'not JSON':JSON.stringify({verdict:conflict?'conflict':'allow',reason:conflict?'Sent invoices cannot be edited.':'Consistent with project decisions.',decisionIds:conflict?[input.decisions[0].id]:[]});
   }
   else if(options.system?.includes('Extract at most three')){const input=JSON.parse(options.messages[0].content[0].text);const human=input.evidence.filter(row=>row.type==='human').at(-1),receipt=input.evidence.find(row=>row.type==='tool'&&row.success);const previous=human.text.includes('Refine the fixture workflow')&&input.workflows?.find(item=>item.title==='Validate the fixture workflow');text=JSON.stringify({entries:[previous?{id:previous.id,revision:previous.revision,kind:'workflow',scope:'project',title:previous.title,content:'When: Validating this fixture project.\nDo: Run the fixture check and inspect its successful result, then check the rollback plan before reporting completion.\nVerify: The fixture check passed; the rollback plan was not tested.',evidenceIds:[human.id,receipt.id]}:human.text.includes('fixture workflow')?{kind:'workflow',scope:'project',title:'Validate the fixture workflow',content:'When: Validating this fixture project.\nDo: Run the fixture check and inspect its successful result before reporting completion.\nVerify: The fixture check passed; other behavior was not tested.',evidenceIds:[human.id,receipt.id]}:{kind:'preference',scope:'personal',title:'Concise summaries',content:'Use concise task summaries.',evidenceIds:[human.id]}]});}
   else {
    const human=[...options.messages].reverse().find(message=>message.source?.kind==='human');
    if(human?.content.some(block=>block.type==='text'&&block.text==='Load the learned workflow skill.')&&!options.messages.some(message=>message.source?.kind==='tool')){
     const skillName=JSON.stringify(options.messages).match(/learned-[0-9a-f-]{36}/)?.[0];assert.ok(skillName,'Fixture workflow missing from the real request.');
     const id=randomUUID(),block={type:'tool-call',id,name:'skill',arguments:JSON.stringify({name:skillName})};
     yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id,name:block.name,argumentsDelta:block.arguments};yield{type:'block-end',index:0,block};yield{type:'finish',reason:{kind:'tool-calls'}};return;
    }
    if(JSON.stringify(options.messages).includes('Show the Monqey thinking preview.')){
     await new Promise((resolve,reject)=>{const timer=setTimeout(done,45000);function done(){options.signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);reject(new Error('Preview cancelled.'));}if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});});
    }
    if(human?.content.some(block=>block.type==='text'&&block.text.includes('fixture workflow'))&&!options.messages.some(message=>message.source?.kind==='tool')){
     const id=randomUUID(),block={type:'tool-call',id,name:'memory_fixture_check',arguments:'{}'};
     yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id,name:block.name,argumentsDelta:'{}'};yield{type:'block-end',index:0,block};yield{type:'finish',reason:{kind:'tool-calls'}};return;
    }
   }
   yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text};yield{type:'block-end',index:0,block:{type:'text',text}};yield{type:'usage',usage:{inputTokens:24,outputTokens:18,cacheReadTokens:4}};yield{type:'finish',reason:{kind:'stop'}};
  }
 }
 ctx.llm.registerAdapter(['memory-fixture-main','memory-fixture-review'],new Adapter());
 ctx.tools.register(defineTool({name:'memory_fixture_check',description:'Read-only test fixture check.',parameters:{},output:{schema:{type:'string'},render:(_args,result)=>[{type:'text',text:result}]},isConcurrencySafe:()=>true,async execute(){return 'Fixture checks passed.';}}));
 ctx.tools.register(defineTool({name:'memory_fixture_mutate',description:'Test fixture mutation counter.',parameters:{intent:{type:'string',required:true,description:'Intended change.'}},output:{schema:{type:'string'},render:(_args,result)=>[{type:'text',text:result}]},async execute(){mutations++;return 'Applied.';}}));
 ctx.on('tools/pre-execute',async(_exec,next)=>{const decision=await next();if(lateChange){const change=lateChange;lateChange=null;change();}return decision;});
 class Fixture extends TypertRemoteService{
  constructor(owner){super(owner,'memoryFixture');}
  async run(){
   const workspace=await ctx.workspaceRegistry.create(process.env.DSH_HOME,'Memory test project');
   const make=(cwd,meta={})=>ctx.agents.create({sessionId:'session-'+randomUUID(),meta:{cwd,agentPreset:'standard',...meta},agentOptions:{provider:'memory-fixture-main',model:'fixture'},setup:agentCtx=>ctx.agentPresets.mount(agentCtx,'standard').then(()=>{})});
   const handle=await make(process.env.DSH_HOME),agent=handle.agent;
   try{
    await workspace.attachSession(agent.id);
    const execute=(name,args,actor=agent)=>ctx.tools.execute({name,arguments:args,agent:actor,callId:randomUUID(),signal:new AbortController().signal});
    const args={scope:'personal',kind:'preference',title:'Interface language',content:'Use English interface labels.'};
    agent.session.append('sandbox/mode',{mode:'read-only'});assert.equal((await execute('memory_save',args)).isError,true);
    assert.equal((await execute('memory_search',{query:''})).isError,false);
    agent.session.append('sandbox/mode',{mode:'workspace-write'});agent.session.append('plan/mode',{active:true});assert.equal((await execute('memory_save',args)).isError,true);agent.session.append('plan/mode',{active:false});
    const saved=await execute('memory_save',args);assert.equal(saved.isError,false,JSON.stringify(saved));const preference=JSON.parse(saved.value).entry;
    const projectSave=await execute('memory_save',{scope:'project',kind:'fact',title:'Invoice API',content:'This workspace uses the Acme invoice API.'});assert.equal(projectSave.isError,false,JSON.stringify(projectSave));const projectId=JSON.parse(projectSave.value).entry.id;
    const secondDirectory=path.join(process.env.DSH_HOME,'second-project');fs.mkdirSync(secondDirectory);const secondWorkspace=await ctx.workspaceRegistry.create(secondDirectory,'Other test project');const second=await make(secondDirectory);
    try{await secondWorkspace.attachSession(second.agent.id);second.agent.session.append('sandbox/mode',{mode:'workspace-write'});const foreign=await execute('memory_read',{id:projectId},second.agent);assert.equal(foreign.isError,true);assert.equal(JSON.parse((await execute('memory_search',{query:'Acme'},second.agent)).value).entries.length,0);assert.equal((await execute('memory_read',{id:preference.id},second.agent)).isError,false);}finally{await second.dispose();}
    agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'Hello.'}]}));await agent.whenIdle();
    await new Promise(resolve=>setTimeout(resolve,1700));assert.equal(calls.filter(call=>call.system?.includes('Extract at most three')).length,0,'Routine chat requested a learning review.');
    agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'My usual style is concise task summaries.'}]}));await agent.whenIdle();
    const deadline=Date.now()+12000;while(Date.now()<deadline&&!ctx.memory.snapshot().entries.some(entry=>entry.title==='Concise summaries'))await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(ctx.memory.snapshot().entries.some(entry=>entry.title==='Concise summaries'),'Automatic post-turn learning did not run. '+JSON.stringify({reviews:ctx.memory.snapshot().reviews,ends:agent.session.ownEvents().filter(event=>event.type==='turn/end').map(event=>event.data.reason),sources:agent.session.deriveMessages().map(message=>({role:message.role,source:message.source?.kind})),calls:calls.map(call=>({review:!!call.system?.includes('Extract at most three')}))}));
    const reviewCall=calls.find(call=>call.system?.includes('Extract at most three'));assert.ok(reviewCall);assert.deepEqual(reviewCall.tools,[]);assert.equal(reviewCall.maxTokens,600);assert.ok(reviewCall.system.length+reviewCall.messages[0].content[0].text.length<=8000);assert.equal(ctx.memory.snapshot().learningBudget.used,1);
    const activity=ctx.memory.activity(agent.id);assert.ok(activity.turns.some(turn=>turn.used.some(ref=>ref.id===preference.id)),'Actual request context was not recorded.');assert.ok(activity.turns.some(turn=>turn.learned.some(ref=>ref.title==='Concise summaries')),'Successful learning was not recorded.');
    const learnedTurn=activity.turns.find(turn=>turn.learned.length);assert.equal(ctx.memory.knowledgeEntry(agent.id,learnedTurn.turn,learnedTurn.learned[0].id).title,'Concise summaries');
    const mainCall=calls.find(call=>!call.system?.includes('Extract at most three'));
    const mainPrompt=JSON.stringify({system:mainCall.system,messages:mainCall.messages});
    assert.ok(mainPrompt.includes('You are Monqey Agent, the AI assistant in the Monqey Agent application.'),'Monqey product identity missing from the actual model request.');
    assert.ok(!mainPrompt.includes('You are an AI agent powered by DeepSeek Harness.'),'Upstream product opener is still in the actual model request.');
    const before=calls.length;agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'Give me a concise summary.'}]}));await agent.whenIdle();
    assert.ok(JSON.stringify(calls[before].messages).includes('Use English interface labels.'),'Saved memory missing from the next real model request.');
    await new Promise(resolve=>setTimeout(resolve,1800));
    assert.equal(calls.filter(call=>call.system?.includes('Extract at most three')).length,1,'Automatic review ignored the five-minute cooldown.');
    const snap=ctx.memory.snapshot();await ctx.memory.configure({...snap.settings,reviewProvider:'memory-fixture-review',reviewModel:'fixture'},snap.settingsRevision);
    const custom=await ctx.memory.review(agent.id);assert.equal(custom.status,'completed',JSON.stringify(custom));assert.equal(calls.at(-1).provider,'memory-fixture-review');assert.equal(agent.options.provider,'memory-fixture-main');
    agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'Check the fixture workflow and save the reusable method.'}]}));await agent.whenIdle();
    const learnedWorkflow=await ctx.memory.review(agent.id);assert.equal(learnedWorkflow.status,'completed',JSON.stringify(learnedWorkflow));
    const workflow=ctx.memory.snapshot().entries.find(entry=>entry.kind==='workflow');assert.ok(workflow);assert.equal(workflow.workspaceId,workspace.id);assert.ok(workflow.source.evidence.includes('Fixture checks passed'));
    assert.equal((await execute('memory_read',{id:workflow.id})).isError,false);
    const corrector=await make(process.env.DSH_HOME);
    try {
      await workspace.attachSession(corrector.agent.id);
      corrector.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'Refine the fixture workflow: correct the order, after successful checks, also check the rollback plan. Run the fixture workflow check to validate the correction.'}]}));await corrector.agent.whenIdle();
      const revisionDeadline=Date.now()+12000;while(Date.now()<revisionDeadline&&ctx.memory.snapshot().entries.find(entry=>entry.id===workflow.id)?.revision!==2)await new Promise(resolve=>setTimeout(resolve,30));
      const revisedWorkflow=ctx.memory.snapshot().entries.find(entry=>entry.id===workflow.id);assert.equal(revisedWorkflow.revision,2);assert.match(revisedWorkflow.content,/rollback plan/);assert.equal(revisedWorkflow.history[0].content,workflow.content);
      assert.ok(!ctx.memory.activity(corrector.agent.id).turns.some(turn=>turn.used.some(ref=>ref.id===workflow.id)),'An advertised workflow was incorrectly counted as loaded.');
      const learned=ctx.memory.activity(corrector.agent.id).turns.flatMap(turn=>turn.learned);assert.ok(learned.some(ref=>ref.id===workflow.id&&ref.revision===2&&ref.via==='updated'));
    } finally { await corrector.dispose(); }
    const budgetAgent=await make(process.env.DSH_HOME),limitedAgent=await make(process.env.DSH_HOME);
    try {
      for(const actor of [budgetAgent.agent,limitedAgent.agent]){await workspace.attachSession(actor.id);actor.session.append('sandbox/mode',{mode:'workspace-write'});}
      budgetAgent.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'I prefer concise summaries.'}]}));await budgetAgent.agent.whenIdle();
      const budgetDeadline=Date.now()+12000;while(Date.now()<budgetDeadline&&ctx.memory.snapshot().learningBudget.used<3)await new Promise(resolve=>setTimeout(resolve,30));
      assert.equal(ctx.memory.snapshot().learningBudget.used,3);
      const settleDeadline=Date.now()+3000;while(ctx.memory.snapshot().reviewing&&Date.now()<settleDeadline)await new Promise(resolve=>setTimeout(resolve,30));
      const reviewsBefore=calls.filter(call=>call.system?.includes('Extract at most three')).length;
      limitedAgent.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'I always prefer concise summaries.'}]}));await limitedAgent.agent.whenIdle();await new Promise(resolve=>setTimeout(resolve,1700));
      assert.equal(calls.filter(call=>call.system?.includes('Extract at most three')).length,reviewsBefore,'Automatic review bypassed the profile budget.');
      const manual=await ctx.memory.review(limitedAgent.agent.id);assert.equal(manual.status,'completed',JSON.stringify(manual));assert.equal(ctx.memory.snapshot().learningBudget.used,3);
    } finally {await budgetAgent.dispose();await limitedAgent.dispose();}
    const reader=await make(process.env.DSH_HOME), outsider=await make(secondDirectory);
    try {
      await workspace.attachSession(reader.agent.id);await secondWorkspace.attachSession(outsider.agent.id);
      reader.agent.session.append('sandbox/mode',{mode:'read-only'});
      const history=await execute('history_search',{query:'concise'},reader.agent);assert.equal(history.isError,false,JSON.stringify(history));
      const match=JSON.parse(history.value).matches.find(item=>item.sessionId===agent.id);assert.ok(match,'Earlier conversation was not found by message content.');
      const excerpt=await execute('history_read',{sessionId:match.sessionId,seq:match.seq},reader.agent);assert.equal(excerpt.isError,false,JSON.stringify(excerpt));assert.ok(JSON.parse(excerpt.value).messages.length);
      const combined=await execute('history_recall',{query:'concise'},reader.agent);assert.equal(combined.isError,false,JSON.stringify(combined));
      assert.ok(JSON.parse(combined.value).matches.some(hit=>hit.sessionId===agent.id&&hit.messages.some(message=>/concise/i.test(message.text))),'Combined recall did not return cited source text.');
      assert.equal(JSON.parse((await execute('history_recall',{query:'concise'},outsider.agent)).value).matches.length,0);
      assert.equal((await execute('history_read',{sessionId:match.sessionId,seq:match.seq},outsider.agent)).isError,true);
      const skillName=`learned-${workflow.id}`;const loaded=await execute('skill',{name:skillName},reader.agent);assert.equal(loaded.isError,false,JSON.stringify(loaded));assert.ok(JSON.stringify(loaded.value).includes('Run the fixture check'));
      assert.equal((await execute('skill',{name:skillName},outsider.agent)).isError,true);
      reader.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'Load the learned workflow skill.'}]}));await reader.agent.whenIdle();
      assert.ok(ctx.memory.activity(reader.agent.id).turns.some(turn=>turn.used.some(ref=>ref.id===workflow.id&&ref.via==='skill')),'A successful native skill load was not recorded.');
      assert.throws(()=>ctx.memory.knowledgeEntry(outsider.agent.id,1,workflow.id),/no longer available/);
    } finally { await reader.dispose();await outsider.dispose(); }
    const beforeCancel=ctx.memory.snapshot().entries.length;holdReview=true;
    const pending=ctx.memory.review(agent.id);const holdDeadline=Date.now()+3000;while(!heldSignal&&Date.now()<holdDeadline)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(heldSignal);
    assert.equal((await ctx.memory.review(agent.id)).status,'busy');
    const permissionCommand=randomUUID();agent.session.append('command/run',{commandId:permissionCommand,name:'permission',args:'read-only',source:{kind:'user'}});agent.session.append('sandbox/mode',{mode:'read-only'});
    assert.equal((await pending).status,'cancelled');assert.ok(heldSignal.aborted);assert.equal(ctx.memory.snapshot().entries.length,beforeCancel);holdReview=false;
    agent.session.append('command/done',{commandId:permissionCommand,kind:'success'});agent.session.append('sandbox/mode',{mode:'workspace-write'});
    const enabled=ctx.memory.snapshot();await ctx.memory.configure({...enabled.settings,enabled:false},enabled.settingsRevision);assert.equal((await execute('memory_save',{...args,title:'Must stay disabled'})).isError,true);assert.equal(JSON.parse((await execute('memory_search',{query:''})).value).entries.length,0);
    const disabled=ctx.memory.snapshot();await ctx.memory.configure({...disabled.settings,enabled:true,automatic:false,reviewProvider:'',reviewModel:''},disabled.settingsRevision);
    let project=ctx.sharedProject.enable(workspace.id,'Shared test business');
    const personalCount=ctx.memory.snapshot().entries.filter(entry=>entry.workspaceId===null).length;
    const proposed=await execute('memory_save',{scope:'project',kind:'fact',title:'Shared invoices',content:'Sent invoices cannot be edited.'});assert.equal(proposed.isError,false,JSON.stringify(proposed));
    const proposal=JSON.parse(proposed.value).proposal;assert.equal(JSON.parse(proposed.value).needsConfirmation,true);
    project=ctx.sharedProject.snapshot(workspace.id);assert.equal(project.decisions.length,0);assert.equal(project.proposals.length,1);
    assert.ok(!ctx.tools.get('shared_project_accept'));
    project=ctx.sharedProject.resolve(workspace.id,proposal.id,project.revision,'accept');
    const sharedRead=await execute('shared_project_read',{decisionId:proposal.decisionId});assert.equal(sharedRead.isError,false);assert.equal(JSON.parse(sharedRead.value).decisions[0].versions[0].content,'Sent invoices cannot be edited.');
    agent.session.append('plan/mode',{active:true});assert.equal((await execute('shared_project_propose',{kind:'fact',title:'Read-only proposal',content:'Must not be saved.',reason:''})).isError,true);agent.session.append('plan/mode',{active:false});
    assert.throws(()=>ctx.memory.mutate({action:'save',kind:'fact',title:'Bypass shared approval',content:'Must not become a private project memory.',workspaceId:workspace.id}),/Co-work/);
    const linked=ctx.memory.snapshot().entries.find(entry=>entry.shared?.decisionId===proposal.decisionId);assert.ok(linked);assert.equal(linked.shared.projectId,project.project.id);
    assert.equal(ctx.memory.snapshot().entries.filter(entry=>entry.workspaceId===null).length,personalCount);
    let blocked=await execute('memory_fixture_mutate',{intent:'allow edits'});assert.equal(blocked.isError,true);assert.ok(JSON.stringify(blocked).includes('Shared project blocked'));assert.equal(mutations,0);
    const marker=path.join(process.env.DSH_HOME,'must-not-exist.txt');assert.ok(ctx.tools.get('pwsh',agent));
    const terminal=await execute('pwsh',{command:`Set-Content -LiteralPath '${marker.replaceAll("'","''")}' -Value 'allow edits'`,description:'Attempt conflicting fixture change'});assert.equal(terminal.isError,true);assert.ok(JSON.stringify(terminal).includes('Shared project blocked'));assert.equal(fs.existsSync(marker),false);
    const workerDirectory=path.join(path.dirname(process.env.DSH_HOME),path.basename(process.env.DSH_HOME)+'-worker');fs.mkdirSync(workerDirectory);
    const child=await make(workerDirectory,{origin:'subagent',parentSession:agent.id});try{assert.equal(child.agent.session.header.cwd,workerDirectory);child.agent.session.append('sandbox/mode',{mode:'workspace-write'});assert.equal((await execute('memory_fixture_mutate',{intent:'allow edits'},child.agent)).isError,true);assert.equal(mutations,0);}finally{await child.dispose();fs.rmdirSync(workerDirectory);}
    assert.equal((await execute('memory_fixture_mutate',{intent:'add an unrelated report'})).isError,false);assert.equal(mutations,1);
    const proposalInput={kind:'decision',title:'Invoice editing',content:'Edits are allowed with an audit trail.',reason:'Discussed and agreed.',decisionId:proposal.decisionId};
    project=ctx.sharedProject.propose(workspace.id,proposalInput);const replacement=project.proposals.find(item=>item.content===proposalInput.content);
    project=ctx.sharedProject.resolve(workspace.id,replacement.id,project.revision,'accept');
    const updated=ctx.memory.snapshot().entries.find(entry=>entry.id===linked.id);assert.equal(updated.content,proposalInput.content);assert.notEqual(updated.shared.version,linked.shared.version);
    assert.equal((await execute('memory_fixture_mutate',{intent:'allow edits'})).isError,false);assert.equal(mutations,2);
    for(const mode of ['invalid','error']){policyMode=mode;assert.equal((await execute('memory_fixture_mutate',{intent:'add a report'})).isError,true);assert.equal(mutations,2);}policyMode='normal';
    duringPolicy=()=>ctx.sharedProject.propose(workspace.id,{kind:'fact',title:'Changed during review',content:'Project changes while the reviewer runs.',reason:''});
    assert.equal((await execute('memory_fixture_mutate',{intent:'add a report'})).isError,true);assert.equal(mutations,2);
    lateChange=()=>ctx.sharedProject.propose(workspace.id,{kind:'fact',title:'Changed after review',content:'Project changes before the final guard.',reason:''});
    assert.equal((await execute('memory_fixture_mutate',{intent:'add a report'})).isError,true);assert.equal(mutations,2);
    assert.equal((await execute('write',{file_path:path.join(process.env.DSH_HOME,'.monqey','project.json'),content:'{}'})).isError,true);
    const newSetting=ctx.memory.snapshot();await ctx.memory.configure({...newSetting.settings,enabled:false},newSetting.settingsRevision);
    assert.equal((await execute('memory_fixture_mutate',{intent:'add a report'})).isError,false,'Disabling private memory disabled shared enforcement.');assert.equal(mutations,3);
    policyMode='error';assert.equal((await execute('memory_fixture_mutate',{intent:'add a report'})).isError,true);policyMode='normal';assert.equal(mutations,3);
    const restoreMemory=ctx.memory.snapshot();await ctx.memory.configure({...restoreMemory.settings,enabled:true},restoreMemory.settingsRevision);
    assert.equal((await execute('memory_read',{id:projectId})).isError,true,'Private legacy project notes leaked into shared recall.');
    const manifest=path.join(process.env.DSH_HOME,'.monqey','project.json'),manifestBytes=fs.readFileSync(manifest);fs.unlinkSync(manifest);
    assert.equal((await execute('memory_fixture_mutate',{intent:'add a report'})).isError,true);assert.equal(mutations,3);fs.writeFileSync(manifest,manifestBytes);
    project=ctx.sharedProject.snapshot(workspace.id);assert.ok(project.notices.length>0);
    const sharedStore=new SharedProjectStore(process.env.DSH_HOME),parallel=sharedStore.propose({kind:'decision',title:'Parallel choice',content:'A concurrent replacement from another computer.',reason:'Offline discussion.',decisionId:proposal.decisionId},{kind:'user',label:'Other person'});
    sharedStore.append(sharedStore.read(),{type:'accept',decisionId:proposal.decisionId,proposalId:parallel.id,parents:[linked.shared.version]},{kind:'user',label:'Other person'});
    const policyCalls=calls.filter(call=>call.system?.startsWith('Check a proposed')).length;
    assert.equal((await execute('memory_fixture_mutate',{intent:'add a report'})).isError,true);assert.equal(mutations,3);
    assert.equal(calls.filter(call=>call.system?.startsWith('Check a proposed')).length,policyCalls,'A deterministic version conflict should not call a model.');
    assert.equal(JSON.parse((await execute('shared_project_read',{decisionId:proposal.decisionId})).value).decisions[0].conflict,true);
    project=ctx.sharedProject.propose(workspace.id,proposalInput);const merged=project.proposals.find(item=>item.decisionId===proposal.decisionId&&item.content===proposalInput.content);assert.ok(merged);
    project=ctx.sharedProject.resolve(workspace.id,merged.id,project.revision,'accept');assert.equal(project.decisions[0].conflict,false);
    const requestStart=calls.length;agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'Summarize the current project knowledge.'}]}));await agent.whenIdle();
    const nextMain=calls.slice(requestStart).find(call=>!call.system?.startsWith('Check a proposed')&&!call.system?.includes('Extract at most three'));assert.ok(JSON.stringify(nextMain.messages).includes(project.project.id));assert.ok(JSON.stringify(nextMain.messages).includes(proposalInput.content));
    const sharedSkillInput={kind:'workflow',title:'Confirmed shared release checklist',content:'Run shared release checks, then check the rollback plan.',reason:'Test a human-confirmed reusable shared workflow.'};
    project=ctx.sharedProject.propose(workspace.id,sharedSkillInput);const sharedSkillProposal=project.proposals.find(item=>item.title===sharedSkillInput.title);assert.ok(sharedSkillProposal);
    assert.ok(!(await ctx.skills.list({cwd:process.env.DSH_HOME,scope:agent})).some(item=>item.description.includes(sharedSkillInput.title)),'An unconfirmed shared workflow became a skill.');
    project=ctx.sharedProject.resolve(workspace.id,sharedSkillProposal.id,project.revision,'accept');
    const sharedSkill=(await ctx.skills.list({cwd:process.env.DSH_HOME,scope:agent})).find(item=>item.description.includes(sharedSkillInput.title));assert.ok(sharedSkill,'Confirmed shared workflow missing from native catalog.');
    const reviewCount=calls.filter(call=>call.system?.startsWith('Check a proposed')).length;
    const sharedLoaded=await execute('skill',{name:sharedSkill.name});assert.equal(sharedLoaded.isError,false,JSON.stringify(sharedLoaded));assert.ok(JSON.stringify(sharedLoaded.value).includes('rollback plan'));
    assert.equal((await execute('history_recall',{query:'concise'})).isError,false,'Combined recall should work in a shared project without a semantic action review.');
    assert.equal(calls.filter(call=>call.system?.startsWith('Check a proposed')).length,reviewCount,'Loading a read-only skill called the semantic reviewer.');
    return{recallChecks:['native full-text search','bounded cited history read','cross-project history blocked','native project skill load','automatic workflow revision','unconfirmed shared skill excluded','confirmed shared skill load without review overhead'],workspaceId:workspace.id,sessionId:agent.id,preferenceId:preference.id,projectMemoryId:projectId,workflowId:workflow.id,sharedProjectId:project.project.id,checks:['real memory tools','read-only and Plan writes denied','project isolation','selective automatic preference learning without tool calls','five-minute review cooldown','bounded tool-free review','memory in next model request','custom review route preserves main model','workflow learned from a real tool result','concurrent reviews refused','permission change cancels review without saving','disable respected','project saves become pending proposals','human-only decision confirmation','conflicting tool and native terminal blocked before side effects','workers inherit project enforcement','unrelated action allowed','confirmed replacement refreshes linked memory and permits the new direction','invalid or unavailable reviewer blocks','mid-review and final-guard version changes block','protected metadata writes blocked','missing known manifest fails closed','private legacy project notes excluded from shared recall','shared enforcement independent of private memory toggle','concurrent confirmed versions block without a model call','human merge resolves all branches','updated shared context in the next model request']};
   }finally{await handle.dispose();}
  }
 }
 new Fixture(ctx);ctx.typert.register({package:'memory-fixture',face:'host',schemas:[],model:{services:[],objects:[],events:[]},invocations:[{id:'memory-fixture#memoryFixture/run',service:'memoryFixture',namespace:'memoryFixture',method:'run',invocation:{kind:'direct'},parameters:[],result:{mode:'strict',typeSymbol:'fixture/result',schema:z.record(z.string(),z.unknown())}}]});
}
