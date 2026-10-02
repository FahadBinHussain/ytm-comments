// sapisid hash for youtube innertube authenticated actions
// mirrors YouTube.js Utils.generateSidAuth

import { warnOnce } from './log'

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
  // hash origin = the PAGE origin (location.origin), NOT a hardcoded
  // https://www.youtube.com. youtube validates SAPISIDHASH against the
  // Origin header the browser actually sends, and a music.youtube.com page
  // sends Origin: https://music.youtube.com on every fetch — hashing www
  // makes the header invalid and every request is served logged-out
  // (logged_in=0, like commands replaced by the sign-in modal). confirmed
  // 2026-10-01 with a header matrix: music-origin hash -> yt_li=1 on both
  // music.* and www.* targets, www-origin hash -> 0/400 from a music page.
  const origin = globalThis.location?.origin ?? ''
  if (!/^https:\/\/([\w-]+\.)?youtube\.com$/.test(origin)) {
    warnOnce('sapisid origin', 'SAPISIDHASH will be computed from a non-youtube origin:', origin)
  }
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
