import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(path.join(process.env.DSH_HOME,'profiles/web/package.json'));
const runtime=async name=>import(pathToFileURL(require.resolve(name)).href);
const {TypertRemoteService}=await runtime('@deepseek-ai/dsh-typert-protocol');
const {createUserMessage}=await runtime('@deepseek-ai/dsh-llm');
const {z}=await runtime('zod');
export const inject=['llm','memory','agents','agentPresets','workspaceRegistry','tools','systemPrompt','sessionProjections','typert'];
export function apply(ctx){
 const route=JSON.parse(process.env.MONQEY_RECALL_LIVE_ROUTE);
 const testAgents=new Set(),steps=new Map(),allowed=new Set(['memory_search','memory_read','history_search','history_read','skill']);
 ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{const value=await next();return testAgents.has(context.agent?.id)?{...value,tools:value.tools.filter(tool=>allowed.has(tool.name))}:value;});
 ctx.tools.guard(exec=>testAgents.has(exec.agent?.id)&&!allowed.has(exec.name)?'Live recall tests permit read-only recall tools only.':undefined);
 ctx.on('agent/pre-step',({agent},next)=>{if(!testAgents.has(agent.id))return next();const count=(steps.get(agent.id)||0)+1;steps.set(agent.id,count);if(count>8||(Object.values(ctx.sessionProjections.stateOf(agent.session,'tokenUsage')?.totals||{}).reduce((a,b)=>a+b,0)>60000)){agent.cancel({kind:'hook',reason:'Live test budget reached.'});return Promise.resolve({kind:'reject'});}return next();});
 class Live extends TypertRemoteService{
  constructor(owner){super(owner,'recallLive');}
  async run(){
   const models=await ctx.llm.listModels(route.provider);assert.ok(models.some(model=>model.id===route.model),'The configured worker model is absent from the live catalog.');
   await ctx.llm.resolveCallConfig(route);
   const settings=ctx.memory.snapshot();await ctx.memory.configure({...settings.settings,automatic:false},settings.settingsRevision);
   const workspace=await ctx.workspaceRegistry.create(process.env.DSH_HOME,'Recall and skills live test');
   const make=selected=>ctx.agents.create({sessionId:randomUUID(),meta:{cwd:process.env.DSH_HOME,agentPreset:'standard'},agentOptions:{...selected,maxTokens:1000},setup:agentCtx=>ctx.agentPresets.mount(agentCtx,'standard').then(()=>{})});
   const seed=await make({provider:'memory-fixture-main',model:'fixture'});
   let reader;
   try{
    await workspace.attachSession(seed.agent.id);
    seed.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'For the Cobalt Wharf release, our agreed deployment target is orchid-harbor-42. This is a test-only decision recorded in this old conversation.'}]}));await seed.agent.whenIdle();
    const saved=ctx.memory.mutate({action:'save',kind:'workflow',title:'Test launch checklist',content:'Before a test release, perform these checks in order: verify silver lantern; check rollback plan. Report those exact two checklist steps. This is a read-only test procedure.',workspaceId:workspace.id});
    const workflow=saved.entries.find(entry=>entry.title==='Test launch checklist');assert.ok(workflow);
    reader=await make(route);testAgents.add(reader.agent.id);await workspace.attachSession(reader.agent.id);
    reader.agent.session.append('sandbox/mode',{mode:'read-only'});
    const timeout=setTimeout(()=>reader.agent.cancel({kind:'hook',reason:'Live recall test timeout.'}),120000);
    try{
     reader.agent.followup(createUserMessage({source:{kind:'human'},content:[{type:'text',text:'This is a read-only integration test. Find the agreed deployment target for Cobalt Wharf in a previous conversation: use history_search, then history_read on the matching result. Load the learned project skill "Test launch checklist" using the native skill tool and its exact available skill name. Briefly report the deployment target and the two checklist steps from those sources. Cite the old session ID and event sequence. Do not use other tools or change any files.'}]}));await reader.agent.whenIdle();
    }finally{clearTimeout(timeout);}
    const messages=reader.agent.session.deriveMessages();
    const tools=messages.flatMap(message=>message.content.filter(block=>block.type==='tool-call').map(block=>block.name));
    const answer=[...messages].reverse().find(message=>message.role==='assistant'&&message.content.some(block=>block.type==='text'))?.content.filter(block=>block.type==='text').map(block=>block.text).join('\n')||'';
    const usage=ctx.sessionProjections.stateOf(reader.agent.session,'tokenUsage')?.totals;
    const result={provider:route.provider,model:route.model,workspaceId:workspace.id,sessionId:reader.agent.id,sourceSessionId:seed.agent.id,skillName:`learned-${workflow.id}`,tools,answer,usage,steps:steps.get(reader.agent.id)};
    assert.ok(tools.includes('history_search')&&tools.includes('history_read')&&tools.includes('skill'),'The real model did not use all three recall/skill tools: '+JSON.stringify(result));
    assert.match(answer,/orchid-harbor-42/i);assert.match(answer,/silver lantern/i);assert.match(answer,/rollback plan/i);assert.ok(answer.includes(seed.agent.id),'Missing source citation: '+answer);
    return{ok:true,...result};
   }finally{if(reader){testAgents.delete(reader.agent.id);await reader.dispose();}await seed.dispose();}
  }
 }
 new Live(ctx);
 ctx.typert.register({package:'recall-live-fixture',face:'host',schemas:[],model:{services:[],objects:[],events:[]},invocations:[{id:'recall-live-fixture#recallLive/run',service:'recallLive',namespace:'recallLive',method:'run',invocation:{kind:'direct'},parameters:[],result:{mode:'strict',typeSymbol:'recall-live/result',schema:z.record(z.string(),z.unknown())}}]});
}
