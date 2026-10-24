const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { APP_ID, stableExecutable, repairShortcuts } = require('./shortcuts.cjs');
function fixture(t) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'monqey-shortcuts-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const appData=path.join(home,'roaming'),desktop=path.join(home,'desktop'),executable=path.join(home,'dist','Monqey Agent 0.0.16.exe');
  const programs=path.join(appData,'Microsoft/Windows/Start Menu/Programs'),pinned=path.join(appData,'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar');
  for(const folder of [desktop,programs,pinned,path.dirname(executable)])fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(executable,'fixture');
  const write=(file,data)=>fs.writeFileSync(file,JSON.stringify(data));let writes=0;
  const shell={readShortcutLink:file=>JSON.parse(fs.readFileSync(file,'utf8')),writeShortcutLink(file,operation,data){writes++;write(file,{...(operation==='update'?this.readShortcutLink(file):{}),...data});return true;}};
  return {home,appData,desktop,executable,programs,pinned,shell,write,writes:()=>writes};
}
test('Start menu, desktop, legacy and existing taskbar links follow the stable portable executable and keep the AppID',t=>{
  const f=fixture(t),links=[path.join(f.programs,'Monqey Agent.lnk'),path.join(f.programs,'Monqey Code.lnk'),path.join(f.desktop,'Monqey Agent.lnk'),path.join(f.pinned,'Monqey Agent.lnk')];
  for(const file of links)f.write(file,{target:path.join(f.home,'missing-temp','Monqey Agent.exe'),icon:'',appUserModelId:APP_ID,args:'--existing-argument',toastActivatorClsid:'keep-toast-identity'});
  const unrelated=path.join(f.desktop,'Monqey Business.lnk');f.write(unrelated,{target:'business.exe'});
  const options={...f,platform:'win32'},first=repairShortcuts(options);assert.equal(first.errors.length,0);assert.equal(first.updated.length,4);
  for(const file of links){const link=f.shell.readShortcutLink(file);assert.equal(link.target,f.executable);assert.equal(link.icon,f.executable);assert.equal(link.appUserModelId,APP_ID);assert.equal(link.args,'--existing-argument');assert.equal(link.toastActivatorClsid,'keep-toast-identity');}
  assert.equal(f.shell.readShortcutLink(unrelated).target,'business.exe');assert.equal(fs.readdirSync(path.join(f.home,'electron-data/shortcut-backups')).length,4);
  assert.equal(repairShortcuts(options).updated.length,0);assert.equal(f.writes(),4);
  const next=path.join(path.dirname(f.executable),'Monqey Agent 0.0.17.exe');fs.writeFileSync(next,'next version');assert.equal(repairShortcuts({...options,executable:next}).updated.length,4);
});
test('missing desktop/pins stay absent, unsafe extracted targets are refused, development does not register Electron',t=>{
  const f=fixture(t);assert.equal(stableExecutable({home:f.home,packaged:false,env:{},execPath:f.executable}),undefined);
  assert.equal(stableExecutable({home:f.home,packaged:true,env:{},execPath:path.join(os.tmpdir(),'Monqey Agent.exe')}),undefined);
  assert.equal(stableExecutable({home:f.home,packaged:true,env:{PORTABLE_EXECUTABLE_FILE:f.executable},execPath:'temporary.exe'}),f.executable);
  assert.equal(repairShortcuts({...f,platform:'win32'}).updated.length,1);assert.equal(fs.readdirSync(f.desktop).length,0);assert.equal(fs.readdirSync(f.pinned).length,0);
  assert.throws(()=>repairShortcuts({...f,executable:path.join(os.tmpdir(),'Monqey Agent.exe'),platform:'win32'}),/existing executable/);
});
test('Windows failures are reported without pretending the shortcut was repaired',t=>{
  const f=fixture(t);f.shell.writeShortcutLink=()=>false;const result=repairShortcuts({...f,platform:'win32'});assert.equal(result.updated.length,0);assert.equal(result.errors.length,1);
});
