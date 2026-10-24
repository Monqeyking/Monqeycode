const extensionSites = [
  'https://chromewebstore.google.com/detail/hhcmgoofomhgciiibhipgmgkgnoenaoi',
  'https://microsoftedge.microsoft.com/addons/detail/browserskill/emacgiaaaiojkkpkddmmdfhmokgmnikg'
];
function installBrowserLinks(win, openExternal, onError) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!extensionSites.includes(url)) return { action: 'allow' };
    Promise.resolve().then(() => openExternal(url)).catch(onError);
    return { action: 'deny' };
  });
}
module.exports = { installBrowserLinks };
