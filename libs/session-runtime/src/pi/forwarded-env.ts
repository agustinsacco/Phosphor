/**
 * Env vars that may cross into pi's environment from outside it, by prefix.
 *
 * An allowlist rather than a wholesale env import on purpose: copying every
 * shell variable would clobber Electron's own runtime vars and leak unrelated
 * shell state into the subprocess.
 */
const FORWARDED_ENV_PREFIXES = [
  'AWS_', // Bedrock: profile, region, keys, endpoint + cache overrides
  'ANTHROPIC_',
  'OPENAI_',
  'AZURE_',
  'GEMINI_',
  'GOOGLE_',
  'VERTEX_',
  'CLOUDFLARE_',
  'GROQ_',
  'MISTRAL_',
  'CEREBRAS_',
  'XAI_',
  'OPENROUTER_',
  'BASETEN_',
  'FIREWORKS_',
  'QWEN_',
  'PI_', // pi's own knobs, e.g. PI_CACHE_RETENTION
]

/** Exact names with no useful shared prefix. */
const FORWARDED_ENV_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']

export function isForwardedEnvName(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    FORWARDED_ENV_NAMES.includes(upper) ||
    FORWARDED_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
  )
}
