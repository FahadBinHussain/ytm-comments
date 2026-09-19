import type { Comment, CommentsPage, RepliesPage, Reply } from './types';

function collectActions(json: any): any[] {
  const endpoints: any[] = json?.onResponseReceivedEndpoints ?? [];
  const out: any[] = [];
  for (const e of endpoints) {
    const append = e?.appendContinuationItemsAction?.continuationItems;
    const reload = e?.reloadContinuationItemsCommand?.continuationItems;
    if (Array.isArray(append)) out.push(...append);
    if (Array.isArray(reload)) out.push(...reload);
  }
  return out;
}

type EntityMaps = {
  commentById: Map<string, any>;
  stateByKey: Map<string, any>;
  surfaceByKey: Map<string, any>;
  rawMap: Map<string, any>;
};

function buildEntityMaps(json: any): EntityMaps {
  const mutations: any[] = json?.frameworkUpdates?.entityBatchUpdate?.mutations ?? [];
  const commentById = new Map<string, any>();
  const stateByKey = new Map<string, any>();
  const surfaceByKey = new Map<string, any>();
  const rawMap = new Map<string, any>();
  for (const m of mutations) {
    const payload = m?.payload;
    if (!payload) continue;
    const key: string | undefined = m.entityKey ?? payload?.commentEntityPayload?.key ?? payload?.engagementToolbarStateEntityPayload?.key ?? payload?.engagementToolbarSurfaceEntityPayload?.key;
    if (key) rawMap.set(key, payload);
    if (payload.commentEntityPayload) {
      const ce = payload.commentEntityPayload;
      const cid = ce?.properties?.commentId ?? ce?.key ?? key;
      if (typeof cid === 'string' && ce?.properties?.commentId) commentById.set(ce.properties.commentId, ce);
      else if (typeof cid === 'string') commentById.set(cid, ce);
      // also index by entityKey if it looks like comment id
      if (key && typeof key === 'string') rawMap.set(key, payload);
    }
    if (payload.engagementToolbarStateEntityPayload) {
      const sp = payload.engagementToolbarStateEntityPayload;
      const k = key ?? sp?.key ?? '';
      if (k) stateByKey.set(k, sp);
      else stateByKey.set(`state_${stateByKey.size}`, sp);
    }
    if (payload.engagementToolbarSurfaceEntityPayload) {
      const sup = payload.engagementToolbarSurfaceEntityPayload;
      const k = key ?? sup?.key ?? '';
      if (k) surfaceByKey.set(k, sup);
      else surfaceByKey.set(`surface_${surfaceByKey.size}`, sup);
    }
    // also handle generic fallback where payload itself is state/surface without wrapper (rare)
    if (payload.likeState || payload.heartState) {
      const k = key ?? `state_${stateByKey.size}`;
      stateByKey.set(k, payload);
    }
  }
  return { commentById, stateByKey, surfaceByKey, rawMap };
}

function findEntityByCommentId(maps: EntityMaps, commentId: string): any | null {
  if (maps.commentById.has(commentId)) return maps.commentById.get(commentId);
  // fallback brute force search in rawMap
  for (const p of maps.rawMap.values()) {
    const ce = p?.commentEntityPayload;
    if (ce?.properties?.commentId === commentId) return ce;
  }
  return null;
}

function findStateForComment(maps: EntityMaps, commentId: string): any | null {
  // try key contains commentId
  for (const [k, v] of maps.stateByKey.entries()) {
    if (k.includes(commentId)) return v;
    // also check if payload json contains commentId
    try {
      if (JSON.stringify(v).includes(commentId)) return v;
    } catch {}
  }
  // brute rawMap fallback
  for (const p of maps.rawMap.values()) {
    const s = p?.engagementToolbarStateEntityPayload ?? p;
    if (s?.likeState && JSON.stringify(s).includes(commentId)) return s;
    if (s?.heartState && JSON.stringify(s).includes(commentId)) return s;
  }
  return null;
}

function findSurfaceForComment(maps: EntityMaps, commentId: string): any | null {
  for (const [k, v] of maps.surfaceByKey.entries()) {
    if (k.includes(commentId)) return v;
    try {
      if (JSON.stringify(v).includes(commentId)) return v;
    } catch {}
  }
  for (const p of maps.rawMap.values()) {
    const s = p?.engagementToolbarSurfaceEntityPayload;
    if (s && JSON.stringify(s).includes(commentId)) return s;
  }
  return null;
}

function deriveLikeMeta(statePayload: any, surfacePayload: any): { isLiked: boolean; isDisliked: boolean; likeCommand: any | null; unlikeCommand: any | null; canLike: boolean } {
  let isLiked = false;
  let isDisliked = false;
  if (statePayload) {
    const ls = statePayload.likeState ?? statePayload?.toolbarState?.likeState;
    if (ls === 'TOOLBAR_LIKE_STATE_LIKED' || ls === 'LIKED' || ls === 1) isLiked = true;
    else if (ls === 'TOOLBAR_LIKE_STATE_DISLIKED' || ls === 'DISLIKED') isDisliked = true;
  }
  let likeCommand: any | null = null;
  let unlikeCommand: any | null = null;
  let canLike = false;
  if (surfacePayload) {
    // surface may have various casings
    likeCommand = surfacePayload.likeCommand ?? surfacePayload.like_command ?? surfacePayload?.toolbarSurface?.likeCommand ?? null;
    unlikeCommand = surfacePayload.unlikeCommand ?? surfacePayload.unlike_command ?? surfacePayload?.toolbarSurface?.unlikeCommand ?? null;
    // if account not signed in, youtube returns prepareAccountCommand instead
    const hasPrepare = !!(surfacePayload.prepareAccountCommand ?? surfacePayload.prepare_account_command);
    if (hasPrepare) {
      canLike = false;
      // treat likeCommand as null when not signed in to force disabled state; but we keep raw for debug
    } else {
      canLike = !!(likeCommand || unlikeCommand);
      // some responses only include likeCommand when not liked, and unlikeCommand when liked
      // if isLiked and only likeCommand present, unlikeCommand may be in state? we keep whatever we have
    }
    // also fallback: surface may directly be the command itself (unlikely)
    if (!likeCommand && surfacePayload?.performCommentActionEndpoint) {
      // heuristic: if payload looks like it is a command, treat as likeCommand
      likeCommand = surfacePayload;
      canLike = true;
    }
  }
  // normalize isLiked fallback from surface if state missing: presence of unlikeCommand often means already liked
  if (!statePayload && surfacePayload) {
    if (unlikeCommand && !likeCommand) isLiked = true;
  }
  return { isLiked, isDisliked, likeCommand, unlikeCommand, canLike };
}

function toCommentFromEntity(entity: any, maps?: EntityMaps, commentIdOverride?: string): Omit<Comment, 'replyCount' | 'replyContinuation'> | null {
  if (!entity) return null;
  const props = entity.properties ?? {};
  const author = entity.author ?? {};
  const toolbar = entity.toolbar ?? {};
  const commentId = props.commentId ?? commentIdOverride;
  if (!commentId || typeof props?.content?.content !== 'string') return null;

  let isLiked = false;
  let isDisliked = false;
  let canLike = false;
  let likeCommand: any | null = null;
  let unlikeCommand: any | null = null;
  if (maps && commentId) {
    const state = findStateForComment(maps, commentId);
    const surface = findSurfaceForComment(maps, commentId);
    const meta = deriveLikeMeta(state, surface);
    isLiked = meta.isLiked;
    isDisliked = meta.isDisliked;
    likeCommand = meta.likeCommand;
    unlikeCommand = meta.unlikeCommand;
    canLike = meta.canLike;
  }

  // heart is in toolbar.heartActive or state.heartState
  let isHearted = Boolean(toolbar.heartActive);
  if (maps && commentId) {
    const st = findStateForComment(maps, commentId);
    if (st?.heartState === 'TOOLBAR_HEART_STATE_HEARTED') isHearted = true;
    else if (st?.heartState === 'TOOLBAR_HEART_STATE_NOT_HEARTED') isHearted = false;
  }

  // likeCount: prefer appropriate variant
  let likeCount = toolbar.likeCountNotliked ?? toolbar.likeCountLiked ?? '0';
  if (maps && commentId) {
    const st = findStateForComment(maps, commentId);
    // if liked, YouTube sometimes returns likeCountLiked as incremented count
    if (isLiked && toolbar.likeCountLiked) likeCount = toolbar.likeCountLiked;
  }

  return {
    id: commentId,
    author: author.displayName ?? '',
    authorAvatar: author.avatarThumbnailUrl ?? author.channelAvatar?.[0]?.url ?? null,
    authorChannelId: author.channelId ?? null,
    body: props.content.content,
    publishedTime: props.publishedTime ?? '',
    likeCount,
    isHearted,
    isPinned: Boolean(props.pinnedText),
    isLiked,
    isDisliked,
    canLike,
    likeCommand,
    unlikeCommand,
  };
}

export function parseCommentsPage(json: any): CommentsPage {
  const maps = buildEntityMaps(json);
  const actions = collectActions(json);

  const items: Comment[] = [];
  let nextPageToken: string | null = null;
  const sortTokens: { top: string | null; newest: string | null } = { top: null, newest: null };

  for (const action of actions) {
    if (action?.commentThreadRenderer) {
      const thread = action.commentThreadRenderer;
      const commentId =
        thread?.commentViewModel?.commentViewModel?.commentId ??
        thread?.commentViewModel?.commentId ??
        thread?.commentViewModel?.commentKeys?.commentKey ??
        null;
      // also try to extract keys for direct map lookup (if commentViewModel carries keys)
      const keys = thread?.commentViewModel?.commentViewModel ?? thread?.commentViewModel ?? {};
      const toolbarStateKey = keys.toolbarStateKey ?? keys.toolbar_state_key;
      const toolbarSurfaceKey = keys.toolbarSurfaceKey ?? keys.toolbar_surface_key;

      let entity: any | null = null;
      if (commentId) entity = findEntityByCommentId(maps, commentId);
      // fallback: if keys present, try rawMap
      if (!entity && toolbarStateKey && maps.rawMap.has(toolbarStateKey)) {
        // not ideal but try to resolve commentId from state map?
      }
      const base = toCommentFromEntity(entity, maps, commentId ?? undefined);
      if (!base) continue;

      // enrich canLike via keys if we have direct surface
      if (toolbarSurfaceKey) {
        const surf = maps.surfaceByKey.get(toolbarSurfaceKey) ?? maps.rawMap.get(toolbarSurfaceKey)?.engagementToolbarSurfaceEntityPayload;
        if (surf) {
          const meta = deriveLikeMeta(findStateForComment(maps, base.id), surf);
          base.isLiked = meta.isLiked;
          base.isDisliked = meta.isDisliked;
          base.likeCommand = meta.likeCommand;
          base.unlikeCommand = meta.unlikeCommand;
          base.canLike = meta.canLike;
        }
      }
      if (toolbarStateKey) {
        const st = maps.stateByKey.get(toolbarStateKey) ?? maps.rawMap.get(toolbarStateKey)?.engagementToolbarStateEntityPayload;
        if (st) {
          const meta = deriveLikeMeta(st, findSurfaceForComment(maps, base.id));
          base.isLiked = meta.isLiked;
          base.isDisliked = meta.isDisliked;
        }
      }

      const replyCount =
        Number(entity?.toolbar?.replyCount) ||
        Number(thread?.replies?.commentRepliesRenderer?.replyCount) ||
        0;
      const replyContinuation =
        thread?.replies?.commentRepliesRenderer?.contents?.find(
          (c: any) => c?.continuationItemRenderer,
        )?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ?? null;
      items.push({ ...base, replyCount, replyContinuation });
    } else if (action?.continuationItemRenderer) {
      const token =
        action.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (typeof token === 'string') nextPageToken = token;
    } else if (action?.commentsHeaderRenderer) {
      const sub = action.commentsHeaderRenderer?.sortMenu?.sortFilterSubMenuRenderer?.subMenuItems;
      if (Array.isArray(sub)) {
        sortTokens.top = sub[0]?.serviceEndpoint?.continuationCommand?.token ?? null;
        sortTokens.newest = sub[1]?.serviceEndpoint?.continuationCommand?.token ?? null;
      }
    }
  }

  return { items, nextPageToken, sortTokens };
}

export function parseRepliesPage(json: any): RepliesPage {
  const maps = buildEntityMaps(json);
  const actions = collectActions(json);

  const items: Reply[] = [];
  let nextPageToken: string | null = null;

  const fromEntity = (entity: any, commentId?: string): Reply | null => {
    const base = toCommentFromEntity(entity, maps, commentId);
    if (!base) return null;
    const { replyCount: _r, replyContinuation: _c, ...rest } = base as any;
    return rest as Reply;
  };

  const considerView = (commentId: string | undefined) => {
    if (!commentId) return;
    const entity = findEntityByCommentId(maps, commentId);
    const r = fromEntity(entity, commentId);
    if (r) items.push(r);
  };

  for (const action of actions) {
    if (action?.commentViewModel) {
      const id =
        action.commentViewModel?.commentViewModel?.commentId ??
        action.commentViewModel?.commentId;
      considerView(id);
    } else if (action?.commentThreadRenderer) {
      const id =
        action.commentThreadRenderer?.commentViewModel?.commentViewModel?.commentId;
      considerView(id);
    } else if (action?.continuationItemRenderer) {
      const token =
        action.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (typeof token === 'string') nextPageToken = token;
    }
  }

  if (items.length === 0) {
    for (const p of maps.rawMap.values()) {
      const ce = p?.commentEntityPayload;
      if (!ce) continue;
      if (Number(ce?.properties?.replyLevel) >= 1) {
        const r = fromEntity(ce, ce.properties.commentId);
        if (r) items.push(r);
      }
    }
    // also try direct maps
    for (const [cid, ce] of maps.commentById.entries()) {
      if (Number(ce?.properties?.replyLevel) >= 1 && !items.find((x) => x.id === cid)) {
        const r = fromEntity(ce, cid);
        if (r) items.push(r);
      }
    }
  }

  return { items, nextPageToken };
}
