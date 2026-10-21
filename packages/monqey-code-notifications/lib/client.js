window.__ModuleLoader__.load({
  id: 'monqey-code-notifications',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const { jsx, jsxs } = require('react/jsx-runtime');
    const React = require('react');

    const defaults = {
      enabled: true,
      notifyOnCompletion: true,
      notifyOnQuestion: true,
      desktopNotifications: true
    };

    const panelStyle = {
      display: 'grid',
      gap: 14,
      padding: 18,
      maxWidth: 720,
      color: 'inherit'
    };
    const cardStyle = {
      display: 'grid',
      gap: 12,
      padding: 16,
      border: '1px solid var(--dsw-alias-line-normal, #555)',
      borderRadius: 12
    };
    const rowStyle = { display: 'flex', gap: 10, alignItems: 'center' };
    const mutedStyle = { margin: 0, color: 'var(--dsw-alias-label-secondary, #aaa)' };
    const buttonStyle = {
      padding: '9px 14px',
      border: '1px solid var(--dsw-alias-line-normal, #555)',
      borderRadius: 8,
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      font: 'inherit'
    };
    const toastStackStyle = {
      position: 'fixed',
      right: 24,
      bottom: 24,
      zIndex: 1000,
      display: 'grid',
      gap: 10,
      width: 'min(380px, calc(100vw - 48px))',
      pointerEvents: 'none'
    };
    const toastStyle = {
      padding: '14px 16px',
      border: '1px solid var(--dsw-alias-line-normal, #555)',
      borderRadius: 12,
      background: 'var(--dsw-specific-input-major, #2d2d2d)',
      color: 'var(--dsw-alias-label-primary, #fff)',
      boxShadow: '0 10px 30px rgba(0, 0, 0, .35)',
      pointerEvents: 'auto'
    };

    function SettingsTab({ scope }) {
      const snapshot = React.useSyncExternalStore(
        scope.subscribe.bind(scope),
        () => scope.getSnapshot(),
        () => scope.getSnapshot()
      );
      const [draft, setDraft] = React.useState({ ...defaults, ...(snapshot.value ?? {}) });
      const [revision, setRevision] = React.useState(snapshot.revision);
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState('');

      React.useEffect(() => {
        if (!saving && snapshot.revision !== revision) {
          setDraft({ ...defaults, ...(snapshot.value ?? {}) });
          setRevision(snapshot.revision);
        }
      }, [revision, saving, snapshot.revision, snapshot.value]);

      if (snapshot.status === 'unavailable') return jsx('div', { style: panelStyle, children: 'Notification settings are unavailable. Restart Monqey Agent and try again.' });

      const update = (key) => (event) => setDraft((value) => ({ ...value, [key]: event.target.checked }));
      const save = async () => {
        setSaving(true);
        setMessage('');
        try {
          if (draft.desktopNotifications && !window.monqeyDesktop?.notify && typeof window.Notification === 'function' && window.Notification.permission === 'default') {
            await window.Notification.requestPermission();
          }
          await scope.set('enabled', draft.enabled);
          await scope.set('notifyOnCompletion', draft.notifyOnCompletion);
          await scope.set('notifyOnQuestion', draft.notifyOnQuestion);
          await scope.set('desktopNotifications', draft.desktopNotifications);
          setMessage('Saved');
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          setSaving(false);
        }
      };

      return jsxs('div', { style: panelStyle, children: [
        jsx('h2', { style: { margin: 0 }, children: 'Notifications' }),
        jsx('p', { style: mutedStyle, children: 'Show a Monqey Agent popup when the agent finishes or needs your input.' }),
        jsxs('div', { style: cardStyle, children: [
          jsx('label', { style: rowStyle, children: [jsx('input', { type: 'checkbox', checked: draft.enabled, onChange: update('enabled') }), 'Enable notifications'] }),
          jsx('label', { style: rowStyle, children: [jsx('input', { type: 'checkbox', checked: draft.notifyOnCompletion, onChange: update('notifyOnCompletion'), disabled: !draft.enabled }), 'Notify when generation is complete'] }),
          jsx('label', { style: rowStyle, children: [jsx('input', { type: 'checkbox', checked: draft.notifyOnQuestion, onChange: update('notifyOnQuestion'), disabled: !draft.enabled }), 'Notify when input is required'] }),
          jsx('label', { style: rowStyle, children: [jsx('input', { type: 'checkbox', checked: draft.desktopNotifications, onChange: update('desktopNotifications'), disabled: !draft.enabled }), 'Also use desktop notifications when Monqey Agent is hidden'] })
        ] }),
        jsxs('div', { style: { display: 'flex', gap: 10, alignItems: 'center' }, children: [
          jsx('button', { type: 'button', style: { ...buttonStyle, background: '#6957ff', borderColor: '#6957ff' }, disabled: saving, onClick: save, children: saving ? 'Saving…' : 'Save changes' }),
          message && jsx('span', { style: { color: message === 'Saved' ? '#58c27d' : '#ff8c8c' }, children: message })
        ] })
      ] });
    }

    function NotificationOverlay({ useSessions, useSessionPendingInteraction, scope }) {
      const settingsSnapshot = React.useSyncExternalStore(
        scope.subscribe.bind(scope),
        () => scope.getSnapshot(),
        () => scope.getSnapshot()
      );
      const settings = { ...defaults, ...(settingsSnapshot.value ?? {}) };
      const sessionState = useSessions((state) => state);
      const sessions = sessionState.byId;
      const pending = useSessionPendingInteraction((state) => state);
      const activeWork = sessionState.phase !== 'ready'
        || Object.values(sessions).some((session) => Boolean(session?.running))
        || Object.values(sessionState.jobsBySession ?? {}).some((jobs) => jobs.some((job) => job.status === 'running' || job.status === 'stopping'))
        || pending.size > 0;
      const previousSessions = React.useRef(null);
      const previousPending = React.useRef(new Map());
      const [toasts, setToasts] = React.useState([]);
      const [unreadCount, setUnreadCount] = React.useState(0);
      const pendingCount = settings.enabled && settings.notifyOnQuestion ? pending.size : 0;

      React.useEffect(() => {
        window.monqeyDesktop?.setPendingAttention?.(pendingCount);
        if (!pendingCount) setToasts(items => items.filter(item => !item.requiresInput));
      }, [pendingCount]);

      React.useEffect(() => () => window.monqeyDesktop?.setPendingAttention?.(0), []);

      React.useEffect(() => {
        window.monqeyDesktop?.setTaskbarBadge?.(unreadCount);
      }, [unreadCount]);

      React.useEffect(() => {
        window.monqeyDesktop?.setActiveWork?.(activeWork);
      }, [activeWork]);

      React.useEffect(() => {
        const clearBadge = () => setUnreadCount(0);
        window.addEventListener('focus', clearBadge);
        return () => window.removeEventListener('focus', clearBadge);
      }, []);

      const addToast = React.useCallback((title, body, requiresInput = false) => {
        const id = `${Date.now()}-${Math.random()}`;
        if (!requiresInput) setUnreadCount((count) => Math.min(99, count + 1));
        setToasts((items) => [...items, { id, title, body, requiresInput }].slice(-3));
        window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 8000);
        if (settings.desktopNotifications) {
          if (window.monqeyDesktop?.notify) window.monqeyDesktop.notify({ title, body, requiresInput });
          else if ((document.visibilityState === 'hidden' || !document.hasFocus()) && typeof window.Notification === 'function' && window.Notification.permission === 'granted') {
            const notification = new window.Notification(title, { body });
            notification.onclick = () => { window.focus(); notification.close(); };
          }
        }
      }, [settings.desktopNotifications]);

      React.useEffect(() => {
        const current = new Map(Object.entries(sessions).map(([id, session]) => [id, Boolean(session?.running)]));
        if (previousSessions.current === null) {
          previousSessions.current = current;
          return;
        }
        if (settings.enabled && settings.notifyOnCompletion) {
          for (const [id, running] of current) {
            if (previousSessions.current.get(id) === true && !running && !pending.has(id)) addToast('Generation complete', 'Monqey Agent has finished working.');
          }
        }
        previousSessions.current = current;
      }, [addToast, sessions, pending, settings.enabled, settings.notifyOnCompletion]);

      React.useEffect(() => {
        const current = new Map([...pending].map(([sessionId, interaction]) => [`${sessionId}:${interaction.key}`, interaction]));
        if (settings.enabled && settings.notifyOnQuestion) {
          for (const [key, interaction] of current) {
            if (!previousPending.current.has(key)) {
              const question = interaction.questions?.[0]?.question;
              if (interaction.kind === 'approval') addToast('Goedkeuring nodig', 'Een opdracht wacht op jouw goedkeuring. Open Monqey Agent om te reageren.', true);
              else addToast('Input required', question || 'Monqey Agent is waiting for your answer.', true);
            }
          }
        }
        previousPending.current = current;
      }, [addToast, pending, settings.enabled, settings.notifyOnQuestion]);

      if (toasts.length === 0) return null;
      return jsx('div', { style: toastStackStyle, children: toasts.map((toast) => jsxs('div', { style: toastStyle, children: [
        jsx('strong', { children: toast.title }),
        jsx('div', { style: { marginTop: 4, color: 'var(--dsw-alias-label-secondary, #bbb)' }, children: toast.body })
      ] }, toast.id)) });
    }

    const inject = ['slots', 'settingsScope'];

    function apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: 'notifications' });
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'monqey-code-notifications',
        order: 100,
        label: 'Monqey Agent notifications'
      }, (props) => jsx(NotificationOverlay, { ...props, scope })));
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'notifications',
        order: 20,
        label: 'Notifications',
        inject: () => ({ scope })
      }, SettingsTab));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
