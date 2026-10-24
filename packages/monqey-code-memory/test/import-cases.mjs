const csvSpec=(delimiter,id,label,amount)=>`Implement a dependency-free CommonJS module importer.cjs exporting { importData(source, existing = []) }. It is a synchronous pure function. No imports, filesystem, network or other side effects. source is CSV text with delimiter ${JSON.stringify(delimiter)} and a header containing ${id}, ${label}, ${amount} exactly once each; header order can vary and extra columns are ignored. A leading UTF-8 BOM, LF/CRLF, quoted delimiters, escaped double quotes and quoted multiline fields must work. Ignore completely blank lines outside quoted fields. Reject missing/duplicate required headers, malformed quoting, wrong row field counts and non-string source. Trim IDs and labels; both must be nonempty. ${amount} is a trimmed decimal number (no numeric junk, NaN or Infinity); an empty field becomes null and zero stays zero. Normalize records as {${id}:string,${label}:string,${amount}:number|null}. Reject duplicate IDs within one batch, including identical rows. existing is a valid array of normalized records, possibly with additional fields. Merge by ID, preserving existing order and additional fields; replace fields present in the normalized incoming row, append new IDs in input order. Preserve unmatched records. Validate the entire batch before applying it. Never mutate source/existing records or lose their additional fields, including on an error. Importing the same source again must produce identical state. An empty batch with a valid header returns existing unchanged in value. Treat IDs such as __proto__ as normal strings. Throw an Error for invalid input. State the public validation you actually ran in your final answer.`;
export const tasks={
 practice:{title:'Reliable customer imports',spec:csvSpec(',','customerId','name','balance')},
 vendors:{title:'Reliable vendor imports',spec:csvSpec(';','vendorId','name','credit')},
 inventory:{title:'Reliable inventory imports',spec:'Implement a dependency-free CommonJS module importer.cjs exporting { importData(source, existing = []) }. It is a synchronous pure function with no imports, filesystem, network or side effects. source is JSON text containing an array of objects. Each object has code (a nonempty string after trimming) and count (a nonnegative finite integer NUMBER; numeric strings, booleans, null and missing values are invalid). Optional title must be a string when present, including an empty string. Ignore extra incoming fields. Normalize to {code, quantity:count, title}. If title is absent, preserve the existing title for that code, or use an empty string for a new code. existing is a valid array of normalized records, possibly with additional fields. Merge by code, preserving existing order and all additional fields, preserving unmatched records, and appending new codes in first-seen input order. Unlike some importers, duplicate codes in this task use LAST ROW WINS, including when the last title is omitted; omitted title is resolved against the original existing record, not an earlier duplicate in this batch. Validate EVERY input row before merging, even an invalid earlier duplicate that a later row would replace. Never mutate existing or lose its extra fields, including on errors. Empty arrays are a no-op by value. Repeating the import must produce identical state. Treat __proto__ as an ordinary code. Reject non-string source, malformed JSON, non-array JSON, null/non-object/array rows and invalid values by throwing an Error. State the public validation you actually ran in your final answer.'}
};
export const starter='"use strict";\nmodule.exports = { importData(source, existing = []) { throw new Error("Not implemented"); } };\n';
const good=(name,source,expected,existing=[],extra={})=>({name,source,expected,existing,...extra});
const bad=(name,source,existing=[])=>({name,source,existing,throws:true});
function csvCases(kind){
 const practice=kind==='practice',d=practice?',':';',id=practice?'customerId':'vendorId',amount=practice?'balance':'credit';
 const h=`${id}${d}name${d}${amount}`,r=(key,name,value)=>({[id]:key,name,[amount]:value});
 const existing=[{...r('old','Kept',7),note:'preserve'}, {...r('a','Before',9),tag:'keep'}];
 const publicCases=[
  good('basic row',`${h}\na${d}Alpha${d}12.5`,[r('a','Alpha',12.5)]),
  good('merge and retain existing fields',`${h}\na${d}After${d}2\nb${d}Beta${d}3`,[existing[0],{...existing[1],name:'After',[amount]:2},r('b','Beta',3)],existing),
  bad('missing required header',`${id}${d}name\na${d}Alpha`),
  bad('invalid number',`${h}\na${d}Alpha${d}7oops`)
 ];
 const extra=[
  good('zero remains zero',`${h}\na${d}Zero${d}0`,[r('a','Zero',0)]),
  good('empty numeric value becomes null',`${h}\na${d}Empty${d}`, [r('a','Empty',null)]),
  good('quoted delimiter and escaped quote',`${h}\na${d}"A${d}B ""quoted"""${d}2`,[r('a',`A${d}B "quoted"`,2)]),
  good('BOM CRLF and reordered header',`\ufeff${amount}${d}${id}${d}name\r\n 0 ${d} a ${d} Alpha \r\n`,[r('a','Alpha',0)]),
  good('quoted multiline field',`${h}\na${d}"Alpha\nBeta"${d}1`,[r('a','Alpha\nBeta',1)]),
  good('empty batch',h,existing,existing),
  good('blank lines',`${h}\n\na${d}Alpha${d}1\n\n`,[r('a','Alpha',1)]),
  good('repeat import is idempotent',`${h}\na${d}After${d}0\nb${d}New${d}`, [existing[0],{...existing[1],name:'After',[amount]:0},r('b','New',null)],existing,{repeat:true}),
  good('prototype-like ID',`${h}\n__proto__${d}Normal${d}1`,[r('__proto__','Normal',1)]),
  bad('duplicate ID rejected',`${h}\na${d}First${d}1\na${d}Last${d}2`,existing),
  bad('later invalid row leaves original unchanged',`${h}\na${d}Changed${d}2\nb${d}${d}3`,existing),
  bad('unclosed quote',`${h}\na${d}"Missing quote${d}2`,existing),
  bad('short row',`${h}\na${d}Alpha`,existing),
  bad('duplicate required header',`${id}${d}name${d}${amount}${d}name\na${d}Alpha${d}1${d}Other`),
  bad('invalid source type',{},existing),
  bad('nonfinite number',`${h}\na${d}Alpha${d}Infinity`,existing)
 ];
 return{public:publicCases,feedback:[...publicCases,...extra.slice(0,5),extra[7],extra[9],extra[10]],private:[...publicCases,...extra]};
}
const stock=[{code:'old',quantity:7,title:'Kept',note:'preserve'},{code:'a',quantity:3,title:'Before',tag:'keep'}];
const inventoryPublic=[
 good('basic inventory',JSON.stringify([{code:'a',count:2,title:'Alpha'}]),[{code:'a',quantity:2,title:'Alpha'}]),
 good('merge keeps fields',JSON.stringify([{code:'a',count:5,title:'After'}]),[stock[0],{...stock[1],quantity:5,title:'After'}],stock),
 bad('numeric strings rejected',JSON.stringify([{code:'a',count:'2'}]),stock),
 bad('non-array source rejected','{}',stock)
];
const inventoryPrivate=[...inventoryPublic,
 good('zero integer',JSON.stringify([{code:' a ',count:0}]),[stock[0],{...stock[1],quantity:0}],stock),
 good('empty title explicitly clears',JSON.stringify([{code:'a',count:2,title:''}]),[stock[0],{...stock[1],quantity:2,title:''}],stock),
 good('new title defaults empty',JSON.stringify([{code:'b',count:0}]),[{code:'b',quantity:0,title:''}]),
 good('last duplicate wins',JSON.stringify([{code:'a',count:1,title:'First'},{code:'a',count:9,title:'Last'}]),[stock[0],{...stock[1],quantity:9,title:'Last'}],stock),
 good('omitted duplicate title uses original state',JSON.stringify([{code:'a',count:1,title:'Temporary'},{code:'a',count:8}]),[stock[0],{...stock[1],quantity:8}],stock),
 good('first-seen insertion order',JSON.stringify([{code:'b',count:1},{code:'c',count:2},{code:'b',count:3}]),[{code:'b',quantity:3,title:''},{code:'c',quantity:2,title:''}]),
 good('idempotent inventory import',JSON.stringify([{code:'a',count:0},{code:'b',count:4,title:'New'}]),[stock[0],{...stock[1],quantity:0},{code:'b',quantity:4,title:'New'}],stock,{repeat:true}),
 good('empty batch preserves state','[]',stock,stock),
 good('prototype-like code',JSON.stringify([{code:'__proto__',count:2}]),[{code:'__proto__',quantity:2,title:''}]),
 bad('earlier invalid duplicate still rejected',JSON.stringify([{code:'a',count:-1},{code:'a',count:2}]),stock),
 bad('later invalid row is atomic',JSON.stringify([{code:'a',count:2},{code:'b',count:null}]),stock),
 bad('fractional quantity',JSON.stringify([{code:'a',count:1.5}]),stock),
 bad('blank code',JSON.stringify([{code:' ',count:1}]),stock),
 bad('null row','[null]',stock),
 bad('array row','[[]]',stock),
 bad('null title',JSON.stringify([{code:'a',count:1,title:null}]),stock),
 bad('invalid JSON','[',stock),
 bad('non-string source',[],stock)
];
export function casesFor(task,suite){
 if(!tasks[task]||!['public','feedback','private'].includes(suite))throw Error('Unknown test case selection.');
 return task==='inventory'?(suite==='public'?inventoryPublic:inventoryPrivate):csvCases(task)[suite];
}
