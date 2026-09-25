import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultIsAlive,
  isSessionFileName,
  parseSessionFile,
  parseSessionRecord,
  repoNameFromCwd,
  scanSessions
} from '../src/main/sources/sessions-registry'

const CONFIG_DIR = join(__dirname, 'fixtures', 'sessions', 'config')
const DEAD_PID = 30003
const allAlive = (): boolean => true
const aliveExceptDead = (pid: number): boolean => pid !== DEAD_PID

describe('repoNameFromCwd', () => {
  it('handles Windows, POSIX, and trailing separators', () => {
    expect(repoNameFromCwd('C:\\Users\\dev\\Repos\\phoenix-core')).toBe('phoenix-core')
    expect(repoNameFromCwd('/home/dev/repos/app/')).toBe('app')
    expect(repoNameFromCwd('C:\\Repos\\gauges\\')).toBe('gauges')
  })
})

describe('isSessionFileName', () => {
  it('accepts .json and rejects .key files', () => {
    expect(isSessionFileName('12440.json')).toBe(true)
    expect(isSessionFileName('12440.abc123.key')).toBe(false)
  })
})

describe('parseSessionFile', () => {
  it('returns null for malformed JSON', () => {
    expect(parseSessionFile('{"pid":1,')).toBeNull()
  })

  it('returns null when required fields are missing or invalid', () => {
    expect(parseSessionRecord({ sessionId: 's', cwd: 'c' })).toBeNull()
    expect(parseSessionRecord({ pid: -1, sessionId: 's', cwd: 'c' })).toBeNull()
    expect(parseSessionRecord({ pid: 1, cwd: 'c' })).toBeNull()
    expect(parseSessionRecord([1, 2])).toBeNull()
  })

  it('maps unknown statuses to "unknown" and drops waitingFor unless waiting', () => {
    const s = parseSessionRecord({
      pid: 1,
      sessionId: 's',
      cwd: '/r/x',
      status: 'thinking',
      waitingFor: 'permission prompt'
    })
    expect(s?.status).toBe('unknown')
    expect(s?.waitingFor).toBeNull()
  })

  it('falls back to statusUpdatedAt for updatedAt', () => {
    const s = parseSessionRecord({ pid: 1, sessionId: 's', cwd: '/r/x', statusUpdatedAt: 42 })
    expect(s?.updatedAt).toBe(42)
  })
})

describe('scanSessions', () => {
  it('parses fixture files into SessionInfo records with repo names', async () => {
    const sessions = await scanSessions(CONFIG_DIR, { isAlive: allAlive })
    expect(sessions.map((s) => s.pid)).toEqual([20001, 12440, 30003])

    const phoenix = sessions.find((s) => s.pid === 12440)
    expect(phoenix).toEqual({
      pid: 12440,
      sessionId: '8372c9df-0000-4000-8000-000000000001',
      cwd: 'C:\\Users\\dev\\Repos\\phoenix-core',
      repoName: 'phoenix-core',
      title: 'Entity Tags backend state',
      status: 'waiting',
      waitingFor: 'permission prompt',
      entrypoint: 'claude-desktop',
      version: '2.1.281',
      startedAt: 1790343585960,
      updatedAt: 1790343600000,
      model: null,
      effort: null,
      effortIsDefault: false,
      gitBranch: null,
      lastActivityAt: null
    })

    const gauges = sessions.find((s) => s.pid === 20001)
    expect(gauges?.repoName).toBe('claude-code-gauges')
    expect(gauges?.title).toBeNull()
    expect(gauges?.status).toBe('busy')
    expect(gauges?.entrypoint).toBe('cli')
  })

  it('skips .key files, malformed JSON, and records missing required fields', async () => {
    const isAlive = vi.fn((_pid: number) => true)
    const sessions = await scanSessions(CONFIG_DIR, { isAlive })
    const pids = sessions.map((s) => s.pid)
    expect(pids).not.toContain(40004)
    expect(pids).not.toContain(50005)
    // isAlive is only consulted for successfully parsed records.
    expect(isAlive.mock.calls.map(([pid]) => pid).sort()).toEqual([12440, 20001, 30003])
  })

  it('excludes sessions whose PID is not alive', async () => {
    const sessions = await scanSessions(CONFIG_DIR, { isAlive: aliveExceptDead })
    expect(sessions.map((s) => s.pid)).toEqual([20001, 12440])
  })

  it('treats a throwing isAlive as dead', async () => {
    const sessions = await scanSessions(CONFIG_DIR, {
      isAlive: () => {
        throw new Error('boom')
      }
    })
    expect(sessions).toEqual([])
  })

  it('returns an empty list when the sessions folder is missing', async () => {
    expect(await scanSessions(join(CONFIG_DIR, 'does-not-exist'), { isAlive: allAlive })).toEqual(
      []
    )
  })

  describe('with a temp dir', () => {
    let dir: string | null = null

    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true })
      dir = null
    })

    it('keeps the most recently updated record for duplicate session ids', async () => {
      dir = await mkdtemp(join(tmpdir(), 'ccg-sessions-'))
      await mkdir(join(dir, 'sessions'))
      const base = { sessionId: 'dup', cwd: '/r/app', status: 'idle' }
      await writeFile(join(dir, 'sessions', '1.json'), JSON.stringify({ ...base, pid: 1, updatedAt: 10 }))
      await writeFile(join(dir, 'sessions', '2.json'), JSON.stringify({ ...base, pid: 2, updatedAt: 20 }))

      const sessions = await scanSessions(dir, { isAlive: allAlive })
      expect(sessions).toHaveLength(1)
      expect(sessions[0]?.pid).toBe(2)
    })
  })
})

describe('defaultIsAlive', () => {
  it('reports the current process as alive', () => {
    expect(defaultIsAlive(process.pid)).toBe(true)
  })

  it('reports a non-existent PID as dead', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    try {
      expect(defaultIsAlive(999999)).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('treats EPERM as alive', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' })
    })
    try {
      expect(defaultIsAlive(4)).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})
