import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFile, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TranscriptFileTail,
  TranscriptReader,
  applyTranscriptLine,
  emptyTranscriptState,
  findTranscriptPath,
  readDefaultEffort
} from '../src/main/sources/transcript-tail'

const FIXTURE_CONFIG = join(__dirname, 'fixtures', 'transcripts', 'config')
const SESSION_A = 'aaaa1111-2222-3333-4444-555555555555'
const SESSION_B = 'bbbb1111-2222-3333-4444-555555555555'

interface AssistantOptions {
  model?: string
  effort?: string
  gitBranch?: string
  isSidechain?: boolean
  timestamp?: string
}

function assistantLine(opts: AssistantOptions = {}): string {
  return (
    JSON.stringify({
      type: 'assistant',
      message: { model: opts.model ?? 'claude-opus-5-5', role: 'assistant' },
      effort: opts.effort ?? 'high',
      perTurnEffort: opts.effort ?? 'high',
      gitBranch: opts.gitBranch ?? 'main',
      isSidechain: opts.isSidechain ?? false,
      timestamp: opts.timestamp ?? '2026-09-25T10:00:00.000Z'
    }) + '\n'
  )
}

describe('applyTranscriptLine', () => {
  it('extracts model, effort, branch, and timestamp from assistant lines', () => {
    const state = emptyTranscriptState()
    applyTranscriptLine(state, assistantLine({ model: 'claude-sonnet-5', effort: 'low', gitBranch: 'dev' }))
    expect(state).toMatchObject({
      model: 'claude-sonnet-5',
      effort: 'low',
      gitBranch: 'dev',
      lastActivityAt: Date.parse('2026-09-25T10:00:00.000Z')
    })
  })

  it('prefers perTurnEffort and falls back to effort', () => {
    const state = emptyTranscriptState()
    applyTranscriptLine(state, JSON.stringify({ type: 'assistant', effort: 'high', perTurnEffort: 'max' }))
    expect(state.effort).toBe('max')
    applyTranscriptLine(state, JSON.stringify({ type: 'assistant', effort: 'low' }))
    expect(state.effort).toBe('low')
  })

  it('ignores sidechain assistant lines', () => {
    const state = emptyTranscriptState()
    applyTranscriptLine(state, assistantLine({ model: 'claude-opus-5-5', effort: 'max' }))
    applyTranscriptLine(state, assistantLine({ model: 'claude-haiku-5', effort: 'low', isSidechain: true }))
    expect(state.model).toBe('claude-opus-5-5')
    expect(state.effort).toBe('max')
  })

  it('reads titles from custom-title and agent-name lines', () => {
    const state = emptyTranscriptState()
    applyTranscriptLine(state, JSON.stringify({ type: 'agent-name', agentName: 'Agent' }))
    applyTranscriptLine(state, JSON.stringify({ type: 'custom-title', customTitle: 'Custom' }))
    expect(state.agentName).toBe('Agent')
    expect(state.customTitle).toBe('Custom')
  })

  it('skips malformed and non-object lines without throwing', () => {
    const state = emptyTranscriptState()
    for (const line of ['', '{"type":"assistant"', 'garbage', '42', 'null', '[1,2]']) {
      expect(() => applyTranscriptLine(state, line)).not.toThrow()
    }
    expect(state).toEqual(emptyTranscriptState())
  })
})

describe('findTranscriptPath', () => {
  it('finds a transcript case-insensitively across project dirs', async () => {
    const path = await findTranscriptPath(FIXTURE_CONFIG, SESSION_A)
    expect(path).toMatch(/AAAA1111-2222-3333-4444-555555555555\.jsonl$/)
    expect(await findTranscriptPath(FIXTURE_CONFIG, SESSION_B.toUpperCase())).toMatch(
      /bbbb1111-2222-3333-4444-555555555555\.jsonl$/
    )
  })

  it('returns null for unknown sessions or a missing projects dir', async () => {
    expect(await findTranscriptPath(FIXTURE_CONFIG, 'nope')).toBeNull()
    expect(await findTranscriptPath(join(FIXTURE_CONFIG, 'missing'), SESSION_A)).toBeNull()
  })
})

describe('readDefaultEffort', () => {
  it('reads effortLevel from settings.json', async () => {
    expect(await readDefaultEffort(FIXTURE_CONFIG)).toBe('medium')
  })

  it('returns null when settings.json is missing', async () => {
    expect(await readDefaultEffort(join(FIXTURE_CONFIG, 'missing'))).toBeNull()
  })
})

describe('TranscriptReader with fixtures', () => {
  it('extracts the latest main-session data and skips malformed/sidechain lines', async () => {
    const info = await new TranscriptReader(FIXTURE_CONFIG).read(SESSION_A)
    expect(info).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'max',
      effortIsDefault: false,
      gitBranch: 'feature/login',
      title: 'Fix login flow',
      lastActivityAt: Date.parse('2026-09-25T10:01:00.000Z')
    })
    expect(info.transcriptPath).not.toBeNull()
  })

  it('falls back to settings.json effort when there is no assistant data', async () => {
    const info = await new TranscriptReader(FIXTURE_CONFIG).read(SESSION_B)
    expect(info).toMatchObject({
      model: null,
      effort: 'medium',
      effortIsDefault: true,
      title: 'Refactor billing'
    })
  })

  it('falls back to settings.json effort when the transcript does not exist', async () => {
    const info = await new TranscriptReader(FIXTURE_CONFIG).read('missing-session')
    expect(info).toMatchObject({ model: null, effort: 'medium', effortIsDefault: true, transcriptPath: null })
  })
})

describe('incremental tailing', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'transcript-tail-'))
    file = join(dir, 'session.jsonl')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('picks up appended lines without re-reading earlier bytes', async () => {
    const first = assistantLine({ model: 'claude-sonnet-5', effort: 'low' })
    await writeFile(file, first)

    const tail = new TranscriptFileTail(file)
    expect((await tail.update()).model).toBe('claude-sonnet-5')
    expect(tail.bytesRead).toBe(Buffer.byteLength(first))

    // Overwrite the already-consumed bytes in place (same length). If the tail
    // re-read them, the parser would see this invalid line and nothing new.
    const handle = await open(file, 'r+')
    await handle.write(Buffer.alloc(Buffer.byteLength(first) - 1, 'x'), 0, undefined, 0)
    await handle.close()

    const second = assistantLine({ model: 'claude-opus-5-5', effort: 'max' })
    await appendFile(file, second)

    const state = await tail.update()
    expect(state.model).toBe('claude-opus-5-5')
    expect(state.effort).toBe('max')
    expect(tail.bytesRead).toBe(Buffer.byteLength(first) + Buffer.byteLength(second))
  })

  it('returns the same state when nothing was appended', async () => {
    await writeFile(file, assistantLine({ model: 'claude-sonnet-5' }))
    const tail = new TranscriptFileTail(file)
    const a = await tail.update()
    const b = await tail.update()
    expect(b).toEqual(a)
  })

  it('holds a partial trailing line until it is completed', async () => {
    const line = assistantLine({ model: 'claude-opus-5-5', effort: 'max' })
    const splitAt = Math.floor(line.length / 2)
    await writeFile(file, assistantLine({ model: 'claude-sonnet-5', effort: 'low' }) + line.slice(0, splitAt))

    const tail = new TranscriptFileTail(file)
    let state = await tail.update()
    expect(state.model).toBe('claude-sonnet-5')
    expect(state.effort).toBe('low')

    await appendFile(file, line.slice(splitAt, -1))
    state = await tail.update()
    expect(state.model).toBe('claude-sonnet-5')

    await appendFile(file, '\n')
    state = await tail.update()
    expect(state.model).toBe('claude-opus-5-5')
    expect(state.effort).toBe('max')
  })

  it('keeps multi-byte characters intact when split across reads', async () => {
    const title = JSON.stringify({ type: 'custom-title', customTitle: 'Café ☕ fix' }) + '\n'
    const bytes = Buffer.from(title, 'utf8')
    const splitAt = bytes.indexOf(Buffer.from('☕', 'utf8')) + 1

    await writeFile(file, bytes.subarray(0, splitAt))
    const tail = new TranscriptFileTail(file)
    await tail.update()
    await appendFile(file, bytes.subarray(splitAt))
    expect((await tail.update()).customTitle).toBe('Café ☕ fix')
  })

  it('handles CRLF line endings', async () => {
    await writeFile(file, assistantLine({ model: 'claude-sonnet-5' }).replace('\n', '\r\n'))
    expect((await new TranscriptFileTail(file).update()).model).toBe('claude-sonnet-5')
  })

  it('restarts from the beginning when the file shrinks', async () => {
    await writeFile(file, assistantLine({ model: 'claude-sonnet-5' }) + assistantLine({ model: 'claude-sonnet-5' }))
    const tail = new TranscriptFileTail(file)
    await tail.update()

    await writeFile(file, assistantLine({ model: 'claude-opus-5-5' }))
    expect((await tail.update()).model).toBe('claude-opus-5-5')
  })

  it('leaves state untouched when the file is missing', async () => {
    const tail = new TranscriptFileTail(join(dir, 'missing.jsonl'))
    expect(await tail.update()).toEqual(emptyTranscriptState())
  })

  it('TranscriptReader tracks appends and locates transcripts created later', async () => {
    const configDir = join(dir, 'config')
    const projectDir = join(configDir, 'projects', 'c--Repos-app')
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(configDir, 'settings.json'), JSON.stringify({ effortLevel: 'high' }))

    const reader = new TranscriptReader(configDir)
    expect(await reader.read('s1')).toMatchObject({ effort: 'high', effortIsDefault: true, transcriptPath: null })

    const transcript = join(projectDir, 's1.jsonl')
    await writeFile(transcript, 'malformed line\n')
    expect(await reader.read('s1')).toMatchObject({ effort: 'high', effortIsDefault: true, transcriptPath: transcript })

    await appendFile(transcript, assistantLine({ model: 'claude-sonnet-5', effort: 'low' }))
    expect(await reader.read('s1')).toMatchObject({ model: 'claude-sonnet-5', effort: 'low', effortIsDefault: false })

    await appendFile(transcript, assistantLine({ model: 'claude-opus-5-5', effort: 'max' }))
    const many = await reader.readMany(['s1', 'other'])
    expect(many.get('s1')).toMatchObject({ model: 'claude-opus-5-5', effort: 'max' })
    expect(many.get('other')).toMatchObject({ model: null, effort: 'high', effortIsDefault: true })

    reader.prune([])
    expect(reader.pathFor('s1')).toBeNull()
  })
})
