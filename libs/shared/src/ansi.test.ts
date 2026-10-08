import { describe, expect, it } from 'vitest'
import { ansiToSpans, stripAnsi } from './ansi'

describe('stripAnsi', () => {
  it('passes plain text through untouched', () => {
    expect(stripAnsi('MCP: 2 servers enabled')).toBe('MCP: 2 servers enabled')
  })

  it('removes SGR sequences', () => {
    expect(stripAnsi('\x1b[38;2;138;190;183m⚡ MCP: 2 servers enabled\x1b[39m')).toBe(
      '⚡ MCP: 2 servers enabled',
    )
  })

  it('removes OSC sequences (BEL and ST terminated)', () => {
    expect(stripAnsi('\x1b]0;title\x07after')).toBe('after')
    expect(stripAnsi('\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\')).toBe('link')
  })

  it('removes bare two-byte escapes and unterminated CSI tails', () => {
    expect(stripAnsi('a\x1bMb')).toBe('ab')
    expect(stripAnsi('cursor \x1b[2K\x1b[1Ghome')).toBe('cursor home')
  })
})

describe('ansiToSpans', () => {
  it('returns one uncolored span for plain text', () => {
    expect(ansiToSpans('hello')).toEqual([{ text: 'hello' }])
  })

  it('colors a truecolor run and resets on 39', () => {
    expect(ansiToSpans('\x1b[38;2;138;190;183m⚡ MCP: 2 servers enabled\x1b[39m ok')).toEqual([
      { text: '⚡ MCP: 2 servers enabled', color: 'rgb(138,190,183)' },
      { text: ' ok' },
    ])
  })

  it('handles basic and bright colors with reset-all', () => {
    expect(ansiToSpans('\x1b[32mgreen\x1b[0mplain\x1b[91mred')).toEqual([
      { text: 'green', color: '#0dbc79' },
      { text: 'plain' },
      { text: 'red', color: '#f14c4c' },
    ])
  })

  it('handles 256-color foregrounds', () => {
    const spans = ansiToSpans('\x1b[38;5;196mx')
    expect(spans).toHaveLength(1)
    expect(spans[0]?.color).toBe('rgb(255,0,0)')
  })

  it('ignores non-color SGR attributes and non-SGR escapes', () => {
    expect(ansiToSpans('\x1b[1mbold\x1b[2Kcleared')).toEqual([{ text: 'boldcleared' }])
  })

  it('merges adjacent same-color runs', () => {
    expect(ansiToSpans('\x1b[31ma\x1b[31mb')).toEqual([{ text: 'ab', color: '#cd3131' }])
  })

  it('leaves an unterminated color running to the end', () => {
    expect(ansiToSpans('\x1b[34mblue to end')).toEqual([{ text: 'blue to end', color: '#2472c8' }])
  })
})
