import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCommandApproval } from '../../../../src/features/extension-ui/commandApproval'
import permissionGate, { permissionDecision, permissionFindings } from './permission-gate'

const prefix =
  'env -u AWS_PROFILE AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 aws --endpoint-url=http://localhost:4566'
const listing = `${prefix} s3api list-objects-v2 --bucket knowledge-artifacts-local --prefix spreadsheets/ --query 'Contents[].{Key:Key,Size:Size,Modified:LastModified}' --output json`
const download = `${prefix} s3 cp 's3://knowledge-artifacts-local/spreadsheets/augment-brokerage/internal/global/9e6906f41c438ca0/manifest.json' - --only-show-errors > /tmp/nrs-manifest.json`
const compound = `${download}; python3 - <<'PY'
import json,collections,os
m=json.load(open('/tmp/nrs-manifest.json'))
r=m['regions']
print(json.dumps({
 'status':m.get('status'),'rejection':m.get('rejection'),'regions':len(r),
 'roles':dict(collections.Counter(x.get('role') for x in r)),
 'worksheets':len(set(x.get('worksheet') for x in r)),
 'worksheetNames':sorted(set(x.get('worksheet') for x in r)),
 'tableRows':sum(x.get('rowCount') or 0 for x in r if x.get('role')=='table'),
 'regionErrors':[{'worksheet':x.get('worksheet'),'error':x.get('error')} for x in r if x.get('error')],
},indent=2))
PY
printf '\\nArtifact totals:\\n'; ${prefix} s3api list-objects-v2 --bucket knowledge-artifacts-local --prefix spreadsheets/augment-brokerage/internal/global/9e6906f41c438ca0/ --query '{Count:KeyCount,Bytes:sum(Contents[].Size)}' --output json`

describe('AWS authorization is left to the machine', () => {
  it.each([
    listing,
    compound,
    download,
    listing.replace('localhost', '127.0.0.1'),
    listing.replace('--endpoint-url=', '--endpoint-url '),
  ])('allows literal local S3 reads: %s', (command) => {
    expect(permissionDecision(command)).toBe('allow')
  })

  it.each([
    'aws s3 ls',
    `${listing}; aws s3 ls --profile prod`,
    `aws sts get-caller-identity --profile staging; ${listing}`,
    `${listing} && aws s3 ls`,
    `${listing} | aws s3 cp - s3://production/key`,
    compound.replace(/; env -u AWS_PROFILE/, '; aws s3 ls; env -u AWS_PROFILE'),
    listing.replace('localhost', 'localhost.example.com'),
    listing.replace('localhost:4566', 'localhost:4566@prod.example.com'),
    listing.replace('4566', '443'),
    listing.replace('http://', 'https://'),
    listing.replace('--endpoint-url=http://localhost:4566 ', ''),
    listing.replace('http://localhost:4566', '$ENDPOINT'),
    listing.replace('http://localhost:4566', '$(echo http://localhost:4566)'),
    listing.replace('AWS_ACCESS_KEY_ID=test', 'AWS_ACCESS_KEY_ID=real'),
    listing.replace('AWS_SECRET_ACCESS_KEY=test', 'AWS_SECRET_ACCESS_KEY=real'),
    listing.replace('-u AWS_PROFILE ', ''),
    listing.replace('AWS_DEFAULT_REGION=us-east-1', 'AWS_PROFILE=prod'),
    ...[
      '--profile prod',
      '--prof prod',
      '--endpoint-url=https://s3.amazonaws.com',
      '--end https://s3.amazonaws.com',
      '--cli-input-json file:///tmp/input.json',
      '--bucket another',
    ].map((flags) => `${listing} ${flags}`),
    `${prefix} s3 rm s3://knowledge-artifacts-local/key`,
    `${prefix} s3 cp /tmp/file s3://knowledge-artifacts-local/key`,
    listing.replace('knowledge-artifacts-local', 'arn:aws:s3:us-east-1:123:accesspoint/test'),
    download.replace(
      's3://knowledge-artifacts-local/',
      's3://arn:aws:s3:us-east-1:123:accesspoint/test/',
    ),
    `${listing} --query "$(aws sts get-caller-identity)"`,
    `echo '${listing}'`,
    `bash -c '${listing}'`,
    `python3 - <<'PY'\nprint(${JSON.stringify(listing)})\nPY`,
    `${listing} \\\n --profile prod`,
    ...['*', '?', '[a-z]*', '~user', '`echo value`'].map(
      (value) => `${listing.replace(/ --query .*/, '')} --query ${value}`,
    ),
    `${listing}; echo "unterminated`,
    `${listing}; python3 - <<'PY'\nunterminated`,
    `${listing}; python3 - <<PY\n$COMMAND\nPY`,
  ])('does not prompt solely for AWS syntax, credentials or endpoints: %s', (command) => {
    expect(permissionDecision(command)).toBe('allow')
  })

  it.each([
    'sudo true',
    'rm -rf ~/project',
    't=$(mktemp -d); rm -rf "$t"',
    'python3 ~/.pi/agent/bin/pi-scratch.py clean "$t"; rm -rf /important',
    'git push --force',
    'git reset --hard',
    'kill -9 -1',
    'pkill worker',
    'killall worker',
    'chmod 777 ~/project',
    'systemctl restart service',
    'service nginx stop',
    'su root',
    'shred /tmp/test',
    'truncate -s 0 /tmp/test',
  ])('preserves other approvals: %s', (command) => {
    expect(permissionDecision(`${listing}; ${command}`)).toBe('ask')
  })
})

// Commands agents ran that used to prompt or hard-block for text that never runs.
describe('only what the shell runs is judged', () => {
  it.each([
    'cat > a.tsx <<\'EOF\'\n<span className="min-w-0 truncate">{label}</span>\nEOF',
    "cat > clean.sh <<'EOF'\nsudo rm -rf / && shred x\nEOF\nchmod +x clean.sh",
    "python3 - <<'PY'\nimport os, signal\nos.kill(pid, signal.SIGTERM)\nPY",
    "python3 -c 'import os; os.kill(1, 9)'",
    'grep -rn "sudo\\|rm -rf" src',
    'echo "run rm -rf / to wipe it"',
    '# sudo rm -rf / is how you lose a laptop\nls',
    'git log --format=%s | grep -c truncate',
    "git commit -m \"$(cat <<'EOF'\nfix: don't kill the gate on git reset --hard\nEOF\n)\"",
    'cd /tmp; rm -rf /tmp/pi-repro && mkdir -p /tmp/pi-repro',
    'mkdir -p /tmp/tvdev/shots && rm -f /tmp/tvdev/shots/*.png && rm -rf /tmp/tvdev/chrome-profile',
    'rm -rf /tmp/x 2>/dev/null || true',
    'rm -rf ~/.pi/agent/scratch/job-1234',
    'rm -rf node_modules dist packages/*/dist test-results',
    'rm -f e2e/zz-live-claude.spec.ts',
    'kill 19268 2>/dev/null; sleep 1',
    'kill $(cat /tmp/web-dev.pid) 2>/dev/null',
    'kill -TERM 8802',
    'pkill -f "remote-debugging-port=9333" || true',
    'ROOT=$(cat /tmp/sym-live.root); pkill -f "$ROOT/bin/proxy.mjs"',
    'pkill -f "fake_tars.py" ; pkill -f "http.server 8765"',
    'git push --force-with-lease=refs/heads/agustin/know-864:abc origin HEAD',
    'git -C /repo push -u origin HEAD',
    'd=$(mktemp -d /tmp/pi-ws.XXXX); chmod -R 777 /tmp/pi-ws',
    'command -v sudo',
    'for f in a b; do echo "$f"; done',
  ])('allows: %s', (command) => {
    expect(permissionFindings(command)).toEqual([])
  })

  it.each([
    ['echo $(rm -rf ~/x)', 'rm -r'],
    ['echo "`sudo ls`"', 'sudo'],
    ['echo "$(sudo ls)"', 'sudo'],
    ['echo $(( $(sudo id -u) + 1 ))', 'sudo'],
    ["bash -c 'rm -rf ~/x'", 'rm -r'],
    ['sh -lc "sudo reboot"', 'sudo'],
    ['cat <<EOF\n$(rm -rf ~/x)\nEOF', 'rm -r'],
    ["bash <<'EOF'\nrm -rf ~/x\nEOF", 'rm -r'],
    ["cat <<'EOF' | bash\nsudo reboot\nEOF", 'sudo'],
    ['bash <<< "rm -rf ~/x"', 'rm -r'],
    ["ssh host 'rm -rf /data'", 'rm -r'],
    ["ssh -i key host <<'EOF'\nsudo reboot\nEOF", 'sudo'],
    ["ssh -o ConnectTimeout=8 host 'bash -s' <<'EOF'\nrm -rf ~/x\nEOF", 'rm -r'],
    ['rm -v -rf apps/web/src/server/tools/scribe/', 'rm -r'],
    ['find . -name x -exec rm -rf {} +', 'rm -r'],
    ['ls | xargs -n1 rm -rf', 'rm -r'],
    [`trap 'rm -rf "$d"' EXIT`, 'rm -r'],
    ['eval "rm -rf $X"', 'rm -r'],
    ['env FOO=1 nohup timeout 5 /bin/rm -rf ~/x', 'rm -r'],
    ['X=1 sudo ls', 'sudo'],
    ['(cd / && rm -rf ~/x)', 'rm -r'],
    ['{ rm -rf src; }', 'rm -r'],
    ['if true; then rm -r ./src; fi', 'rm -r'],
    ['diff <(sudo cat /etc/hosts) hosts', 'sudo'],
    ['rm -rf /tmp/*', 'rm -r'],
    ['rm -rf /tmp/../Users/me', 'rm -r'],
    ['rm -rf "$TMPDIR/x"', 'rm -r'],
    ['rm -rf /tmp/x ~/y', 'rm -r'],
    ['rm --recursive .', 'rm -r'],
    ['git -C repo push -f', 'git push --force'],
    ['git push origin +main', 'git push --force'],
    ['git push --force-with-lease --force', 'git push --force'],
    ['git -C repo reset --hard HEAD~1', 'git reset --hard'],
    ['kill 0', 'kill -1'],
    ['kill -- -4242', 'kill -1'],
    ['pkill -f node', 'pkill'],
    ['pkill -f ".*"', 'pkill'],
    ['pkill -f "pi --mode rpc"', 'pkill'],
    ['killall -9 Electron', 'killall'],
    ['chmod 777 "$d"', 'chmod 777'],
    ['SUDO ls', 'sudo'],
  ])('asks: %s', (command, finding) => {
    expect(permissionFindings(command)).toContain(finding)
  })

  it('terminates and never throws on arbitrary shell-ish text', () => {
    const alphabet = [
      'rm -rf ~',
      ' ',
      '\n',
      "'",
      '"',
      '`',
      '$(',
      '((',
      ')',
      '<<',
      "<<'E'",
      'E',
      '\\',
      '#',
      ';',
      '|',
      '&',
      '>',
      '<(',
      '{',
      '}',
      'bash -c',
      'ssh h',
    ]
    let seed = 7
    const pick = (): string => alphabet[(seed = (seed * 48271) % 2147483647) % alphabet.length]!
    for (let run = 0; run < 2000; run++) {
      const script = Array.from({ length: 24 }, pick).join('')
      expect(Array.isArray(permissionFindings(script))).toBe(true)
    }
  })

  it('falls back to the raw text when the script cannot be followed', () => {
    expect(permissionFindings('rm -rf ~/x; echo "unterminated')).toContain('rm -r')
    expect(permissionFindings('echo "$(unterminated')).toEqual([])
  })

  it('writes a heading Phosphor recognises as a command approval', async () => {
    const on = vi.fn<Parameters<typeof permissionGate>[0]['on']>()
    permissionGate({ on })
    const select = vi.fn().mockResolvedValue('No')
    const command = "cat <<'EOF' | bash\nsudo reboot\nEOF\ngit push -f"
    await on.mock.calls[0]![1](
      { toolName: 'bash', input: { command } },
      {
        hasUI: true,
        ui: { select },
      },
    )
    const [title, options] = select.mock.calls[0]!
    expect(title).toMatch(/^Dangerous command \(git push --force \+1\):/)
    expect(
      parseCommandApproval({
        type: 'extension_ui_request',
        id: '1',
        method: 'select',
        title,
        options,
      }),
    ).toEqual({
      command,
      heading: 'Dangerous command (git push --force +1)',
    })
  })
})

it.skipIf(process.platform === 'win32')(
  'runs both examples against a local AWS stub, never the real CLI',
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'permission-gate-'))
    try {
      writeFileSync(
        join(dir, 'aws'),
        `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(join(dir, 'calls'))}, JSON.stringify({
  args: process.argv.slice(2), profile: process.env.AWS_PROFILE,
  key: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY,
}) + '\\n');
console.log(JSON.stringify({regions: []}));
`,
        { mode: 0o700 },
      )
      execFileSync(
        '/bin/bash',
        [
          '--noprofile',
          '--norc',
          '-c',
          `${listing}\n${compound}`.replaceAll(
            '/tmp/nrs-manifest.json',
            join(dir, 'manifest.json'),
          ),
        ],
        {
          env: { PATH: `${dir}:/usr/bin:/bin`, AWS_PROFILE: 'prod' },
        },
      )
      const calls = readFileSync(join(dir, 'calls'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(calls).toHaveLength(3)
      for (const call of calls) {
        expect(call).toMatchObject({ key: 'test', secret: 'test' })
        expect(call.profile).toBeUndefined()
        expect(call.args[0]).toBe('--endpoint-url=http://localhost:4566')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

it('asks for approvals, never hard-blocks, and does not prompt for AWS at the hook', async () => {
  const on = vi.fn<Parameters<typeof permissionGate>[0]['on']>()
  permissionGate({ on })
  const handler = on.mock.calls[0]![1]
  const select = vi.fn().mockResolvedValue('No')
  const ctx = { hasUI: true, ui: { select } }
  const call = (command: string) => handler({ toolName: 'bash', input: { command } }, ctx)
  expect(await call(listing)).toBeUndefined()
  expect(select).not.toHaveBeenCalled()
  expect(await call('aws s3 ls')).toBeUndefined()
  expect(select).not.toHaveBeenCalled()
  expect(await call('rm -rf /tmp/test')).toBeUndefined()
  expect(select).not.toHaveBeenCalled()
  expect(await call('rm -rf ~/test')).toMatchObject({ block: true })
  select.mockResolvedValue(undefined)
  expect(await call('rm -rf ~/test')).toMatchObject({ block: true })
  select.mockResolvedValue('Yes')
  expect(await call('rm -rf ~/test')).toBeUndefined()
  expect(await call('shred /tmp/test')).toBeUndefined()
  select.mockClear()
  ctx.hasUI = false
  expect(await call('rm -rf ~/test')).toMatchObject({ block: true })
  expect(await call('aws s3 ls')).toBeUndefined()
  expect(await call(compound)).toBeUndefined()
  expect(select).not.toHaveBeenCalled()
  expect(await handler({ toolName: 'read', input: {} }, ctx)).toBeUndefined()
})
