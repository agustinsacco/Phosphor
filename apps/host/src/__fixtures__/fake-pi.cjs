#!/usr/bin/env node
/**
 * The Host's fake pi: `--version`, and enough of `--mode rpc` for the
 * composition tests. Like pi, it saves a turn to its session file when the
 * turn ends, in the folder pi would use for its cwd.
 *
 * A prompt holding "stream" streams until aborted; any other answers with
 * the first PHX-... token it holds, or "ok". "/fake-clone" is an extension
 * command that does what pi's clone does: copy the session to a new file and
 * move onto it, before it answers. "/fake-clone-fails" does the same, then
 * fails. "/fake-clone-hold-reply <file>" moves and holds its answer, and
 * "/fake-clone-hold-state <file>" moves, answers, and holds the next
 * get_state: each writes <file>.held once it holds, and lets go once <file>
 * exists. "/fake-clone-lose-state" moves, after which get_state fails while
 * pi runs on, as pi 0.87.1's does once the last session_info of its file has
 * a name that is not a string. "/fake-clone-hide-file" moves, after which
 * get_state names no file until "/fake-find-file". Modes, from the
 * environment pi receives:
 *   FAKE_PI_IGNORE_TERM=1  ignore SIGTERM, so only SIGKILL stops it
 *   FAKE_PI_CHILD=1        start a child in its process group that ignores SIGTERM
 *   FAKE_PI_LEAK=1         print ANTHROPIC_API_KEY on stderr at startup, as a failing provider might
 * At startup it prints, on stderr, the names in its environment, its PATH
 * and its child's pid.
 */
'use strict'
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log('0.87.1')
  process.exit(0)
}
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

// pi's layout, as libs/session-runtime/src/pi/pi-paths.ts mangles it: keep the two in step.
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? '/', '.pi', 'agent')
const sessions = process.env.PI_CODING_AGENT_SESSION_DIR ?? join(agentDir, 'sessions')
const folder = join(
  sessions,
  `--${process
    .cwd()
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`,
)
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')
let sessionFile = flag('--session') ?? join(folder, `${stamp()}_${randomUUID()}.jsonl`)
let id = randomUUID()
let messages = 0

console.error(`FAKE_PI_ENV ${Object.keys(process.env).sort().join(',')}`)
console.error(`FAKE_PI_PATH ${process.env.PATH ?? ''}`)
if (process.env.FAKE_PI_LEAK) {
  console.error(`cannot reach the provider with ${process.env.ANTHROPIC_API_KEY}`)
}
if (process.env.FAKE_PI_CHILD) {
  const child = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { stdio: 'ignore' },
  )
  console.error(`FAKE_PI_CHILD ${child.pid}`)
}
process.on('SIGTERM', () => {
  if (!process.env.FAKE_PI_IGNORE_TERM) process.exit(0)
})

const out = (record) => process.stdout.write(JSON.stringify(record) + '\n')
const respond = (cmd, data) =>
  out({ id: cmd.id, type: 'response', command: cmd.type, success: true, data })
const fail = (cmd, error) =>
  out({ id: cmd.id, type: 'response', command: cmd.type, success: false, error })
const text = (value) => ({ role: 'assistant', content: [{ type: 'text', text: value }] })

const header = () =>
  JSON.stringify({
    type: 'session',
    version: 3,
    id,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  })

/** What pi does when a turn ends: append it, writing the header first for a new file. */
function save(user, reply) {
  if (!existsSync(sessionFile)) {
    mkdirSync(dirname(sessionFile), { recursive: true })
    appendFileSync(sessionFile, header() + '\n')
  }
  for (const message of [{ role: 'user', content: user }, reply]) {
    appendFileSync(
      sessionFile,
      JSON.stringify({ type: 'message', id: randomUUID(), message }) + '\n',
    )
    messages++
  }
}

/** pi's clone: a new file with this one's entries, which pi then writes instead. */
function clone() {
  const entries = existsSync(sessionFile)
    ? readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean).slice(1)
    : []
  id = randomUUID()
  sessionFile = join(dirname(sessionFile), `${stamp()}_${id}.jsonl`)
  mkdirSync(dirname(sessionFile), { recursive: true })
  writeFileSync(sessionFile, [header(), ...entries].map((line) => line + '\n').join(''))
}

/** Run `then` once `file` exists, after writing `file`.held to say it waits. */
function holdUntil(file, then) {
  writeFileSync(`${file}.held`, '')
  const timer = setInterval(() => {
    if (!existsSync(file)) return
    clearInterval(timer)
    then()
  }, 10)
}

// The file whose existence lets the next get_state be answered, if one is held.
let heldState = null
// How get_state answers once a move has made it lose its file: 'fails' or 'hides'.
let lostState = null

let streaming = null
function delta(value) {
  out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: value } })
}
function finish(user, reply, stopReason) {
  const message = { ...text(reply), stopReason }
  out({ type: 'message_end', message })
  save(user, message)
  out({ type: 'agent_end', messages: [message] })
  out({ type: 'agent_settled' })
}
function prompt(message) {
  out({ type: 'agent_start' })
  out({ type: 'message_start', message: text('') })
  if (message.includes('stream')) {
    let count = 0
    streaming = { user: message, reply: '' }
    streaming.timer = setInterval(() => {
      const piece = `${++count} `
      streaming.reply += piece
      delta(piece)
    }, 20)
    return
  }
  const reply = (/PHX-[A-Za-z0-9]+/.exec(message) ?? ['ok'])[0]
  delta(reply)
  setTimeout(() => finish(message, reply, 'stop'), 10)
}

/** What get_state reports. */
function state() {
  return {
    model: {
      provider: flag('--provider') ?? 'fake',
      id: flag('--model') ?? 'fake-model',
      contextWindow: 200000,
    },
    thinkingLevel: flag('--thinking') ?? 'off',
    isStreaming: streaming !== null,
    isCompacting: false,
    steeringMode: 'all',
    followUpMode: 'one-at-a-time',
    sessionFile,
    sessionId: id,
    sessionName: flag('-n'),
    autoCompactionEnabled: true,
    messageCount: messages,
    pendingMessageCount: 0,
  }
}

function handle(cmd) {
  switch (cmd.type) {
    case 'get_state': {
      const answer = () => {
        if (lostState === 'fails') return fail(cmd, 'cannot read the session')
        return respond(cmd, {
          ...state(),
          ...(lostState === 'hides' && { sessionFile: undefined }),
        })
      }
      if (heldState === null) return answer()
      const release = heldState
      heldState = null
      return holdUntil(release, answer)
    }
    case 'prompt': {
      const space = cmd.message.indexOf(' ')
      const name = space === -1 ? cmd.message : cmd.message.slice(0, space)
      const arg = cmd.message.slice(space + 1)
      switch (name) {
        case '/fake-clone':
          clone()
          return respond(cmd)
        case '/fake-clone-fails':
          clone()
          return fail(cmd, 'the extension failed')
        case '/fake-clone-hold-reply':
          clone()
          return holdUntil(arg, () => respond(cmd))
        case '/fake-clone-hold-state':
          clone()
          heldState = arg
          return respond(cmd)
        case '/fake-clone-lose-state':
        case '/fake-clone-hide-file':
          clone()
          lostState = name === '/fake-clone-lose-state' ? 'fails' : 'hides'
          return respond(cmd)
        case '/fake-find-file':
          lostState = null
          return respond(cmd)
      }
      respond(cmd)
      // The context-budget extension's command: no model turn.
      if (!cmd.message.startsWith('/phosphor-context-budget ')) prompt(cmd.message)
      return
    }
    case 'abort': {
      respond(cmd)
      if (!streaming) return
      const { user, reply, timer } = streaming
      clearInterval(timer)
      streaming = null
      return finish(user, reply, 'aborted')
    }
    default:
      fail(cmd, 'unsupported in fake')
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (let at = buffer.indexOf('\n'); at !== -1; at = buffer.indexOf('\n')) {
    const line = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    if (line.trim()) handle(JSON.parse(line))
  }
})
// pi in RPC mode exits when its input ends.
process.stdin.on('end', () => process.exit(0))
