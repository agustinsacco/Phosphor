import { createServer } from 'node:http'
import { URL } from 'node:url'
import { timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { WebSocketServer } from 'ws'

/** Diagnostic fixture only: no pi, files, commands, cookies or persistent state. */
export async function createProbe({ origin, token, port = 0, ttlMs = 300_000 }) {
  if (new URL(origin).origin !== origin || !origin.startsWith('https://'))
    throw new Error('An exact HTTPS origin is required')
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
    throw new Error('A random 32-byte hex token is required')
  if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 300_000)
    throw new Error('Lifetime must be between 1 and 300000 ms')
  const expiresAt = Date.now() + ttlMs
  const accepts = (value) =>
    typeof value === 'string' &&
    /^[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token))
  const allowed = (req) => req.headers.origin === origin && Date.now() < expiresAt
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader(
      'Vary',
      'Origin, Access-Control-Request-Headers, Access-Control-Request-Private-Network',
    )
    if (req.url !== '/probe' || !allowed(req)) return res.writeHead(403).end()
    res.setHeader('Access-Control-Allow-Origin', origin)
    if (req.method === 'OPTIONS') {
      const headers = String(req.headers['access-control-request-headers'] || '')
        .toLowerCase()
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean)
      if (
        req.headers['access-control-request-method'] !== 'GET' ||
        headers.some((h) => h !== 'authorization')
      )
        return res.writeHead(403).end()
      res.setHeader('Access-Control-Allow-Methods', 'GET')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization')
      if (req.headers['access-control-request-private-network'] === 'true')
        res.setHeader('Access-Control-Allow-Private-Network', 'true')
      return res.writeHead(204).end()
    }
    if (req.method !== 'GET') return res.writeHead(405).end()
    const auth = req.headers.authorization
    if (!accepts(auth?.startsWith('Bearer ') ? auth.slice(7) : undefined))
      return res.writeHead(401).end()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ type: 'probe', version: 1, expiresAt }))
  })
  server.maxConnections = 32
  server.headersTimeout = 5000
  server.requestTimeout = 5000
  server.setTimeout(5000, (socket) => socket.destroy())
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 64,
    perMessageDeflate: false,
    handleProtocols: () => 'phosphor-probe',
  })
  server.on('upgrade', (req, socket, head) => {
    const protocols = String(req.headers['sec-websocket-protocol'] || '')
      .split(',')
      .map((p) => p.trim())
    if (
      req.url !== '/probe' ||
      !allowed(req) ||
      sockets.clients.size >= 8 ||
      protocols.length !== 2 ||
      protocols[0] !== 'phosphor-probe' ||
      !accepts(protocols[1])
    ) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      let sequence = 0
      let messages = 0
      ws.on('error', () => ws.terminate())
      ws.send(JSON.stringify({ type: 'ready', version: 1 }))
      const ticker = setInterval(() => {
        if (Date.now() >= expiresAt) return ws.terminate()
        if (ws.bufferedAmount > 4096) return ws.terminate()
        ws.send(JSON.stringify({ type: 'tick', sequence: ++sequence }))
      }, 250)
      ws.on('close', () => clearInterval(ticker))
      ws.on('message', (data, binary) => {
        if (Date.now() >= expiresAt || binary || ++messages > 32 || data.toString() !== 'ping')
          return ws.close(1008, 'Probe messages only')
        ws.send(JSON.stringify({ type: 'pong' }))
      })
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  let stopped
  const close = () => {
    if (!stopped)
      stopped = new Promise((resolve) => {
        clearTimeout(expiry)
        for (const ws of sockets.clients) ws.terminate()
        sockets.close()
        server.close(resolve)
        server.closeAllConnections()
      })
    return stopped
  }
  const expiry = setTimeout(close, ttlMs)
  return { url: `http://127.0.0.1:${server.address().port}/probe`, expiresAt, close }
}
