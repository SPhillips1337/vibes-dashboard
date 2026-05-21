/* ═══════════════════════════════════════
   Vibes Dashboard — Web Browser Module Script
   ═══════════════════════════════════════ */

(function () {
  'use strict';

  let viewPanel = null;
  let btnBack = null;
  let btnForward = null;
  let btnReload = null;
  let inputAddress = null;
  let iframe = null;
  let bookmarkPills = [];

  function initDOM() {
    viewPanel = document.getElementById('view-web-browser');
    if (!viewPanel) return false;
    btnBack = viewPanel.querySelector('#browser-back');
    btnForward = viewPanel.querySelector('#browser-forward');
    btnReload = viewPanel.querySelector('#browser-reload');
    inputAddress = viewPanel.querySelector('#browser-address');
    iframe = viewPanel.querySelector('#browser-iframe');
    bookmarkPills = viewPanel.querySelectorAll('.bookmark-pill');
    return true;
  }

  function bindEvents() {
    if (!initDOM()) return;

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

    inputAddress.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        let url = inputAddress.value.trim();
        if (url) {
          if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
            url = 'https://' + url;
          }
          iframe.src = url;
          inputAddress.value = url;
          
          // Clear active states on bookmarks unless it matches
          bookmarkPills.forEach(p => {
            const purl = p.getAttribute('data-url');
            p.classList.toggle('active', purl === url);
          });
        }
      }
    });

    bookmarkPills.forEach(pill => {
      pill.addEventListener('click', () => {
        if (window.vibePlayer) window.vibePlayer.playClick();
        const url = pill.getAttribute('data-url');
        iframe.src = url;
        inputAddress.value = url;

        bookmarkPills.forEach(p => p.classList.toggle('active', p === pill));
      });
    });

    iframe.addEventListener('load', () => {
      try {
        if (iframe.contentWindow) {
          const loc = iframe.contentWindow.location;
          // If loaded same-origin, sync the input address bar
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
  }

  // Try to bind early
  setTimeout(bindEvents, 100);

  // Re-bind when view is displayed
  document.addEventListener('dashboard:view-changed', (e) => {
    if (e.detail.id === 'web-browser') {
      if (!iframe) bindEvents();
    }
  });

})();
