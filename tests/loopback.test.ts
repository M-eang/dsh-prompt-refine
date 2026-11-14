import { describe, expect, it } from 'vitest'
import { fenceReason, isLoopbackRequest, isTrustedRequest } from '../src/loopback'

const req = (
  fields: {
    remoteAddress?: string
    host?: string
    forwarded?: boolean
    realIp?: string
    origin?: string
  } = {},
) =>
  ({
    socket: { remoteAddress: fields.remoteAddress ?? '127.0.0.1' },
    headers: {
      ...(fields.host === undefined ? {} : { host: fields.host }),
      ...(fields.forwarded === true ? { 'x-forwarded-for': '203.0.113.7' } : {}),
      ...(fields.realIp === undefined ? {} : { 'x-real-ip': fields.realIp }),
      ...(fields.origin === undefined ? {} : { origin: fields.origin }),
    },
  }) as never

describe('isLoopbackRequest', () => {
  it('accepts loopback socket addresses only', () => {
    expect(isLoopbackRequest(req({ remoteAddress: '127.0.0.1' }))).toBe(true)
    expect(isLoopbackRequest(req({ remoteAddress: '::1' }))).toBe(true)
    expect(isLoopbackRequest(req({ remoteAddress: '192.168.1.7' }))).toBe(false)
    expect(isLoopbackRequest(req({ remoteAddress: '' }))).toBe(false)
  })
})

describe('isTrustedRequest (DNS-rebinding fence)', () => {
  it('accepts loopback sockets with trusted Host headers', () => {
    expect(isTrustedRequest(req({ host: 'localhost' }))).toBe(true)
    expect(isTrustedRequest(req({ host: 'localhost:3080' }))).toBe(true)
    expect(isTrustedRequest(req({ host: '127.0.0.1:3080' }))).toBe(true)
    expect(isTrustedRequest(req({ host: '[::1]:3080' }))).toBe(true)
    expect(isTrustedRequest(req({ host: 'LOCALHOST' }))).toBe(true)
  })

  it('accepts a missing Host header (HTTP/1.0) on a loopback socket', () => {
    expect(isTrustedRequest(req({}))).toBe(true)
  })

  it('refuses rebound attacker hostnames even from a loopback socket', () => {
    expect(isTrustedRequest(req({ host: 'evil.com' }))).toBe(false)
    expect(isTrustedRequest(req({ host: 'evil.com:3080' }))).toBe(false)
    expect(isTrustedRequest(req({ host: 'internal.attacker.example' }))).toBe(false)
  })

  it('refuses proxy-forwarded requests (X-Forwarded-For / X-Real-IP / Forwarded)', () => {
    expect(isTrustedRequest(req({ forwarded: true }))).toBe(false)
    expect(isTrustedRequest(req({ forwarded: true, host: 'localhost' }))).toBe(false)
    // X-Real-IP belongs to the same family and must be refused identically:
    // nginx and many reverse proxies set it, so accepting it would reopen the
    // very path the forwarded-header rule exists to close.
    expect(isTrustedRequest(req({ realIp: '203.0.113.7' }))).toBe(false)
    expect(isTrustedRequest(req({ realIp: '203.0.113.7', host: 'localhost' }))).toBe(false)
    expect(isTrustedRequest(req({ realIp: '127.0.0.1' }))).toBe(false)
  })

  it('refuses cross-site Origins but accepts same-app local Origins', () => {
    expect(isTrustedRequest(req({ host: 'localhost', origin: 'https://evil.com' }))).toBe(false)
    expect(isTrustedRequest(req({ host: 'localhost', origin: 'http://evil.com:3080' }))).toBe(false)
    expect(isTrustedRequest(req({ host: 'localhost', origin: 'http://127.0.0.1:3080' }))).toBe(true)
    expect(isTrustedRequest(req({ host: 'localhost', origin: 'https://localhost' }))).toBe(true)
    expect(isTrustedRequest(req({ host: 'localhost', origin: '' }))).toBe(true)
  })

  it('refuses degenerate and attacker-shaped Origins', () => {
    expect(isTrustedRequest(req({ host: 'localhost', origin: 'null' }))).toBe(false)
    expect(isTrustedRequest(req({ host: 'localhost', origin: 'file://' }))).toBe(false)
    expect(isTrustedRequest(req({ host: 'localhost', origin: 'http://localhost.evil.com' }))).toBe(false)
    expect(isTrustedRequest(req({ host: 'localhost', origin: 'http://127.0.0.1.evil.com:3080' }))).toBe(false)
  })

  it('refuses localhost look-alike Host headers', () => {
    expect(isTrustedRequest(req({ host: 'localhost.evil.com' }))).toBe(false)
    expect(isTrustedRequest(req({ host: 'localhost.evil.com:3080' }))).toBe(false)
    expect(isTrustedRequest(req({ host: '127.0.0.1.evil.com' }))).toBe(false)
  })

  it('still refuses non-loopback sockets regardless of Host', () => {
    expect(isTrustedRequest(req({ remoteAddress: '192.168.1.7', host: 'localhost' }))).toBe(false)
  })
})

describe('fenceReason', () => {
  it('names the broken rule instead of a bare boolean', () => {
    expect(fenceReason(req({ host: 'localhost' }))).toBeNull()
    expect(fenceReason(req({ forwarded: true }))).toBe('forwarded')
    expect(fenceReason(req({ realIp: '203.0.113.7' }))).toBe('forwarded')
    expect(fenceReason(req({ remoteAddress: '192.168.1.7' }))).toBe('socket')
    expect(fenceReason(req({ host: 'evil.com' }))).toBe('host')
    expect(fenceReason(req({ host: 'localhost', origin: 'https://evil.com' }))).toBe('origin')
  })

  it('reports the outermost rule first', () => {
    const all = { forwarded: true, remoteAddress: '192.168.1.7', host: 'evil.com', origin: 'https://evil.com' }
    expect(fenceReason(req(all))).toBe('forwarded')
    expect(fenceReason(req({ ...all, forwarded: false }))).toBe('socket')
    expect(fenceReason(req({ host: 'evil.com', origin: 'https://evil.com' }))).toBe('host')
  })
})
