const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),home=fs.mkdtempSync(path.join(root,'logs/workspace-fixture-'));
const previewMode=process.argv.includes('--preview');
const originalSettings=fs.readFileSync(path.join(root,'settings.yaml')),originalCredentials=fs.readFileSync(path.join(root,'.credentials.yaml'));
for(const name of ['profiles','packages','vendor'])fs.symlinkSync(path.join(root,name),path.join(home,name),'junction');
fs.writeFileSync(path.join(home,'settings.yaml'),'agent-default-model:\n  provider: fixture\n  model: fixture\n');
fs.writeFileSync(path.join(home,'fixture.yml'),'- insert:\n    - id: workspace-fixture\n      name: monqey-code-workspace-tools/runtime-fixture\n');
const cache=path.join(root,'npm-cache/_npx'),nodePath=fs.readdirSync(cache).map(name=>path.join(cache,name,'node_modules')).join(path.delimiter);
let output='',started=false,finished=false;
const child=spawn(process.execPath,['--preserve-symlinks',path.join(root,'profiles/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',path.join(home,'fixture.yml'),'--no-open','--port','0'],{cwd:home,env:{...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',MONQEY_WORKSPACE_PREVIEW:previewMode?'1':'',NODE_PATH:nodePath},windowsHide:true,stdio:['ignore','pipe','pipe']});
function cleanup(){clearTimeout(timer);try{execFileSync(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});}catch{}for(const name of ['profiles','packages','vendor']){const link=path.join(home,name);if(fs.lstatSync(link).isSymbolicLink())fs.unlinkSync(link);}fs.rmSync(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
async function inspect(){
  const match=output.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/[^\s\x1b]*/);if(started||!match)return;started=true;
  try{
    const url=new URL(match[0]),initial=await fetch(url,{redirect:'manual'}),cookie=initial.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const method='workspaceFixture/run',response=await fetch(`${url.origin}/api/${method}`,{method:'POST',headers:{'content-type':'application/json',Origin:url.origin,Cookie:cookie},body:JSON.stringify({type:'client-request',rpcId:'workspace-smoke',method,payload:{args:{}}})});
    const envelope=await response.json();assert.equal(envelope.result?.ok,true,JSON.stringify(envelope.result?.error));assert.equal(envelope.result.value.ok,true);
    assert.deepEqual(fs.readFileSync(path.join(root,'settings.yaml')),originalSettings);assert.deepEqual(fs.readFileSync(path.join(root,'.credentials.yaml')),originalCredentials);
    const result={...envelope.result.value,settingsUnchanged:true,credentialsUnchanged:true};fs.writeFileSync(path.join(root,'logs/workspace-tools-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
    if(previewMode){fs.writeFileSync(path.join(root,'logs/workspace-tools-preview.json'),JSON.stringify({url:url.href,home,pid:child.pid,...result}));clearTimeout(timer);return;}
  }catch(error){process.exitCode=1;console.error(error.stack);console.error(output.replace(/([?&]token=)[^\s]+/gi,'$1[redacted]').slice(-5000));}
  finally{if(!previewMode||process.exitCode){finished=true;cleanup();}}
}
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk.toString();void inspect();});
child.on('exit',()=>{if(!finished){finished=true;console.error(output.replace(/([?&]token=)[^\s]+/gi,'$1[redacted]').slice(-7000));process.exitCode=1;cleanup();}});
const timer=setTimeout(()=>{finished=true;console.error('Workspace runtime test timed out.');process.exitCode=1;cleanup();},90000);
