const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monqeyDesktop', {
  chrome: {
    getInfo: () => ipcRenderer.invoke('monqey-code:desktop-chrome', 'info'),
    onAction(callback) {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, action) => { if (['new-agent', 'settings'].includes(action)) callback(action); };
      ipcRenderer.on('monqey-code:desktop-action', listener);
      return () => ipcRenderer.removeListener('monqey-code:desktop-action', listener);
    }
  },
  mobileAccess: {
    signIn: provider => ipcRenderer.invoke('monqey-code:mobile-access', 'sign-in', provider),
    cancelSignIn: () => ipcRenderer.invoke('monqey-code:mobile-access', 'cancel-sign-in'),
    signOut: () => ipcRenderer.invoke('monqey-code:mobile-access', 'sign-out'),
    getStatus: () => ipcRenderer.invoke('monqey-code:mobile-access', 'status'),
    setConnectionService: value => ipcRenderer.invoke('monqey-code:mobile-access', 'configure', value),
    setEnabled: enabled => ipcRenderer.invoke('monqey-code:mobile-access', 'enable', enabled),
    pairPhone: () => ipcRenderer.invoke('monqey-code:mobile-access', 'pair'),
    cancelPairing: () => ipcRenderer.invoke('monqey-code:mobile-access', 'cancel'),
    approvePhone: id => ipcRenderer.invoke('monqey-code:mobile-access', 'approve', id),
    revokeAccess: () => ipcRenderer.invoke('monqey-code:mobile-access', 'revoke')
  },
  setPendingAttention(count) {
    if (!Number.isFinite(count)) return;
    ipcRenderer.send('monqey-code:pending-attention', Math.max(0, Math.min(99, Math.trunc(count))));
  },
  notify(message) {
    if (typeof message?.title !== 'string' || typeof message?.body !== 'string') return;
    ipcRenderer.send('monqey-code:desktop-notification', { title: message.title.slice(0, 100), body: message.body.slice(0, 300), requiresInput: message.requiresInput === true });
  },
  setTaskbarBadge(count) {
    if (!Number.isFinite(count)) return;
    ipcRenderer.send('monqey-code:taskbar-badge', Math.max(0, Math.min(99, Math.trunc(count))));
  },
  setActiveWork(active) {
    if (typeof active !== 'boolean') return;
    ipcRenderer.send('monqey-code:active-work', active);
  }
});

if (process.platform === 'win32') window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    body{padding-top:36px!important;box-sizing:border-box!important}
    #monqey-titlebar{position:fixed;inset:0 0 auto;height:36px;z-index:10000;display:flex;align-items:center;gap:2px;padding:0 150px 0 12px;box-sizing:border-box;background:var(--dsw-alias-bg-base,#111111);color:var(--dsw-alias-label-primary,#ededed);font:12px system-ui;-webkit-app-region:drag;user-select:none}
    #monqey-titlebar button{border:0;border-radius:5px;padding:5px 9px;background:transparent;color:inherit;font:inherit;-webkit-app-region:no-drag;cursor:pointer}
    #monqey-titlebar button:hover,#monqey-titlebar button:focus-visible{background:var(--dsw-alias-bg-layer-2,#333);outline:1px solid var(--dsw-alias-border-l3,#666)}
    #monqey-titlebar .title{margin-left:18px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    @media(display-mode:fullscreen){body{padding-top:0!important}#monqey-titlebar{display:none}}
  `;
  document.head.append(style);
  const bar = document.createElement('nav');
  bar.id = 'monqey-titlebar'; bar.setAttribute('aria-label', 'Application menu'); bar.setAttribute('role', 'menubar');
  for (const name of ['File', 'Edit', 'View', 'Help']) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = name; button.setAttribute('role', 'menuitem'); button.setAttribute('aria-haspopup', 'menu');
    button.addEventListener('click', () => {
      const rect = button.getBoundingClientRect();
      ipcRenderer.invoke('monqey-code:desktop-chrome', 'menu', { name, x: rect.left, y: rect.bottom }).catch(() => {});
    });
    bar.append(button);
  }
  const title = document.createElement('span'); title.className = 'title'; title.textContent = 'Monqey Agent'; bar.append(title);
  document.body.append(bar);
  bar.addEventListener('keydown', event => {
    const buttons = [...bar.querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); buttons[(index + (event.key === 'ArrowRight' ? 1 : 3)) % 4].focus(); }
    if (event.key === 'Escape') document.activeElement.blur();
  });
  document.addEventListener('keydown', event => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const index = ['f', 'e', 'v', 'h'].indexOf(event.key.toLowerCase());
    if (index >= 0) { event.preventDefault(); bar.children[index].focus(); bar.children[index].click(); }
  });
  const theme = () => ipcRenderer.invoke('monqey-code:desktop-chrome', 'theme', document.body.hasAttribute('data-ds-dark-theme')).catch(() => {});
  theme(); new MutationObserver(theme).observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
});
