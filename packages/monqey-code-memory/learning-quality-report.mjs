import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {casesFor} from './test/import-cases.mjs';
const median=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
const sumUsage=calls=>calls.reduce((sum,call)=>{for(const key of Object.keys(sum)){const n=call.usage?.[key]||0;assert.ok(Number.isSafeInteger(n)&&n>=0);sum[key]+=n;}return sum;},{inputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:0});
const total=usage=>Object.values(usage).reduce((a,b)=>a+b,0);
export function summarize(result){
 const groups=[];
 for(const task of ['vendors','inventory'])for(const mode of ['control','learned']){
  const runs=result.runs.filter(run=>run.task===task&&run.mode===mode);
  const publicNames=new Set(casesFor(task,'public').map(item=>item.name)),privateCases=casesFor(task,'private');
  const group={task,mode,runs:runs.length,passed:0,total:privateCases.length*runs.length,unseenPassed:0,unseenTotal:(privateCases.length-publicNames.size)*runs.length,hardFailures:0,currentValidation:0,skillLoaded:0};
  const pairs=new Set();
  for(const run of runs){
   assert.ok(!pairs.has(run.pair),'Duplicate paired run.');pairs.add(run.pair);
   assert.equal(run.grade.total,privateCases.length);
   assert.equal(run.grade.passed,run.grade.results.filter(item=>item.pass).length);
   assert.equal(total(sumUsage(run.calls)),run.totalTokens);
   group.passed+=run.grade.passed;
   group.unseenPassed+=run.grade.results.filter(item=>item.pass&&!publicNames.has(item.name)).length;
   group.hardFailures+=Number(!!run.grade.hardFailure||!run.sentinelPreserved||!!run.scopeViolation);
   group.currentValidation+=Number(!!run.publicValidationCurrent&&!!run.publicValidation?.allPass);
   group.skillLoaded+=Number(run.loadedSkills>0);
  }
  Object.assign(group,{percent:group.total?100*group.passed/group.total:null,unseenPercent:group.unseenTotal?100*group.unseenPassed/group.unseenTotal:null,medianTokens:median(runs.map(run=>run.totalTokens)),medianMs:median(runs.map(run=>run.ms)),medianSteps:median(runs.map(run=>run.calls.length)),totalTokens:runs.reduce((sum,run)=>sum+run.totalTokens,0)});groups.push(group);
 }
 if(result.ok){assert.equal(result.runs.length,12);assert.ok(groups.every(group=>group.runs===3));assert.equal(result.auxiliary.length,0);}
 const trainingCalls=[...(result.training.initial?.calls||[]),...(result.training.feedback?.calls||[])],reviewCalls=result.learningCalls||[];
 const accounting={practiceTokens:total(sumUsage(trainingCalls)),reviewTokens:total(sumUsage(reviewCalls)),controlTokens:groups.filter(item=>item.mode==='control').reduce((sum,item)=>sum+item.totalTokens,0),learnedEvaluationTokens:groups.filter(item=>item.mode==='learned').reduce((sum,item)=>sum+item.totalTokens,0),totalReportedTokens:result.totalTokens,practiceMs:(result.training.initial?.ms||0)+(result.training.feedback?.ms||0),reviewMs:reviewCalls.reduce((sum,call)=>sum+(call.ms||0),0)};
 accounting.learnedIncludingPracticeAndReview=accounting.practiceTokens+accounting.reviewTokens+accounting.learnedEvaluationTokens;
 accounting.harnessCalibrationTokens=result.harnessCalibration?.tokens||0;
 accounting.allObservedIncludingHarnessCalibration=accounting.totalReportedTokens+accounting.harnessCalibrationTokens;
 accounting.experimentCostComplete=!result.interruptedAttempt;
 if(result.ok)assert.equal(accounting.practiceTokens+accounting.reviewTokens+accounting.controlTokens+accounting.learnedEvaluationTokens,result.totalTokens);
 return{complete:result.ok,reason:result.reason,groups,accounting};
}
export function report(result){
 const summary=summarize(result),lines=['# Monqey automatic-learning quality pilot','',`Model: ${result.provider}/${result.model}. Status: ${result.ok?'complete':'incomplete / stopped'}.`,result.reason?`Reason: ${result.reason}`:'','Two new development tasks, each in three alternating pairs. Control and learned variants receive the same complete functional requirements and clean starter code. The learned project retains the workflow extracted by the normal automatic post-turn reviewer from a real practice/correction episode.','',
 '| Task | Variant | Runs | Unseen checks passed | All checks passed | Median tokens | Median time | Model calls | Validated final artifact | Skill loaded |',
 '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
 for(const group of summary.groups)lines.push(`| ${group.task} | ${group.mode} | ${group.runs} | ${group.unseenPassed}/${group.unseenTotal}${group.unseenPercent===null?'':` (${group.unseenPercent.toFixed(1)}%)`} | ${group.passed}/${group.total} | ${group.medianTokens??'—'} | ${group.medianMs===null?'—':(group.medianMs/1000).toFixed(2)+' s'} | ${group.medianSteps??'—'} | ${group.currentValidation}/${group.runs} | ${group.skillLoaded}/${group.runs} |`);
 lines.push('','Primary score excludes the public examples. All-check totals include those examples as regression checks. Input mutation, task scope violations and sentinel-file changes are hard failures; these remain separate from the average score. A final artifact is validated only when the last successful public-check code hash matches the submitted code.','');
 for(const task of ['vendors','inventory']){
  const control=summary.groups.find(item=>item.task===task&&item.mode==='control'),learned=summary.groups.find(item=>item.task===task&&item.mode==='learned');
  if(control.runs&&learned.runs)lines.push(`- ${task}: learned minus control unseen correctness = ${(learned.unseenPercent-control.unseenPercent).toFixed(1)} percentage points; hard failures control ${control.hardFailures}, learned ${learned.hardFailures}.`);
 }
 lines.push('','## One-time learning and token accounting','',
  `- Practice plus corrective turn: ${summary.accounting.practiceTokens} tokens.`,
  `- Actual automatic review: ${summary.accounting.reviewTokens} tokens, ${(summary.accounting.reviewMs/1000).toFixed(2)} s; ${result.learningCalls?.length||0} requests.`,
  `- Control evaluations: ${summary.accounting.controlTokens} tokens.`,
  `- Learned evaluations: ${summary.accounting.learnedEvaluationTokens} tokens.`,
  `- Learned evaluations INCLUDING practice and review: ${summary.accounting.learnedIncludingPracticeAndReview} tokens.`,
  `- All observed requests combined: ${summary.accounting.totalReportedTokens} tokens.`,
  `- Earlier evaluator calibration (excluded from quality scores and paired comparisons): ${summary.accounting.harnessCalibrationTokens} tokens.`,
  `- All requests including that calibration: ${summary.accounting.allObservedIncludingHarnessCalibration} tokens.`,
  ...(result.interruptedAttempt?['- A separate interrupted pilot has incomplete usage records. The figures above are recorded totals for the completed pilot and known calibration, not the complete cost of developing/running the experiment. See learning-quality-interrupted-notes.md.']:[]),
  '', 'Tokens include reported cached reads/writes, uncached input and output across every attempt. They are not a currency/subscription price calculation. Practice/review cost is an additional up-front cost; it is not charged to the control as if the control had learned.','',
  '## Automatically saved workflows','');
 for(const workflow of result.workflows||[])lines.push(`### ${workflow.title}`,'',`ID ${workflow.id}; revision ${workflow.revision}; source actor ${workflow.source.actor}.`,'',workflow.content,'','Evidence retained by the memory system:',workflow.source.evidence,'');
 lines.push('## Individual evaluation runs','','| Task | Pair | Variant | All checks | Tokens | Time | Loaded skills | Failed checks |','| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |');
 for(const run of result.runs)lines.push(`| ${run.task} | ${run.pair} | ${run.mode} | ${run.grade.passed}/${run.grade.total} | ${run.totalTokens} | ${(run.ms/1000).toFixed(2)} s | ${run.loadedSkills} | ${run.grade.results.filter(item=>!item.pass).map(item=>item.name).join('; ')||run.grade.error||'none'} |`);
 lines.push('','## Limits and integrity','',
  '- This is one task family and one connected model, with three paired repeats per task. The task model did not grade its own output. A higher score here does not establish generally improved reasoning or retrained model weights.',
  '- If both variants pass every unseen check, the pilot shows a ceiling effect, not improved output quality. Efficiency differences are a separate result. Close or inconsistent results are inconclusive; individual failures remain visible above.',
  '- The feedback is authored for this controlled exercise and sent as a human-source message in the temporary training chat. Actual automatic extraction must save a workflow; no ideal lesson is injected by hand. Evaluation background learning is disabled; practice history and hidden cases cannot be read through the offered task tools.',
  '- Generated code implements pure import transformations rather than a whole application. It is executed in a separate Node process with restricted filesystem permissions and a VM without imports/process/require. These tests check returned data and input immutability, not production database/storage transactions.',
  '- The validation tool exposes a fixed public suite. Agents do not have an arbitrary shell/test-runner tool; this pilot measures implementation quality under that restricted interface. It does not measure the full testing workflow available in a normal development workspace.',
  '- The inventory task intentionally requires last-row-wins, whereas practice and vendor import require duplicate rejection. This checks a changed current requirement. Separate real Co-work decision changes and other-project semantic tasks were not run; existing scope checks and workflow catalog isolation are used here.',
  `- Auxiliary calls: ${result.auxiliary.length}. Settings unchanged: ${result.realSettingsUnchanged}. Credentials unchanged: ${result.realCredentialsUnchanged}. The isolated runtime and temporary credentials/task files are removed after completion; raw results retain the generated code and public/hidden grades.`,
  '- A preliminary evaluator run failed because a junction path had not been canonicalized for Node filesystem permissions. Its model honestly reported the failed test execution and no workflow was learned. That run is retained in learning-quality-calibration-result.json. The repaired evaluator has a junction regression test and a preflight before any model request.',
  '',result.method,'','Raw results: learning-quality-result.json.','');
 return{summary,markdown:lines.filter(line=>line!==undefined).join('\n')};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const result=JSON.parse(fs.readFileSync(path.join(root,'logs/learning-quality-result.json'),'utf8'));
 const calibrationPath=path.join(root,'logs/learning-quality-calibration-result.json');
 if(fs.existsSync(calibrationPath)){const calibration=JSON.parse(fs.readFileSync(calibrationPath,'utf8'));result.harnessCalibration={tokens:calibration.totalTokens,reason:calibration.reason};}
 result.interruptedAttempt=fs.existsSync(path.join(root,'logs/learning-quality-interrupted-notes.md'));
 const {summary,markdown}=report(result);
 const auditPath=path.join(root,'logs/learning-quality-output-audit.md');
 const audit=fs.existsSync(auditPath)?'\n## Output evidence audit\n\n'+fs.readFileSync(auditPath,'utf8'):'';
 fs.writeFileSync(path.join(root,'logs/learning-quality-summary.json'),JSON.stringify(summary,null,2));fs.writeFileSync(path.join(root,'logs/learning-quality-report.md'),markdown+audit);console.log(JSON.stringify(summary));
}
