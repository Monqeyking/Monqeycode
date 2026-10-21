window.__ModuleLoader__.load({
  id: 'monqey-code-delegation',
  factory: require => {
    const React = require('react');
    const { jsx, jsxs } = require('react/jsx-runtime');
    const panel = { display: 'grid', gap: 12, padding: 18, maxWidth: 760, color: 'inherit' };
    const card = { border: '1px solid var(--dsw-alias-line-normal, #555)', borderRadius: 10, padding: 12, display: 'grid', gap: 8 };
    const field = { padding: 8, borderRadius: 6, background: 'var(--dsw-specific-input-major, #292929)', color: 'inherit', border: '1px solid var(--dsw-alias-line-normal, #555)', font: 'inherit' };
    const muted = { color: 'var(--dsw-alias-label-secondary, #aaa)', margin: 0, fontSize: 12 };
    const total = usage => Object.values(usage ?? {}).reduce((sum, n) => sum + n, 0);
    const format = n => Number(n).toLocaleString();
    async function rpc(method, args, signal) {
      const rpcId = crypto.randomUUID();
      const response = await fetch(`/api/workers/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: `workers/${method}`, payload: { args } }), signal });
      if (!response.ok) throw new Error(`Workers unavailable (HTTP ${response.status}).`);
      const envelope = await response.json();
      if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) throw new Error('Invalid worker response.');
      if (!envelope.result?.ok) throw new Error(envelope.result?.error?.message ?? 'Worker request failed.');
      return envelope.result.value;
    }
    function RoutePicker({ title, value, onChange }) {
      const [catalog, setCatalog] = React.useState({ providers: [], models: [] });
      const [error, setError] = React.useState('');
      const [loading, setLoading] = React.useState(false);
      React.useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError('');
        rpc('catalog', { providerId: value.provider }, controller.signal).then(setCatalog).catch(cause => {
          if (!controller.signal.aborted) setError(cause.message);
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
      }, [value.provider]);
      return jsxs('fieldset', { style: card, children: [
        jsx('legend', { children: title }),
        jsx('label', { children: ['Provider ', jsx('select', { style: field, 'aria-label': `${title} provider`, value: value.provider,
          onChange: event => onChange({ provider: event.target.value, model: '' }), children: [
            jsx('option', { value: '', children: 'Choose a connected provider' }),
            ...catalog.providers.map(provider => jsx('option', { value: provider.id, children: provider.name }, provider.id))
          ] })] }),
        jsx('label', { children: ['Model ', jsx('select', { style: field, 'aria-label': `${title} model`, value: value.model, disabled: !value.provider || loading,
          onChange: event => onChange({ ...value, model: event.target.value }), children: [
            jsx('option', { value: '', children: loading ? 'Loading live catalog…' : 'Choose a model' }),
            ...catalog.models.map(model => jsx('option', { value: model.id, children: model.name }, model.id))
          ] })] }),
        error && jsx('p', { role: 'alert', style: muted, children: error }),
        value.model && !loading && !error && !catalog.models.some(model => model.id === value.model) && jsx('p', { role: 'alert', style: muted, children: 'Saved model is unavailable. Choose a model from the current catalog.' })
      ] });
    }
    function SettingsTab({ scope }) {
      const snapshot = React.useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot());
      const [draft, setDraft] = React.useState(snapshot.value);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState('');
      React.useEffect(() => setDraft(snapshot.value), [snapshot.value]);
      if (!draft || snapshot.status === 'unavailable') return jsx('p', { style: panel, children: 'Worker settings unavailable. Restart Monqey Agent.' });
      const save = async () => {
        setSaving(true); setMessage('');
        try {
          if (draft.enabled && (!draft.worker.provider || !draft.worker.model)) throw new Error('Choose a worker model before enabling automatic delegation.');
          for (const selected of [draft.worker, draft.fallback]) {
            if (!selected.provider && !selected.model) continue;
            if (!selected.provider || !selected.model) throw new Error('Select both a provider and a model, or clear the provider.');
            const live = await rpc('catalog', { providerId: selected.provider });
            if (!live.models.some(model => model.id === selected.model)) throw new Error('Selected model is unavailable in the live catalog.');
          }
          await scope.mutate(Object.entries(draft).map(([key, value]) => ({ op: 'set', path: [key], value })), snapshot.revision);
          setMessage('Saved. Applies to the next worker task; your main model stays the same.');
        } catch (error) { setMessage(error.message); }
        finally { setSaving(false); }
      };
      return jsxs('div', { style: panel, children: [
        jsx('h2', { style: { margin: 0 }, children: 'Workers' }),
        jsx('p', { style: muted, children: 'Automatically use a worker for substantial independent tasks. Small tasks stay with the main model. Select a lower-cost model yourself; delegation adds coordination work and does not guarantee fewer tokens.' }),
        jsxs('label', { children: [jsx('input', { type: 'checkbox', checked: draft.enabled, onChange: event => setDraft({ ...draft, enabled: event.target.checked }) }), ' Automatic delegation'] }),
        jsx(RoutePicker, { title: 'Worker', value: draft.worker, onChange: worker => setDraft({ ...draft, worker }) }),
        jsx(RoutePicker, { title: 'Reserve (optional)', value: draft.fallback, onChange: fallback => setDraft({ ...draft, fallback }) }),
        jsx('p', { style: muted, children: 'The reserve is tried at most once. For account quota errors it must use another provider. At most two managed workers run per chat; workers cannot delegate further.' }),
        ...[['taskTokenLimit', 'Total tokens per worker task (all attempts, including cache)', 1000, 10000000], ['outputTokenLimit', 'Maximum output tokens per model request', 256, 32768]].map(([key, label, min, max]) => jsxs('label', { children: [label, ' ', jsx('input', { type: 'number', min, max, step: 1, style: field, value: draft[key], onChange: event => setDraft({ ...draft, [key]: Number(event.target.value) }) })] }, key)),
        jsx('p', { style: muted, children: 'Budgets use provider-reported usage and stop further worker requests when reached. One in-flight request can exceed the budget. Unreported provider usage cannot be measured. Native manual subagent/fork tools remain separate.' }),
        jsx('button', { type: 'button', disabled: saving, style: field, onClick: save, children: saving ? 'Saving…' : 'Save changes' }),
        message && jsx('p', { role: 'status', children: message })
      ] });
    }
    function WorkerCards({ sessionId, openChild }) {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [showAll, setShowAll] = React.useState(false);
      React.useEffect(() => {
        const controller = new AbortController();
        let busy = false;
        setError('');
        const refresh = async () => {
          if (busy || document.hidden) return;
          busy = true;
          try { const next = await rpc('listTasks', { parentId: sessionId }, controller.signal); if (!controller.signal.aborted) { setData({ ...next, parentId: sessionId }); setError(''); } }
          catch (cause) { if (!controller.signal.aborted) setError(cause.message); }
          finally { busy = false; }
        };
        void refresh();
        const timer = setInterval(refresh, 3000);
        document.addEventListener('visibilitychange', refresh);
        return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
      }, [sessionId]);
      const [stopping, setStopping] = React.useState(null);
      const stop = async task => {
        setStopping(task.id);
        try { await rpc('stopTask', { parentId: sessionId, taskId: task.id }); setError(''); }
        catch (cause) { setError(cause.message); }
        finally { setStopping(null); }
      };
      if (data?.parentId !== sessionId || !data?.tasks.length) return error ? jsx('p', { style: muted, role: 'status', children: error }) : null;
      const tasks = data.tasks.slice().sort((a, b) => b.createdAt - a.createdAt);
      const visible = showAll ? tasks : tasks.slice(0, 3);
      return jsxs('section', { 'aria-label': 'Worker tasks', style: { display: 'grid', gap: 8, padding: '8px 0', maxHeight: 340, overflowY: 'auto' }, children: [
        jsx('div', { style: muted, children: `Main: ${format(total(data.mainUsage))} · Workers: ${format(total(data.workersUsage))} · Total: ${format(total(data.mainUsage) + total(data.workersUsage))} tokens (includes cache and retries; not a price)` }),
        ...visible.map(task => {
          const attempt = task.attempts.at(-1);
          const running = ['starting', 'running', 'recovering'].includes(task.status);
          return jsxs('article', { style: card, children: [
            jsxs('div', { style: { display: 'flex', gap: 12, justifyContent: 'space-between' }, children: [jsx('strong', { children: task.description }), jsx('span', { role: 'status', children: task.status })] }),
            jsx('p', { style: muted, children: `${attempt ? `${attempt.provider} / ${attempt.model}` : 'Checking model…'} · ${format(total(task.usage))} / ${format(task.tokenLimit)} tokens · ${task.attempts.length} attempt(s)` }),
            task.detail && jsx('p', { style: muted, children: task.detail }),
            jsxs('div', { style: { display: 'flex', gap: 12 }, children: [
              attempt && jsx('button', { type: 'button', style: field, onClick: () => openChild({ parentSessionId: sessionId, childSessionId: attempt.childId, mode: 'continuable' }), children: 'View worker' }),
              running && jsx('button', { type: 'button', style: field, disabled: stopping === task.id, onClick: () => stop(task), children: stopping === task.id ? 'Stopping…' : 'Stop' })
            ] }),
            task.output && jsxs('details', { children: [jsx('summary', { children: 'Result' }), jsx('pre', { style: { whiteSpace: 'pre-wrap', font: 'inherit', margin: '8px 0' }, children: task.output })] })
          ] }, task.id);
        }),
        tasks.length > 3 && jsx('button', { type: 'button', style: field, onClick: () => setShowAll(!showAll), children: showAll ? 'Show recent workers' : `Show all ${tasks.length} workers` }),
        error && jsx('p', { role: 'alert', style: muted, children: error })
      ] });
    }
    return {
      inject: ['slots', 'settingsScope', 'sessions'],
      apply(ctx) {
        const scope = ctx.settingsScope.bind({ namespace: 'workers' });
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'workers', order: 21, label: 'Workers', inject: () => ({ scope }) }, SettingsTab));
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'monqey-workers', order: 20,
          inject: sessionId => ({ sessionId, openChild: address => ctx.sessions.openSubagent(address) }) }, WorkerCards));
      }
    };
  }
});
