import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, screen, type Rectangle } from 'electron'
import type { AppConfig, WindowBounds } from '../shared/types'
import { ConfigStore } from './config-store'
import { GaugesController, registerIpcHandlers } from './ipc'

const DEFAULT_WIDTH = 420
const DEFAULT_HEIGHT = 640
const MIN_WIDTH = 320
const MIN_HEIGHT = 400
const BOUNDS_SAVE_DEBOUNCE_MS = 500

let mainWindow: BrowserWindow | null = null
let controller: GaugesController | null = null
let unregisterIpc: (() => void) | null = null
let quitting = false
/** Latest in-flight bounds write, awaited before quitting. */
let pendingBoundsSave: Promise<void> = Promise.resolve()
/** Saves the current window bounds immediately (set while a window exists). */
let flushWindowBounds: () => void = () => undefined

function logError(error: unknown): void {
  // Messages only: errors from the sources never carry tokens, but avoid dumping whole objects.
  console.error('[gauges]', error instanceof Error ? error.message : String(error))
}

/** Keeps saved bounds only if they still overlap a connected display (monitors can be unplugged). */
function restorableBounds(saved: WindowBounds | null): Partial<Rectangle> {
  if (!saved) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  const width = Math.max(MIN_WIDTH, Math.round(saved.width))
  const height = Math.max(MIN_HEIGHT, Math.round(saved.height))
  if (saved.x === undefined || saved.y === undefined) return { width, height }

  const rect = { x: Math.round(saved.x), y: Math.round(saved.y), width, height }
  const visible = screen.getAllDisplays().some(({ workArea: area }) => {
    const overlapX = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x)
    const overlapY = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y)
    return overlapX >= 50 && overlapY >= 50
  })
  return visible ? rect : { width, height }
}

function applyWindowConfig(config: AppConfig): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isAlwaysOnTop() !== config.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(config.alwaysOnTop)
  }
}

function sendToRenderer(channel: string, payload: unknown): void {
  const contents = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null
  if (contents && !contents.isDestroyed()) contents.send(channel, payload)
}

async function pickConfigDirectory(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Select a Claude Code config directory',
    buttonLabel: 'Link account',
    defaultPath: app.getPath('home'),
    properties: ['openDirectory', 'showHiddenFiles', 'dontAddToRecent']
  }
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

function createWindow(config: AppConfig): BrowserWindow {
  const window = new BrowserWindow({
    ...restorableBounds(config.windowBounds),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'Claude Code Gauges',
    backgroundColor: '#15171c',
    show: false,
    autoHideMenuBar: true,
    alwaysOnTop: config.alwaysOnTop,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const saveBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return
    const { x, y, width, height } = window.getNormalBounds()
    const current = controller
    if (!current) return
    pendingBoundsSave = current.saveWindowState({ windowBounds: { x, y, width, height } }).catch(logError)
  }
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveBounds, BOUNDS_SAVE_DEBOUNCE_MS)
  }
  flushWindowBounds = saveBounds
  window.on('moved', scheduleSave)
  window.on('resized', scheduleSave)
  window.on('close', saveBounds)
  window.on('focus', () => controller?.handleFocus())
  window.on('closed', () => {
    if (saveTimer) clearTimeout(saveTimer)
    if (mainWindow === window) {
      mainWindow = null
      flushWindowBounds = () => undefined
    }
  })

  // Keep navigation inside the app; external links never open in-process.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

async function bootstrap(): Promise<void> {
  const store = await ConfigStore.open(app.getPath('userData'))
  controller = new GaugesController({
    store,
    send: sendToRenderer,
    pickDirectory: pickConfigDirectory,
    onConfigApplied: applyWindowConfig,
    onError: logError
  })
  unregisterIpc = registerIpcHandlers(ipcMain, controller)

  mainWindow = createWindow(controller.getConfig())
  await controller.start()

  app.on('activate', () => {
    if (!mainWindow && controller) mainWindow = createWindow(controller.getConfig())
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(bootstrap).catch((error) => {
    logError(error)
    app.quit()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitting || !controller) return
  // Dispose watchers/timers (and flush pending config writes) before exiting.
  event.preventDefault()
  quitting = true
  flushWindowBounds()
  const current = controller
  controller = null
  unregisterIpc?.()
  unregisterIpc = null
  void pendingBoundsSave
    .then(() => current.dispose())
    .catch(logError)
    .finally(() => app.quit())
})
