window.__ModuleLoader__.load({
  id: 'monqey-code-cowork',
  factory: require => {
    const React = require('react');
    const { jsx, jsxs } = require('react/jsx-runtime');
    const labels = { todo: 'To do', in_progress: 'In progress', waiting: 'Waiting', done: 'Done' };
    const muted = { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 };
    const colors = { todo: '#9299a5', in_progress: '#879cff', waiting: '#daa75c', done: '#72b694' };
    const css = `
      .mq-cowork{height:100%;min-height:0;overflow:auto;color:var(--dsw-alias-label-primary);font-size:14px;padding:28px;box-sizing:border-box}
      .mq-cowork *{box-sizing:border-box}.mq-cowork h1{font-size:24px;letter-spacing:-.6px;margin:0 0 6px}.mq-cowork h2{font-size:16px;margin:0}
      .mq-cowork p{line-height:1.5}.mq-cowork button,.mq-cowork input,.mq-cowork textarea,.mq-cowork select,.mq-task-links button{font:inherit;color:inherit}
      .mq-cowork button,.mq-task-links button{cursor:pointer}.mq-cowork button:disabled{opacity:.5;cursor:default}
      .mq-cowork button:focus-visible,.mq-cowork input:focus-visible,.mq-cowork textarea:focus-visible,.mq-cowork select:focus-visible,.mq-task-links button:focus-visible{outline:2px solid #879cff;outline-offset:2px}
      .mq-cowork .mq-btn,.mq-task-links button{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:8px 12px}
      .mq-cowork .mq-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent}
      .mq-cowork .mq-toolbar{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:24px}
      .mq-cowork .mq-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mq-cowork .mq-body{display:flex;gap:20px;align-items:flex-start}
      .mq-cowork .mq-board{display:grid;grid-template-columns:repeat(4,minmax(180px,1fr));gap:14px;flex:1;min-width:0;overflow-x:auto;padding-bottom:10px}
      .mq-cowork .mq-column{background:var(--dsw-specific-sidebar-fill);border-radius:12px;padding:12px;min-height:220px}
      .mq-cowork .mq-col-title{display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;margin:2px 2px 16px}
      .mq-cowork .mq-card{display:block;width:100%;text-align:left;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l3);border-radius:10px;padding:13px;margin-bottom:10px;overflow-wrap:anywhere}
      .mq-cowork .mq-card:hover{background:var(--dsw-alias-interactive-bg-hover)}.mq-cowork .mq-card[aria-pressed=true]{border-color:#879cff}
      .mq-cowork .mq-card strong{font-size:13px;font-weight:500;line-height:1.5;display:block}.mq-cowork .mq-meta{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:10px;line-height:1.5}
      .mq-cowork .mq-detail{border:1px solid var(--dsw-alias-border-l3);border-radius:12px;padding:18px;width:340px;flex:none;display:grid;gap:14px;background:var(--dsw-alias-bg-base)}
      .mq-cowork label{display:grid;gap:6px;font-size:12px}.mq-cowork input:not([type=checkbox]),.mq-cowork select,.mq-cowork textarea{width:100%;border:1px solid var(--dsw-alias-border-l3);border-radius:7px;background:var(--dsw-specific-input-major);padding:9px;font:inherit;color:inherit}
      .mq-cowork textarea{resize:vertical;min-height:90px}.mq-cowork .mq-check{display:flex;align-items:center;gap:7px;line-height:1.5}.mq-cowork .mq-check input{margin:0}
      .mq-cowork .mq-empty{padding:30px 16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;border:1px dashed var(--dsw-alias-border-l3);border-radius:10px}
      .mq-cowork .mq-message{padding:12px 14px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;margin-bottom:16px;line-height:1.5}
      .mq-cowork .mq-history{border-top:1px solid var(--dsw-alias-border-l3);padding-top:12px;display:grid;gap:10px;font-size:12px;overflow-wrap:anywhere}.mq-cowork .mq-history p{margin:3px 0;white-space:pre-wrap}
      .mq-cowork .mq-activity{margin-top:24px}.mq-cowork .mq-activity summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}.mq-cowork .mq-activity li{padding:6px 0;font-size:12px;line-height:1.5}
      .mq-task-links{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;padding:6px 0;color:var(--dsw-alias-label-secondary)}.mq-task-links button{padding:5px 9px;background:transparent}
      @media(max-width:1450px){.mq-cowork .mq-body{flex-direction:column}.mq-cowork .mq-board{width:100%;flex:auto}.mq-cowork .mq-detail{width:100%;max-width:700px}}
      @media(max-width:650px){.mq-cowork{padding:18px}.mq-cowork .mq-board{grid-template-columns:repeat(4,220px)}.mq-cowork .mq-toolbar{align-items:flex-start}}
    `;
    async function rpc(method, args = {}, signal, namespace = 'cowork') {
      const rpcId = crypto.randomUUID();
      const response = await fetch(`/api/${namespace}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId, method: `${namespace}/${method}`, payload: { args } }), signal });
      if (!response.ok) throw Error(`Co-work unavailable (HTTP ${response.status}).`);
      const envelope = await response.json();
      if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) throw Error('Invalid Co-work response.');
      if (!envelope.result?.ok) throw Error(envelope.result?.error?.message ?? 'Co-work request failed.');
      return envelope.result.value;
    }
    const time = value => new Date(value).toLocaleString();
    const button = (text, onClick, props = {}) => jsx('button', { type: 'button', className: 'mq-btn', onClick, ...props, children: text });
    const sharedRpc = (method, args, signal) => rpc(method, args, signal, 'sharedProject');
    function SharedProject({ workspace }) {
      const [data, setData] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false), [draft, setDraft] = React.useState(null);
      const alive = React.useRef(true);
      React.useEffect(() => {
        alive.current = true; const controller = new AbortController(); let loading = false;
        const refresh = async () => { if (loading || document.hidden) return; loading = true; try { const next = await sharedRpc('snapshot', { workspaceId: workspace.id }, controller.signal); if (!controller.signal.aborted) { setData(next); setError(''); } } catch (cause) { if (!controller.signal.aborted) setError(cause.message); } finally { loading = false; } };
        void refresh(); const timer = setInterval(refresh, 3000);
        return () => { alive.current = false; controller.abort(); clearInterval(timer); };
      }, [workspace.id]);
      const run = async (method, args) => { setBusy(true); setError(''); try { const next = await sharedRpc(method, { workspaceId: workspace.id, ...args }); if (alive.current) { setData(next); setDraft(null); } } catch (cause) { if (alive.current) setError(cause.message); } finally { if (alive.current) setBusy(false); } };
      const propose = item => setDraft({ ...(item ? { decisionId: item.decisionId } : {}), kind: item?.kind ?? 'decision', title: item?.title ?? '', content: item?.content ?? '', reason: '' });
      const input = (label, key, multiline = false) => jsxs('label', { children: [label, jsx(multiline ? 'textarea' : 'input', { value: draft[key], required: key !== 'reason', maxLength: key === 'title' ? 100 : key === 'reason' ? 1000 : 4000, onChange: event => setDraft({ ...draft, [key]: event.target.value }) })] });
      return jsxs('section', { 'aria-label': 'Shared project', style: { display: 'grid', gap: 16, maxWidth: 1000 }, children: [
        jsxs('div', { children: [jsx('h2', { children: 'Shared project' }), jsx('p', { style: muted, children: 'Decisions and project knowledge live in .monqey inside this project folder. Both people open the same synced folder. Personal memory and chats stay private; the task board remains local to this device.' })] }),
        error && jsx('div', { className: 'mq-message', role: 'alert', children: error }),
        !data ? jsx('p', { children: 'Loading shared project…' }) : !data.enabled ? jsxs('div', { className: 'mq-message', children: [jsx('p', { children: 'Enable sharing for this project folder. Agents will propose project knowledge here for your confirmation. Existing private notes are kept private. Confirmed decisions are checked before agent tool actions, including terminal and worker calls; these checks use extra model requests.' }), button('Enable shared project', () => run('enable', { title: workspace.title.slice(0, 100) }), { disabled: busy })] }) : jsxs(React.Fragment, { children: [
          jsxs('div', { className: 'mq-tools', children: [jsx('strong', { children: data.project.title }), jsx('span', { style: muted, children: `${data.decisions.length} subjects · ${data.proposals.length} pending · ${data.author}` }), button('New proposal', () => propose(), { disabled: busy }), jsx('span', { style: muted, children: `Project ${data.project.id.slice(0, 8)}` })] }),
          data.decisions.some(item => item.conflict) && jsx('div', { className: 'mq-message', role: 'alert', children: 'Conflicting confirmed versions were synced. Agent actions are blocked. Propose one replacement for this subject and confirm it to resolve all current versions.' }),
          draft && jsxs('form', { className: 'mq-detail', style: { width: '100%' }, onSubmit: event => { event.preventDefault(); void run('propose', { input: draft }); }, children: [
            jsx('h2', { children: draft.decisionId ? 'Propose replacement' : 'New project proposal' }),
            jsxs('label', { children: ['Type', jsx('select', { value: draft.kind, onChange: event => setDraft({ ...draft, kind: event.target.value }), children: ['decision','fact','workflow'].map(kind => jsx('option', { value: kind, children: { decision: 'Decision', fact: 'Project fact', workflow: 'Workflow' }[kind] }, kind)) })] }),
            input('Title', 'title'), input('Agreement or knowledge', 'content', true), input('Reason for this choice', 'reason', true),
            jsxs('div', { className: 'mq-tools', children: [jsx('button', { type: 'submit', className: 'mq-btn', disabled: busy || !draft.title.trim() || !draft.content.trim(), children: 'Save proposal' }), button('Cancel', () => setDraft(null), { disabled: busy })] })
          ] }),
          jsx('h2', { children: 'Pending confirmation' }),
          !data.proposals.length && jsx('p', { style: muted, children: 'No pending proposals. Agents can propose useful project knowledge during work.' }),
          ...data.proposals.map(item => jsxs('article', { className: 'mq-detail', style: { width: '100%' }, children: [jsx('strong', { children: item.title }), jsx('p', { style: { margin: 0, whiteSpace: 'pre-wrap' }, children: item.content }), item.reason && jsx('p', { style: muted, children: `Reason: ${item.reason}` }), jsx('span', { style: muted, children: `Proposed by ${item.actor.label} · ${time(item.at)}${data.decisions.some(decision => decision.id === item.decisionId) ? ' · Replaces the current version(s)' : ''}` }), jsxs('div', { className: 'mq-tools', children: [button('Confirm agreement', () => run('resolve', { proposalId: item.id, revision: data.revision, action: 'accept' }), { disabled: busy }), button('Dismiss', () => run('resolve', { proposalId: item.id, revision: data.revision, action: 'dismiss' }), { disabled: busy })] })] }, item.id)),
          jsx('h2', { children: 'Confirmed project knowledge' }),
          !data.decisions.length && jsx('p', { style: muted, children: 'No confirmed decisions yet.' }),
          ...data.decisions.flatMap(decision => decision.versions.map(item => jsxs('article', { className: 'mq-detail', style: { width: '100%' }, children: [jsx('strong', { children: `${decision.conflict ? 'Conflict · ' : ''}${item.title}` }), jsx('p', { style: { margin: 0, whiteSpace: 'pre-wrap' }, children: item.content }), item.reason && jsx('p', { style: muted, children: `Reason: ${item.reason}` }), jsx('span', { style: muted, children: `Confirmed by ${item.confirmedBy} · ${time(item.confirmedAt)} · Version ${item.version.slice(0, 8)}` }), button('Propose replacement', () => propose(item), { disabled: busy })] }, item.version))),
          data.notices?.length > 0 && jsxs('details', { className: 'mq-activity', children: [jsx('summary', { children: 'Blocked agent actions' }), ...data.notices.map((item, index) => jsx('p', { style: muted, children: `${time(item.at)} · ${item.reason}` }, `${item.at}:${index}`))] }),
          data.history?.length > 0 && jsxs('details', { className: 'mq-activity', children: [jsx('summary', { children: 'Decision history' }), ...data.history.slice().sort((a,b) => b.at-a.at).map(item => jsx('p', { style: muted, children: `${time(item.at)} · ${item.actor.label} · ${item.type === 'accept' ? 'Confirmed' : 'Dismissed'} · ${item.title ?? item.decisionId} · ${item.id.slice(0, 8)}` }, item.id))] })
        ] })
      ] });
    }
    function Icon({ size = 16, board = false }) {
      return jsx('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        children: board ? jsxs(React.Fragment, { children: [jsx('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }), jsx('path', { d: 'M9 4v16M15 4v16M5.5 8h1M11.5 8h1M17.5 8h1' })] }) : jsx('path', { d: 'M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-5 3v-6a7.5 7.5 0 0 1 6.5-12H13a7 7 0 0 1 7 7.5Z' }) });
    }
    const selection = { workspaceId: '', taskId: '', listeners: new Set(), version: 0 };
    const select = (workspaceId, taskId) => { selection.workspaceId = workspaceId; selection.taskId = taskId; selection.version++; for (const listener of selection.listeners) listener(); };
    const subscribe = listener => { selection.listeners.add(listener); return () => selection.listeners.delete(listener); };
    const taskDraft = task => ({ title: task.title, description: task.description, assignee: task.assignee, status: task.status, linkedSessionId: task.linkedSessionId, dependencies: task.dependencies });
    function TaskDetail({ task, board, workspace, sessions, save, openAgent, close }) {
      const [draft, setDraft] = React.useState(() => taskDraft(task));
      const [base, setBase] = React.useState(task.revision);
      const [comment, setComment] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const dirty = JSON.stringify(draft) !== JSON.stringify(taskDraft(task));
      React.useEffect(() => { if (!dirty && !comment) { setDraft(taskDraft(task)); setBase(task.revision); } }, [task.revision]);
      const change = (key, value) => setDraft(old => ({ ...old, [key]: value }));
      const run = async request => { setBusy(true); setError(''); try { const result = await save({ taskId: task.id, revision: base, ...request }); setDraft(taskDraft(result.task)); setBase(result.task.revision); if (request.action === 'comment') setComment(''); } catch (cause) { setError(cause.message); } finally { setBusy(false); } };
      const field = (label, key, props = {}) => jsxs('label', { children: [label, jsx('input', { value: draft[key], maxLength: key === 'title' ? 160 : 100, onChange: event => change(key, event.target.value), ...props })] });
      const actor = by => by.kind === 'agent' ? sessions.byId[by.id]?.title || 'Agent' : by.label;
      const stale = task.revision !== base;
      return jsxs('aside', { className: 'mq-detail', 'aria-label': 'Task details', children: [
        jsxs('div', { className: 'mq-tools', style: { justifyContent: 'space-between' }, children: [jsx('h2', { children: 'Task details' }), button('Close', close)] }),
        task.archived && jsx('div', { style: muted, children: 'Archived task' }),
        stale && jsxs('div', { role: 'status', className: 'mq-message', children: ['This task changed. Your draft has been kept. ', button('Reload latest', () => { setDraft(taskDraft(task)); setBase(task.revision); setError(''); })] }),
        field('Title', 'title', { required: true }),
        jsxs('label', { children: ['Description', jsx('textarea', { value: draft.description, maxLength: 4000, onChange: event => change('description', event.target.value) })] }),
        field('Owner', 'assignee', { placeholder: 'Person or agent' }),
        jsxs('label', { children: ['Status', jsx('select', { value: draft.status, onChange: event => change('status', event.target.value), children: Object.entries(labels).map(([value, label]) => jsx('option', { value, children: label }, value)) })] }),
        jsxs('label', { children: ['Linked agent', jsx('select', { value: draft.linkedSessionId ?? '', onChange: event => change('linkedSessionId', event.target.value || null), children: [jsx('option', { value: '', children: 'No linked agent' }), ...workspace.sessionIds.map(id => jsx('option', { value: id, children: sessions.byId[id]?.title || `Agent ${id.slice(0, 8)}` }, id))] })] }),
        task.linkedSessionId && button('Open agent', () => openAgent(task.linkedSessionId)),
        jsx('p', { style: { ...muted, margin: 0 }, children: 'An owner tracks responsibility. To run work, open an agent and give it a task.' }),
        jsxs('details', { children: [jsx('summary', { style: { fontSize: 12, cursor: 'pointer' }, children: `Dependencies (${draft.dependencies.length})` }), jsx('div', { style: { display: 'grid', gap: 7, marginTop: 10, maxHeight: 180, overflowY: 'auto' }, children: board.tasks.filter(item => item.id !== task.id && (!item.archived || draft.dependencies.includes(item.id))).map(item => jsxs('label', { className: 'mq-check', children: [jsx('input', { type: 'checkbox', checked: draft.dependencies.includes(item.id), onChange: event => change('dependencies', event.target.checked ? [...draft.dependencies, item.id] : draft.dependencies.filter(id => id !== item.id)) }), `${item.title} · ${labels[item.status]}`] }, item.id)) })] }),
        error && jsx('p', { role: 'alert', style: { ...muted, margin: 0 }, children: error }),
        jsxs('div', { className: 'mq-tools', children: [button(busy ? 'Saving…' : 'Save changes', () => run({ action: 'update', patch: draft }), { className: 'mq-btn mq-primary', disabled: busy || stale || !draft.title.trim() || !dirty }), button(task.archived ? 'Restore' : 'Archive', () => run({ action: 'update', patch: { archived: !task.archived } }), { disabled: busy || stale || dirty })] }),
        jsx('div', { style: muted, children: `Updated ${time(task.updatedAt)} · ${actor(task.updatedBy)}` }),
        jsxs('section', { className: 'mq-history', 'aria-label': 'Task comments', children: [jsx('strong', { children: 'Comments' }), task.comments.length === 0 && jsx('span', { style: muted, children: 'Progress and decisions appear here.' }), ...task.comments.map(item => jsxs('article', { children: [jsx('span', { style: muted, children: `${actor(item.actor)} · ${time(item.createdAt)}` }), jsx('p', { children: item.text })] }, item.id)), jsxs('label', { children: ['Add comment', jsx('textarea', { value: comment, maxLength: 2000, onChange: event => setComment(event.target.value), placeholder: 'Share progress or a decision…' })] }), button('Post comment', () => run({ action: 'comment', comment }), { disabled: busy || stale || dirty || !comment.trim() }), dirty && jsx('span', { style: muted, children: 'Save or reload your changes before posting a comment.' })] })
      ] });
    }
    function Board({ useSessions, useWorkspaces, openAgent }) {
      const sessions = useSessions(state => state);
      const workspaceState = useWorkspaces(state => state);
      const selectionVersion = React.useSyncExternalStore(subscribe, () => selection.version);
      const [workspaces, setWorkspaces] = React.useState([]);
      const [workspaceId, setWorkspaceId] = React.useState(selection.workspaceId);
      const [board, setBoard] = React.useState(null);
      const [selected, setSelected] = React.useState(selection.taskId);
      const [archived, setArchived] = React.useState(false);
      const [error, setError] = React.useState('');
      const [creating, setCreating] = React.useState(false);
      const [title, setTitle] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [newRequest, setNewRequest] = React.useState(() => crypto.randomUUID());
      const [view, setView] = React.useState('tasks');
      const currentWorkspace = React.useRef(workspaceId); currentWorkspace.current = workspaceId;
      React.useEffect(() => { const controller = new AbortController(); rpc('workspaces', {}, controller.signal).then(items => { setWorkspaces(items); setWorkspaceId(old => items.some(item => item.id === old) ? old : items.find(item => item.sessionIds.includes(sessions.current))?.id || items[0]?.id || ''); }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }); return () => controller.abort(); }, [workspaceState.items]);
      React.useEffect(() => { if (selection.workspaceId) { setWorkspaceId(selection.workspaceId); setSelected(selection.taskId); } }, [selectionVersion]);
      React.useEffect(() => {
        setBoard(null); setError(''); if (!workspaceId) return;
        const controller = new AbortController(); let loading = false;
        const refresh = async () => { if (loading || document.hidden) return; loading = true; try { const next = await rpc('board', { workspaceId }, controller.signal); if (!controller.signal.aborted) { setBoard(next); setError(''); } } catch (cause) { if (!controller.signal.aborted) setError(cause.message); } finally { loading = false; } };
        void refresh(); const timer = setInterval(refresh, 3000); document.addEventListener('visibilitychange', refresh);
        return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
      }, [workspaceId]);
      const save = async request => { const owned = workspaceId; const result = await rpc('mutate', { workspaceId: owned, request }); if (currentWorkspace.current === owned) setBoard(result.board); return result; };
      const create = async event => { event.preventDefault(); if (!title.trim() || busy) return; setBusy(true); setError(''); const owned = workspaceId; try { const result = await save({ action: 'create', requestId: newRequest, title }); if (currentWorkspace.current === owned) { setSelected(result.task.id); setTitle(''); setCreating(false); setNewRequest(crypto.randomUUID()); } } catch (cause) { setError(cause.message); } finally { setBusy(false); } };
      const workspace = workspaces.find(item => item.id === workspaceId);
      const data = board?.workspaceId === workspaceId ? board : null;
      const tasks = data?.tasks.filter(item => item.archived === archived) ?? [];
      const selectedTask = data?.tasks.find(item => item.id === selected);
      return jsxs('div', { className: 'mq-cowork', children: [
        jsx('style', { children: css }),
        jsxs('header', { className: 'mq-toolbar', children: [jsxs('div', { children: [jsx('h1', { children: 'Co-work' }), jsx('p', { style: { ...muted, margin: 0 }, children: 'One workspace. One shared view of the work.' })] }), jsxs('div', { className: 'mq-tools', children: [jsx('select', { 'aria-label': 'Workspace', style: { width: 'auto', maxWidth: 260 }, value: workspaceId, disabled: busy, onChange: event => { setWorkspaceId(event.target.value); setSelected(''); setTitle(''); setCreating(false); setNewRequest(crypto.randomUUID()); }, children: workspaces.map(item => jsx('option', { value: item.id, children: item.title }, item.id)) }), button(archived ? 'Show active' : 'Archived', () => { setView('tasks'); setArchived(!archived); setSelected(''); }), button('New task', () => { setView('tasks'); setCreating(!creating); setNewRequest(crypto.randomUUID()); }, { className: 'mq-btn mq-primary', disabled: !workspace || busy })] })] }),
        jsxs('div', { className: 'mq-tools', style: { marginBottom: 20 }, children: [button('Tasks', () => setView('tasks'), { 'aria-pressed': view === 'tasks' }), button('Shared project', () => setView('shared'), { 'aria-pressed': view === 'shared', disabled: !workspace })] }),
        view === 'shared' && workspace && jsx(SharedProject, { workspace }, workspace.id),
        jsx('div', { hidden: view !== 'tasks', children: jsxs(React.Fragment, { children: [
        jsx('p', { style: { ...muted, margin: '0 0 18px' }, children: 'Tasks are saved in this Monqey Agent workspace. Team accounts and syncing between devices are not connected yet.' }),
        error && jsx('div', { className: 'mq-message', role: 'alert', children: error }),
        creating && jsxs('form', { onSubmit: create, className: 'mq-tools', style: { marginBottom: 20 }, children: [jsx('input', { 'aria-label': 'New task title', autoFocus: true, required: true, maxLength: 160, placeholder: 'What needs to be done?', value: title, disabled: busy, style: { flex: 1, minWidth: 200 }, onChange: event => setTitle(event.target.value) }), jsx('button', { type: 'submit', className: 'mq-btn mq-primary', disabled: busy || !title.trim(), children: busy ? 'Creating…' : 'Create task' }), button('Cancel', () => setCreating(false), { disabled: busy })] }),
        !workspace ? jsx('div', { className: 'mq-empty', children: 'Open or add a workspace from Agents to start tracking tasks.' }) : !data ? jsx('div', { className: 'mq-empty', children: error ? 'The board could not be loaded. Retrying…' : 'Loading tasks…' }) : jsxs('div', { className: 'mq-body', children: [
          jsx('div', { className: 'mq-board', 'aria-label': archived ? 'Archived tasks' : 'Task board', children: Object.entries(labels).map(([status, label]) => jsxs('section', { className: 'mq-column', 'aria-label': label, children: [jsxs('div', { className: 'mq-col-title', children: [jsx('span', { style: { width: 7, height: 7, borderRadius: '50%', background: colors[status] } }), label, jsx('span', { style: { ...muted, marginLeft: 'auto' }, children: tasks.filter(item => item.status === status).length })] }), ...tasks.filter(item => item.status === status).sort((a, b) => b.updatedAt - a.updatedAt).map(task => {
            const blocked = task.dependencies.filter(id => data.tasks.find(item => item.id === id)?.status !== 'done').length;
            return jsxs('button', { type: 'button', className: 'mq-card', 'aria-pressed': task.id === selected, onClick: () => setSelected(task.id), children: [jsx('strong', { children: task.title }), jsx('div', { className: 'mq-meta', children: task.assignee || 'Unassigned' }), (blocked > 0 || task.linkedSessionId || task.comments.length > 0) && jsx('div', { className: 'mq-meta', children: [blocked > 0 ? `${blocked} dependency waiting` : '', task.linkedSessionId ? 'Agent linked' : '', task.comments.length ? `${task.comments.length} comment(s)` : ''].filter(Boolean).join(' · ') })] }, task.id);
          }), !tasks.some(item => item.status === status) && jsx('div', { className: 'mq-empty', children: 'No tasks' })] }, status)) }),
          selectedTask && jsx(TaskDetail, { task: selectedTask, board: data, workspace, sessions, save, openAgent, close: () => setSelected('') }, `${workspaceId}:${selectedTask.id}`)
        ] }),
        data?.activity.length > 0 && jsxs('details', { className: 'mq-activity', children: [jsx('summary', { children: 'Recent activity' }), jsx('ul', { style: { listStyle: 'none', padding: 0 }, children: data.activity.slice(0, 30).map(item => jsx('li', { children: `${item.actor.kind === 'agent' ? sessions.byId[item.actor.id]?.title || 'Agent' : item.actor.label} · ${item.text} · ${time(item.createdAt)}` }, item.id)) })] })
        ] }) })
      ] });
    }
    function SessionTasks({ sessionId, openBoard }) {
      const [data, setData] = React.useState(null);
      React.useEffect(() => {
        const controller = new AbortController(); let busy = false; setData(null);
        const refresh = async () => { if (busy || document.hidden) return; busy = true; try { const next = await rpc('sessionTasks', { sessionId }, controller.signal); if (!controller.signal.aborted) setData(next); } catch { /* The board reports connection errors; keep the composer usable. */ } finally { busy = false; } };
        void refresh(); const timer = setInterval(refresh, 3000); document.addEventListener('visibilitychange', refresh);
        return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
      }, [sessionId]);
      if (!data?.tasks.length) return null;
      return jsxs('div', { className: 'mq-task-links', 'aria-label': 'Linked Co-work tasks', children: [jsx('style', { children: css }), jsx('span', { children: 'Co-work' }), ...data.tasks.slice(0, 3).map(task => button(`${task.title} · ${labels[task.status]}`, () => openBoard(data.workspaceId, task.id), { key: task.id })), data.tasks.length > 3 && button(`+${data.tasks.length - 3} tasks`, () => openBoard(data.workspaceId, ''))] });
    }
    return { inject: ['slots', 'layout', 'uiWorkspace'], apply(ctx) {
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'cowork', inject: () => ({ openAgent: id => ctx.uiWorkspace.openSession(id) }) }, Board));
      ctx.slots.inject('sidebar.panellist', function* () {
        yield ctx.slots.register({ name: 'sidebar.panellist', id: 'agents', order: 0, label: () => 'Agents' }, props => jsx(Icon, props));
        yield ctx.slots.register({ name: 'sidebar.panellist', id: 'cowork', order: 10, label: () => 'Co-work' }, props => jsx(Icon, { ...props, board: true }));
      });
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'monqey-cowork-tasks', order: 10, inject: sessionId => ({ sessionId, openBoard: (workspaceId, taskId) => { select(workspaceId, taskId); ctx.layout.selectPanel('cowork'); } }) }, SessionTasks));
    } };
  }
});
