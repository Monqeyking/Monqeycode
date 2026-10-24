// Explicitly invoked live-model hard benchmark. Uses fabricated project data only.
// Usage: node hard-bench-live.cjs [--runs N]   (N alternating control/learned runs per arm, default 5; 0 = practice sessions only)
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const postJson=require('./test/live-rpc.cjs');
const root=path.resolve(__dirname,'../..'),requireProfile=createRequire(path.join(root,'profiles/web/package.json')),yaml=requireProfile('yaml');
const runsFlag=process.argv.indexOf('--runs'),runs=runsFlag>=0?Number(process.argv[runsFlag+1]):5,deadline=14400000;
assert.ok(Number.isInteger(runs)&&runs>=0&&runs<=20,'--runs must be an integer from 0 to 20.');
const originalSettings=fs.readFileSync(path.join(root,'settings.yaml')),originalCredentials=fs.readFileSync(path.join(root,'.credentials.yaml'));
const settings=yaml.parse(originalSettings.toString('utf8')),credentials=yaml.parse(originalCredentials.toString('utf8')),route=settings.workers?.worker;
assert.ok(route?.provider&&route?.model,'Choose a worker model in Monqey settings before running this test.');
const key=`llm-pi-ai/${route.provider}`,record=structuredClone(credentials.records[key]);
assert.ok(record?.kind==='grant'&&record.payload?.type==='oauth','This test expects the existing OAuth worker connection.');
assert.ok(record.payload.expires-Date.now()>300000,'The existing access grant expires too soon for an isolated test. Refresh it in Monqey first.');
record.payload.refresh=''; // Never rotate the main app's refresh grant from a test process.
const home=fs.mkdtempSync(path.join(root,'logs/recall-live-'));
for(const name of ['profiles','packages'])fs.symlinkSync(path.join(root,name),path.join(home,name),'junction');
fs.writeFileSync(path.join(home,'settings.yaml'),yaml.stringify({'llm-pi-ai':{providers:{[route.provider]:settings['llm-pi-ai'].providers[route.provider]||{}}},'agent-default-model':{provider:'memory-fixture-main',model:'fixture'}}));
fs.writeFileSync(path.join(home,'.credentials.yaml'),yaml.stringify({version:credentials.version,records:{[key]:record},refs:{}}),{mode:0o600});
fs.writeFileSync(path.join(home,'fixture.yml'),'- id: session-title-llm\n  disabled: true\n- insert:\n    - id: memory-fixture\n      name: monqey-code-memory/runtime-fixture\n    - id: recall-live-fixture\n      name: monqey-code-memory/hard-bench-fixture\n');
const cache=path.join(root,'npm-cache/_npx'),dependencies=fs.readdirSync(cache).map(name=>path.join(cache,name,'node_modules')).join(path.delimiter);
const progressArchive=path.join(root,'logs/hard-bench-progress.jsonl');fs.writeFileSync(progressArchive,'');
const keepDir=path.join(root,'logs/hard-bench-runs');fs.rmSync(keepDir,{recursive:true,force:true});fs.mkdirSync(keepDir,{recursive:true});
const child=spawn(process.execPath,['--preserve-symlinks',path.join(root,'profiles/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',path.join(home,'fixture.yml'),'--no-open','--port','0'],{cwd:home,env:{...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',NODE_PATH:dependencies,MONQEY_RECALL_LIVE_ROUTE:JSON.stringify(route),MONQEY_QUALITY_PROGRESS:progressArchive,MONQEY_HB_RUNS:String(runs),MONQEY_HB_KEEP:keepDir},windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='',started=false,finished=false;
async function cleanup(){clearTimeout(timeout);try{execFileSync(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});}catch{}await new Promise(resolve=>setTimeout(resolve,750));const target=path.resolve(home);assert.equal(path.dirname(target),path.join(root,'logs'));assert.match(path.basename(target),/^recall-live-[a-zA-Z0-9]+$/);for(const name of ['profiles','packages']){const link=path.join(target,name);if(!fs.existsSync(link))continue;assert.ok(fs.lstatSync(link).isSymbolicLink());fs.unlinkSync(link);}fs.rmSync(target,{recursive:true,force:true,maxRetries:20,retryDelay:150});}
async function inspect(){
 const match=output.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/[^\s\x1b]*/);if(started||!match)return;started=true;
 try{
  const url=new URL(match[0]),initial=await fetch(url,{redirect:'manual'}),cookie=initial.headers.getSetCookie().map(item=>item.split(';')[0]).join('; ');
  const envelope=await postJson(`${url.origin}/api/recallLive/run`,{type:'client-request',rpcId:'hard-bench-test',method:'recallLive/run',payload:{args:{}}},{'content-type':'application/json',Origin:url.origin,Cookie:cookie},deadline-30000);
  assert.equal(envelope.result?.ok,true,JSON.stringify(envelope.result?.error));
  const result=envelope.result.value;
  assert.deepEqual(fs.readFileSync(path.join(root,'settings.yaml')),originalSettings);assert.deepEqual(fs.readFileSync(path.join(root,'.credentials.yaml')),originalCredentials);
  fs.writeFileSync(path.join(root,'logs/hard-bench-result.json'),JSON.stringify({...result,realSettingsUnchanged:true,realCredentialsUnchanged:true},null,2));
  console.log(JSON.stringify({ok:result.ok,model:result.model,runs:result.runs.length,totalTokens:result.totalTokens,reason:result.reason,realSettingsUnchanged:true,realCredentialsUnchanged:true}));
  assert.equal(result.ok,true,'The live test failed; see the saved result.');finished=true;await cleanup();
 }catch(error){finished=true;console.error(String(error.stack).replace(/([?&]token=)[^\s]+/gi,'$1[redacted]'));process.exitCode=1;await cleanup();}
}
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk.toString();void inspect();});
child.on('exit',async()=>{if(!finished){finished=true;console.error('Isolated live runtime stopped before completing the test.');process.exitCode=1;await cleanup();}});
const timeout=setTimeout(async()=>{finished=true;console.error('Hard benchmark timed out.');process.exitCode=1;await cleanup();},deadline);
