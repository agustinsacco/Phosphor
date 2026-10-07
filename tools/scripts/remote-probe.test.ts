import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { connect } from 'node:net'
import { WebSocket } from 'ws'
import { createProbe } from './remote-probe.mjs'

const origin = 'https://app.example'
const token = randomBytes(32).toString('hex')
const stops: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()))
})
async function start(ttlMs = 300_000) {
  const probe = await createProbe({ origin, token, ttlMs })
  stops.push(probe.close)
  return probe
}
const headers = { Origin: origin, Authorization: `Bearer ${token}` }
function socket(url: string, candidate = token, from = origin) {
  return new WebSocket(url.replace('http:', 'ws:'), ['phosphor-probe', candidate], { origin: from })
}

describe('temporary remote transport probe', () => {
  it('binds loopback and returns only diagnostic data without caching', async () => {
    const probe = await start()
    expect(new URL(probe.url).hostname).toBe('127.0.0.1')
    const response = await fetch(probe.url, { headers })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    expect(await response.json()).toEqual({ type: 'probe', version: 1, expiresAt: probe.expiresAt })
  })

  it.each(['', token, `Bearer ${'0'.repeat(64)}`, `Bearer ${'é'.repeat(64)}`])(
    'rejects invalid authorization without crashing',
    async (authorization) => {
      const probe = await start()
      expect(
        (await fetch(probe.url, { headers: { ...headers, Authorization: authorization } })).status,
      ).toBe(401)
      expect((await fetch(probe.url, { headers })).status).toBe(200)
    },
  )

  it('rejects absent/foreign origins, other paths, query tokens and mutations', async () => {
    const probe = await start()
    for (const from of ['', 'null', 'https://evil.example'])
      expect((await fetch(probe.url, { headers: { ...headers, Origin: from } })).status).toBe(403)
    expect((await fetch(`${probe.url}?token=${token}`, { headers })).status).toBe(403)
    expect((await fetch(probe.url.replace('/probe', '/files'), { headers })).status).toBe(403)
    expect((await fetch(probe.url, { headers, method: 'POST' })).status).toBe(405)
  })

  it('allows narrow preflights including private-network requests, but not foreign origins', async () => {
    const probe = await start()
    const preflight = {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
      'Access-Control-Request-Private-Network': 'true',
    }
    const response = await fetch(probe.url, { method: 'OPTIONS', headers: preflight })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-private-network')).toBe('true')
    const rejected = await fetch(probe.url, {
      method: 'OPTIONS',
      headers: { ...preflight, Origin: 'https://evil.example' },
    })
    expect(rejected.status).toBe(403)
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull()
    expect(
      (
        await fetch(probe.url, {
          method: 'OPTIONS',
          headers: { ...preflight, 'Access-Control-Request-Headers': 'authorization,x-unexpected' },
        })
      ).status,
    ).toBe(403)
  })

  it('streams, answers ping, and permits reconnect without reflecting the token', async () => {
    const probe = await start()
    for (let attempt = 0; attempt < 2; attempt++) {
      const ws = socket(probe.url)
      const ready = once(ws, 'message')
      await once(ws, 'open')
      expect(ws.protocol).toBe('phosphor-probe')
      expect(JSON.parse(String((await ready)[0])).type).toBe('ready')
      const pong = once(ws, 'message')
      ws.send('ping')
      expect(JSON.parse(String((await pong)[0])).type).toBe('pong')
      expect(JSON.parse(String((await once(ws, 'message'))[0]))).toEqual({
        type: 'tick',
        sequence: 1,
      })
      const closed = once(ws, 'close')
      ws.close()
      await closed
    }
  })

  it.each([
    [token, 'https://evil.example'],
    ['0'.repeat(64), origin],
  ])('refuses unauthorized WebSocket upgrades', async (candidate, from) => {
    const probe = await start()
    const ws = socket(probe.url, candidate, from)
    const [error] = await once(ws, 'error')
    expect(error.message).toContain('401')
  })

  it('terminates existing streams and stops listening at expiry', async () => {
    const probe = await start(1000)
    const ws = socket(probe.url)
    await once(ws, 'open')
    await once(ws, 'close')
    await probe.close()
    await expect(fetch(probe.url, { headers })).rejects.toThrow()
  })

  it('cannot be kept alive by a rejected half-open upgrade', async () => {
    const probe = await start()
    const peer = connect({
      host: '127.0.0.1',
      port: Number(new URL(probe.url).port),
      allowHalfOpen: true,
    })
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      await once(peer, 'connect')
      peer.write(
        'GET /probe HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
      )
      expect(String((await once(peer, 'data'))[0])).toContain('401 Unauthorized')
      await Promise.race([
        probe.close(),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Rejected peer prevented shutdown')), 500)
        }),
      ])
    } finally {
      clearTimeout(deadline)
      peer.destroy()
    }
  })

  it('rejects unsafe configuration', async () => {
    for (const options of [
      { origin: 'http://app.example' },
      { origin: `${origin}/path` },
      { token: 'short' },
      { ttlMs: 300_001 },
    ])
      await expect(createProbe({ origin, token, ...options })).rejects.toThrow()
  })
})
