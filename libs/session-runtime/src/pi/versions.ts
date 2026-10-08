/** Compare dotted semver-ish strings. Returns <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Pull a version like "0.78.0" out of mixed CLI output. */
export function extractVersion(output: string): string | null {
  for (const line of output.split('\n')) {
    const match = /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(line.trim())
    if (match) return match[1]!
  }
  return null
}
