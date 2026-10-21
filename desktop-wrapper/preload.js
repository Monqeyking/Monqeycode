const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monqeyDesktop', {
  mobileAccess: {
    getStatus: () => ipcRenderer.invoke('monqey-code:mobile-access', 'status'),
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
