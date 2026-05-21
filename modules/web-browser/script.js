/* ═══════════════════════════════════════
   Vibes Dashboard — Web Browser Module Script
   Window management, dock tabs, minimize/close
   ═══════════════════════════════════════ */

(function () {
  'use strict';

  let viewPanel = null;
  let browserContainer = null;
  let emptyState = null;
  let btnBack = null;
  let btnForward = null;
  let btnReload = null;
  let btnMinimize = null;
  let btnClose = null;
  let inputAddress = null;
  let iframe = null;
  let bookmarkPills = [];
  let dockContainer = null;

  // Track minimized tabs: Map<tabId, { url, title, element }>
  let tabIdCounter = 0;
  const dockedTabs = new Map();

  function initDOM() {
    viewPanel = document.getElementById('view-web-browser');
    if (!viewPanel) return false;
    browserContainer = viewPanel.querySelector('.browser-container');
    emptyState = viewPanel.querySelector('#browser-empty-state');
    btnBack = viewPanel.querySelector('#browser-back');
    btnForward = viewPanel.querySelector('#browser-forward');
    btnReload = viewPanel.querySelector('#browser-reload');
    btnMinimize = viewPanel.querySelector('#browser-minimize');
    btnClose = viewPanel.querySelector('#browser-close');
    inputAddress = viewPanel.querySelector('#browser-address');
    iframe = viewPanel.querySelector('#browser-iframe');
    bookmarkPills = viewPanel.querySelectorAll('.bookmark-pill');
    dockContainer = document.getElementById('browser-dock');
    return true;
  }

  // ── Title Derivation ──
  function deriveTitle(url) {
    if (!url) return 'Untitled';
    try {
      // Local start page
      if (url.includes('/modules/web-browser/start.html')) return 'Vibes Portal';

      // Try to extract hostname from full URLs
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const parsed = new URL(url);
        let host = parsed.hostname.replace(/^www\./, '');
        // Capitalize first letter
        return host.charAt(0).toUpperCase() + host.slice(1);
      }

      // Relative path — extract last segment
      const segments = url.split('/').filter(Boolean);
      if (segments.length > 0) {
        const last = segments[segments.length - 1];
        return last.replace(/\.[^.]+$/, ''); // strip extension
      }
    } catch (_) {
      // Fall through
    }
    return 'Web Page';
  }

  function getCurrentUrl() {
    try {
      if (iframe && iframe.contentWindow) {
        const loc = iframe.contentWindow.location;
        if (loc.href.startsWith(window.location.origin)) {
          return loc.pathname + loc.search + loc.hash;
        }
        return loc.href;
      }
    } catch (_) {
      // Cross-origin — fall back to address bar
    }
    return inputAddress ? inputAddress.value : '/modules/web-browser/start.html';
  }

  // ── Show / Hide Browser Window ──
  function showBrowserWindow() {
    if (browserContainer) {
      browserContainer.classList.remove('hidden', 'minimizing');
      // Re-trigger entry animation
      browserContainer.style.animation = 'none';
      // Force reflow
      void browserContainer.offsetHeight;
      browserContainer.style.animation = '';
    }
    if (emptyState) emptyState.classList.add('hidden');
  }

  function hideBrowserWindow(animate) {
    if (!browserContainer) return;

    if (animate) {
      browserContainer.classList.add('minimizing');
      // Wait for animation to finish before hiding
      setTimeout(() => {
        browserContainer.classList.add('hidden');
        browserContainer.classList.remove('minimizing');
      }, 400);
    } else {
      browserContainer.classList.add('hidden');
    }

    if (emptyState) emptyState.classList.remove('hidden');
  }

  // ── Dock Tab Management ──
  function createDockTab(tabId, title, url) {
    const tab = document.createElement('div');
    tab.className = 'dock-tab';
    tab.dataset.tabId = String(tabId);

    const icon = document.createElement('span');
    icon.className = 'dock-tab-icon';
    icon.textContent = '🌐';
    tab.appendChild(icon);

    const titleEl = document.createElement('span');
    titleEl.className = 'dock-tab-title';
    titleEl.textContent = title;
    tab.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'dock-tab-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close tab';
    tab.appendChild(closeBtn);

    // Click tab body → restore
    tab.addEventListener('click', (e) => {
      if (e.target === closeBtn) return; // handled below
      if (window.vibePlayer) window.vibePlayer.playClick();
      restoreFromDock(tabId);
    });

    // Click close → remove tab without restoring
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.vibePlayer) window.vibePlayer.playClick();
      removeDockTab(tabId);
    });

    return tab;
  }

  function minimizeWindow() {
    const url = getCurrentUrl();
    const title = deriveTitle(url);
    const tabId = ++tabIdCounter;

    const tabEl = createDockTab(tabId, title, url);
    dockedTabs.set(tabId, { url, title, element: tabEl });

    if (dockContainer) {
      dockContainer.appendChild(tabEl);
    }

    hideBrowserWindow(true);

    if (window.bgEffect) window.bgEffect.pulse();
  }

  function restoreFromDock(tabId) {
    const tab = dockedTabs.get(tabId);
    if (!tab) return;

    // Switch to web-browser view if not already there
    if (window.Dashboard && window.Dashboard.activeModuleId !== 'web-browser') {
      window.Dashboard.showView('web-browser');
    }

    // Load URL
    if (iframe) {
      iframe.src = tab.url;
    }
    if (inputAddress) {
      inputAddress.value = tab.url;
    }

    // Update bookmark pill active state
    if (bookmarkPills) {
      bookmarkPills.forEach(p => {
        const purl = p.getAttribute('data-url');
        p.classList.toggle('active', purl === tab.url);
      });
    }

    showBrowserWindow();
    removeDockTab(tabId);

    if (window.bgEffect) window.bgEffect.pulse();
  }

  function removeDockTab(tabId) {
    const tab = dockedTabs.get(tabId);
    if (tab && tab.element && tab.element.parentNode) {
      tab.element.style.transition = 'opacity 0.2s, transform 0.2s';
      tab.element.style.opacity = '0';
      tab.element.style.transform = 'translateY(10px) scale(0.8)';
      setTimeout(() => {
        if (tab.element.parentNode) tab.element.parentNode.removeChild(tab.element);
      }, 200);
    }
    dockedTabs.delete(tabId);
  }

  function closeWindow() {
    // Reset iframe to start page
    if (iframe) {
      iframe.src = '/modules/web-browser/start.html';
    }
    if (inputAddress) {
      inputAddress.value = '/modules/web-browser/start.html';
    }

    // Update bookmark pills
    if (bookmarkPills) {
      bookmarkPills.forEach(p => {
        const purl = p.getAttribute('data-url');
        p.classList.toggle('active', purl === '/modules/web-browser/start.html');
      });
    }

    hideBrowserWindow(false);

    if (window.bgEffect) window.bgEffect.pulse();
  }

  // ── Bind Events ──
  function bindEvents() {
    if (!initDOM()) return;

    // Navigation buttons
    btnBack.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      try {
        if (iframe.contentWindow && iframe.contentWindow.history) {
          iframe.contentWindow.history.back();
        }
      } catch (e) {
        console.warn('[Browser] Navigation back blocked by cross-origin policy.');
      }
    });

    btnForward.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      try {
        if (iframe.contentWindow && iframe.contentWindow.history) {
          iframe.contentWindow.history.forward();
        }
      } catch (e) {
        console.warn('[Browser] Navigation forward blocked by cross-origin policy.');
      }
    });

    btnReload.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      try {
        iframe.contentWindow.location.reload();
      } catch (e) {
        // Fallback for cross-origin URLs
        const src = iframe.src;
        iframe.src = '';
        iframe.src = src;
      }
    });

    // Address bar
    inputAddress.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        let url = inputAddress.value.trim();
        if (url) {
          if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
            url = 'https://' + url;
          }
          iframe.src = url;
          inputAddress.value = url;

          bookmarkPills.forEach(p => {
            const purl = p.getAttribute('data-url');
            p.classList.toggle('active', purl === url);
          });
        }
      }
    });

    // Bookmark pills
    bookmarkPills.forEach(pill => {
      pill.addEventListener('click', () => {
        if (window.vibePlayer) window.vibePlayer.playClick();
        const url = pill.getAttribute('data-url');
        iframe.src = url;
        inputAddress.value = url;

        bookmarkPills.forEach(p => p.classList.toggle('active', p === pill));
      });
    });

    // Iframe load sync
    iframe.addEventListener('load', () => {
      try {
        if (iframe.contentWindow) {
          const loc = iframe.contentWindow.location;
          if (loc.href.startsWith(window.location.origin)) {
            const relativePath = loc.pathname + loc.search + loc.hash;
            inputAddress.value = relativePath;

            bookmarkPills.forEach(p => {
              const purl = p.getAttribute('data-url');
              p.classList.toggle('active', purl === relativePath);
            });
          } else {
            inputAddress.value = loc.href;
            bookmarkPills.forEach(p => {
              const purl = p.getAttribute('data-url');
              p.classList.toggle('active', purl === loc.href);
            });
          }
        }
      } catch (e) {
        // Cross-origin URL load prevents location inspection, which is expected.
      }
    });

    // ── Window Controls ──
    btnMinimize.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      minimizeWindow();
    });

    btnClose.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      closeWindow();
    });
  }

  // ── Expose Global API ──
  window.BrowserDock = {
    minimize: minimizeWindow,
    restore: function (url) {
      // Find the first docked tab matching the url, or restore generically
      for (const [tabId, tab] of dockedTabs) {
        if (tab.url === url) {
          restoreFromDock(tabId);
          return;
        }
      }
      // If no matching tab, just navigate and show
      if (window.Dashboard && window.Dashboard.activeModuleId !== 'web-browser') {
        window.Dashboard.showView('web-browser');
      }
      if (iframe) iframe.src = url;
      if (inputAddress) inputAddress.value = url;
      showBrowserWindow();
    },
    closeTab: function (url) {
      for (const [tabId, tab] of dockedTabs) {
        if (tab.url === url) {
          removeDockTab(tabId);
          return;
        }
      }
    },
    showBrowserWindow: showBrowserWindow
  };

  // Try to bind early
  setTimeout(bindEvents, 100);

  // Re-bind when view is displayed
  document.addEventListener('dashboard:view-changed', (e) => {
    if (e.detail.id === 'web-browser') {
      if (!iframe) bindEvents();
      // If browser container is visible, no action needed.
      // If hidden (was closed), show empty state.
      if (browserContainer && browserContainer.classList.contains('hidden')) {
        if (emptyState) emptyState.classList.remove('hidden');
      }
    }
  });

})();
