/* global fetch, AbortSignal, WebSocket, location, navigator */
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import assert from 'node:assert/strict'
import { chromium, firefox, webkit } from '@playwright/test'

// A mode-0600 JSON file: { pageUrl, endpoint, token }. Never log its token.
const config = JSON.parse(await readFile(process.env.PROBE_CONFIG, 'utf8'))
for (const value of [config.pageUrl, config.endpoint]) {
  const url = new URL(value)
  assert.ok(
    url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
    'Probe URLs must be HTTPS without credentials, query or fragment',
  )
}
if (typeof config.token !== 'string' || !/^[a-f0-9]{64}$/.test(config.token))
  throw new Error('A random 32-byte hex token is required')
if (new URL(config.endpoint).pathname !== '/probe') throw new Error('Expected the /probe endpoint')
const engine = process.env.PROBE_BROWSER || 'chromium'
const browserType = { chromium, firefox, webkit }[engine]
if (!browserType) throw new Error('Unsupported browser')
const browser = await browserType.launch()
try {
  const context = await browser.newContext()
  const localNetworkConsent = process.env.PROBE_LOCAL_NETWORK_CONSENT === '1'
  if (localNetworkConsent) await context.grantPermissions(['local-network-access'])
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error')
      console.error(message.text().replaceAll(config.token, '[redacted]').slice(0, 500))
  })
  await page.goto(config.pageUrl, { waitUntil: 'domcontentloaded' })
  const result = await page.evaluate(async ({ endpoint, token }) => {
    const request = (credential) =>
      fetch(endpoint, {
        headers: { Authorization: `Bearer ${credential}` },
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      })
    const response = await request(token)
    const denied = await request('0'.repeat(64))
    const stream = () =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(endpoint.replace(/^https:/, 'wss:'), ['phosphor-probe', token])
        const ticks = []
        let ready = false
        let pong = false
        let finished = false
        const timer = setTimeout(() => finish(new Error('WebSocket timeout')), 10_000)
        function finish(error) {
          if (finished) return
          finished = true
          clearTimeout(timer)
          socket.onclose = null
          socket.close()
          if (error) reject(error)
          else resolve({ ready, pong, ticks, protocol: socket.protocol })
        }
        socket.onopen = () => socket.send('ping')
        socket.onerror = () => finish(new Error('WebSocket connection failed'))
        socket.onclose = () => finish(new Error('WebSocket closed before probe completed'))
        socket.onmessage = ({ data }) => {
          const message = JSON.parse(data)
          if (message.type === 'ready') ready = true
          if (message.type === 'pong') pong = true
          if (message.type === 'tick') ticks.push(message.sequence)
          if (ready && pong && ticks.length === 3) finish()
        }
      })
    return {
      origin: location.origin,
      userAgent: navigator.userAgent,
      http: response.status,
      denied: denied.status,
      body: await response.json(),
      streams: [await stream(), await stream()],
    }
  }, config)
  assert.equal(result.http, 200)
  assert.equal(result.denied, 401)
  assert.equal(result.body.type, 'probe')
  for (const stream of result.streams)
    assert.deepEqual(stream, {
      ready: true,
      pong: true,
      ticks: [1, 2, 3],
      protocol: 'phosphor-probe',
    })
  console.log(JSON.stringify({ engine, localNetworkConsent, ...result }))
} finally {
  await browser.close()
}
