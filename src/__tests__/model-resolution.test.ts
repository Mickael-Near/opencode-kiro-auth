import { describe, expect, test } from 'bun:test'
import { getContextWindowSize, resolveKiroModel, toOpenCodeModelID } from '../plugin/models.js'

describe('resolveKiroModel', () => {
  test('resolves catalog IDs that need no rewriting', () => {
    expect(resolveKiroModel('auto')).toBe('auto')
    expect(resolveKiroModel('deepseek-3.2')).toBe('deepseek-3.2')
    expect(resolveKiroModel('minimax-m2.5')).toBe('minimax-m2.5')
    expect(resolveKiroModel('qwen3-coder-next')).toBe('qwen3-coder-next')
  })

  test('restores the dots OpenCode model IDs cannot carry', () => {
    expect(resolveKiroModel('claude-sonnet-4-5')).toBe('claude-sonnet-4.5')
    expect(resolveKiroModel('claude-sonnet-4')).toBe('claude-sonnet-4')
    expect(resolveKiroModel('claude-opus-4-8')).toBe('claude-opus-4.8')
    expect(resolveKiroModel('claude-opus-5-5')).toBe('claude-opus-5.5')
  })

  test('strips the thinking suffix', () => {
    expect(resolveKiroModel('claude-opus-4-8-thinking')).toBe('claude-opus-4.8')
    expect(resolveKiroModel('claude-sonnet-5-thinking')).toBe('claude-sonnet-5')
  })

  // Kiro folded its 1M variants into the base models; the old slugs stay
  // resolvable so existing configs keep working.
  test('resolves retired 1m slugs to the base model', () => {
    expect(resolveKiroModel('claude-sonnet-5-1m')).toBe('claude-sonnet-5')
    expect(resolveKiroModel('claude-sonnet-5-1m-thinking')).toBe('claude-sonnet-5')
    expect(resolveKiroModel('claude-opus-4-6-1m')).toBe('claude-opus-4.6')
  })

  test('rejects unknown slugs', () => {
    expect(() => resolveKiroModel('qwen3-coder-480b')).toThrow(
      'Unsupported model: qwen3-coder-480b'
    )
    expect(() => resolveKiroModel('this-model-does-not-exist')).toThrow(
      'Unsupported model: this-model-does-not-exist'
    )
  })
})

describe('toOpenCodeModelID', () => {
  test('replaces every dot, not just the first', () => {
    expect(toOpenCodeModelID('claude-opus-5.5')).toBe('claude-opus-5-5')
    expect(toOpenCodeModelID('gpt-5.6-sol')).toBe('gpt-5-6-sol')
    expect(toOpenCodeModelID('auto')).toBe('auto')
  })
})

describe('getContextWindowSize', () => {
  test('reports the window Kiro declares for the model', () => {
    expect(getContextWindowSize('claude-opus-5')).toBe(1000000)
    expect(getContextWindowSize('claude-opus-5-thinking')).toBe(1000000)
    expect(getContextWindowSize('claude-sonnet-4-5')).toBe(200000)
    expect(getContextWindowSize('qwen3-coder-next')).toBe(256000)
  })

  test('falls back to the smallest window Kiro ships for unknown models', () => {
    expect(getContextWindowSize('unknown-model')).toBe(200000)
    expect(getContextWindowSize('')).toBe(200000)
  })
})
