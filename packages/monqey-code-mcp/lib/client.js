  window.__ModuleLoader__.load({
    id: 'monqey-code-mcp',
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      const { jsx, jsxs } = require('react/jsx-runtime');
    const React = require('react');

    const locale = {
      nav: 'MCP',
      title: 'MCP connections',
      intro: 'Connect Monqey Code to local tools and services that expose the Model Context Protocol.',
      add: 'Add MCP server',
      save: 'Save changes',
      saved: 'Saved',
      enabled: 'Enabled',
      name: 'Server name',
      transport: 'Transport',
      stdio: 'Local process (stdio)',
      http: 'Streamable HTTP',
      command: 'Command',
      arguments: 'Arguments (one per line)',
      workingDirectory: 'Working directory (optional)',
      url: 'MCP endpoint URL',
      remove: 'Remove',
      empty: 'No MCP servers configured yet.',
      unavailable: 'MCP settings are unavailable. Restart Monqey Code and try again.',
      advanced: 'Authentication headers and environment variables can be added under the mcp-secrets section in settings.yaml.'
    };

    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '10px 12px',
      border: '1px solid var(--dsw-alias-line-normal, #555)',
      borderRadius: 8,
      background: 'var(--dsw-alias-fill-normal, transparent)',
      color: 'inherit',
      font: 'inherit'
    };
    const labelStyle = { display: 'grid', gap: 6, flex: 1, minWidth: 220 };
    const cardStyle = {
      display: 'grid',
      gap: 14,
      padding: 16,
      marginTop: 12,
      border: '1px solid var(--dsw-alias-line-normal, #555)',
      borderRadius: 12
    };
    const buttonStyle = {
      padding: '9px 14px',
      border: '1px solid var(--dsw-alias-line-normal, #555)',
      borderRadius: 8,
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      font: 'inherit'
    };

    function freshServer() {
      return {
        serverName: 'new-server',
        enabled: false,
        transport: 'stdio',
        command: '',
        args: [],
        cwd: '',
        url: '',
        toolCallTimeoutMs: 60000
      };
    }

    function McpTab({ scope }) {
      const snapshot = React.useSyncExternalStore(
        scope.subscribe.bind(scope),
        () => scope.getSnapshot(),
        () => scope.getSnapshot()
      );
      const storedServers = snapshot.value?.servers ?? [];
      const [draft, setDraft] = React.useState(storedServers);
      const [revision, setRevision] = React.useState(snapshot.revision);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState('');

      React.useEffect(() => {
        if (!saving && snapshot.revision !== revision) {
          setDraft(storedServers);
          setRevision(snapshot.revision);
        }
      }, [snapshot.revision, revision, saving, storedServers]);

      if (snapshot.status === 'unavailable') return jsx('div', { style: { padding: 20 }, children: locale.unavailable });

      const update = (index, patch) => setDraft((servers) => servers.map((server, i) => i === index ? { ...server, ...patch } : server));
      const save = async () => {
        setSaving(true);
        setMessage('');
        try {
          await scope.set('servers', draft);
          setMessage(locale.saved);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          setSaving(false);
        }
      };

      return jsxs('div', { style: { padding: 20, maxWidth: 760 }, children: [
        jsx('h2', { style: { margin: '0 0 8px' }, children: locale.title }),
        jsx('p', { style: { margin: '0 0 18px', color: 'var(--dsw-alias-label-secondary, #aaa)' }, children: locale.intro }),
        draft.length === 0 && jsx('p', { style: { color: 'var(--dsw-alias-label-secondary, #aaa)' }, children: locale.empty }),
        ...draft.map((server, index) => jsxs('div', { style: cardStyle, children: [
          jsxs('div', { style: { display: 'flex', gap: 14, alignItems: 'end', flexWrap: 'wrap' }, children: [
            jsx('label', { style: labelStyle, children: [locale.name, jsx('input', { style: inputStyle, value: server.serverName, onChange: (event) => update(index, { serverName: event.target.value }) })] }),
            jsx('label', { style: labelStyle, children: [locale.transport, jsx('select', { style: inputStyle, value: server.transport, onChange: (event) => update(index, { transport: event.target.value }), children: [jsx('option', { value: 'stdio', children: locale.stdio }), jsx('option', { value: 'streamable-http', children: locale.http })] })] }),
            jsx('label', { style: { display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 10 }, children: [jsx('input', { type: 'checkbox', checked: server.enabled, onChange: (event) => update(index, { enabled: event.target.checked }) }), locale.enabled] })
          ] }),
          server.transport === 'stdio' ? jsxs(React.Fragment, { children: [
            jsx('label', { style: labelStyle, children: [locale.command, jsx('input', { style: inputStyle, placeholder: 'python', value: server.command, onChange: (event) => update(index, { command: event.target.value }) })] }),
            jsx('label', { style: labelStyle, children: [locale.arguments, jsx('textarea', { style: { ...inputStyle, minHeight: 72 }, value: server.args.join('\n'), onChange: (event) => update(index, { args: event.target.value.split(/\r?\n/).filter(Boolean) }) })] }),
            jsx('label', { style: labelStyle, children: [locale.workingDirectory, jsx('input', { style: inputStyle, value: server.cwd, onChange: (event) => update(index, { cwd: event.target.value }) })] })
          ] }) : jsx('label', { style: labelStyle, children: [locale.url, jsx('input', { style: inputStyle, placeholder: 'http://127.0.0.1:3000/mcp', value: server.url, onChange: (event) => update(index, { url: event.target.value }) })] }),
          jsx('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary, #aaa)', fontSize: 13 }, children: locale.advanced }),
          jsx('button', { type: 'button', style: { ...buttonStyle, justifySelf: 'start' }, onClick: () => setDraft((servers) => servers.filter((_server, i) => i !== index)), children: locale.remove })
        ] }, `${server.serverName}-${index}`)),
        jsxs('div', { style: { display: 'flex', gap: 10, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' }, children: [
          jsx('button', { type: 'button', style: buttonStyle, onClick: () => setDraft((servers) => [...servers, freshServer()]), children: locale.add }),
          jsx('button', { type: 'button', style: { ...buttonStyle, background: '#6957ff', borderColor: '#6957ff' }, disabled: saving, onClick: save, children: saving ? 'Saving…' : locale.save }),
          message && jsx('span', { style: { color: message === locale.saved ? '#58c27d' : '#ff8c8c' }, children: message })
        ] })
      ] });
    }

    const inject = ['slots', 'settingsScope'];

    function apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: 'mcp' });
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'mcp',
        order: 10,
        label: () => locale.nav,
        inject: () => ({ scope })
      }, McpTab));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
