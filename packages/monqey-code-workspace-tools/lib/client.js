window.__ModuleLoader__.load({id:'monqey-code-workspace-tools',factory:require=>{
  const React=require('react'),{jsx,jsxs}=require('react/jsx-runtime');
  const field={border:'1px solid var(--dsw-alias-border-l3)',background:'var(--dsw-specific-input-major)',color:'inherit',borderRadius:7,padding:9,font:'inherit'};
  const muted={color:'var(--dsw-alias-label-secondary)',fontSize:12,lineHeight:1.5};
  const button=(text,onClick,disabled=false)=>jsx('button',{type:'button',style:{...field,cursor:'pointer'},onClick,disabled,children:text});
  async function rpc(method,args={}){
    const rpcId=crypto.randomUUID(),response=await fetch(`/api/workspaceTools/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method:`workspaceTools/${method}`,payload:{args}})});
    if(!response.ok)throw Error(`Workspace tools unavailable (${response.status}).`);
    const envelope=await response.json();if(envelope.rpcId!==rpcId||!envelope.result?.ok)throw Error(envelope.result?.error?.message??'Workspace request failed.');return envelope.result.value;
  }
  function BrowserSettings(){
    const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
    const refresh=async()=>{setBusy(true);setError('');try{setData(await rpc('browser'));}catch(error){setError(error.message);}finally{setBusy(false);}};
    React.useEffect(()=>{void refresh();},[]);
    const connected=data?.checks?.find(check=>check.name==='extension connected')?.ok;
    return jsxs('section',{style:{display:'grid',gap:14,maxWidth:760},children:[jsx('h2',{style:{margin:0},children:'Browser'}),jsx('p',{style:{margin:0,lineHeight:1.5},children:'Let your agents work in your signed-in browser. Tasks open in a separate Agent Window. Watch, take over, or close that window to stop the task.'}),
      jsxs('div',{style:{...field,padding:16,display:'grid',gap:8},children:[jsx('strong',{role:'status',children:busy?'Checking your browser…':connected?'Browser connected':'Connect your browser'}),jsx('p',{style:{...muted,margin:0},children:connected?'Ready. Use /browser-skill in an agent and describe the task.':'Install the BrowserSkill extension once and enable its local connection. Brave uses the Chrome Web Store extension. Then check the connection here.'}),
      jsxs('div',{style:{display:'flex',gap:16,flexWrap:'wrap'},children:[jsx('a',{style:{color:'inherit'},href:'https://chromewebstore.google.com/detail/hhcmgoofomhgciiibhipgmgkgnoenaoi',target:'_blank',rel:'noopener noreferrer',children:'Install for Brave / Chrome'}),jsx('a',{style:{color:'inherit'},href:'https://microsoftedge.microsoft.com/addons/detail/browserskill/emacgiaaaiojkkpkddmmdfhmokgmnikg',target:'_blank',rel:'noopener noreferrer',children:'Install for Edge'})]}),button(busy?'Checking…':'Check connection',refresh,busy)]}),
      error&&jsx('p',{role:'alert',children:error}),data?.error&&jsx('p',{role:'alert',children:data.error}),
      jsx('p',{style:{...muted,margin:0},children:'Brave compatibility must be checked after connecting; BrowserSkill officially targets Chrome and Edge. Login and verification stay with you. Browser access requires Workspace Write. Give the agent a specific task and check consequential actions.'}),
      jsxs('details',{children:[jsx('summary',{style:{...muted,cursor:'pointer'},children:'Connection details'}),...(data?.checks??[]).map(check=>jsxs('div',{style:{borderBottom:field.border,padding:'8px 0'},children:[jsx('strong',{style:muted,children:`${check.ok?'✓':'○'} ${check.name}`}),jsx('div',{style:{...muted,overflowWrap:'anywhere'},children:check.detail})]},check.name))]})]});
  }
  function FileComparison({sessionId,checkpointId,file}){
    const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[open,setOpen]=React.useState(false);
    const load=async()=>{setOpen(!open);if(open||data)return;try{setData(await rpc('diff',{sessionId,checkpointId,file}));}catch(error){setError(error.message);}};
    return jsxs('div',{children:[jsx('button',{type:'button','aria-expanded':open,style:{...muted,border:0,padding:'5px 0',background:'transparent',cursor:'pointer'},onClick:load,children:open?'Hide comparison':'Compare file'}),open&&error&&jsx('p',{role:'alert',children:error}),open&&data&&jsxs('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:8},children:[...['before','current'].map(key=>jsxs('div',{style:{minWidth:0},children:[jsx('strong',{style:muted,children:key==='before'?'Restore point':'Current workspace'}),jsx('pre',{style:{fontSize:11,whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:240,overflow:'auto',padding:8,border:field.border},children:data[key]||'[File absent or empty]'})]},key)),data.truncated&&jsx('span',{style:muted,children:'Preview limited to 8,000 characters per side. Restore uses the complete saved file.'})]})]});
  }
  function RestorePoints({sessionId}){
    const [coverage,setCoverage]=React.useState({limited:false,reason:''});
    const [rows,setRows]=React.useState([]),[preview,setPreview]=React.useState(null),[selected,setSelected]=React.useState([]),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[message,setMessage]=React.useState('');
    const current=React.useRef(sessionId);current.current=sessionId;
    React.useEffect(()=>{let alive=true;setCoverage({limited:false,reason:''});const check=()=>{if(document.hidden||!sessionId)return;rpc('status',{sessionId}).then(value=>{if(alive)setCoverage(value);}).catch(()=>{});};check();const timer=setInterval(check,15000);return()=>{alive=false;clearInterval(timer);};},[sessionId]);
    React.useEffect(()=>{setRows([]);setPreview(null);setSelected([]);setError('');setMessage('');},[sessionId]);
    const action=async fn=>{const owned=sessionId;setBusy(true);setError('');try{await fn(owned);}catch(error){if(current.current===owned)setError(error.message);}finally{if(current.current===owned)setBusy(false);}};
    const refresh=()=>action(async owned=>{const rows=await rpc('list',{sessionId:owned});if(current.current===owned){setRows(rows);setPreview(null);}});
    React.useEffect(()=>{void refresh();},[sessionId]);
    const show=row=>action(async owned=>{const next=await rpc('preview',{sessionId:owned,checkpointId:row.id});if(current.current===owned){setPreview({...next,checkpointId:row.id});setSelected([]);setMessage('');}});
    const restore=()=>{if(!window.confirm(`Restore ${selected.length} selected file(s)? This changes workspace files. A recovery point will be kept.`))return;void action(async owned=>{const result=await rpc('restore',{sessionId:owned,token:preview.token,files:selected});if(current.current===owned){setPreview(null);setMessage(`Restored ${result.restored} file(s). A recovery point was saved.`);const rows=await rpc('list',{sessionId:owned});if(current.current===owned)setRows(rows);}});};
    return jsx('section',{style:{flex:1,minHeight:0,overflow:'auto',padding:20},children:jsxs('div',{'aria-label':'Restore points',style:{maxWidth:1000,margin:'0 auto',display:'grid',gap:12},children:[
      jsx('strong',{children:'Restore points'}),jsx('p',{style:muted,children:'Automatic source-file snapshots around file edits and terminal tools. Review and select files changed during the action. Newer edits, changed shared decisions, and running agents block restoration. Builds, dependencies, credentials, media, binary files, files over 8 MB, links and .monqey metadata are excluded. Cloud changes still waiting to sync cannot be detected.'}),
      button('Refresh',refresh,busy),error&&jsx('p',{role:'alert',children:error}),message&&jsx('p',{role:'status',children:message}),
      coverage.limited&&jsxs('div',{role:'status',style:muted,children:[jsx('p',{children:`Terminal snapshots are paused for this workspace. Your agent can continue; targeted file-edit restore points are still attempted. ${coverage.reason}`}),button('Retry automatic snapshots',()=>action(async owned=>{const value=await rpc('retry',{sessionId:owned});if(current.current===owned)setCoverage(value);}),busy)]}),
      !rows.length&&jsx('p',{style:muted,children:'No restore points yet. They appear after an agent edits files or runs a terminal tool in a registered workspace.'}),
      ...rows.map(row=>jsxs('div',{style:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'},children:[jsx('span',{style:{...muted,flex:1},children:`${new Date(row.at).toLocaleString()} · ${row.label} · ${row.changed} file(s)${row.skipped?' · additional files excluded':''}${!row.ready?' · not finalized; unavailable':''}`}),button('Preview',()=>show(row),busy||!row.ready||!row.changed)]},row.id)),
      preview&&jsxs('div',{style:{display:'grid',gap:8},children:[jsx('strong',{children:'Choose files to restore'}),preview.sharedChanged&&jsx('p',{role:'alert',children:'Shared project decisions changed. This restore point is blocked.'}),...preview.files.map(file=>jsxs('div',{children:[jsxs('label',{style:{display:'flex',gap:8,overflowWrap:'anywhere'},children:[jsx('input',{type:'checkbox',disabled:busy||file.conflict,checked:selected.includes(file.name),onChange:event=>setSelected(event.target.checked?[...selected,file.name].slice(0,100):selected.filter(name=>name!==file.name))}),`${file.name} · ${file.action}${file.conflict?' · newer change; blocked':''}`]}),jsx(FileComparison,{sessionId,checkpointId:preview.checkpointId,file:file.name})]},`${preview.checkpointId}:${file.name}`)),button('Restore selected files',restore,busy||!selected.length)]})]})});
  }
  return{inject:['slots'],apply(ctx){
    ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'monqey-browser',order:35,label:()=> 'Browser'},BrowserSettings));
    ctx.slots.inject('conversation.view',()=>ctx.slots.register({name:'conversation.view',id:'monqey-restore-points',order:20,label:()=> 'Restore points',inject:sessionId=>({sessionId})},RestorePoints));
  }};
}});
