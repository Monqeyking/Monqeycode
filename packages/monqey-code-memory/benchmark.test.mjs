import test from 'node:test';
import assert from 'node:assert/strict';
import {median,summarize} from './recall-benchmark-report.cjs';
function fixture(){
 const result={ok:true,provider:'test',model:'test-model',auxiliary:[],corpora:[{size:'small',sessions:3},{size:'large',sessions:60}],runs:[]};
 for(const size of ['small','large'])for(let pair=1;pair<=3;pair++)for(const mode of ['full-context','recall-skills']){
  const usage={inputTokens:pair*10,cacheReadTokens:100,cacheWriteTokens:0,outputTokens:5};
  const calls=[{provider:'test',model:'test-model',usage}];if(mode==='recall-skills')calls.push({provider:'test',model:'test-model',usage:{...usage}});
  result.runs.push({size,pair,mode,correct:true,metered:true,ms:pair*100,calls,usage:Object.fromEntries(Object.entries(usage).map(([key,value])=>[key,value*calls.length])),totalTokens:(pair*10+105)*calls.length});
 }
 return result;
}
test('benchmark counts every request and cached tokens before taking medians',()=>{
 assert.equal(median([9,1,5]),5);assert.equal(median([1,9]),5);
 const summary=summarize(fixture());assert.equal(summary[0].baseline.totalTokens,125);assert.equal(summary[0].recall.totalTokens,250);assert.equal(summary[0].recall.cacheReadTokens,200);assert.equal(summary[0].totalTokenReductionPercent,-100);
});
test('benchmark refuses incomplete pairs, unmetered calls and incorrect answers',()=>{
 for(const change of [r=>r.runs.pop(),r=>r.runs[0].correct=false,r=>delete r.runs[0].calls[0].usage,r=>r.runs[0].totalTokens++,r=>r.runs[0].calls[0].model='other',r=>r.auxiliary.push({})]){
  const result=fixture();change(result);assert.throws(()=>summarize(result));
 }
});
test('optimized benchmark validates all three context cases separately',()=>{
 const result=fixture();result.experiment='combined-recall';
 for(const run of result.runs){run.task='missing-context';run.mode=run.mode==='full-context'?'legacy':'optimized';}
 result.runs.push(...result.runs.filter(run=>run.size==='small').map(run=>({...run,task:'provided-context'})));
 const summary=summarize(result);assert.equal(summary.length,3);assert.equal(summary[1].task,'provided-context');assert.equal(summary[1].recall.totalTokens,250);
 result.runs.at(-1).task='missing-context';assert.throws(()=>summarize(result));
});
