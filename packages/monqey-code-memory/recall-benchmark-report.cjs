const assert=require('node:assert/strict');
const median=values=>{assert.ok(values.length);const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
function summarize(result){
 const efficiency=result.experiment==='combined-recall';
 assert.equal(result.ok,true,'Incomplete or failed benchmark.');assert.equal(result.runs.length,efficiency?18:12);assert.deepEqual(result.auxiliary,[]);
 const cases=result.corpora.flatMap(corpus=>efficiency?(corpus.size==='small'?['missing-context','provided-context']:['missing-context']).map(task=>({...corpus,task})):[corpus]);
 return cases.map(corpus=>{
  const group=mode=>{
   const runs=result.runs.filter(run=>run.size===corpus.size&&run.mode===mode&&(!efficiency||run.task===corpus.task));
   assert.equal(runs.length,3);assert.deepEqual(runs.map(run=>run.pair).sort(),[1,2,3]);
   for(const run of runs){
    assert.ok(run.correct&&run.metered);assert.ok(Number.isFinite(run.ms)&&run.ms>=0);assert.ok(run.calls.length);
    const sum={inputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:0};
    for(const call of run.calls){
     assert.equal(call.provider,result.provider);assert.equal(call.model,result.model);assert.ok(call.usage);
     for(const key of Object.keys(sum)){const value=call.usage[key]??0;assert.ok(Number.isSafeInteger(value)&&value>=0);sum[key]+=value;}
    }
    assert.deepEqual(run.usage,sum);assert.equal(run.totalTokens,Object.values(sum).reduce((a,b)=>a+b,0));
   }
   return{runs:runs.length,totalTokens:median(runs.map(run=>run.totalTokens)),ms:median(runs.map(run=>run.ms)),requests:median(runs.map(run=>run.calls.length)),...Object.fromEntries(Object.keys(runs[0].usage).map(key=>[key,median(runs.map(run=>run.usage[key]))]))};
  };
  const baseline=group(efficiency?'legacy':'full-context'),recall=group(efficiency?'optimized':'recall-skills');
  return{size:corpus.size,...(efficiency?{task:corpus.task}:{}),sessions:corpus.sessions,archiveCharacters:corpus.archiveCharacters,baseline,recall,totalTokenReductionPercent:100*(1-recall.totalTokens/baseline.totalTokens)};
 });
}
function report(result){
 if(result.experiment==='combined-recall')return efficiencyReport(result);
 const summary=summarize(result),lines=[
  '# Monqey recall and skills: measured token comparison','',
  `Model: ${result.provider}/${result.model}. Recorded ${new Date(result.runs[0].startedAt).toISOString()}.`,'',
  'Twelve real-model runs: three alternating pairs at each archive size. All twelve must answer the same factual question, return the two exact checklist steps, and cite the correct old session and event. All model steps and reported cache reads count.','',
  '| Archive | Strategy | Median total tokens | Uncached input | Cached input | Output | Requests | Time |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'
 ];
 for(const item of summary){
  for(const [label,stats] of [['Full supplied context',item.baseline],['Native recall + skill',item.recall]])lines.push(`| ${item.sessions} conversations | ${label} | ${stats.totalTokens} | ${stats.inputTokens} | ${stats.cacheReadTokens+stats.cacheWriteTokens} | ${stats.outputTokens} | ${stats.requests} | ${(stats.ms/1000).toFixed(2)} s |`);
 }
 lines.push('','Each column is a separate median; component medians need not sum to the median total. Total = uncached input + cached read/write input + output, summed over every request in a run. Cached tokens are counted as tokens, not priced as uncached tokens.','');
 for(const item of summary)lines.push(`- ${item.sessions} conversations (${item.archiveCharacters} supplied archive/workflow characters): recall used ${Math.abs(item.totalTokenReductionPercent).toFixed(1)}% ${item.totalTokenReductionPercent>=0?'fewer':'more'} total tokens, comparing the two median totals.`);
 lines.push('','## Individual runs','','| Archive | Pair | Strategy | Correct | Total tokens | Uncached input | Cached input | Output | Requests | Time |','| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
 for(const run of result.runs)lines.push(`| ${run.size} | ${run.pair} | ${run.mode} | ${run.correct?'yes':'no'} | ${run.totalTokens} | ${run.usage.inputTokens} | ${run.usage.cacheReadTokens+run.usage.cacheWriteTokens} | ${run.usage.outputTokens} | ${run.calls.length} | ${(run.ms/1000).toFixed(2)} s |`);
 lines.push('','## Interpretation and limits','',
  '- This measures a new question with either the entire synthetic historical archive supplied or explicit native history search/read plus skill loading. It does not compare against Monqey\'s existing compaction, and is not an app-wide savings percentage.',
  '- Both routes use the same native preset, connected model, output cap and read-only tool set. Full-context runs are instructed to answer directly, but native skill guidance may still cause tool calls; these are counted. Recall runs are instructed to retrieve. Automatic selection of the cheaper strategy is not measured.',
  '- Cache is observed, not cleared. The first pair is retained; later runs can reuse provider cache. Both cached and uncached input are shown. No exact bill or subscription-limit saving is inferred.',
  '- Synthetic project conversations contain one decisive fact; workflow data was saved before the run. Initial workflow learning is outside this per-question comparison. Local search/index work invoked during a run is included in its elapsed time. Fake seed-model calls use no external provider.',
  '- Automatic learning and model-generated chat titles are disabled. Zero auxiliary real-model calls are allowed. Missing usage or a failed model attempt invalidates a run; the benchmark stops on its first failed run.',
  '- Twelve runs with one model and one task establish this example only. Repeated wording in the generated archive can affect cache/token behavior; real project histories and search quality differ.',
  '- Two preliminary harness checks were discarded: the first selected an internal context event as its citation oracle; the second unnecessarily rejected a correct full-context answer because it also loaded a skill. Neither was a factual model failure. Both calibration files are retained separately and excluded from the paired results.',
  `- Real settings unchanged: ${result.realSettingsUnchanged}. Real credentials unchanged: ${result.realCredentialsUnchanged}. Temporary sessions and credentials are removed after the test.`,
  '',`Raw data: recall-benchmark-result.json. ${result.method}`,'');
 return{summary,markdown:lines.join('\n')};
}
function efficiencyReport(result){
 const summary=summarize(result),lines=['# Monqey: combined recall and selective retrieval','',
  `Model: ${result.provider}/${result.model}. Recorded ${new Date(result.runs[0].startedAt).toISOString()}.`,
  '',`All ${result.runs.length} runs passed the exact target, ordered checklist and source-session/event checks. Three alternating pairs per case; all reported cached/uncached input and output tokens across all steps count. No model failures or unmetered attempts are accepted.`,
  '','| Case | Strategy | Median total tokens | Uncached input | Cached input | Output | Requests | Time |','| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
 for(const item of summary){
  const label=`${item.sessions} conversations, ${item.task==='provided-context'?'context already supplied':'historical context missing'}`;
  for(const [mode,stats] of [['Previous',item.baseline],['Combined/selective',item.recall]])lines.push(`| ${label} | ${mode} | ${stats.totalTokens} | ${stats.inputTokens} | ${stats.cacheReadTokens+stats.cacheWriteTokens} | ${stats.outputTokens} | ${stats.requests} | ${(stats.ms/1000).toFixed(2)} s |`);
 }
 lines.push('','Each column is a separate median. Component medians need not sum to the median total. Cached tokens count as tokens; this is not a price calculation.','');
 for(const item of summary)lines.push(`- ${item.sessions} conversations / ${item.task}: ${Math.abs(item.totalTokenReductionPercent).toFixed(1)}% ${item.totalTokenReductionPercent>=0?'fewer':'more'} median total tokens.`);
 lines.push('','## Individual runs','','| Archive | Context | Pair | Strategy | Total tokens | Requests | Time | Tools |','| --- | --- | ---: | --- | ---: | ---: | ---: | --- |');
 for(const run of result.runs)lines.push(`| ${run.size} | ${run.task} | ${run.pair} | ${run.mode} | ${run.totalTokens} | ${run.calls.length} | ${(run.ms/1000).toFixed(2)} s | ${run.tools.join(', ')||'none'} |`);
 lines.push('','## Method and limits','',
  '- The previous variant restores the earlier conversation-recall instruction and history_search description/schema text, and hides the new combined tool. The updated variant uses the production selective instruction and exposes history_recall. Both get the identical question, native preset, model and output limit. No request forces a specific tool recipe. Previous history_read also reports the new truncation flag; this small shared format change is retained in both variants.',
  '- Context missing: the fact is only in an old project conversation and the workflow must be loaded. Context supplied: the same fact, source citation and complete workflow are already in the current question. Extra tool calls in either route are counted.',
  '- Cache is observed rather than cleared. The first pair is retained. Synthetic data, one model and one task family do not establish an app-wide saving or a guaranteed subscription/currency saving. Workflow learning is outside the measured question; local search/index work is included in elapsed time.',
  '- Automatic learning and model-generated titles are disabled. Reader sessions are excluded from subsequent searches. The test stops at its first incorrect/unmetered run and has per-run/global step, token and time limits.',
  '- The initial implementation was also measured in 18 correct runs; its data and report remain in recall-efficiency-first-pass-result.json and recall-efficiency-first-pass-report.md. Those measurements exposed literal-phrase search failures. The final version clarifies that contract in the tool schema and policy; the final paired results below do not pool the two versions.',
  '- No automatic workflow inlining was added. The native skill catalog can still require loading a matching workflow even when its text has already been supplied, so fewer history searches do not guarantee a cheaper already-supplied-context answer.',
  '- Already-supplied context is especially variable: the first pass used 4.6% more median tokens, whereas the final pass used 50.0% fewer. The final updated route still reloaded a skill in one of its three runs. Treat that case as inconclusive for a stable savings percentage.',
  `- Real settings unchanged: ${result.realSettingsUnchanged}. Real credentials unchanged: ${result.realCredentialsUnchanged}. The temporary runtime and its sessions/credentials are removed after the test.`,
  '',result.method,'','Raw measurements and tool arguments: recall-efficiency-result.json.','');
 return{summary,markdown:lines.join('\n')};
}
module.exports={median,summarize,report};
if(require.main===module){
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../..');
 const label=process.argv.includes('--optimized-benchmark')?'efficiency':'benchmark';
 const result=JSON.parse(fs.readFileSync(path.join(root,`logs/recall-${label}-result.json`),'utf8')),{summary,markdown}=report(result);
 fs.writeFileSync(path.join(root,`logs/recall-${label}-report.md`),markdown);fs.writeFileSync(path.join(root,`logs/recall-${label}-summary.json`),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
