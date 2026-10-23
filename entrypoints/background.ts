// background entrypoint — hosts the dev-loop self-reload helper.
// tools/reload-extension.ps1 opens public/reload.html, which messages here
// with { type: 'selfReload' }. we blank the sender tab, then call
// browser.runtime.reload() — the real disk re-load (same path as the
// chrome://extensions reload button), so manifest.json version bumps are
// picked up. Extensions Reloader can't do this: it only flips
// management.setEnabled off/on, which never re-reads the manifest.
import { browser } from 'wxt/browser';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'selfReload') return;

    const tabId = sender?.tab?.id;
    if (typeof tabId === 'number') {
      browser.tabs.update(tabId, { url: 'about:blank' }).catch(() => {});
    }
    sendResponse({ ok: true }); // reply BEFORE reload() - the runtime is torn down by reload(), so a reply sent after it never lands (reload.js would wrongly print "reload failed")
    browser.runtime.reload();
    return true;
  });
});
