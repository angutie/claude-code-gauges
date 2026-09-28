import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FileCredentialReader,
  isDefaultConfigDir,
  isTokenExpired,
  parseCredentials,
  readAccountIdentity,
  readOauthAccount,
  resolveClaudeJsonPath,
  validateConfigDir,
  type CredentialReader
} from '../src/main/sources/account-reader'

const FIXTURES = join(__dirname, 'fixtures', 'accounts')
const HOME = join(FIXTURES, 'home')
const DEFAULT_DIR = join(HOME, '.claude')
const WORK_DIR = join(HOME, '.claude-work')
const MALFORMED_DIR = join(FIXTURES, 'malformed')
const NO_CREDS_DIR = join(FIXTURES, 'no-credentials')
const NOW = Date.UTC(2026, 8, 25)
const opts = { homeDir: HOME, now: NOW }

describe('resolveClaudeJsonPath', () => {
  it('uses the home-level file for the default ~/.claude dir', () => {
    expect(isDefaultConfigDir(DEFAULT_DIR, opts)).toBe(true)
    expect(resolveClaudeJsonPath(DEFAULT_DIR, opts)).toBe(join(HOME, '.claude.json'))
    expect(resolveClaudeJsonPath('~/.claude', opts)).toBe(join(HOME, '.claude.json'))
  })

  it('uses the file inside a custom config dir', () => {
    expect(isDefaultConfigDir(WORK_DIR, opts)).toBe(false)
    expect(resolveClaudeJsonPath(WORK_DIR, opts)).toBe(join(WORK_DIR, '.claude.json'))
  })
})

describe('readOauthAccount', () => {
  it('reads email, org, and display name for the default dir', async () => {
    const result = await readOauthAccount(DEFAULT_DIR, opts)
    expect(result).toEqual({
      status: 'ok',
      value: {
        accountUuid: '00000000-0000-4000-8000-000000000001',
        email: 'dev@example.com',
        displayName: 'Test Developer',
        organizationUuid: '00000000-0000-4000-8000-0000000000aa',
        organizationName: 'Example Org'
      }
    })
  })

  it('reads a custom dir', async () => {
    const result = await readOauthAccount(WORK_DIR, opts)
    expect(result.status === 'ok' && result.value.email).toBe('work@example.com')
  })

  it('returns unavailable for a missing file', async () => {
    const result = await readOauthAccount(join(FIXTURES, 'does-not-exist'), opts)
    expect(result).toMatchObject({ status: 'unavailable', reason: 'missing' })
  })

  it('returns unavailable for malformed JSON', async () => {
    const result = await readOauthAccount(MALFORMED_DIR, opts)
    expect(result).toMatchObject({ status: 'unavailable', reason: 'malformed' })
  })
})

describe('FileCredentialReader', () => {
  const reader = new FileCredentialReader(opts)

  it('reads subscription type and expiry', async () => {
    const result = await reader.read(DEFAULT_DIR)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.value.subscriptionType).toBe('max')
    expect(result.value.expiresAt).toBe(4102444800000)
    expect(result.value.accessToken).toBe('FAKE-access-token-default-0001')
    expect(isTokenExpired(result.value, NOW)).toBe(false)
  })

  it('reports an expired token when expiresAt is in the past', async () => {
    const result = await reader.read(WORK_DIR)
    expect(result.status === 'ok' && isTokenExpired(result.value, NOW)).toBe(true)
  })

  it('returns unavailable for missing and malformed files', async () => {
    expect(await reader.read(NO_CREDS_DIR)).toMatchObject({ status: 'unavailable', reason: 'missing' })
    const malformed = await reader.read(MALFORMED_DIR)
    expect(malformed).toMatchObject({ status: 'unavailable', reason: 'malformed' })
    expect(JSON.stringify(malformed)).not.toContain('FAKE-access-token')
  })

  it('treats a missing access token or unexpected shape as unavailable', () => {
    expect(parseCredentials({ claudeAiOauth: { expiresAt: 1 } })).toMatchObject({ reason: 'missing' })
    expect(parseCredentials({})).toMatchObject({ reason: 'missing' })
    expect(parseCredentials(['nope'])).toMatchObject({ reason: 'malformed' })
  })

  it('never exposes the token through serialization or logging', async () => {
    const result = await reader.read(DEFAULT_DIR)
    expect(result.status).toBe('ok')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    console.log(result)
    const logged = log.mock.calls.flat().map(String).join(' ')
    log.mockRestore()
    expect(JSON.stringify(result)).not.toContain('FAKE-access-token')
    expect(logged).not.toContain('FAKE-access-token')
    expect(Object.keys(result.status === 'ok' ? result.value : {})).not.toContain('accessToken')
  })
})

describe('readAccountIdentity', () => {
  it('combines identity and credentials without secrets', async () => {
    const identity = await readAccountIdentity(DEFAULT_DIR, opts)
    expect(identity).toEqual({
      email: 'dev@example.com',
      displayName: 'Test Developer',
      organizationName: 'Example Org',
      subscriptionType: 'max',
      tokenStatus: 'valid',
      tokenExpiresAt: 4102444800000
    })
    expect(JSON.stringify(identity)).not.toContain('FAKE')
  })

  it('reports an expired token', async () => {
    const identity = await readAccountIdentity(WORK_DIR, opts)
    expect(identity).toMatchObject({ email: 'work@example.com', subscriptionType: 'pro', tokenStatus: 'expired' })
  })

  it('degrades to nulls and a missing token without throwing', async () => {
    const identity = await readAccountIdentity(MALFORMED_DIR, opts)
    expect(identity).toEqual({
      email: null,
      displayName: null,
      organizationName: null,
      subscriptionType: null,
      tokenStatus: 'missing',
      tokenExpiresAt: null
    })
  })

  it('tolerates a credential reader that throws', async () => {
    const failing: CredentialReader = { read: () => Promise.reject(new Error('keychain locked')) }
    const identity = await readAccountIdentity(DEFAULT_DIR, { ...opts, credentialReader: failing })
    expect(identity).toMatchObject({ email: 'dev@example.com', tokenStatus: 'missing' })
  })
})

describe('validateConfigDir', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gauges-account-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('accepts a dir with credentials and returns its identity', async () => {
    const result = await validateConfigDir(WORK_DIR, opts)
    expect(result).toMatchObject({ ok: true, configDir: WORK_DIR, identity: { email: 'work@example.com' } })
  })

  it('rejects a dir without .credentials.json', async () => {
    const result = await validateConfigDir(NO_CREDS_DIR, opts)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('.credentials.json')
  })

  it('rejects an empty temp dir, a missing dir, a file, and a blank path', async () => {
    expect((await validateConfigDir(tempDir, opts)).ok).toBe(false)
    expect(await validateConfigDir(join(tempDir, 'missing'), opts)).toMatchObject({ ok: false })
    const file = join(tempDir, 'file.txt')
    await writeFile(file, 'x')
    expect(await validateConfigDir(file, opts)).toMatchObject({ ok: false })
    expect(await validateConfigDir('  ', opts)).toMatchObject({ ok: false })
  })

  it('rejects malformed credentials without leaking contents', async () => {
    const result = await validateConfigDir(MALFORMED_DIR, opts)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).not.toContain('FAKE')
  })
})
