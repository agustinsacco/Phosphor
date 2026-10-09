/**
 * The Host's own version. Real versioning arrives with signed release
 * bundles (component 23). Until then the build stamps the source commit, and
 * an unstamped run (tests, a scratch bundle) reports `source`.
 */
declare const __PHOSPHOR_HOST_SOURCE_SHA__: string | undefined

export const HOST_SOURCE_SHA: string | null =
  typeof __PHOSPHOR_HOST_SOURCE_SHA__ === 'string' &&
  /^[0-9a-f]{40}$/.test(__PHOSPHOR_HOST_SOURCE_SHA__)
    ? __PHOSPHOR_HOST_SOURCE_SHA__
    : null

export const HOST_VERSION = `0.0.0-dev.${HOST_SOURCE_SHA?.slice(0, 7) ?? 'source'}`
