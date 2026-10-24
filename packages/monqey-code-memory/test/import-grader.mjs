import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {casesFor} from './import-cases.mjs';
export function evaluate(code,task,suite){
 const results=casesFor(task,suite).map(item=>{
  let output;
  try{
   const context=vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false}});
   vm.runInContext('globalThis.module={exports:{}}; globalThis.exports=module.exports;',context,{timeout:500});
   new vm.Script(code,{filename:'importer.cjs'}).runInContext(context,{timeout:500});
   const args=JSON.stringify([item.source,item.existing]);
   output=JSON.parse(vm.runInContext(`(()=>{const [source,existing]=JSON.parse(${JSON.stringify(args)});const before=JSON.stringify(existing);let result,error,repeat;try{result=module.exports.importData(source,existing);${item.repeat?'repeat=module.exports.importData(source,JSON.parse(JSON.stringify(result)));':''}}catch(e){error=String(e?.message||e)}return JSON.stringify({result,error,repeat,mutated:before!==JSON.stringify(existing)});})()`,context,{timeout:500}));
   assert.equal(output.mutated,false,'Input state was mutated.');
   if(item.throws)assert.ok(output.error,'Expected invalid input to throw.');
   else{assert.equal(output.error,undefined);assert.deepEqual(output.result,item.expected);if(item.repeat)assert.deepEqual(output.repeat,item.expected);}
   return{name:item.name,pass:true};
  }catch(error){return{name:item.name,pass:false,mutated:!!output?.mutated,detail:String(error.message).slice(0,650)};}
 });
 return{task,suite,passed:results.filter(item=>item.pass).length,total:results.length,allPass:results.every(item=>item.pass),hardFailure:results.some(item=>item.mutated),results};
}
export function gradeCode(code,task,suite){
 const file=fs.realpathSync.native(fileURLToPath(import.meta.url)),cases=fs.realpathSync.native(fileURLToPath(new URL('./import-cases.mjs',import.meta.url)));
 const env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP};
 try{return JSON.parse(execFileSync(process.execPath,['--permission',`--allow-fs-read=${file}`,`--allow-fs-read=${cases}`,'--max-old-space-size=96',file,'--worker'],{input:JSON.stringify({code,task,suite}),encoding:'utf8',timeout:15000,maxBuffer:256000,windowsHide:true,env,stdio:['pipe','pipe','pipe']}));}
 catch(error){return{task,suite,passed:0,total:casesFor(task,suite).length,allPass:false,hardFailure:false,error:String(error.message).slice(0,700),results:[]};}
}
if(process.argv.includes('--worker')){
 const {code,task,suite}=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(evaluate(code,task,suite)));
}
