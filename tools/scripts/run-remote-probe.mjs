import { createProbe } from './remote-probe.mjs'

// Set the token through a protected environment, never a URL or command argument.
const probe = await createProbe({
  origin: process.env.PROBE_ORIGIN,
  token: process.env.PROBE_TOKEN,
  port: Number(process.env.PROBE_PORT || 18591),
})
console.log(JSON.stringify({ url: probe.url, expiresAt: probe.expiresAt }))
process.once('SIGTERM', () => void probe.close())
process.once('SIGINT', () => void probe.close())
