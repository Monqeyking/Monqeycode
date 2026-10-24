const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'lib/client.js'),'utf8');
const body=source.match(/function monqeyIsThinking\(snapshot\) \{[\s\S]*?\n\t\t\}/)?.[0];
assert.ok(body,'Native thinking selector missing.');
const thinking=vm.runInNewContext(`(${body})`);
const snapshot=(blocks,runningCalls=[])=>({legacy:{partial:blocks===null?null:{turn:1,step:1,blocks},runningCalls}});
test('native stream state selects only active reasoning independently of rendered transcript rows',()=>{
 assert.equal(thinking(snapshot(null)),false,'first token or retry wait');
 assert.equal(thinking(snapshot([])),false);
 assert.equal(thinking(snapshot([{kind:'reasoning',text:'Thinking'}])),true);
 assert.equal(thinking(snapshot([{kind:'reasoning'},{kind:'text'}])),false);
 assert.equal(thinking(snapshot([{kind:'tool-call'}])),false);
 assert.equal(thinking(snapshot([{kind:'reasoning'}],[{callId:'t'}])),false);
 assert.equal(thinking(snapshot(null)),false,'retry must clear reasoning status');
 assert.equal(thinking(snapshot([{kind:'reasoning',text:'Second attempt'}])),true);
});
test('the native renderer owns text, visibility and colors; branding no longer rewrites its DOM',()=>{
 assert.match(source,/running && thinking && \(0, react_jsx_runtime\.jsx\)\(TurnStatus/);
 assert.doesNotMatch(source,/"chat\.deepDiving": "Deep diving/);
 assert.equal((source.match(/"chat\.deepDiving": "Scratching head…"/g)||[]).length,2);
 assert.match(source,/--monqey-thinking-base/);
 const brand=fs.readFileSync(path.join(__dirname,'../monqey-code-brand/lib/client.js'),'utf8');
 assert.doesNotMatch(brand,/brandThinkingStatus|originals\.set\(element/);
});
