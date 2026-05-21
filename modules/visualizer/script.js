/* ═══════════════════════════════════════
   Vibes Dashboard — Visualizer Module Script
   ═══════════════════════════════════════ */

(function () {
  'use strict';

  let viewPanel = null;
  let vizPrev = null;
  let vizNext = null;
  let vizModeLabel = null;

  function initDOM() {
    viewPanel = document.getElementById('view-visualizer');
    if (!viewPanel) return false;
    vizPrev = viewPanel.querySelector('#viz-prev');
    vizNext = viewPanel.querySelector('#viz-next');
    vizModeLabel = viewPanel.querySelector('#viz-mode-label');
    return true;
  }

  const updateLabel = (modeName) => {
    if (!vizModeLabel) initDOM();
    if (vizModeLabel) {
      vizModeLabel.textContent = modeName;
      vizModeLabel.classList.add('flash');
      setTimeout(() => {
        vizModeLabel.classList.remove('flash');
      }, 600);
    }
  };

  function bindEvents() {
    if (!initDOM()) return;

    vizPrev.addEventListener('click', () => {
      if (window.bgEffect) {
        const mode = window.bgEffect.prevMode();
        updateLabel(mode);
        window.bgEffect.pulse();
      }
    });

    vizNext.addEventListener('click', () => {
      if (window.bgEffect) {
        const mode = window.bgEffect.nextMode();
        updateLabel(mode);
        window.bgEffect.pulse();
      }
    });

    if (window.bgEffect) {
      vizModeLabel.textContent = window.bgEffect.getCurrentModeName();
    }
  }

  document.addEventListener('dashboard:view-changed', (e) => {
    if (e.detail.id === 'visualizer') {
      if (!vizPrev) bindEvents();
      // Trigger resize to fix canvas layout issues
      window.dispatchEvent(new Event('resize'));
      
      // Let the current background mode set its hue
      if (window.bgEffect) {
        window.bgEffect.applyModeColorShift();
        updateLabel(window.bgEffect.getCurrentModeName());
      }
    }
  });

  // Try to bind early
  setTimeout(bindEvents, 100);

})();
