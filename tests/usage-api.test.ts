import { describe, expect, it, vi } from 'vitest'
import {
  EXPIRED_MESSAGE,
  USAGE_API_BETA,
  USAGE_API_URL,
  UsagePoller,
  computeBackoffDelay,
  fetchUsage,
  mapUsageResponse,
  parseRetryAfter,
  type FetchLike
} from '../src/main/sources/usage-api'
import { parseCredentials, type CredentialReader, type Credentials } from '../src/main/sources/account-reader'

const FAKE_TOKEN = 'sk-ant-oat01-FAKE-TEST-TOKEN'
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0)
const BASE = 90_000
const CAP = 30 * 60_000

const SAMPLE = {
  five_hour: { utilization: 42.5, resets_at: '2026-09-25T15:00:00Z' },
  seven_day: { utilization: 12, resets_at: '2026-09-30T00:00:00.000Z' },
  seven_day_opus: { utilization: null, resets_at: null },
  seven_day_oauth_apps: null
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => body
  }
}

function credentials(expiresAt: number | null = NOW + 3_600_000): Credentials {
  const result = parseCredentials({ claudeAiOauth: { accessToken: FAKE_TOKEN, expiresAt, subscriptionType: 'max' } })
  if (result.status !== 'ok') throw new Error('bad fixture')
  return result.value
}

function reader(creds: Credentials | null = credentials()): CredentialReader {
  return {
    read: async () =>
      creds ? { status: 'ok', value: creds } : { status: 'unavailable', reason: 'missing', message: '.credentials.json not found' }
  }
}

function makePoller(fetch: FetchLike, creds: Credentials | null = credentials()) {
  return new UsagePoller({
    configDir: '/fake/.claude',
    credentialReader: reader(creds),
    pollIntervalMs: BASE,
    maxBackoffMs: CAP,
    fetch,
    now: () => NOW
  })
}

describe('mapUsageResponse', () => {
  it('maps five_hour, seven_day, and optional model windows including null utilization', () => {
    expect(mapUsageResponse(SAMPLE)).toEqual({
      fiveHour: { percent: 42.5, resetsAt: Date.UTC(2026, 8, 25, 15) },
      weekly: { percent: 12, resetsAt: Date.UTC(2026, 8, 30) },
      weeklyOpus: { percent: null, resetsAt: null },
      weeklySonnet: null
    })
  })

  it('tolerates junk input', () => {
    expect(mapUsageResponse(null)).toEqual({ fiveHour: null, weekly: null, weeklyOpus: null, weeklySonnet: null })
    expect(mapUsageResponse({ five_hour: { utilization: 'x', resets_at: 'not a date' } }).fiveHour).toEqual({
      percent: null,
      resetsAt: null
    })
  })
})

describe('parseRetryAfter', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('120')).toBe(120_000)
    expect(parseRetryAfter(new Date(NOW + 5_000).toUTCString(), NOW)).toBe(5_000)
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('soon')).toBeNull()
  })
})

describe('computeBackoffDelay', () => {
  it('doubles per failure and caps', () => {
    expect(computeBackoffDelay(BASE, 0, CAP)).toBe(BASE)
    expect(computeBackoffDelay(BASE, 1, CAP)).toBe(BASE * 2)
    expect(computeBackoffDelay(BASE, 3, CAP)).toBe(BASE * 8)
    expect(computeBackoffDelay(BASE, 50, CAP)).toBe(CAP)
  })
})

describe('fetchUsage', () => {
  it('sends the bearer token and beta header to the usage endpoint', async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse(200, SAMPLE))
    const result = await fetchUsage(FAKE_TOKEN, { fetch })
    expect(result.kind).toBe('ok')
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(USAGE_API_URL)
    expect(init.method).toBe('GET')
    expect(init.headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(init.headers['anthropic-beta']).toBe(USAGE_API_BETA)
  })

  it('classifies 401, 429, 5xx, bad JSON, and network failures', async () => {
    expect(await fetchUsage(FAKE_TOKEN, { fetch: async () => jsonResponse(401, {}) })).toEqual({ kind: 'expired' })
    expect(
      await fetchUsage(FAKE_TOKEN, { fetch: async () => jsonResponse(429, {}, { 'Retry-After': '30' }) })
    ).toEqual({ kind: 'rate-limited', retryAfterMs: 30_000 })
    expect((await fetchUsage(FAKE_TOKEN, { fetch: async () => jsonResponse(503, {}) })).kind).toBe('error')
    const badJson = await fetchUsage(FAKE_TOKEN, {
      fetch: async () => ({ ...jsonResponse(200, null), json: async () => JSON.parse('{') })
    })
    expect(badJson.kind).toBe('error')
    const network = await fetchUsage(FAKE_TOKEN, {
      fetch: async () => {
        throw new TypeError(`fetch failed with Bearer ${FAKE_TOKEN}`)
      }
    })
    expect(network).toEqual({ kind: 'error', message: 'Network error contacting the usage API' })
  })
})

describe('UsagePoller', () => {
  it('returns ok with mapped windows on success', async () => {
    const poller = makePoller(async () => jsonResponse(200, SAMPLE))
    const snap = await poller.poll()
    expect(snap.status).toBe('ok')
    expect(snap.fiveHour?.percent).toBe(42.5)
    expect(snap.weeklyOpus).toEqual({ percent: null, resetsAt: null })
    expect(snap.lastSuccessAt).toBe(NOW)
    expect(snap.nextPollAt).toBe(NOW + BASE)
  })

  it('reports expired with a `claude` hint on 401', async () => {
    const snap = await makePoller(async () => jsonResponse(401, {})).poll()
    expect(snap.status).toBe('expired')
    expect(snap.message).toBe(EXPIRED_MESSAGE)
    expect(snap.message).toContain('`claude`')
  })

  it('reports expired without calling the API when expiresAt is in the past', async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse(200, SAMPLE))
    const snap = await makePoller(fetch, credentials(NOW - 1)).poll()
    expect(snap.status).toBe('expired')
    expect(snap.message).toContain('run `claude`')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports unavailable when there are no credentials', async () => {
    const snap = await makePoller(async () => jsonResponse(200, SAMPLE), null).poll()
    expect(snap.status).toBe('unavailable')
  })

  it('backs off exponentially on 429 up to the cap, then resets on success', async () => {
    let status = 429
    const poller = makePoller(async () => jsonResponse(status, SAMPLE))
    const delays: number[] = []
    for (let i = 0; i < 8; i++) {
      await poller.poll()
      delays.push(poller.nextDelayMs())
    }
    expect(delays.slice(0, 4)).toEqual([BASE * 2, BASE * 4, BASE * 8, BASE * 16])
    expect(delays.at(-1)).toBe(CAP)
    for (let i = 1; i < delays.length; i++) expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!)

    status = 200
    const snap = await poller.poll()
    expect(snap.status).toBe('ok')
    expect(poller.nextDelayMs()).toBe(BASE)
  })

  it('honors a longer Retry-After on 429 (capped)', async () => {
    const poller = makePoller(async () => jsonResponse(429, {}, { 'retry-after': '600' }))
    const snap = await poller.poll()
    expect(poller.nextDelayMs()).toBe(600_000)
    expect(snap.nextPollAt).toBe(NOW + 600_000)
  })

  it('keeps last good data as stale after a network error', async () => {
    let fail = false
    const poller = makePoller(async () => {
      if (fail) throw new Error('ECONNRESET')
      return jsonResponse(200, SAMPLE)
    })
    await poller.poll()
    fail = true
    const snap = await poller.poll()
    expect(snap.status).toBe('stale')
    expect(snap.fiveHour?.percent).toBe(42.5)
    expect(snap.lastSuccessAt).toBe(NOW)
    expect(poller.nextDelayMs()).toBe(BASE * 2)
  })

  it('reports error when a request fails before any success', async () => {
    const snap = await makePoller(async () => {
      throw new Error('offline')
    }).poll()
    expect(snap.status).toBe('error')
  })

  it('never logs or exposes the token or headers', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    const poller = makePoller(async () => {
      throw new Error(`boom Bearer ${FAKE_TOKEN}`)
    })
    const snap = await poller.poll()
    await makePoller(async () => jsonResponse(429, {})).poll()
    await makePoller(async () => jsonResponse(401, {})).poll()
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
    expect(JSON.stringify(snap)).not.toContain(FAKE_TOKEN)
    expect(JSON.stringify(poller.current)).not.toContain('Bearer')
  })
})
