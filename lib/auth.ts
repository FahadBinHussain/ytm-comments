// sapisid hash for youtube innertube authenticated actions
// mirrors YouTube.js Utils.generateSidAuth

function getCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

async function sha1Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-1', enc)
  const arr = Array.from(new Uint8Array(buf))
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function getSapisidAuth(): Promise<string | null> {
  // prefer __Secure-3PAPISID (the sid youtube's own web app hashes on
  // www.youtube.com in 2024+); SAPISID is the legacy fallback.
  const sid = getCookieValue('__Secure-3PAPISID') ?? getCookieValue('SAPISID')
  if (!sid) return null
  const timestamp = Math.floor(Date.now() / 1000).toString()
  // hash origin is the CONSTANT https://www.youtube.com (confirmed against
  // YouTube.js Utils.generateSidAuth) — NOT the request's Origin header.
  const origin = 'https://www.youtube.com'
  const hash = await sha1Hex(`${timestamp} ${sid} ${origin}`)
  return `SAPISIDHASH ${timestamp}_${hash}`
}

export function isSignedIn(): boolean {
  return !!getCookieValue('SAPISID')
}

export function getVisitorData(): string | null {
  // visitorData sometimes stored as cookie VISITOR_INFO1_LIVE or in innertube context
  return getCookieValue('VISITOR_INFO1_LIVE')
}
