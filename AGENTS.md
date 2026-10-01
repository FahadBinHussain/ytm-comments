# ytm-comments — agent notes

## comments icon anchor (fragile)

- `composables/usePlayerBarButton.ts` injects the icon into the player bar. the primary anchor `.middle-controls-buttons > ytmusic-menu-renderer` broke in the 2026-09 yt music update twice over: the menu renderer now sits in `template is="dom-if" if="[[currentItem.menu]]"` (never stamps when yt stops serving menu data), and `isMiniplayerEnabled` can swap the whole top bar for the lit `ytmusic-miniplayer` (no middle-controls-buttons at all).
- `placeButton()` walks 4 ordered anchors: menu renderer -> like button (unconditional sibling) -> middle-controls-buttons -> `.ytMusicMiniPlayerActionBar`. non-primary strategies log loudly once and stamp `data-ytm-anchor-strategy` on the host; total failure logs the observed DOM structure instead of staying silent.
- against a future yt update: download the live bundle (`https://music.youtube.com/s/<hash>/music_polymer_inlined_html.js`, hash in the homepage html), grep for the anchor classes, and only then touch the selectors.

## client context

- `lib/clientContext.ts` harvests `INNERTUBE_CONTEXT` from the current origin's own page (same-origin, no CORS) instead of the www.youtube.com homepage, which is CORS-blocked from a music content script. extraction walks balanced braces — a non-greedy regex truncates on nested `}` and silently kills JSON.parse.
- the music page serves `WEB_REMIX` (`1.YYYYMMDD.XX.XX`); comment threads are only served to `WEB` (`2.YYYYMMDD.XX.XX`), so the harvest rewrites the name and keeps the date with the canonical `.00.00` build. never serve the hardcoded `2.20240101.00.00` fallback on a cold read path — a stale client version makes yt drop comment framework updates.

## logging

- all diagnostics go through `lib/log.ts` `warnOnce(key, ...)` — each key logs once per page load. edge hides `console.debug` by default, and the parse path runs per comment thread, so an unguarded `console.warn` floods the console within one scroll.

## windows / pnpm quirks

- `pnpm install` on this machine fails with `[ERR_PNPM_IGNORED_BUILDS] esbuild`. use `npx vue-tsc --noEmit` (or `npm run compile`) and `npx wxt build` directly — they succeed without install.
- `npx wxt build` writes `.output/chrome-mv3/` — load unpacked from there.

## manifest version bump

- version is derived from `package.json:version`. bump it in the same commit as code — browser update checks only fire on a higher version.

## fragile file

- `lib/parseComments.ts` — yt reshapes `frameworkUpdates` paths a few times a year. keep `?.` chains and the brute-force `includes(commentId)` fallback.
