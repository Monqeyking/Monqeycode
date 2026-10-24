window.__ModuleLoader__.load({
  id: 'monqey-code-memory',
  factory: require => {
    const React = require('react');
    const { jsx, jsxs } = require('react/jsx-runtime');
    const field = { border:'1px solid var(--dsw-alias-border-l3)',background:'var(--dsw-specific-input-major)',color:'inherit',borderRadius:7,padding:9,font:'inherit',boxSizing:'border-box',maxWidth:'100%' };
    const button = (title,onClick,props={}) => jsx('button',{type:'button',style:{...field,cursor:'pointer'},onClick,...props,children:title});
    const muted = {color:'var(--dsw-alias-label-secondary)',fontSize:12,lineHeight:1.5};
    const card = {border:'1px solid var(--dsw-alias-border-l3)',borderRadius:10,padding:16,display:'grid',gap:10};
    async function rpc(method,args={},signal) {
      const rpcId=crypto.randomUUID();const response=await fetch(`/api/memory/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method:`memory/${method}`,payload:{args}}),signal});
      if(!response.ok)throw Error(`Memory unavailable (HTTP ${response.status}).`);
      const envelope=await response.json();if(envelope.type!=='server-response'||envelope.rpcId!==rpcId)throw Error('Invalid memory response.');
      if(!envelope.result?.ok)throw Error(envelope.result?.error?.message??'Memory request failed.');return envelope.result.value;
    }
    function ReviewRoute({value,change}) {
      const [catalog,setCatalog]=React.useState({providers:[],models:[]});const [error,setError]=React.useState('');
      React.useEffect(()=>{const controller=new AbortController();setError('');rpc('catalog',{providerId:value.reviewProvider},controller.signal).then(setCatalog).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});return()=>controller.abort();},[value.reviewProvider]);
      return jsxs('div',{style:{display:'grid',gap:8},children:[
        jsxs('label',{children:['Learning model ',jsx('select',{'aria-label':'Learning provider',style:field,value:value.reviewProvider,onChange:event=>change({...value,reviewProvider:event.target.value,reviewModel:''}),children:[jsx('option',{value:'',children:'Use the current agent model'}),...catalog.providers.map(item=>jsx('option',{value:item.id,children:item.name},item.id))]})]}),
        value.reviewProvider&&jsx('select',{'aria-label':'Learning model',style:field,value:value.reviewModel,onChange:event=>change({...value,reviewModel:event.target.value}),children:[jsx('option',{value:'',children:'Choose a model…'}),...catalog.models.map(item=>jsx('option',{value:item.id,children:item.name},item.id))]}),
        value.reviewModel&&!catalog.models.some(item=>item.id===value.reviewModel)&&jsx('span',{style:muted,children:'The saved model is not currently listed. Refresh its connection or choose another model.'}),
        error&&jsx('span',{role:'alert',style:muted,children:error})
      ]});
    }
    function Editor({entry,workspaceId,workflow,save,close,busy,error}) {
      const [draft,setDraft]=React.useState(()=>entry?{...entry}:{title:'',content:'',kind:workflow?'workflow':workspaceId?'fact':'preference',workspaceId});
      const submit=event=>{event.preventDefault();void save({action:'save',...(entry?{id:entry.id,revision:entry.revision}:{}),kind:draft.kind,title:draft.title,content:draft.content,workspaceId:draft.workspaceId});};
      return jsxs('form',{onSubmit:submit,style:card,'aria-label':entry?'Edit memory':'New memory',children:[
        jsx('strong',{children:entry?'Edit memory':workflow?'New workflow':'New memory'}),
        jsxs('label',{style:{display:'grid',gap:5},children:['Title',jsx('input',{style:field,required:true,maxLength:100,value:draft.title,onChange:event=>setDraft({...draft,title:event.target.value})})]}),
        jsxs('label',{style:{display:'grid',gap:5},children:['Type',jsx('select',{style:field,value:draft.kind,disabled:!!entry,onChange:event=>setDraft({...draft,kind:event.target.value}),children:(workflow?['workflow']:workspaceId?['fact','preference']:['preference']).map(kind=>jsx('option',{value:kind,children:{preference:'Preference',fact:'Project fact',workflow:'Learned workflow'}[kind]},kind))})]}),
        jsxs('label',{style:{display:'grid',gap:5},children:['Content',jsx('textarea',{style:{...field,minHeight:130,resize:'vertical'},required:true,maxLength:draft.kind==='workflow'?4000:1600,value:draft.content,onChange:event=>setDraft({...draft,content:event.target.value})})]}),
        error&&jsx('span',{role:'alert',style:muted,children:error}),
        jsxs('div',{style:{display:'flex',gap:8},children:[jsx('button',{type:'submit',disabled:busy||!draft.title.trim()||!draft.content.trim(),style:field,children:busy?'Saving…':'Save memory'}),button('Cancel',close,{disabled:busy})]})
      ]});
    }
    const knowledgeFeeds = new Map();
    function useKnowledge(sessionId) {
      const [snapshot,setSnapshot] = React.useState({sessionId,turns:[]});
      React.useEffect(() => {
        let feed=knowledgeFeeds.get(sessionId);
        if(!feed){
          const controller=new AbortController();
          feed={listeners:new Set(),snapshot:{sessionId,turns:[]},loading:false,controller};
          feed.refresh=async()=>{
            if(feed.loading||document.hidden||controller.signal.aborted)return;
            feed.loading=true;
            try{const result=await rpc('activity',{sessionId},controller.signal);if(!controller.signal.aborted)feed.snapshot={sessionId,...result};}
            catch{if(!controller.signal.aborted)feed.snapshot={...feed.snapshot,error:'Knowledge activity is temporarily unavailable.'};}
            finally{feed.loading=false;if(!controller.signal.aborted)for(const listener of feed.listeners)listener(feed.snapshot);}
          };
          feed.timer=setInterval(feed.refresh,3000);document.addEventListener('visibilitychange',feed.refresh);knowledgeFeeds.set(sessionId,feed);
        }
        feed.listeners.add(setSnapshot);setSnapshot(feed.snapshot);void feed.refresh();
        return()=>{feed.listeners.delete(setSnapshot);if(!feed.listeners.size){feed.controller.abort();clearInterval(feed.timer);document.removeEventListener('visibilitychange',feed.refresh);knowledgeFeeds.delete(sessionId);}};
      },[sessionId]);
      return snapshot.sessionId===sessionId?snapshot:{turns:[]};
    }
    function KnowledgeReceipt({sessionId,messageId}) {
      const data=useKnowledge(sessionId),receipt=data.turns.find(item=>item.messageId===messageId);
      const [tab,setTab]=React.useState(null),[entry,setEntry]=React.useState(null),[editing,setEditing]=React.useState(false),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
      const request=React.useRef(null);
      const container=React.useRef(null);
      const panel=React.useRef(null);
      const panelId=React.useId();
      const [position,setPosition]=React.useState({top:12,left:12});
      React.useEffect(()=>()=>request.current?.abort(),[sessionId,messageId]);
      React.useLayoutEffect(()=>{
        if(!tab||!panel.current)return;
        const element=panel.current;
        if(!element.matches(':popover-open'))element.showPopover();
        const place=()=>{
          const anchor=container.current?.getBoundingClientRect();if(!anchor)return;
          const box=element.getBoundingClientRect(),below=window.innerHeight-anchor.bottom-12;
          const top=below>=box.height?anchor.bottom+8:Math.max(12,anchor.top-box.height-8);
          setPosition({top:Math.min(top,window.innerHeight-box.height-12),left:Math.max(12,Math.min(anchor.left,window.innerWidth-box.width-12))});
        };
        place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
        return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
      },[tab,entry,editing,busy]);
      React.useEffect(()=>{
        if(!tab)return;
        const dismiss=event=>{if(event.type==='keydown'?event.key==='Escape':!container.current?.contains(event.target)){if(event.type==='keydown')container.current?.querySelector('button[aria-expanded="true"]')?.focus();request.current?.abort();setTab(null);setBusy(false);}};
        document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',dismiss);
        return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',dismiss);};
      },[tab]);
      const select=phase=>{request.current?.abort();setTab(old=>old===phase?null:phase);setEntry(null);setEditing(false);setError('');setBusy(false);};
      const inspect=async ref=>{
        request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setError('');setEditing(false);setEntry(null);
        try{const value=await rpc('knowledgeEntry',{sessionId,turn:receipt.turn,entryId:ref.id},controller.signal);if(!controller.signal.aborted)setEntry({...value,loadedRevision:ref.revision});}
        catch(cause){if(!controller.signal.aborted)setError(cause.message);}finally{if(!controller.signal.aborted)setBusy(false);}
      };
      const mutate=async value=>{
        request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setError('');
        try{await rpc('mutate',{request:value},controller.signal);if(!controller.signal.aborted){setEntry(null);setEditing(false);await knowledgeFeeds.get(sessionId)?.refresh();}}
        catch(cause){if(!controller.signal.aborted)setError(cause.message);}finally{if(!controller.signal.aborted)setBusy(false);}
      };
      if(!receipt||!receipt.used.length&&!receipt.learned.length)return null;
      const labels={context:'Included in response context','memory-read':'Opened memory',skill:'Loaded skill',saved:'New memory',updated:'Updated memory'};
      const active=tab?receipt[tab]:[];
      const badge=(phase,title)=>receipt[phase].length?button(`${title} · ${receipt[phase].length}`,()=>select(phase),{'aria-expanded':tab===phase,'aria-controls':tab===phase?panelId:undefined,style:{...field,padding:'3px 8px',fontSize:12,cursor:'pointer',background:'transparent',borderRadius:20}}):null;
      return jsxs('div',{ref:container,'aria-label':'Knowledge for this response',style:{display:'inline-flex',gap:8,position:'relative'},children:[
        jsxs('div',{style:{display:'flex',gap:6,flexWrap:'wrap'},children:[badge('used','Knowledge used'),badge('learned','Learned')]}),
        tab&&jsxs('section',{ref:panel,id:panelId,popover:'manual','aria-label':tab==='used'?'Knowledge used details':'Learned knowledge details',style:{...card,position:'fixed',inset:'auto',margin:0,top:position.top,left:position.left,width:'min(560px, calc(100vw - 48px))',boxSizing:'border-box',color:'var(--dsw-alias-label-primary)',background:'var(--dsw-specific-input-major)',boxShadow:'0 8px 32px #0004',padding:12,maxHeight:'min(380px, 60vh)',overflowY:'auto'},children:[
          jsxs('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8},children:[jsx('strong',{style:{fontSize:13},children:tab==='used'?'Knowledge used':'Learned'}),button('Close',()=>select(tab),{'aria-label':'Close knowledge details',style:{...field,padding:'3px 7px',fontSize:12,cursor:'pointer'}})]}),
          jsx('p',{style:{...muted,margin:0},children:tab==='used'?'These memories were included in this response’s context or opened successfully. This shows access, not whether they influenced the answer.':'Saved or updated during this turn or its learning review. Shared proposals awaiting confirmation are not counted.'}),
          ...active.map(ref=>button(`${ref.title} · ${labels[ref.via]} · revision ${ref.revision}`,()=>inspect(ref),{key:ref.id,disabled:busy,style:{...field,textAlign:'left',fontSize:12,cursor:'pointer'}})),
          data.error&&jsx('span',{role:'status',style:muted,children:data.error}),
          busy&&jsx('span',{role:'status',style:muted,children:'Loading…'}),
          error&&jsx('span',{role:'alert',style:muted,children:error}),
          entry&&!active.some(ref=>ref.id===entry.id)&&jsx('span',{style:muted,children:'This memory is no longer available here.'}),
          entry&&active.some(ref=>ref.id===entry.id)&&(editing?jsx(Editor,{entry,workspaceId:entry.workspaceId,workflow:entry.kind==='workflow',save:mutate,close:()=>setEditing(false),busy,error}):jsxs('article',{style:{display:'grid',gap:8},children:[
            jsx('strong',{style:{fontSize:13},children:entry.title}),
            jsx('span',{style:muted,children:`${entry.workspaceId?'Project':'Personal'} · Current saved revision ${entry.revision}${entry.loadedRevision!==entry.revision?` · ${tab==='learned'?'This turn saved':'This response loaded'} revision ${entry.loadedRevision}`:''}`}),
            jsx('p',{style:{margin:0,fontSize:13,lineHeight:1.5,whiteSpace:'pre-wrap',overflowWrap:'anywhere'},children:entry.content}),
            entry.source.evidence&&jsxs('details',{children:[jsx('summary',{style:muted,children:'Source evidence'}),jsx('p',{style:{...muted,whiteSpace:'pre-wrap'},children:entry.source.evidence})]}),
            entry.shared&&jsx('span',{style:muted,children:'Confirmed shared knowledge. Edit its decision in Co-work > Shared project.'}),
            jsxs('div',{style:{display:'flex',gap:6},children:[!entry.shared&&button('Edit',()=>setEditing(true),{disabled:busy}),button('Forget',()=>mutate({action:'forget',id:entry.id,revision:entry.revision}),{disabled:busy})]})
          ]}))
        ]})
      ]});
    }
    function MemorySettings({useSessions,openAgent,close}) {
      const goAgent=id=>{close?.();openAgent(id);};
      const current=useSessions(state=>state.current);
      const [data,setData]=React.useState(null),[draft,setDraft]=React.useState(null),[configRevision,setConfigRevision]=React.useState(0);
      const [scope,setScope]=React.useState('personal'),[tab,setTab]=React.useState('memories'),[query,setQuery]=React.useState(''),[edit,setEdit]=React.useState(null);
      const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[message,setMessage]=React.useState('');
      const mounted=React.useRef(true);
      React.useEffect(()=>{mounted.current=true;const controller=new AbortController();let loading=false;const refresh=async()=>{if(loading||document.hidden)return;loading=true;try{const next=await rpc('snapshot',{},controller.signal);if(!controller.signal.aborted)setData(next);}catch(cause){if(!controller.signal.aborted)setError(cause.message);}finally{loading=false;}};void refresh();const timer=setInterval(refresh,3000);document.addEventListener('visibilitychange',refresh);return()=>{mounted.current=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[]);
      React.useEffect(()=>{if(data){setDraft(data.settings);setConfigRevision(data.settingsRevision);}},[data?.settingsRevision]);
      const run=async operation=>{setBusy(true);setError('');setMessage('');try{return await operation();}catch(cause){if(mounted.current)setError(cause.message);}finally{if(mounted.current)setBusy(false);}};
      const save=async request=>{const next=await rpc('mutate',{request});if(mounted.current)setData(next);};
      const saveSettings=()=>run(async()=>{const next=await rpc('configure',{value:draft,revision:configRevision});if(mounted.current){setData(next);setMessage('Memory settings saved. Applies to the next request or review.');}});
      const saveEditor=request=>run(async()=>{await save(request);setEdit(null);setMessage('Memory saved.');});
      const review=()=>run(async()=>{const result=await rpc('review',{sessionId:current});if(mounted.current){setMessage(result.detail);setData(await rpc('snapshot'));}});
      if(!data||!draft)return jsx('p',{style:muted,role:error?'alert':'status',children:error||'Loading local memory…'});
      const workspaceId=scope==='personal'?null:scope;
      const sharedWorkspace=workspaceId&&data.sharedWorkspaces?.includes(workspaceId);
      const scopes=[...data.workspaces,...[...new Set(data.entries.map(entry=>entry.workspaceId).filter(Boolean))].filter(id=>!data.workspaces.some(item=>item.id===id)).map(id=>({id,title:`Unavailable workspace (${id.slice(0,8)})`}))];
      const entries=data.entries.filter(entry=>entry.workspaceId===workspaceId&&(tab==='workflows'?entry.kind==='workflow':entry.kind!=='workflow')&&`${entry.title} ${entry.content}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.updatedAt-a.updatedAt);
      const forget=entry=>run(async()=>{await save({action:'forget',id:entry.id,revision:entry.revision});setMessage('Memory forgotten. Its content and previous versions were removed; automatic learning will not recreate it under the same title. Existing conversations are unchanged; start a new agent for a clean context.');});
      return jsxs('section',{style:{display:'grid',gap:18,padding:20,maxWidth:900,color:'var(--dsw-alias-label-primary)'},'aria-label':'Local memory settings',children:[
        jsx('h2',{style:{margin:0},children:'Memory'}),
        jsx('p',{style:{...muted,margin:0},children:'Use the search icon beside Workspaces to search previous agent messages. Learned workflows are also available as project skills: the agent sees their names and loads full instructions only when needed. Successful corrections can improve learned workflows; manual edits stay protected.'}),
        jsx('p',{style:{...muted,margin:0},children:'Private memory for this local user profile, available across chats and model changes. Personal memories stay private. When you enable a shared project in Co-work, new project knowledge becomes a proposal there and confirmed decisions update their linked local memories. Existing private project notes are not published.'}),
        jsxs('div',{style:card,children:[
          jsxs('label',{children:[jsx('input',{type:'checkbox',checked:draft.enabled,onChange:event=>setDraft({...draft,enabled:event.target.checked})}),' Enable local memory']}),
          jsxs('label',{children:[jsx('input',{type:'checkbox',checked:draft.automatic,onChange:event=>setDraft({...draft,automatic:event.target.checked})}),' Learn from preferences and verified corrections']}),
          jsx('p',{style:{...muted,margin:0},children:'A local filter selects newly stated preferences or failures/corrections followed by successful tool results. Routine conversations do not request a review. Each automatic review uses at most 8,000 input characters including instructions and 600 output tokens, or your lower limits. Up to three attempts are allowed per rolling 24 hours across this profile; failed and cancelled attempts count too. Input token usage varies by model. Manual reviews use your limits and bypass the daily allowance. At most one review runs at a time, with a five-minute cooldown per agent. New work cancels its review. Read-only and Plan sessions cannot save memories.'}),
          jsxs('details',{children:[jsx('summary',{style:{cursor:'pointer',fontSize:13},children:'Learning model and limits'}),jsx('div',{style:{display:'grid',gap:10,marginTop:12},children:[
          jsx(ReviewRoute,{value:draft,change:setDraft}),
          jsxs('label',{children:['Maximum input characters including review instructions ',jsx('input',{type:'number',min:2000,max:24000,step:1000,style:{...field,width:110},value:draft.maxInputChars,onChange:event=>setDraft({...draft,maxInputChars:Number(event.target.value)})})]}),
          jsxs('label',{children:['Maximum review output tokens ',jsx('input',{type:'number',min:256,max:2048,step:1,style:{...field,width:110},value:draft.maxOutputTokens,onChange:event=>setDraft({...draft,maxOutputTokens:Number(event.target.value)})})]}),
          ]})]}),
          jsxs('div',{style:{display:'flex',gap:8,flexWrap:'wrap'},children:[button(busy?'Saving…':'Save settings',saveSettings,{disabled:busy||Boolean(draft.reviewProvider)&&!draft.reviewModel}),button(data.reviewing?'Review running…':'Review current agent',review,{disabled:busy||!!data.reviewing||!current||!data.settings.enabled})]}),
          jsx('span',{style:muted,children:`Local profile ${data.profileId.slice(0,8)} · ${data.entries.length}/300 saved entries · ${data.reviewing?'Learning in progress':'No review running'}`}),
          data.learningBudget&&jsx('span',{style:muted,children:`Automatic reviews: ${data.learningBudget.used}/${data.learningBudget.limit} attempts in the last 24 hours${data.learningBudget.nextAt?` · Next slot ${new Date(data.learningBudget.nextAt).toLocaleString()}`:''}`})
        ]}),
        error&&jsx('div',{role:'alert',style:muted,children:error}),message&&jsx('div',{role:'status',style:muted,children:message}),
        jsxs('div',{style:{display:'flex',gap:8,flexWrap:'wrap'},children:[jsx('select',{'aria-label':'Memory scope',style:field,value:scope,disabled:busy,onChange:event=>{setScope(event.target.value);setEdit(null);},children:[jsx('option',{value:'personal',children:'Personal'}),...scopes.map(item=>jsx('option',{value:item.id,children:item.title},item.id))]}),button('Memories',()=>{setTab('memories');setEdit(null);},{'aria-pressed':tab==='memories',disabled:busy}),button('Learned workflows',()=>{setTab('workflows');setEdit(null);},{'aria-pressed':tab==='workflows',disabled:busy}),button(tab==='workflows'?'Add workflow':'Add memory',()=>setEdit({new:true}),{disabled:busy||!!sharedWorkspace||tab==='workflows'&&!workspaceId}),jsx('input',{'aria-label':'Search memories',placeholder:'Search saved knowledge…',style:{...field,flex:1,minWidth:170},value:query,onChange:event=>setQuery(event.target.value)})]}),
        sharedWorkspace&&jsx('p',{style:muted,children:'This project uses shared knowledge. Add or change it in Co-work > Shared project. Older private project notes remain here for you but are excluded from agent recall.'}),
        edit&&jsx(Editor,{entry:edit.new?null:edit,workspaceId,workflow:tab==='workflows',save:saveEditor,close:()=>setEdit(null),busy,error},`editor:${edit.id??`${scope}:${tab}:new`}`),
        entries.length===0&&jsx('p',{style:muted,children:tab==='workflows'&&!workspaceId?'Choose a workspace to view its learned workflows.':'Nothing saved here yet. Add an entry or let an agent learn a useful lesson.'}),
        ...entries.map(entry=>jsxs('article',{style:card,children:[
          jsx('strong',{children:entry.title}),jsx('span',{style:muted,children:`${entry.kind==='workflow'?'Project skill':entry.kind==='fact'?'Project fact':'Preference'} · ${entry.source.actor==='user'?'Added by you':entry.source.actor==='review'?'Learned automatically':'Saved by agent'} · ${new Date(entry.updatedAt).toLocaleString()}`}),
          entry.kind==='workflow'&&jsx('code',{style:{...muted,overflowWrap:'anywhere'},children:sharedWorkspace&&!entry.shared?'Private workflow — unavailable as a skill in this shared project':`learned-${entry.id} · revision ${entry.revision}`}),
          jsx('p',{style:{margin:0,whiteSpace:'pre-wrap',overflowWrap:'anywhere',lineHeight:1.5},children:entry.content}),
          entry.shared&&jsx('span',{style:muted,children:`Follows shared project ${entry.shared.projectId.slice(0,8)} · decision ${entry.shared.decisionId.slice(0,8)} · version ${entry.shared.version.slice(0,8)}. Change it in Co-work > Shared project.`}),
          jsxs('div',{style:{display:'flex',gap:8,flexWrap:'wrap'},children:[!entry.shared&&!sharedWorkspace&&button('Edit',()=>setEdit(entry),{disabled:busy}),button('Forget',()=>forget(entry),{disabled:busy}),entry.source.sessionId&&button('Open source agent',()=>goAgent(entry.source.sessionId))]}),
          entry.source.evidence&&jsxs('details',{children:[jsx('summary',{style:{...muted,cursor:'pointer'},children:'Source evidence'}),jsx('p',{style:{...muted,whiteSpace:'pre-wrap',overflowWrap:'anywhere'},children:entry.source.evidence})]}),
          entry.history.length>0&&jsxs('details',{children:[jsx('summary',{style:{...muted,cursor:'pointer'},children:'Previous versions'}),...entry.history.map((version,index)=>jsx('p',{style:{...muted,whiteSpace:'pre-wrap'},children:`${new Date(version.updatedAt).toLocaleString()} · ${version.title}\n${version.content}`},index))]})
        ]},`entry:${entry.id}`)),
        data.reviews.length>0&&jsxs('details',{children:[jsx('summary',{style:{cursor:'pointer'},children:'Learning activity'}),...data.reviews.map(review=>jsxs('div',{style:{...card,marginTop:10},children:[jsx('span',{children:`${review.status} · ${review.detail}`}),jsx('span',{style:muted,children:`${new Date(review.at).toLocaleString()} · ${review.provider} / ${review.model} · reported input ${review.inputTokens}, output ${review.outputTokens}, cache read ${review.cacheReadTokens} tokens`}),button('Open source agent',()=>goAgent(review.sessionId))]},review.id))]})
      ]});
    }
    return {inject:['slots','uiWorkspace'],apply(ctx){
      if(typeof document!=='undefined')ctx.effect(()=>{
        const style=document.createElement('style');
        // shortcut: native search results expose CSS classes, but no snippet presentation slot.
        style.textContent='[class*="_searchResultMeta"]:has([class*="_searchResultSnippet"]){flex-direction:column;align-items:flex-start;gap:3px}[class*="_searchResultSnippet"]{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;overflow:hidden;line-height:1.45}';
        document.head.append(style);return()=>style.remove();
      });
      ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'memory',order:34,label:()=> 'Memory',inject:()=>({openAgent:id=>ctx.uiWorkspace.openSession(id)})},MemorySettings));
      ctx.slots.inject('conversation.chat.assistant-actions',()=>ctx.slots.register({name:'conversation.chat.assistant-actions',id:'monqey-knowledge-receipt',order:30,inject:sessionId=>({sessionId})},KnowledgeReceipt));
    }};
  }
});
