const { contextBridge, ipcRenderer } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { existsSync } = require('node:fs')
const os = require('node:os')

/**
 * Phase B preload. Exposes a small, safe surface to the bundled renderer.
 *
 * The renderer (apps/web) uses `window.gcustomizeDesktop` to:
 *   - read the stable per-install deviceId (created/loaded on first call)
 *   - persist {licenseKey, deviceId, tenantId, branding} to userData
 *   - apply branding (window title + accent theme)
 *   - ask the main process to validate the license via /license/validate
 *
 * Everything stays contextIsolation:true and nodeIntegration:false; the
 * renderer has no direct access to fs / Electron APIs.
 */

const CONFIG_DIR_NAME = 'gcustomize'
const CONFIG_FILE_NAME = 'license-config.json'
const DEVICE_ID_FILE_NAME = 'device-id'

/**
 * @typedef {Object} LicenseConfig
 * @property {string} licenseKey
 * @property {string} deviceId
 * @property {string} tenantId
 * @property {string} tenantSubdomain
 * @property {Brand} branding
 *
 * @typedef {Object} Brand
 * @property {string} productName
 * @property {(string|null)} logoStorageKey
 * @property {string} accentColor
 * @property {(string|null)} faviconStorageKey
 */

let cachedConfigPath = null
let cachedDeviceId = null
let cachedConvexEndpoint = null

async function ensureConfigPath() {
  if (cachedConfigPath) return cachedConfigPath
  const electron = require('electron')
  const userData = (electron.app || electron.remote.app).getPath('userData')
  const dir = path.join(userData, CONFIG_DIR_NAME)
  await fs.mkdir(dir, { recursive: true })
  cachedConfigPath = path.join(dir, CONFIG_FILE_NAME)
  return cachedConfigPath
}

async function ensureDeviceIdPath() {
  const electron = require('electron')
  const userData = (electron.app || electron.remote.app).getPath('userData')
  const dir = path.join(userData, CONFIG_DIR_NAME)
  await fs.mkdir(dir, { recursive: true })
  return path.join(dir, DEVICE_ID_FILE_NAME)
}

async function readDeviceId() {
  if (cachedDeviceId) return cachedDeviceId
  const filePath = await ensureDeviceIdPath()
  if (existsSync(filePath)) {
    cachedDeviceId = (await fs.readFile(filePath, 'utf8')).trim()
    return cachedDeviceId
  }
  const generated = generateDeviceId()
  await fs.writeFile(filePath, generated, 'utf8')
  cachedDeviceId = generated
  return cachedDeviceId
}

function generateDeviceId() {
  // 22 URL-safe chars._crypto.randomUUID is available in Electron's renderer
  // too but we want a stable id even before the renderer loads.
  const crypto = require('node:crypto')
  return crypto.randomUUID().replace(/-/g, '')
}

async function readConfig() {
  const filePath = await ensureConfigPath()
  if (!existsSync(filePath)) return null
  try {
    const contents = await fs.readFile(filePath, 'utf8')
    return JSON.parse(contents)
  } catch {
    return null
  }
}

async function writeConfig(config) {
  const filePath = await ensureConfigPath()
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8')
}

async function getDeviceLabel() {
  try {
    const hostname = os.hostname()
    const platform = process.platform
    return `${hostname}-${platform}`
  } catch {
    return process.platform
  }
}

async function setConvexEndpoint(url) {
  cachedConvexEndpoint = url
}

async function getConvexEndpoint() {
  if (cachedConvexEndpoint) return cachedConvexEndpoint
  // The renderer's getConvexHttpUrl already derives from VITE_CONVEX_URL.
  // We don't duplicate the URL on the main side; the renderer passes the
  // fully-formed endpoint when it wants us to validate.
  return null
}

async function applyBranding(_branding) {
  // Window title is updated by the main process via ipcRenderer; accent is
  // applied inside the renderer via CSS. The renderer invokes its own apply
  // CSS injection after this returns.
  await ipcRenderer.invoke('gcustomize:apply-branding', _branding)
}

contextBridge.exposeInMainWorld('gcustomizeDesktop', {
  platform: process.platform,

  async getDeviceId() {
    return await readDeviceId()
  },

  async getDeviceLabel() {
    return await getDeviceLabel()
  },

  async getLicenseConfig() {
    return await readConfig()
  },

  async setLicenseConfig(config) {
    await writeConfig(config)
  },

  async clearLicenseConfig() {
    const filePath = await ensureConfigPath()
    if (existsSync(filePath)) await fs.unlink(filePath)
  },

  async applyBranding(branding) {
    await applyBranding(branding)
  },

  async validateLicense(licenseKey, deviceId) {
    const endpoint = cachedConvexEndpoint
    if (!endpoint) throw new Error('Convex site URL not configured on this device.')
    const body = JSON.stringify({ licenseKey, deviceId })
    const result = await ipcRenderer.invoke('gcustomize:validate-license', {
      endpoint,
      body,
    })
    return result
  },

  async setConvexSiteUrl(url) {
    await setConvexEndpoint(url)
  },
})