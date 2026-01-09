// Minimal Electron smoke test to isolate GPU/platform issues (ESM).
// Creates a BrowserWindow and loads about:blank, logs lifecycle events.

import { app, BrowserWindow } from 'electron'

// Common flags similar to index.js
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-webgl')
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-setuid-sandbox')
app.commandLine.appendSwitch('ozone-platform', 'x11')

// Honor environment toggles
if (process.env.ELECTRON_NOGPU === '1') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('in-process-gpu')
  app.commandLine.appendSwitch('use-gl', 'swiftshader')
} else {
  // Under Ozone on Linux, GLX/desktop is not supported; use EGL
  app.commandLine.appendSwitch('use-gl', 'egl')
}

const headless = !process.env.DISPLAY
if (headless) app.disableHardwareAcceleration()

app.on('ready', () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: !headless,
    backgroundColor: '#001601',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webgl: true,
      offscreen: headless
    }
  })
  win.webContents.on('render-process-gone', (_e, d) => console.error('[smoke] render-process-gone', d))
  win.webContents.on('child-process-gone', (_e, d) => console.error('[smoke] child-process-gone', d))
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('[smoke] did-fail-load', { code, desc, url }))
  console.log('[smoke] created window, loading about:blank')
  win.loadURL('about:blank')
})

app.on('window-all-closed', () => app.quit())
