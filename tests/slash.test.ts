import { describe, expect, it } from 'vitest'
import { joinSlashPrefix, splitSlashPrefix } from '../src/shared/slash'

describe('splitSlashPrefix', () => {
  it('reports no command for a plain draft', () => {
    expect(splitSlashPrefix('帮我把这段提示词改好')).toEqual({ prefix: '', body: '帮我把这段提示词改好' })
  })

  it('splits a command line off the prose after it', () => {
    expect(splitSlashPrefix('/logs 200\n看看最近的日志，找出报错')).toEqual({
      prefix: '/logs 200',
      body: '看看最近的日志，找出报错',
    })
  })

  it('splits a bare command with no arguments', () => {
    expect(splitSlashPrefix('/enhance\n帮我把这段话改好')).toEqual({
      prefix: '/enhance',
      body: '帮我把这段话改好',
    })
  })

  it('reports an empty body when the draft is nothing but a command', () => {
    // 上游用这个信号决定"不发模型调用"：没有正文就没有可改写的散文。
    expect(splitSlashPrefix('/logs 200')).toEqual({ prefix: '/logs 200', body: '' })
    expect(splitSlashPrefix('/logs 200   ')).toEqual({ prefix: '/logs 200', body: '' })
  })

  it('keeps the whole body when the slash line is not a command', () => {
    // 路径里的斜杠不是命令：`/home/user/a.txt` 有第二个斜杠，不匹配命令形态。
    const path = '/home/user/a.txt 帮我改一下'
    expect(splitSlashPrefix(path)).toEqual({ prefix: '', body: path })
    const year = '/2024 年度报告\n接着写下去'
    expect(splitSlashPrefix(year)).toEqual({ prefix: '', body: year })
  })

  it('only ever looks at the first line', () => {
    const text = '看看日志\n/logs 200'
    expect(splitSlashPrefix(text)).toEqual({ prefix: '', body: text })
  })

  it('trims the command line and the body edges, keeping the body interior', () => {
    expect(splitSlashPrefix('  /logs 200  \n\n  第一段\n\n  第二段  ')).toEqual({
      prefix: '/logs 200',
      body: '第一段\n\n  第二段',
    })
  })

  it('accepts a command with an underscore or a dash', () => {
    expect(splitSlashPrefix('/shell_kit\n重启')).toEqual({ prefix: '/shell_kit', body: '重启' })
    expect(splitSlashPrefix('/stt-qwen\n识别这段音频')).toEqual({ prefix: '/stt-qwen', body: '识别这段音频' })
  })

  it('does not treat a slash inside a word as a command', () => {
    const text = 'A/B 测试怎么写\n给我一个方案'
    expect(splitSlashPrefix(text)).toEqual({ prefix: '', body: text })
  })
})

describe('joinSlashPrefix', () => {
  it('re-attaches the command line verbatim', () => {
    expect(joinSlashPrefix('/logs 200', '看看最近的日志。')).toBe('/logs 200\n看看最近的日志。')
  })

  it('is the identity for a body without a command', () => {
    expect(joinSlashPrefix('', '  看看最近的日志。  ')).toBe('看看最近的日志。')
  })

  it('keeps a lone command untouched', () => {
    expect(joinSlashPrefix('/logs 200', '   ')).toBe('/logs 200')
  })

  it('round-trips a split draft when the body is unchanged', () => {
    const draft = '/logs 200\n看看最近的日志，找出报错'
    const { prefix, body } = splitSlashPrefix(draft)
    expect(joinSlashPrefix(prefix, body)).toBe(draft)
  })
})
