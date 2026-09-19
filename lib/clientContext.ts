import { storage } from '#imports';
import type { ClientContext } from './types';
import { warnOnce } from './log';

export const FALLBACK_CLIENT_CONTEXT: ClientContext = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20240101.00.00',
    hl: 'en',
    gl: 'US',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  },
};

const STORAGE_KEY = 'session:ytm-comments-client-context' as const;
const STORAGE_TTL_MS = 6 * 60 * 60 * 1000;

type CacheEntry = { value: ClientContext; fetchedAt: number };

let memoryCache: CacheEntry | null = null;

async function readSessionCache(): Promise<ClientContext | null> {
  try {
    const entry = await storage.getItem<CacheEntry>(STORAGE_KEY);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > STORAGE_TTL_MS) return null;
    memoryCache = entry;
    return entry.value;
  } catch {
    return null;
  }
}

async function writeSessionCache(value: ClientContext): Promise<void> {
  const entry: CacheEntry = { value, fetchedAt: Date.now() };
  memoryCache = entry;
  try {
    await storage.setItem<CacheEntry>(STORAGE_KEY, entry);
  } catch {
    // session storage may be unavailable; memory cache still works
  }
}

// balanced-brace extraction: a non-greedy regex stops at the first nested '}',
// which silently truncates INNERTUBE_CONTEXT (it has nested objects) and makes
// JSON.parse fail -> harvest returns null -> stale hardcoded fallback client.
// walk to the matching brace instead, respecting string literals.
function extractJSONObjectAt(html: string, key: string): string | null {
  const keyStart = html.indexOf(`"${key}"`);
  if (keyStart < 0) return null;
  const objStart = html.indexOf('{', keyStart);
  if (objStart < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = objStart; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return html.slice(objStart, i + 1);
    }
  }
  return null;
}

async function harvestLiveContext(): Promise<ClientContext | null> {
  try {
    // same-origin only: from a music.youtube.com content script, fetching the
    // www.youtube.com HOMEPAGE is CORS-blocked (its HTML sends no
    // Access-Control-Allow-Origin, unlike the /youtubei API endpoints — that
    // silent failure is what left the client version stuck on the 2.5-year-old
    // hardcoded fallback, which makes youtube gate the engagement toolbar
    // surface behind an inert innertubeCommand placeholder instead of the real
    // performCommentActionEndpoint). the current origin's own page embeds a
    // fresh INNERTUBE_CONTEXT, and same-origin means no CORS and same-site
    // cookies, so it works from the content script.
    const res = await fetch(`${location.origin}/`, {
      credentials: 'include',
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) {
      warnOnce('ctx-harvest-status', `client context harvest: same-origin fetch returned ${res.status}`);
      return null;
    }
    const html = await res.text();
    const raw = extractJSONObjectAt(html, 'INNERTUBE_CONTEXT');
    if (!raw) {
      warnOnce('ctx-harvest-missing', 'client context harvest: INNERTUBE_CONTEXT not found in same-origin page html');
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed?.client?.clientName || !parsed?.client?.clientVersion) {
      warnOnce('ctx-harvest-incomplete', 'client context harvest: parsed context missing client name/version');
      return null;
    }
    // the music page serves the WEB_REMIX client ("1.YYYYMMDD.XX.XX"). comment
    // threads + the engagement toolbar surface are only served to the WEB
    // client ("2.YYYYMMDD.XX.XX") — a WEB_REMIX /next returns no comment
    // framework at all ("comments are disabled"). WEB bumps the same date;
    // emit the canonical first build of that day (.00.00 always exists, while
    // reusing the music build number can name a WEB version that was never
    // published and makes youtube gate the surface). rewrite to WEB without
    // needing the CORS-blocked www homepage. pass through only fields the
    // Context proto actually knows — extras can make youtube's json parser
    // reject the whole request.
    let clientName: string = parsed.client.clientName;
    let clientVersion: string = parsed.client.clientVersion;
    if (clientName === 'WEB_REMIX' && clientVersion.startsWith('1.')) {
      clientName = 'WEB';
      const datePart = clientVersion.slice(2).split('.')[0];
      clientVersion = `2.${datePart}.00.00`;
    }
    const ctx: ClientContext = {
      client: {
        clientName,
        clientVersion,
        hl: parsed.client.hl ?? 'en',
        gl: parsed.client.gl ?? 'US',
        userAgent: parsed.client.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
      },
    };
    console.info(`[ytm-comments] harvested client context: ${clientName} ${clientVersion}`);
    return ctx;
  } catch (e) {
    warnOnce('ctx-harvest-failed', 'client context harvest failed:', e);
    return null;
  }
}

export async function getClientContext(): Promise<ClientContext> {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < STORAGE_TTL_MS) {
    return memoryCache.value;
  }
  const cached = await readSessionCache();
  if (cached) return cached;
  // never serve the stale hardcoded fallback on a cold read path — a 2.5-year-old
  // clientVersion makes youtube return comments WITHOUT the engagement toolbar
  // surface (no likeCommand), which silently downgrades liking. harvest a live
  // context first; only fall back if the harvest itself fails.
  const live = await harvestLiveContext();
  if (live) {
    await writeSessionCache(live);
    return live;
  }
  return FALLBACK_CLIENT_CONTEXT;
}

export async function refreshClientContext(): Promise<ClientContext> {
  const live = await harvestLiveContext();
  if (live) {
    await writeSessionCache(live);
    return live;
  }
  return FALLBACK_CLIENT_CONTEXT;
}
