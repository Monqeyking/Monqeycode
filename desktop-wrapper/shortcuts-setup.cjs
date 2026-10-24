// Run after packaging so Windows never retains a shortcut to an extracted portable app.
const { app, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { resolvePaths } = require('./paths.cjs');
const { repairShortcuts } = require('./shortcuts.cjs');
const paths = resolvePaths({ wrapperDir: __dirname, packaged: false });
fs.mkdirSync(path.join(paths.electronData, 'shortcut-setup'), { recursive:true });
app.setPath('userData', path.join(paths.electronData, 'shortcut-setup'));
app.whenReady().then(() => {
  try {
    const executable = path.join(__dirname, 'dist-cowork', `Monqey Agent ${require('./package.json').version}.exe`);
    const result = repairShortcuts({ shell, home:paths.home, executable, appData:app.getPath('appData'), desktop:app.getPath('desktop') });
    console.log(JSON.stringify(result));
    app.exit(result.errors.length ? 1 : 0);
  } catch (error) { console.error(error.message); app.exit(1); }
});
