import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('project scaffold', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2)
  })

  it('exposes the expected npm scripts', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    for (const script of ['dev', 'build', 'test', 'typecheck']) {
      expect(pkg.scripts[script]).toBeTruthy()
    }
  })
})
