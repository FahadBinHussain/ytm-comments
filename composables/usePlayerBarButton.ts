import { onScopeDispose, watch, type Ref } from 'vue';
import { warnOnce } from '@/lib/log';

const BUTTON_ID = 'ytm-comments-injected-button';
const STYLE_ID = 'ytm-comments-injected-style';

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" focusable="false" aria-hidden="true" style="pointer-events:none;display:inherit;width:100%;height:100%"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>`;

// what the player bar actually looks like right now — logged when injection
// fails, so a console paste pins the exact DOM break instead of guessing
function observedStructure(): string {
  const mcb = document.querySelector('ytmusic-player-bar .middle-controls-buttons');
  return JSON.stringify({
    playerBar: !!document.querySelector('ytmusic-player-bar'),
    miniplayer: !!document.querySelector('ytmusic-miniplayer'),
    miniActionBar: !!document.querySelector('.ytMusicMiniPlayerActionBar'),
    mcbChildren: mcb ? [...mcb.children].map((c) => c.tagName.toLowerCase()).join(',') : null,
  });
}

// ytm music reshapes the player bar in updates. anchor order:
// 1. the menu renderer (original target) — only stamped when yt serves
//    currentItem.menu, so it can vanish while the bar itself is intact
// 2. the like button — unconditional child of middle-controls-buttons
// 3. middle-controls-buttons itself
// 4. the new lit miniplayer's action bar (yt replaced the top bar with
//    ytmusic-miniplayer behind isMiniplayerEnabled — no middle-controls there)
// a non-primary strategy logs loudly once (data-ytm-anchor-strategy on the
// host records it for inspection too); total failure logs the observed DOM.
function placeButton(host: HTMLElement): string | null {
  const mcb = document.querySelector('ytmusic-player-bar .middle-controls-buttons') as HTMLElement | null;
  if (mcb) {
    const menu = mcb.querySelector(':scope > ytmusic-menu-renderer') as HTMLElement | null;
    if (menu) {
      menu.before(host);
      return 'player-bar menu-renderer';
    }
    const like = mcb.querySelector(':scope > ytmusic-like-button-renderer') as HTMLElement | null;
    if (like) {
      like.after(host);
      return 'player-bar like-button (menu renderer not stamped)';
    }
    mcb.append(host);
    return 'player-bar middle-controls-buttons (like + menu both missing)';
  }
  const miniBar = document.querySelector('.ytMusicMiniPlayerActionBar') as HTMLElement | null;
  if (miniBar) {
    (miniBar.shadowRoot ?? miniBar).append(host);
    return miniBar.shadowRoot ? 'miniplayer action bar (shadow root)' : 'miniplayer action bar';
  }
  return null;
}

function ensureGlobalStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    yt-button-shape#${BUTTON_ID} {
      position: relative;
      margin-left: 8px;
    }
    yt-button-shape#${BUTTON_ID}.ytm-active::after {
      content: '';
      position: absolute;
      bottom: 4px;
      left: 50%;
      transform: translateX(-50%);
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background-color: currentColor;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function createButton(onClick: () => void): HTMLElement {
  const shape = document.createElement('yt-button-shape');
  shape.id = BUTTON_ID;
  shape.className = 'style-scope ytmusic-menu-renderer';

  shape.innerHTML = `
    <button
      class="ytSpecButtonShapeNextHost ytSpecButtonShapeNextText ytSpecButtonShapeNextMono ytSpecButtonShapeNextSizeM ytSpecButtonShapeNextIconButton ytSpecButtonShapeNextEnableBackdropFilterExperiment"
      title="Comments"
      aria-label="Comments"
      aria-pressed="false"
      type="button"
    >
      <div aria-hidden="true" class="ytSpecButtonShapeNextIcon">
        <span class="ytIconWrapperHost" style="width: 24px; height: 24px;">
          <span class="yt-icon-shape ytSpecIconShapeHost">
            <div style="width: 100%; height: 100%; display: block; fill: currentcolor;">
              ${ICON_SVG}
            </div>
          </span>
        </span>
      </div>
      <yt-touch-feedback-shape aria-hidden="true" class="ytSpecTouchFeedbackShapeHost ytSpecTouchFeedbackShapeTouchResponse">
        <div class="ytSpecTouchFeedbackShapeStroke"></div>
        <div class="ytSpecTouchFeedbackShapeFill"></div>
      </yt-touch-feedback-shape>
    </button>
  `;

  // listener on the SHAPE, not the inner button: a click landing on the
  // shape's own padding (or any synthetic .click() on the shape) has no
  // listener on the inner button, bubbles straight into yt's
  // ytVideoActionBarViewModelHost when the miniplayer anchor is used, and
  // that handler routes watch -> / within ~1ms. stopping at the shape
  // covers inner-button clicks (they bubble through it) and shape clicks.
  shape.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });

  return shape;
}

function applyActive(host: HTMLElement | null, active: boolean) {
  if (!host) return;
  host.classList.toggle('ytm-active', active);
  const btn = host.querySelector('button');
  btn?.setAttribute('aria-pressed', String(active));
}

function applyVisibility(host: HTMLElement | null, visible: boolean) {
  if (!host) return;
  host.style.display = visible ? '' : 'none';
}

export function usePlayerBarButton(
  active: Ref<boolean>,
  visible: Ref<boolean>,
  onClick: () => void,
) {
  let observer: MutationObserver | null = null;

  function inject(): HTMLElement | null {
    const existing = document.getElementById(BUTTON_ID);
    if (existing) return existing;
    ensureGlobalStyle();
    const host = createButton(onClick);
    const strategy = placeButton(host);
    if (!strategy) {
      warnOnce(
        'anchor-missing',
        'comments button NOT injected — no player bar anchor found. observed:',
        observedStructure(),
      );
      return null;
    }
    host.setAttribute('data-ytm-anchor-strategy', strategy);
    if (strategy !== 'player-bar menu-renderer') {
      warnOnce(
        `anchor-strategy ${strategy}`,
        'yt music player bar DOM changed — comments button placed via non-primary anchor:',
        strategy,
      );
    }
    applyActive(host, active.value);
    applyVisibility(host, visible.value);
    return host;
  }

  inject();

  observer = new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID)) {
      const host = inject();
      if (host) {
        applyActive(host, active.value);
        applyVisibility(host, visible.value);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  watch(
    active,
    (v) => applyActive(document.getElementById(BUTTON_ID), v),
    { immediate: true },
  );
  watch(
    visible,
    (v) => applyVisibility(document.getElementById(BUTTON_ID), v),
    { immediate: true },
  );

  onScopeDispose(() => {
    observer?.disconnect();
    document.getElementById(BUTTON_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  });
}
