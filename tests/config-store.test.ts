import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONFIG_FILE_NAME,
  ConfigStore,
  DEFAULT_ACCOUNT_ID,
  createDefaultConfig,
  loadConfig,
  mergeWithDefaults,
  resolveDefaultConfigDir,
  saveConfig
} from '../src/main/config-store'

const HOME = join('/home', 'tester')
const noEnv = { env: {}, homeDir: HOME }

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gauges-config-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('defaults', () => {
  it('uses ~/.claude when CLAUDE_CONFIG_DIR is not set', () => {
    expect(resolveDefaultConfigDir(noEnv)).toBe(join(HOME, '.claude'))
  })

  it('honors CLAUDE_CONFIG_DIR for the default account', () => {
    const custom = join(HOME, '.claude-work')
    const config = createDefaultConfig({ env: { CLAUDE_CONFIG_DIR: custom }, homeDir: HOME })
    expect(config.accounts).toEqual([{ id: DEFAULT_ACCOUNT_ID, label: '', configDir: custom }])
  })

  it('ignores a blank CLAUDE_CONFIG_DIR', () => {
    expect(resolveDefaultConfigDir({ env: { CLAUDE_CONFIG_DIR: '  ' }, homeDir: HOME })).toBe(
      join(HOME, '.claude')
    )
  })

  it('has one active default account and all widgets on', () => {
    const config = createDefaultConfig(noEnv)
    expect(config.accounts).toHaveLength(1)
    expect(config.activeAccountId).toBe(DEFAULT_ACCOUNT_ID)
    expect(Object.values(config.widgets).every(Boolean)).toBe(true)
    expect(config.usagePollSeconds).toBe(90)
    expect(config.alwaysOnTop).toBe(false)
    expect(config.windowBounds).toBeNull()
    expect(config.windowMode).toBe('max')
    expect(config.miniWindowBounds).toBeNull()
  })
})

describe('loadConfig', () => {
  it('returns defaults when the file is missing', async () => {
    expect(await loadConfig(dir, noEnv)).toEqual(createDefaultConfig(noEnv))
  })

  it('returns defaults when the file is corrupt', async () => {
    await writeFile(join(dir, CONFIG_FILE_NAME), '{"accounts": [', 'utf8')
    const config = await loadConfig(dir, noEnv)
    expect(config).toEqual(createDefaultConfig(noEnv))
    expect(config.accounts).toHaveLength(1)
  })

  it('returns defaults when the JSON is not an object', async () => {
    await writeFile(join(dir, CONFIG_FILE_NAME), '[1,2,3]', 'utf8')
    expect(await loadConfig(dir, noEnv)).toEqual(createDefaultConfig(noEnv))
  })

  it('merges a partial config with the defaults', async () => {
    await writeFile(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ alwaysOnTop: true, widgets: { branch: false } }),
      'utf8'
    )
    const config = await loadConfig(dir, noEnv)
    const defaults = createDefaultConfig(noEnv)
    expect(config.alwaysOnTop).toBe(true)
    expect(config.widgets).toEqual({ ...defaults.widgets, branch: false })
    expect(config.accounts).toEqual(defaults.accounts)
    expect(config.usagePollSeconds).toBe(defaults.usagePollSeconds)
  })
})

describe('mergeWithDefaults', () => {
  const defaults = createDefaultConfig(noEnv)

  it('drops invalid accounts and falls back to the first account when active id is unknown', () => {
    const config = mergeWithDefaults(
      {
        accounts: [
          { id: 'a', label: 'Work', configDir: '/x/.claude-work' },
          { id: 'a', label: 'dup', configDir: '/y' },
          { id: 'b' },
          'junk'
        ],
        activeAccountId: 'missing'
      },
      defaults
    )
    expect(config.accounts).toEqual([{ id: 'a', label: 'Work', configDir: '/x/.claude-work' }])
    expect(config.activeAccountId).toBe('a')
  })

  it('restores the default account when no valid accounts remain', () => {
    const config = mergeWithDefaults({ accounts: [] }, defaults)
    expect(config.accounts).toEqual(defaults.accounts)
    expect(config.activeAccountId).toBe(DEFAULT_ACCOUNT_ID)
  })

  it('clamps usagePollSeconds and ignores wrong types', () => {
    expect(mergeWithDefaults({ usagePollSeconds: 5 }, defaults).usagePollSeconds).toBe(60)
    expect(mergeWithDefaults({ usagePollSeconds: 9999 }, defaults).usagePollSeconds).toBe(600)
    expect(mergeWithDefaults({ usagePollSeconds: '120' }, defaults).usagePollSeconds).toBe(90)
  })

  it('keeps watched sessions only for known accounts', () => {
    const config = mergeWithDefaults(
      {
        watchedSessionIds: { [DEFAULT_ACCOUNT_ID]: ['s1', 's1', 2, 's2'], ghost: 'all' }
      },
      defaults
    )
    expect(config.watchedSessionIds).toEqual({ [DEFAULT_ACCOUNT_ID]: ['s1', 's2'] })
  })

  it('validates window bounds', () => {
    expect(mergeWithDefaults({ windowBounds: { width: 400, height: 600, x: 10 } }, defaults).windowBounds).toEqual({
      width: 400,
      height: 600,
      x: 10
    })
    expect(mergeWithDefaults({ windowBounds: { width: -1, height: 600 } }, defaults).windowBounds).toBeNull()
  })

  it('accepts known window modes and falls back to max otherwise', () => {
    expect(mergeWithDefaults({ windowMode: 'mini' }, defaults).windowMode).toBe('mini')
    expect(mergeWithDefaults({ windowMode: 'max' }, defaults).windowMode).toBe('max')
    for (const windowMode of ['tiny', 'MINI', '', 1, null, true, { mode: 'mini' }]) {
      expect(mergeWithDefaults({ windowMode }, defaults).windowMode).toBe('max')
    }
    expect(mergeWithDefaults({}, defaults).windowMode).toBe('max')
  })

  it('validates mini window bounds independently of max bounds', () => {
    const merged = mergeWithDefaults(
      {
        windowBounds: { width: 420, height: 640 },
        miniWindowBounds: { x: 5, y: 6, width: 400, height: 400 }
      },
      defaults
    )
    expect(merged.windowBounds).toEqual({ width: 420, height: 640 })
    expect(merged.miniWindowBounds).toEqual({ x: 5, y: 6, width: 400, height: 400 })
    expect(
      mergeWithDefaults({ miniWindowBounds: { width: 400, height: 400, x: 'a' } }, defaults)
        .miniWindowBounds
    ).toEqual({ width: 400, height: 400 })
    for (const miniWindowBounds of [
      { width: 0, height: 400 },
      { width: 400 },
      { width: Number.NaN, height: 400 },
      { width: '400', height: '400' },
      [400, 400],
      'big',
      null
    ]) {
      expect(mergeWithDefaults({ miniWindowBounds }, defaults).miniWindowBounds).toBeNull()
    }
    expect(mergeWithDefaults({}, defaults).miniWindowBounds).toBeNull()
  })
})

describe('saveConfig', () => {
  it('round-trips through disk and leaves no temp files', async () => {
    const config = { ...createDefaultConfig(noEnv), alwaysOnTop: true, usagePollSeconds: 120 }
    await saveConfig(dir, config)
    await saveConfig(dir, { ...config, usagePollSeconds: 180 })
    expect(await readdir(dir)).toEqual([CONFIG_FILE_NAME])
    expect(await loadConfig(dir, noEnv)).toEqual({ ...config, usagePollSeconds: 180 })
  })

  it('creates the directory if needed', async () => {
    const nested = join(dir, 'nested', 'userData')
    await saveConfig(nested, createDefaultConfig(noEnv))
    const text = await readFile(join(nested, CONFIG_FILE_NAME), 'utf8')
    expect(JSON.parse(text)).toEqual(createDefaultConfig(noEnv))
  })
})

describe('ConfigStore', () => {
  it('persists updates that survive reopening', async () => {
    const store = await ConfigStore.open(dir, noEnv)
    await store.update({
      accounts: [
        ...store.get().accounts,
        { id: 'work', label: 'Work', configDir: join(HOME, '.claude-work') }
      ],
      activeAccountId: 'work'
    })
    const reopened = await ConfigStore.open(dir, noEnv)
    expect(reopened.get().accounts.map((a) => a.id)).toEqual([DEFAULT_ACCOUNT_ID, 'work'])
    expect(reopened.get().activeAccountId).toBe('work')
  })

  it('serializes concurrent writes so the last update wins', async () => {
    const store = await ConfigStore.open(dir, noEnv)
    await Promise.all([60, 90, 120, 150, 180].map((s) => store.update({ usagePollSeconds: s })))
    expect((await loadConfig(dir, noEnv)).usagePollSeconds).toBe(180)
    expect(await readdir(dir)).toEqual([CONFIG_FILE_NAME])
  })

  it('persists windowMode and miniWindowBounds across reopening', async () => {
    const store = await ConfigStore.open(dir, noEnv)
    await store.update({
      windowMode: 'mini',
      miniWindowBounds: { x: 30, y: 40, width: 360, height: 360 }
    })
    const reopened = await ConfigStore.open(dir, noEnv)
    expect(reopened.get().windowMode).toBe('mini')
    expect(reopened.get().miniWindowBounds).toEqual({ x: 30, y: 40, width: 360, height: 360 })
    expect(reopened.get().windowBounds).toBeNull()
  })

  it('rejects an invalid windowMode and malformed miniWindowBounds on set', async () => {
    const store = await ConfigStore.open(dir, noEnv)
    await store.update({ windowMode: 'mini', miniWindowBounds: { width: 300, height: 300 } })
    const next = await store.set({
      ...store.get(),
      windowMode: 'huge',
      miniWindowBounds: { width: -5, height: 300 }
    })
    expect(next.windowMode).toBe('max')
    expect(next.miniWindowBounds).toBeNull()
    expect((await loadConfig(dir, noEnv)).windowMode).toBe('max')
  })

  it('returns copies so callers cannot mutate internal state', async () => {
    const store = await ConfigStore.open(dir, noEnv)
    store.get().widgets.model = false
    expect(store.get().widgets.model).toBe(true)
  })
})
