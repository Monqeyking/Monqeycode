import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Checkpoints } from '../lib/checkpoints.js';
const require=createRequire(path.join(process.env.DSH_HOME,'profiles/web/package.json'));
const {TypertRemoteService}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-protocol')).href);
const {defineTool}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);
const {createUserMessage}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
const {z}=await import(pathToFileURL(require.resolve('zod')).href);
export const inject=['workspaceTools','agents','tools','agentPresets','workspaceRegistry','sessionProjections','skills','typert','jobs'];
export function apply(ctx){
  ctx.tools.register(defineTool({name:'workspace_fixture_write',description:'Write a harmless fixture.',parameters:{},output:{schema:{type:'string'},render:()=>[{type:'text',text:'written'}]},isConcurrencySafe:()=>false,async execute(){fs.writeFileSync(path.join(process.env.DSH_HOME,'project/example.ts'),'after');return 'written';}}));
  class Fixture extends TypertRemoteService{
    constructor(owner){super(owner,'workspaceFixture');}
    async run(){
      const folder=path.join(process.env.DSH_HOME,'project');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'example.ts'),'before');
      const workspace=await ctx.workspaceRegistry.create(folder,'Restore point test');
      const handle=await ctx.agents.create({sessionId:'session-'+randomUUID(),meta:{cwd:folder,agentPreset:'standard'},setup:agentCtx=>ctx.agentPresets.mount(agentCtx,'standard').then(()=>{})});
      const agent=handle.agent;await workspace.attachSession(agent.id);
      const execute=(name,args)=>ctx.tools.execute({name,arguments:args,agent,callId:randomUUID(),signal:new AbortController().signal});
      try{
        assert.ok((await ctx.skills.list({cwd:folder,scope:agent})).some(skill=>skill.name==='browser-skill'),'BrowserSkill must be in the real skill catalog');
        // Loading the official skill must register the actual upstream native tools.
        const skill=await execute('skill',{name:'browser-skill'});assert.equal(skill.isError,false,JSON.stringify(skill));
        agent.session.append('sandbox/mode',{mode:'read-only'});
        const blocked=await execute('bsk_page',{action:'navigate',url:'https://example.com'});assert.equal(blocked.isError,true);assert.match(JSON.stringify(blocked),/Read-only|Plan/);
        agent.session.append('sandbox/mode',{mode:'workspace-write'});
        assert.equal((await execute('workspace_fixture_write',{})).isError,false);
        const rows=ctx.workspaceTools.list(agent.id);assert.equal(rows.length,1);assert.equal(rows[0].changed,1);
        const preview=ctx.workspaceTools.preview(agent.id,rows[0].id);assert.equal(preview.files[0].name,'example.ts');
        const restored=ctx.workspaceTools.restore(agent.id,preview.token,['example.ts']);assert.equal(restored.restored,1);assert.equal(fs.readFileSync(path.join(folder,'example.ts'),'utf8'),'before');
        assert.throws(()=>ctx.workspaceTools.restore(agent.id,preview.token,['example.ts']),/expired/);
        const recovery=ctx.workspaceTools.preview(agent.id,restored.guardId);fs.writeFileSync(path.join(folder,'example.ts'),'partner');assert.throws(()=>ctx.workspaceTools.restore(agent.id,recovery.token,['example.ts']),/Nothing was restored/);
        assert.equal((await execute('read',{file_path:path.join(folder,'example.ts')})).isError,false);
        assert.equal((await execute('write',{file_path:path.join(folder,'example.ts'),content:'native file write'})).isError,false);
        assert.ok(ctx.workspaceTools.list(agent.id).some(row=>row.label==='write'&&row.changed===1));
        const shell=await execute('pwsh',{command:"Set-Content -LiteralPath './shell-test.ts' -Value 'terminal change'",description:'Harmless restore point fixture',timeoutMs:10000});assert.equal(shell.isError,false,JSON.stringify(shell));
        assert.ok(ctx.workspaceTools.list(agent.id).some(row=>row.label==='pwsh'&&row.changed===1));
        const newest=ctx.workspaceTools.list(agent.id).find(row=>row.label==='pwsh'),jobPreview=ctx.workspaceTools.preview(agent.id,newest.id);
        let settle;const done=new Promise(resolve=>{settle=resolve;});
        ctx.jobs.start({kind:'bash',owner:agent,label:'Harmless background fixture',run:()=>({done,cancel:()=>settle({status:'killed'})})});
        assert.throws(()=>ctx.workspaceTools.restore(agent.id,jobPreview.token,['shell-test.ts']),/background jobs/);
        settle({status:'completed'});await new Promise(resolve=>setImmediate(resolve));
        assert.match(agent.id,/^session-/);
        const originalScan=Checkpoints.prototype.scan;let fullScans=0;
        Checkpoints.prototype.scan=function(directory,save,targets){if(directory===folder&&!targets){fullScans++;throw Error('Workspace exceeds the automatic terminal backup budget.');}return originalScan.call(this,directory,save,targets);};
        try{
          agent.session.append('sandbox/mode',{mode:'read-only'});
          const readonly=await execute('pwsh',{command:'Get-Location',description:'Read-only location check',timeoutMs:10000});assert.doesNotMatch(JSON.stringify(readonly),/backup budget/);assert.equal(fullScans,0);
          agent.session.append('sandbox/mode',{mode:'workspace-write'});
          for(let i=0;i<2;i++){const result=await execute('pwsh',{command:'Get-Location',description:'Oversized-workspace location check',timeoutMs:10000});assert.equal(result.isError,false,JSON.stringify(result));}
          assert.equal(fullScans,1,'Failed whole-workspace captures must not repeat on each terminal command');assert.equal(ctx.workspaceTools.status(agent.id).limited,true);
          assert.equal((await execute('read',{file_path:path.join(folder,'example.ts')})).isError,false);
          const write=await execute('write',{file_path:path.join(folder,'example.ts'),content:'targeted large-workspace edit'});assert.equal(write.isError,false,JSON.stringify(write));
          const targeted=ctx.workspaceTools.list(agent.id).find(row=>row.label==='write'),targetedPreview=ctx.workspaceTools.preview(agent.id,targeted.id);
          assert.equal(ctx.workspaceTools.restore(agent.id,targetedPreview.token,['example.ts']).restored,1);
          assert.equal(ctx.workspaceTools.retry(agent.id).limited,false);
        }finally{Checkpoints.prototype.scan=originalScan;}
        if(process.env.MONQEY_WORKSPACE_PREVIEW==='1')agent.session.append('user/message',createUserMessage({source:{kind:'human'},content:[{type:'text',text:'Preview the restore points tab layout.'}]}),{surfaceOp:'append'});
        return{ok:true,sessionId:agent.id,workspaceId:workspace.id,checks:['official browser skill loaded','real native browser tool registered','browser denied in read-only mode','native tool snapshot','native filesystem write checkpoint','real PowerShell checkpoint','preview and human restore service','guard checkpoint','single-use preview','newer partner edit blocked','background job blocks restore','native prefixed session identifier','read-only terminal skips capture','oversized workspace does not block terminal','failed full capture attempted once','targeted write and restore survive full backup budget','limited coverage and retry']};
      }finally{if(process.env.MONQEY_WORKSPACE_PREVIEW!=='1')await handle.dispose();}
    }
  }
  new Fixture(ctx);ctx.typert.register({package:'workspace-fixture',face:'host',schemas:[],model:{services:[],objects:[],events:[]},invocations:[{id:'workspace-fixture#workspaceFixture/run',service:'workspaceFixture',namespace:'workspaceFixture',method:'run',invocation:{kind:'direct'},parameters:[],result:{mode:'strict',typeSymbol:'workspaceFixture/result',schema:z.record(z.string(),z.unknown())}}]});
}
