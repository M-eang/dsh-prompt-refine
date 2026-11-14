/**
 * Loopback fence for the plugin's host routes: the enhance route forwards
 * the draft to a configured model provider, so untrusted callers must be
 * turned away regardless of method or content-type (same fence policy as
 * the describe-image route family).
 *
 * This fence is the canonical implementation for the three plugin packages
 * in this workspace (dsh-prompt-refine / dsh-shell-kit / dsh-stt-qwen);
 * the JavaScript copies in the other two keep the same four rules in the
 * same order so a reviewer can diff them by eye.
 * @module dsh-prompt-refine/loopback
 */

import type { IncomingMessage } from 'node:http'

/** Hostnames a browser (or local process) may use to reach the loopback server. */
const TRUSTED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * Proxy-forwarding headers: any of them means a proxy is in the path, which
 * this route's trust model does not cover. `x-real-ip` belongs to the same
 * family (`X-Forwarded-For`, `Forwarded`) and is refused for the same reason.
 */
const FORWARDING_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded'] as const

/** Why a request was refused; `null` means trusted. */
export type FenceReason = 'forwarded' | 'socket' | 'host' | 'origin'

/** Whether the request arrived on a loopback socket address. */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Strip the port (and IPv6 brackets) from a Host header value. */
function hostnameOf(hostHeader: string): string {
  const trimmed = hostHeader.trim().toLowerCase()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end === -1 ? trimmed : trimmed.slice(1, end)
  }
  const colon = trimmed.lastIndexOf(':')
  return colon === -1 ? trimmed : trimmed.slice(0, colon)
}

/** Origins a web page may come from to call the loopback server (same-app pages). */
function isTrustedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && TRUSTED_HOSTNAMES.has(url.hostname)
  } catch {
    return false
  }
}

/**
 * Full trust check for the plugin's host routes: the socket must be loopback,
 * the Host header must name a loopback host, and no proxy-forwarding headers
 * may be present. The Host check defeats DNS rebinding — a rebound attacker
 * domain keeps the loopback socket address but carries the attacker's
 * hostname, which is refused here. A missing Host header (HTTP/1.0 style)
 * stays allowed: the socket check already bounds it to local processes.
 * Requests carrying `X-Forwarded-For` / `X-Real-IP` / `Forwarded` are refused
 * outright: those headers only exist when a proxy is in the path, which this
 * route's trust model does not cover. A browser-supplied `Origin` must be a
 * same-app local page — this defeats cross-site fire-and-forget POSTs, which
 * always carry an `Origin` that will not be trusted.
 *
 * Returns the failed rule instead of a bare boolean so callers can log or
 * report *which* trust assumption broke; `null` means the request is trusted.
 */
export function fenceReason(req: IncomingMessage): FenceReason | null {
  for (const header of FORWARDING_HEADERS) {
    if (req.headers[header] !== undefined) return 'forwarded'
  }
  if (!isLoopbackRequest(req)) return 'socket'
  const host = req.headers.host
  if (typeof host === 'string' && host.trim() !== '' && !TRUSTED_HOSTNAMES.has(hostnameOf(host))) return 'host'
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.trim() !== '' && !isTrustedOrigin(origin)) return 'origin'
  return null
}

/** Boolean form of {@link fenceReason}, kept for route guards. */
export function isTrustedRequest(req: IncomingMessage): boolean {
  return fenceReason(req) === null
}
