import { getClientContext, refreshClientContext } from './clientContext';
import { getSapisidAuth, getVisitorData } from './auth';
import { warnOnce } from './log';
import { storage } from '#imports';

const ENDPOINT = 'https://www.youtube.com/youtubei/v1/next?prettyPrint=false';
const PERFORM_ENDPOINT = 'https://www.youtube.com/youtubei/v1/comment/perform_comment_action?prettyPrint=false';

// visitor data: youtube serves the anonymous engagement surface (inert
// innertubeCommand placeholders + "sign in to continue") to requests that
// carry a valid SAPISIDHASH but no visitor data — yt-dlp/YouTube.js both
// capture responseContext.visitorData and echo it as X-Goog-Visitor-Id.
// there is no VISITOR_INFO1_LIVE cookie on music.youtube.com, so the only
// source is the api response itself, persisted for the next page load.
const VISITOR_KEY = 'session:ytm-comments-visitor-data' as const;
let _visitorData: string | null = null;
let _visitorLoaded = false;

async function loadCachedVisitorData(): Promise<void> {
  if (_visitorLoaded) return;
  _visitorLoaded = true;
  try {
    _visitorData = (await storage.getItem<string>(VISITOR_KEY)) ?? null;
  } catch {}
}

async function rememberVisitorData(vd: string): Promise<void> {
  if (_visitorData === vd) return;
  _visitorData = vd;
  try {
    await storage.setItem(VISITOR_KEY, vd);
  } catch {}
}

async function postRaw(body: object, signal?: AbortSignal): Promise<any> {
  await loadCachedVisitorData();
  const context = await getClientContext();
  const extra = await buildAuthHeaders();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-youtube-client-name': '1',
      'x-youtube-client-version': context.client.clientVersion,
      ...extra,
    },
    body: JSON.stringify({ context, ...body }),
  });
  if (!res.ok) throw new Error(`youtube api ${res.status}`);
  const json = await res.json();
  const vd = json?.responseContext?.visitorData;
  if (typeof vd === 'string' && vd) void rememberVisitorData(vd);
  return json;
}

export async function post(body: object, signal?: AbortSignal): Promise<any> {
  try {
    const json = await postRaw(body, signal);
    if (!isPlausibleResponse(json)) {
      await refreshClientContext();
      return postRaw(body, signal);
    }
    return json;
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    await refreshClientContext();
    return postRaw(body, signal);
  }
}

function isPlausibleResponse(json: any): boolean {
  if (!json || typeof json !== 'object') return false;
  if (json.contents || json.onResponseReceivedEndpoints || json.frameworkUpdates) return true;
  return false;
}

export const fetchWatchNext = (videoId: string, signal?: AbortSignal) =>
  post({ videoId }, signal);

export const fetchContinuation = (continuation: string, signal?: AbortSignal) =>
  post({ continuation }, signal);

// DECISIVE diagnostic: hit an endpoint whose ONLY success condition is valid
// auth (no body shape to confound the result). distinguishes "auth broken on
// the wire" (fix hash/cookies) from "auth fine but engagement surface gated
// cross-origin" (fix request context - route via background worker).
let _authProbed = false;
export async function probeAuthState(): Promise<void> {
  if (_authProbed) return;
  _authProbed = true;
  const context = await getClientContext();

  // probe A: same-origin control - music.youtube.com from a music page. no
  // CORS, cookies guaranteed, no Origin header. if this is ALSO logged_out,
  // the hash itself is broken and cross-origin is irrelevant.
  await probeAccountMenu('A same-origin(music)', 'https://music.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false', context, true);
  // probe B: cross-origin www with the current header set (authuser=0)
  await probeAccountMenu('B cross-origin(www) authuser=0', 'https://www.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false', context, true);
  // probe C: cross-origin www WITHOUT x-goog-authuser - in multi-account
  // profiles authuser=0 can point at an empty slot, which youtube reports as
  // logged_out even with a valid sid hash.
  await probeAccountMenu('C cross-origin(www) no-authuser', 'https://www.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false', context, false);
}

async function probeAccountMenu(label: string, url: string, context: any, sendAuthuser: boolean): Promise<void> {
  try {
    const extra = await buildAuthHeaders();
    if (!sendAuthuser) delete extra['x-goog-authuser'];
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-youtube-client-name': '1',
        'x-youtube-client-version': context.client.clientVersion,
        ...extra,
      },
      body: JSON.stringify({ context }),
    });
    const text = await res.text();
    const authed = res.ok && /"logged_in","1"|"logged_in":1/.test(text);
    console.warn(`[ytm-comments] AUTH PROBE ${label}: status=${res.status} authed=${authed}`);
  } catch (e) {
    console.warn(`[ytm-comments] AUTH PROBE ${label} threw:`, e);
  }
}

export async function buildAuthHeaders(): Promise<Record<string, string>> {
  await loadCachedVisitorData();
  const auth = await getSapisidAuth();
  const headers: Record<string, string> = {};
  if (auth) {
    headers['authorization'] = auth;
    headers['x-goog-authuser'] = '0';
  }
  // visitor data: prefer the value captured from a previous api response
  // (music.youtube.com has no VISITOR_INFO1_LIVE cookie); fall back to the
  // cookie when present. without this youtube serves the signed-out surface.
  const vd = _visitorData ?? getVisitorData();
  if (vd) headers['x-goog-visitor-id'] = vd;
  // diagnostic only (never log the hash value itself). warnOnce: this fires
  // on every /next fetch while scrolling, which buried every other signal.
  warnOnce('request auth headers', {
    hasAuthorization: !!headers['authorization'],
    hasVisitorId: !!headers['x-goog-visitor-id'],
    hasSapisidCookie: typeof document !== 'undefined' && /(?:^|; )SAPISID=/.test(document.cookie),
  });
  return headers;
}

function extractActionPayload(cmd: any): any {
  if (!cmd || typeof cmd !== 'object') return null;
  // cmd may be raw endpoint payload stored from surface entity
  // shapes seen:
  // { clickTrackingParams, commandMetadata: { webCommandMetadata: { apiUrl } }, performCommentActionEndpoint: { action, ... } }
  // { performCommentActionEndpoint: {...} }
  // { action, actions, clientActionsParam, ... }
  // we want the innertube usable payload without metadata
  if (cmd.performCommentActionEndpoint) return { ...cmd, performCommentActionEndpoint: cmd.performCommentActionEndpoint };
  // if it's already the inner payload
  if (cmd.action || cmd.actions) return cmd;
  // if it's wrapped in serviceEndpoint
  if (cmd.serviceEndpoint?.performCommentActionEndpoint) return cmd.serviceEndpoint;
  // fallback: return as-is
  return cmd;
}

export async function performCommentAction(likeCommand: any, signal?: AbortSignal): Promise<any> {
  const context = await getClientContext();
  const payload = extractActionPayload(likeCommand);
  if (!payload) throw new Error('missing like command payload');
  warnOnce(
    'performCommentAction payload',
    `client ${context.client.clientName} ${context.client.clientVersion}`,
    'input=', JSON.stringify(likeCommand).slice(0, 1200),
    'extracted=', JSON.stringify(payload).slice(0, 1200),
  );

  const extra = await buildAuthHeaders();

  // build up to 3 body variants to handle payload shape drift — no silent fallback, each variant tried visibly
  const variants: any[] = [];
  // variant 1: raw spread (most likely matches YouTube.js command wrapper)
  variants.push({ context, ...payload });
  // variant 2: inner endpoint only + clickTrackingParams
  if (payload.performCommentActionEndpoint) {
    const inner = payload.performCommentActionEndpoint;
    const v2: any = { context, ...inner };
    if (payload.clickTrackingParams) v2.clickTrackingParams = payload.clickTrackingParams;
    // normalize action -> actions
    if (inner.action && !inner.actions) {
      v2.actions = [inner.action];
      delete v2.action;
    }
    variants.push(v2);
    // variant 2b: with actions wrapper explicitly
    if (inner.actions) variants.push({ context, actions: inner.actions, clickTrackingParams: payload.clickTrackingParams });
  }
  // variant 3: if payload already has actions/action at top level, ensure actions array form
  if (payload.actions || payload.action) {
    const v3: any = { context, ...payload };
    if (payload.action && !payload.actions) {
      v3.actions = [payload.action];
      delete v3.action;
    }
    if (!variants.some((v) => JSON.stringify(v) === JSON.stringify(v3))) variants.push(v3);
  }

  let lastErr: string | null = null;
  for (let i = 0; i < variants.length; i++) {
    const body = variants[i];
    const res = await fetch(PERFORM_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-youtube-client-name': '1',
        'x-youtube-client-version': context.client.clientVersion,
        ...extra,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      if (json?.error || json?.responseContext?.errors) {
        const msg = `like rejected: ${JSON.stringify(json).slice(0, 500)}`;
        // if this was not last variant, try next; else throw LOUD
        if (i < variants.length - 1) {
          lastErr = msg;
          continue;
        }
        throw new Error(msg);
      }
      return json;
    }
    const txt = await res.text().catch(() => '');
    lastErr = `like failed ${res.status} ${txt.slice(0, 400)} (variant ${i + 1}/${variants.length})`;
    if (i === variants.length - 1) throw new Error(lastErr);
    // else try next variant LOUDLY would be visible if all fail; individual retries are internal but final error shows variant count
  }
  throw new Error(lastErr ?? 'like failed: no variants');
}

// optimistic helper used by UI: toggles like via appropriate command
export async function toggleLike(comment: { isLiked: boolean; likeCommand: any; unlikeCommand: any }): Promise<any> {
  const cmd = comment.isLiked ? comment.unlikeCommand : comment.likeCommand;
  if (!cmd) throw new Error(comment.isLiked ? 'unlike not available — are you signed in?' : 'like not available — are you signed in?');
  return performCommentAction(cmd);
}

// fallback synthetic like via commentId when surface command missing (debug aid — shows loud fallback badge)
// tries naive shapes; if youtube changes proto this will 4xx and surface loud error with variant count
export async function performFallbackLikeById(commentId: string, unlike: boolean, signal?: AbortSignal): Promise<any> {
  const context = await getClientContext();
  const extra = await buildAuthHeaders();
  const actionName = unlike ? 'ACTION_UNLIKE_COMMENT' : 'ACTION_LIKE_COMMENT';
  const variants: any[] = [
    { context, actions: [actionName], commentId },
    { context, action: actionName, commentId },
    { context, commentId, action: actionName },
    { context, actions: [{ action: actionName, commentId }] },
  ];
  let lastErr: string | null = null;
  for (let i = 0; i < variants.length; i++) {
    const body = variants[i];
    const res = await fetch(PERFORM_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-youtube-client-name': '1',
        'x-youtube-client-version': context.client.clientVersion,
        ...extra,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      if (!json?.error) return json;
      lastErr = `fallback rejected (variant ${i + 1}/${variants.length}): ${JSON.stringify(json).slice(0, 500)}`;
      warnOnce(`fallback-rejected-${i}`, `fallback variant ${i + 1}/${variants.length} rejected`, json);
    } else {
      const txt = await res.text().catch(() => '');
      lastErr = `fallback failed ${res.status} ${txt.slice(0, 300)} (variant ${i + 1}/${variants.length})`;
      warnOnce(`fallback-failed-${i}`, `fallback variant ${i + 1}/${variants.length} failed ${res.status}`, txt.slice(0, 300));
    }
  }
  throw new Error(lastErr ?? 'fallback like failed');
}
