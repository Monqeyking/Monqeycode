# MonqeyCode desktop wrapper

This wrapper starts the existing DSH web profile and displays its local URL in an Electron window.

On Windows, closing the window hides Monqey Code in the system tray after a one-time notice. DSH tasks keep running until you choose **Quit Monqey Code** from the tray menu. If Monqey reports active work or cannot confirm task status, quitting asks before stopping DSH. Click the tray icon or choose **Open Monqey Code** to return to the session.

## Build

```powershell
npm install
npm run build
```

The portable executable is written to `dist`.
