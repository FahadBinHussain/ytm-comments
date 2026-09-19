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
  const sapisid = getCookieValue('SAPISID') ?? getCookieValue('__Secure-3PAPISID')
  if (!sapisid) return null
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const origin = 'https://www.youtube.com'
  const hash = await sha1Hex(`${timestamp} ${sapisid} ${origin}`)
  return `SAPISIDHASH ${timestamp}_${hash}`
}

export function isSignedIn(): boolean {
  return !!getCookieValue('SAPISID')
}

export function getVisitorData(): string | null {
  // visitorData sometimes stored as cookie VISITOR_INFO1_LIVE or in innertube context
  return getCookieValue('VISITOR_INFO1_LIVE')
}
