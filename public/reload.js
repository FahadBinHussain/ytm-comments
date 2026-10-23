// reload.js - dev-loop helper behind public/reload.html (opened by
// tools/reload-extension.ps1 after rebuilding, INCLUDING manifest.json
// version bumps). Extensions Reloader can NOT pick up manifest changes - it
// only flips chrome.management.setEnabled off/on, which never re-reads the
// manifest from disk (its own README says so). chrome.runtime.reload() called
// from INSIDE the extension re-loads from disk, exactly like the
// chrome://extensions reload button. no new permissions needed.
try {
  chrome.runtime.sendMessage({ type: 'selfReload' }, (resp) => {
    const el = document.getElementById('status');
    if (chrome.runtime.lastError) {
      if (el) el.textContent = 'reload failed: ' + chrome.runtime.lastError.message;
    } else if (!resp || resp.ok !== true) {
      if (el)
        el.textContent =
          'running version has no self-reload yet - hit reload on chrome://extensions once, then this page works.';
    } else if (el) {
      el.textContent =
        'reloading… this tab goes to about:blank - check chrome://extensions for the new version.';
    }
  });
} catch (e) {
  const el = document.getElementById('status');
  if (el) el.textContent = 'reload failed: ' + String(e && e.message ? e.message : e);
}
