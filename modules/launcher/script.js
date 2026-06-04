(function () {
  'use strict';

  function init() {
    const viewPanel = document.getElementById('view-launcher');
    if (!viewPanel) return;

    const sidebarEl = viewPanel.querySelector('nav#sidebar');
    if (!sidebarEl) return;

    // Move #sidebar to the root of #ui-root (before #main-content)
    const uiRoot = document.getElementById('ui-root');
    const mainContent = document.getElementById('main-content');
    if (uiRoot && mainContent) {
      uiRoot.insertBefore(sidebarEl, mainContent);
    }

    // Remove the wrapper panel
    viewPanel.remove();

    // Render existing modules
    if (window.Dashboard && window.Dashboard.modules) {
      window.Dashboard.modules.forEach(module => {
        renderModuleButton(module);
      });
    }

    // Listen for future dynamic registrations
    document.addEventListener('dashboard:module-registered', (e) => {
      renderModuleButton(e.detail);
    });

    // Wire logout
    setupLogout();

    // Enable drag-and-drop
    enableSidebarDragAndDrop();
  }

  function renderModuleButton(module) {
    if (module.hidden) return; // Skip hidden modules (like the launcher itself)
    if (document.getElementById(`nav-${module.id}`)) return; // Already exists

    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    const spacer = sidebar.querySelector('.sidebar-spacer');
    if (!spacer) return;

    const btn = document.createElement('button');
    btn.className = 'sidebar-btn';
    btn.id = `nav-${module.id}`;
    btn.title = module.name;

    // Safe inline SVG parsing (prevents XSS/innerHTML)
    if (module.icon) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(module.icon, 'image/svg+xml');
        btn.appendChild(doc.documentElement);
      } catch (err) {
        console.error(`[Launcher] Failed to parse icon for module ${module.id}:`, err);
      }
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.vibePlayer) window.vibePlayer.playClick();
      if (window.Dashboard && window.Dashboard.showView) {
        window.Dashboard.showView(module.id);
      }
    });

    sidebar.insertBefore(btn, spacer);
  }

  function setupLogout() {
    const logoutBtn = document.getElementById('nav-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.vibePlayer && window.vibePlayer.playClick) {
          window.vibePlayer.playClick();
        }
        if (window.Dashboard && window.Dashboard.logout) {
          window.Dashboard.logout();
        }
      });
    }
  }

  function enableSidebarDragAndDrop() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    let longPressTimer = null;
    let dragElement = null;
    let isHolding = false;
    let isWobbling = false;
    let isDragging = false;
    let activeDragMode = null; // 'held' or 'click-to-drag'
    let startY = 0;
    let originalNextSibling = null;
    let hasMovedDuringWobble = false;
    let wasClickToDragDrop = false;

    // Get all module buttons (exclude logo, separator, spacer, and bottom buttons)
    function getModuleButtons() {
      return Array.from(sidebar.querySelectorAll('.sidebar-btn'))
        .filter(btn => btn.id.startsWith('nav-') && btn.id !== 'nav-logout');
    }

    // Function to finish the drag and save
    async function finishDrag(shouldSave = true) {
      const elementToClean = dragElement;
      const saveNeeded = shouldSave && isDragging;

      // Reset all states immediately to prevent async event race conditions
      dragElement = null;
      isHolding = false;
      isWobbling = false;
      isDragging = false;
      activeDragMode = null;
      hasMovedDuringWobble = false;
      originalNextSibling = null;

      // Clean up classes from all module buttons to prevent active borders staying active
      getModuleButtons().forEach(btn => {
        btn.classList.remove('wobbling');
        btn.classList.remove('dragging');
      });

      if (saveNeeded) {
        await saveNewOrder();
      }
    }

    // Listen to mousedown on document to handle click-to-drag drop anywhere
    document.addEventListener('mousedown', (e) => {
      // If we are currently in click-to-drag mode, any click/mousedown should place the item and finish dragging
      if (activeDragMode === 'click-to-drag') {
        e.preventDefault();
        e.stopPropagation();
        wasClickToDragDrop = true;
        finishDrag(true);
        setTimeout(() => { wasClickToDragDrop = false; }, 50);
        return;
      }

      // Otherwise, check if we clicked a module button to start a hold timer
      const btn = e.target.closest('.sidebar-btn');
      if (!btn || !sidebar.contains(btn)) return;
      if (e.button !== 0) return; // Left mouse button only

      // Only drag module buttons
      if (!btn.id.startsWith('nav-') || btn.id === 'nav-logout') return;

      dragElement = btn;
      isHolding = true;
      startY = e.clientY;
      originalNextSibling = btn.nextSibling;
      hasMovedDuringWobble = false;

      longPressTimer = setTimeout(() => {
        if (!isHolding || !dragElement) return;
        isWobbling = true;
        dragElement.classList.add('wobbling');
        if (window.vibePlayer) {
          window.vibePlayer.playClick();
        }
      }, 1000); // 1000ms hold to activate dragging
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragElement) return;

      if (!isWobbling) {
        // Cancel timer if they move cursor more than 5px before wobble triggers
        if (Math.abs(e.clientY - startY) > 5) {
          clearTimeout(longPressTimer);
          dragElement = null;
          isHolding = false;
        }
        return;
      }

      // Wobbling is active!
      e.preventDefault();

      if (activeDragMode !== 'click-to-drag') {
        activeDragMode = 'held';
      }

      isDragging = true;
      hasMovedDuringWobble = true;
      dragElement.classList.add('dragging');

      const buttons = getModuleButtons();
      const clientY = e.clientY;

      // Find sibling we are currently hovering over
      const sibling = buttons.find(b => {
        if (b === dragElement) return false;
        const box = b.getBoundingClientRect();
        return clientY > box.top && clientY < box.bottom;
      });

      if (sibling) {
        const box = sibling.getBoundingClientRect();
        const middle = box.top + box.height / 2;
        if (clientY < middle) {
          sidebar.insertBefore(dragElement, sibling);
        } else {
          sidebar.insertBefore(dragElement, sibling.nextSibling);
        }
      }
    });

    document.addEventListener('mouseup', (e) => {
      clearTimeout(longPressTimer);

      if (wasClickToDragDrop) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (!dragElement) return;

      if (isHolding && !isWobbling) {
        // Cancel if mouse released before wobble triggered
        dragElement = null;
        isHolding = false;
        return;
      }

      if (isWobbling) {
        if (activeDragMode === 'held' || hasMovedDuringWobble) {
          // Held mode or they dragged and released. Drop and save!
          finishDrag(true);
        } else {
          // Held for 1s, wobbled, released without moving -> enter click-to-drag mode
          activeDragMode = 'click-to-drag';
          dragElement.classList.add('wobbling');
        }
      }
    });

    // Intercept click to consume it when dropping
    document.addEventListener('click', (e) => {
      if (wasClickToDragDrop) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // Cancel dragging if Escape is pressed
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dragElement && (isWobbling || isDragging)) {
        e.preventDefault();
        // Revert position
        sidebar.insertBefore(dragElement, originalNextSibling);
        finishDrag(false);
      }
    });

    async function saveNewOrder() {
      const buttons = getModuleButtons();
      const moduleOrder = buttons.map(btn => btn.id.replace('nav-', ''));
      
      console.log('[Launcher] Saving new module order preference:', moduleOrder);

      try {
        const resp = await fetch('/api/users/module-order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.Dashboard.csrfToken
          },
          body: JSON.stringify({ moduleOrder })
        });

        if (resp.ok) {
          if (window.VoiceCommands && window.VoiceCommands.showToast) {
            window.VoiceCommands.showToast('Module layout order saved', 'success');
          }
        }
      } catch (err) {
        console.error('[Launcher] Failed to save module order:', err);
      }
    }
  }

  // Self-execute on load
  init();

})();
