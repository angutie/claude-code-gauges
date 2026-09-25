import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AccountIdentity, EpochMs, TokenStatus } from '../../shared/types'

/**
 * Reads account identity (.claude.json → oauthAccount) and credentials
 * (.credentials.json → claudeAiOauth) for a Claude Code config directory.
 *
 * SECURITY: access tokens never leave the main process. They are exposed only
 * through a non-enumerable property so they cannot leak via JSON.stringify or
 * console.log, and error messages never include file contents.
 */

export const CLAUDE_JSON_FILE_NAME = '.claude.json'
export const CREDENTIALS_FILE_NAME = '.credentials.json'

export type UnavailableReason = 'missing' | 'malformed' | 'unreadable'

/** Typed failure returned instead of throwing when a file can't be used. */
export interface Unavailable {
  status: 'unavailable'
  reason: UnavailableReason
  /** Secret-free, human-readable explanation. */
  message: string
}

export type ReadResult<T> = { status: 'ok'; value: T } | Unavailable

/** Non-secret identity from `oauthAccount` in .claude.json. */
export interface OauthAccountInfo {
  accountUuid: string | null
  email: string | null
  displayName: string | null
  organizationUuid: string | null
  organizationName: string | null
}

/** Main-process-only credential data. `accessToken` is non-enumerable. */
export interface Credentials {
  readonly accessToken: string
  expiresAt: EpochMs | null
  subscriptionType: string | null
  rateLimitTier: string | null
}

/** Abstraction so non-file stores (e.g. the macOS Keychain) can be plugged in later. */
export interface CredentialReader {
  read(configDir: string): Promise<ReadResult<Credentials>>
}

export interface PathOptions {
  homeDir?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function unavailable(reason: UnavailableReason, message: string): Unavailable {
  return { status: 'unavailable', reason, message }
}

function normalizeForCompare(path: string): string {
  const resolved = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Expands a leading `~` to the home directory. */
export function expandHome(path: string, options: PathOptions = {}): string {
  const home = options.homeDir ?? homedir()
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2))
  return path
}

/**
 * Reads and parses a JSON file. The parse error text is discarded on purpose:
 * V8 includes a snippet of the input, which could contain a token.
 */
async function readJsonFile(path: string, label: string): Promise<ReadResult<unknown>> {
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return unavailable('missing', `${label} not found`)
    return unavailable('unreadable', `${label} could not be read${code ? ` (${code})` : ''}`)
  }
  try {
    return { status: 'ok', value: JSON.parse(text.replace(/^﻿/, '')) as unknown }
  } catch {
    return unavailable('malformed', `${label} is not valid JSON`)
  }
}

// ---------------------------------------------------------------------------
// .claude.json / oauthAccount
// ---------------------------------------------------------------------------

export function isDefaultConfigDir(configDir: string, options: PathOptions = {}): boolean {
  const home = options.homeDir ?? homedir()
  return normalizeForCompare(expandHome(configDir, options)) === normalizeForCompare(join(home, '.claude'))
}

/**
 * The default ~/.claude dir keeps its global config at ~/.claude.json;
 * a custom CLAUDE_CONFIG_DIR keeps it inside the dir.
 */
export function resolveClaudeJsonPath(configDir: string, options: PathOptions = {}): string {
  if (isDefaultConfigDir(configDir, options)) {
    return join(options.homeDir ?? homedir(), CLAUDE_JSON_FILE_NAME)
  }
  return join(expandHome(configDir, options), CLAUDE_JSON_FILE_NAME)
}

export function parseOauthAccount(raw: unknown): ReadResult<OauthAccountInfo> {
  if (!isRecord(raw)) return unavailable('malformed', `${CLAUDE_JSON_FILE_NAME} has an unexpected shape`)
  const account = raw['oauthAccount']
  if (!isRecord(account)) return unavailable('missing', `${CLAUDE_JSON_FILE_NAME} has no oauthAccount`)
  return {
    status: 'ok',
    value: {
      accountUuid: optionalString(account['accountUuid']),
      email: optionalString(account['emailAddress']),
      displayName: optionalString(account['displayName']),
      organizationUuid: optionalString(account['organizationUuid']),
      organizationName: optionalString(account['organizationName'])
    }
  }
}

export async function readOauthAccount(
  configDir: string,
  options: PathOptions = {}
): Promise<ReadResult<OauthAccountInfo>> {
  const result = await readJsonFile(resolveClaudeJsonPath(configDir, options), CLAUDE_JSON_FILE_NAME)
  if (result.status !== 'ok') return result
  return parseOauthAccount(result.value)
}

// ---------------------------------------------------------------------------
// .credentials.json
// ---------------------------------------------------------------------------

export function credentialsPath(configDir: string, options: PathOptions = {}): string {
  return join(expandHome(configDir, options), CREDENTIALS_FILE_NAME)
}

export function parseCredentials(raw: unknown): ReadResult<Credentials> {
  if (!isRecord(raw)) return unavailable('malformed', `${CREDENTIALS_FILE_NAME} has an unexpected shape`)
  const oauth = raw['claudeAiOauth']
  if (!isRecord(oauth)) return unavailable('missing', `${CREDENTIALS_FILE_NAME} has no claudeAiOauth entry`)
  const accessToken = optionalString(oauth['accessToken'])
  if (!accessToken) return unavailable('missing', `${CREDENTIALS_FILE_NAME} has no access token`)

  const credentials = {
    expiresAt: optionalFiniteNumber(oauth['expiresAt']),
    subscriptionType: optionalString(oauth['subscriptionType']),
    rateLimitTier: optionalString(oauth['rateLimitTier'])
  } as Credentials
  Object.defineProperty(credentials, 'accessToken', {
    value: accessToken,
    enumerable: false,
    writable: false,
    configurable: false
  })
  return { status: 'ok', value: credentials }
}

/** Reads `<configDir>/.credentials.json` (Windows/Linux storage). */
export class FileCredentialReader implements CredentialReader {
  constructor(private readonly options: PathOptions = {}) {}

  async read(configDir: string): Promise<ReadResult<Credentials>> {
    const result = await readJsonFile(credentialsPath(configDir, this.options), CREDENTIALS_FILE_NAME)
    if (result.status !== 'ok') return result
    return parseCredentials(result.value)
  }
}

export function isTokenExpired(credentials: Pick<Credentials, 'expiresAt'>, now: EpochMs = Date.now()): boolean {
  return credentials.expiresAt !== null && credentials.expiresAt <= now
}

export function tokenStatus(result: ReadResult<Credentials>, now: EpochMs = Date.now()): TokenStatus {
  if (result.status !== 'ok') return 'missing'
  return isTokenExpired(result.value, now) ? 'expired' : 'valid'
}

// ---------------------------------------------------------------------------
// Combined identity (safe to send to the renderer)
// ---------------------------------------------------------------------------

export interface ReadIdentityOptions extends PathOptions {
  credentialReader?: CredentialReader
  now?: EpochMs
}

/** Builds a secret-free AccountIdentity; missing pieces become null rather than throwing. */
export async function readAccountIdentity(
  configDir: string,
  options: ReadIdentityOptions = {}
): Promise<AccountIdentity> {
  const reader = options.credentialReader ?? new FileCredentialReader(options)
  const [account, credentials] = await Promise.all([
    readOauthAccount(configDir, options),
    reader.read(configDir).catch(
      (): ReadResult<Credentials> => unavailable('unreadable', 'Credentials could not be read')
    )
  ])
  const info = account.status === 'ok' ? account.value : null
  const creds = credentials.status === 'ok' ? credentials.value : null
  return {
    email: info?.email ?? null,
    displayName: info?.displayName ?? null,
    organizationName: info?.organizationName ?? null,
    subscriptionType: creds?.subscriptionType ?? null,
    tokenStatus: tokenStatus(credentials, options.now ?? Date.now()),
    tokenExpiresAt: creds?.expiresAt ?? null
  }
}

// ---------------------------------------------------------------------------
// Add-account validation
// ---------------------------------------------------------------------------

export type ValidateConfigDirResult =
  | { ok: true; configDir: string; identity: AccountIdentity }
  | { ok: false; error: string }

/** Confirms a directory looks like a signed-in Claude Code config dir. */
export async function validateConfigDir(
  configDir: string,
  options: ReadIdentityOptions = {}
): Promise<ValidateConfigDirResult> {
  if (typeof configDir !== 'string' || configDir.trim() === '') {
    return { ok: false, error: 'No directory was provided.' }
  }
  const dir = resolve(expandHome(configDir.trim(), options))

  try {
    const stat = await fs.stat(dir)
    if (!stat.isDirectory()) return { ok: false, error: `${dir} is not a directory.` }
  } catch {
    return { ok: false, error: `${dir} does not exist.` }
  }

  const reader = options.credentialReader ?? new FileCredentialReader(options)
  const credentials = await reader
    .read(dir)
    .catch((): ReadResult<Credentials> => unavailable('unreadable', 'Credentials could not be read'))
  if (credentials.status !== 'ok') {
    const hint =
      credentials.reason === 'missing'
        ? `No usable ${CREDENTIALS_FILE_NAME} found in ${dir}. Run \`claude\` with CLAUDE_CONFIG_DIR set to this folder and log in first.`
        : `${credentials.message} in ${dir}.`
    return { ok: false, error: hint }
  }

  return { ok: true, configDir: dir, identity: await readAccountIdentity(dir, { ...options, credentialReader: reader }) }
}
