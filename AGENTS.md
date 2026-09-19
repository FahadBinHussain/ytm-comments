# ytm-comments — agent notes

## like support (0.2.1)

- **root cause of "Like not available for this comment" (0.2.0)**: the `/youtubei/v1/next` fetches never sent the `Authorization: SAPISIDHASH` header. YouTube only returns `engagementToolbarSurfaceEntityPayload` (which holds `likeCommand`/`unlikeCommand`) to *authenticated* requests. cookies alone were enough for locale + like *state* in some cases but not the like *commands*. fix: `postRaw()` now spreads `buildAuthHeaders()` into every request, so the primary path carries the surface commands.
- liking uses `POST https://www.youtube.com/youtubei/v1/comment/perform_comment_action` — same `context` as `youtubei/v1/next` but needs extra auth headers. `host_permissions` for `https://www.youtube.com/*` already covers it.
- auth: `Authorization: SAPISIDHASH <timestamp>_<sha1(timestamp + ' ' + SAPISID + ' https://www.youtube.com')>` from `SAPISID` or `__Secure-3PAPISID` cookie. generate via `crypto.subtle.digest('SHA-1', ...)` in `lib/auth.ts`. also send `X-Goog-AuthUser: 0` and `X-Goog-Visitor-Id: VISITOR_INFO1_LIVE` if present. `credentials: 'include'` still required so cookies go through. without `SAPISID` the endpoint returns 401 — surface as `Sign in to YouTube to like comments` not silent.
- payload shape: toolbar surface entity (`engagementToolbarSurfaceEntityPayload`) contains `likeCommand` / `unlikeCommand` wrapping `performCommentActionEndpoint`. don't invent proto — reuse the command object youtube returns. `lib/youtubeApi.ts:performCommentAction` tries 3 body variants (raw spread, inner endpoint, actions array) and fails LOUDLY on last variant if all 400. no fallback to fake success.
- parsing: `frameworkUpdates.entityBatchUpdate.mutations` contains 3 payload types: `commentEntityPayload`, `engagementToolbarStateEntityPayload` (`likeState === TOOLBAR_LIKE_STATE_LIKED`), `engagementToolbarSurfaceEntityPayload` (`likeCommand`/`unlikeCommand`/`prepareAccountCommand`). original `lib/parseComments.ts` only kept first two, so like state/commands were lost. now `buildEntityMaps()` keeps all three and maps `commentId -> state/surface` by `entityKey.includes(commentId)` with `JSON.stringify(v).includes(commentId)` brute-force fallback — keys are `comment_toolbar_state.<id>` style but yt reshapes yearly.
- ui: `components/CommentItem.vue` and `ReplyList.vue` do optimistic toggle — flip `isLiked` + `likeCount` (+1/-1 if numeric else keep string), store `likedAnim` for 300ms scale 1.35, rollback on catch and show `role="alert"` error. button disabled when `!canLike` (surface has `prepareAccountCommand`). all icons have motion (`transform` + `transition: cubic-bezier(0.34,1.56,0.64,1)`).
- types: `Comment`/`Reply` now `isLiked`, `isDisliked`, `canLike`, `likeCommand`, `unlikeCommand`.
- fallback policy: if the surface command is still missing after auth, `performFallbackLikeById()` tries a synthetic `commentId`-keyed body (4 shape variants). this 2nd method is shown LOUDLY as an amber `FALLBACK: synthetic commentId method` badge next to the button — it never pretends to be the primary path, and any failure rolls back + shows the server's own error text. per global rule, no silent fallback ever.
- debug: **all diagnostics go through `lib/log.ts` `warnOnce(key, ...)`** — each key logs once per page load. edge hides `console.debug` by default, and the parse path runs per comment thread, so an unguarded `console.warn` floods the console within one scroll (the gated-surface warn alone fired ~20 times per page). keys in use: `request auth headers`, `AUTH PROBE <label>` (`probeAuthState`, one-shot via `_authProbed`), `parse debug`, `surface-gated`, `surface-prepare-coexist`, `performCommentAction payload`, `like-blocked` / `reply-like-blocked`, `ctx-harvest-*`. check these in the music.youtube.com tab console (page console, not the extension popup) when like misbehaves.
- **chrome.storage.local is a dead diagnostic transport here**: `browser.storage.local.set` succeeds but edge's leveldb (`User Data/Default/Local Extension Settings/<id>/000003.log`) never flushed to disk — the file stayed 0 bytes for hours, even across extension reloads. do not bring back the `ytmDebugParse`/`ytmDebugLike` stash; console pastes are the only channel that works.

## windows / pnpm quirks

- `pnpm install` on this machine fails with `[ERR_PNPM_IGNORED_BUILDS] esbuild` due to ignored-builds policy. don't run `pnpm install` before compile. use `npx vue-tsc --noEmit` and `npx wxt build` directly — they succeed without install. if you must install, run `pnpm install --ignore-scripts` or approve builds, but CI doesn't need it.
- `npx wxt build` writes `.output/chrome-mv3/` — load unpacked from there. `pnpm zip` still works but wraps extra github zip.

## manifest version bump

- version is derived from `package.json:version`. bump it (patch for fixes, minor for features like like support) in same commit as code — tampermonkey/browser update checks only fire on higher version.

## fragile file

- `lib/parseComments.ts` — yt reshapes `frameworkUpdates` paths a few times a year. keep `?.` chains and fallback brute-force `includes(commentId)` check.
