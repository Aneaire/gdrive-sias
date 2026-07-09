const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { existsSync } = require('node:fs')
const osName = require('node:os').hostname

const DEV_WEB_URL = 'http://localhost:3000'
const DESKTOP_ICON_PATH = path.join(
  __dirname,
  '..',
  'assets',
  process.platform === 'win32' ? 'icon.ico' : 'icon.png',
)

const CONFIG_DIR_NAME = 'gcustomize'
const CONFIG_FILE_NAME = 'license-config.json'

let primaryWindow = null

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

async function createWindow() {
  primaryWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Survey File System',
    icon: DESKTOP_ICON_PATH,
    backgroundColor: '#f4f0e6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  primaryWindow.setMenu(null)
  primaryWindow.removeMenu()
  primaryWindow.setMenuBarVisibility(false)

  primaryWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  void loadApplication(primaryWindow)
}

async function loadApplication(window) {
  try {
    const baseUrl = await resolveApplicationUrl()
    const targetUrl = await resolveInitialRoute(baseUrl)

    if (!app.isPackaged && targetUrl.startsWith('http://localhost')) {
      await waitForUrl(targetUrl, 45_000)
    }

    await window.loadURL(targetUrl)
  } catch (error) {
    await window.loadURL(
      `data:text/html;base64,${Buffer.from(
        `<h1>Unable to start desktop app</h1><pre>${escapeHtml(String(error))}</pre>`,
      ).toString('base64')}`,
    )
  }
}

async function resolveApplicationUrl() {
  if (process.env.RIELAN_WEB_URL) return process.env.RIELAN_WEB_URL
  if (!app.isPackaged) return DEV_WEB_URL
  const LocalWebServer = require('./local-web-server.cjs')
  if (!localWebServerStarted) {
    const server = new LocalWebServer({ app })
    await server.start()
    localWebServerStarted = true
  }
  throw new Error('Packaged offline renderer is wired in Phase D.')
}

let localWebServerStarted = false

async function resolveInitialRoute(baseUrl) {
  // The renderer instructs the main process which site URL to POST to; for
  // now derive it from VITE_CONVEX_URL → convex.site rewriting that the
  // renderer already does.
  const config = await readLicenseConfig()
  if (!config) return `${baseUrl}/activate`
  // Existing config: route through the /validate screen, which calls
  // /license/validate through the renderer (it knows the Convex site URL) and
  // then redirects to /files once the license is confirmed active.
  return `${baseUrl}/validate`
}

async function readLicenseConfig() {
  const userData = app.getPath('userData')
  const dir = path.join(userData, CONFIG_DIR_NAME)
  const file = path.join(dir, CONFIG_FILE_NAME)
  if (!existsSync(file)) return null
  try {
    const contents = await fs.readFile(file, 'utf8')
    return JSON.parse(contents)
  } catch {
    return null
  }
}

async function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'HEAD' })
      if (response.ok || response.status === 404) return
    } catch {
      // dev server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

// ────────────────────────────────────────────────────────────────────────
// IPC handlers (Phase B)
// ────────────────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  ipcMain.handle('gcustomize:apply-branding', async (event, branding) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    if (branding?.productName) {
      const suffix = process.env.NODE_ENV === 'production' ? '' : ' (dev)'
      win.setTitle(`${branding.productName}${suffix}`)
    }
    return null
  })

  ipcMain.handle(
    'gcustomize:validate-license',
    async (_event, { endpoint, body }) => {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
        const json = await response.json().catch(() => ({}))
        return json
      } catch (error) {
        return { revoked: true, reason: error?.message || 'Network error.' }
      }
    },
  )
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

void osName // silence unused warning if not touched
void dialog