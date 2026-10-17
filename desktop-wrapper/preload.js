const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monqeyDesktop', {
  setTaskbarBadge(count) {
    if (!Number.isFinite(count)) return;
    ipcRenderer.send('monqey-code:taskbar-badge', Math.max(0, Math.min(99, Math.trunc(count))));
  },
  setActiveWork(active) {
    if (typeof active !== 'boolean') return;
    ipcRenderer.send('monqey-code:active-work', active);
  }
});
