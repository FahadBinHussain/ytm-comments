import { getClientContext, refreshClientContext } from './clientContext';
import { getSapisidAuth } from './auth';

const ENDPOINT = 'https://www.youtube.com/youtubei/v1/next?prettyPrint=false';
const PERFORM_ENDPOINT = 'https://www.youtube.com/youtubei/v1/comment/perform_comment_action?prettyPrint=false';

async function postRaw(body: object, signal?: AbortSignal): Promise<any> {
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
  return res.json();
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

export async function buildAuthHeaders(): Promise<Record<string, string>> {
  const auth = await getSapisidAuth();
  const headers: Record<string, string> = {};
  if (auth) {
    headers['authorization'] = auth;
    headers['x-goog-authuser'] = '0';
  }
  // visitor id helps youtube route correctly; not required but cheap
  try {
    const m = document.cookie.match(/(?:^|; )VISITOR_INFO1_LIVE=([^;]*)/);
    if (m) headers['x-goog-visitor-id'] = decodeURIComponent(m[1]);
  } catch {}
  // ytmusic sometimes expects origin
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
    console.warn(`[ytm-comments] fallback like variant ${i + 1}/${variants.length} for ${commentId} ->`, JSON.stringify(body).slice(0, 400));
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
      lastErr = `fallback rejected: ${JSON.stringify(json).slice(0, 500)}`;
    } else {
      const txt = await res.text().catch(() => '');
      lastErr = `fallback failed ${res.status} ${txt.slice(0, 300)}`;
    }
  }
  throw new Error(lastErr ?? 'fallback like failed');
}
