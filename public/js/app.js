/* ═══════════════════════════════════════
   Vibes Dashboard — Main App Logic (Modular Core)
   Manages module loading, routing, and event forwarding.
   ═══════════════════════════════════════ */

(function () {
  'use strict';

  let socket;
  let csrfToken = '';

  // ── Core Namespace ──
  window.Dashboard = {
    socket: null,
    csrfToken: '',
    agents: new Map(),
    modules: [],
    activeModuleId: null,
    currentUser: null,
    settingsTabs: [],
    registerSettingsTab(tabSpec) {
      this.settingsTabs.push(tabSpec);
      document.dispatchEvent(new CustomEvent('dashboard:settings-tab-registered', { detail: tabSpec }));
    },
    showView(id) {
      const targetModule = this.modules.find(m => m.id === id);
      if (!targetModule) return;

      this.activeModuleId = id;

      // Toggle view elements in DOM
      const views = document.querySelectorAll('.view-panel');
      views.forEach(view => {
        const isTarget = view.id === `view-${id}`;
        view.classList.toggle('hidden', !isTarget);
        if (isTarget) {
          view.classList.add('active');
        } else {
          view.classList.remove('active');
        }
      });

      // Toggle active state on sidebar buttons
      const buttons = document.querySelectorAll('.sidebar-btn');
      buttons.forEach(btn => {
        if (btn.id === `nav-${id}`) {
          btn.classList.add('active');
        } else if (btn.id !== 'nav-logout') {
          btn.classList.remove('active');
        }
      });

      // Update page header titles
      const pageTitle = document.getElementById('page-title');
      const pageSubtitle = document.querySelector('.header-subtitle');
      if (pageTitle) pageTitle.textContent = targetModule.name || targetModule.id;
      if (pageSubtitle) pageSubtitle.textContent = targetModule.subtitle || '';

      // Pulse background and shift palette based on view
      if (window.bgEffect) {
        window.bgEffect.pulse();
        if (id === 'orchestrator') {
          window.bgEffect.setHue(220); // Blue/purple
        } else if (id === 'log-viewer') {
          window.bgEffect.setHue(190); // Teal/cyan
        } else if (id === 'visualizer') {
          window.bgEffect.applyModeColorShift();
        } else if (id === 'web-browser') {
          window.bgEffect.setHue(280); // Lavender/violet
        } else if (id === 'terminal') {
          window.bgEffect.setHue(145); // Emerald/Green terminal theme
        }
      }

      // Dispatch a view changed event
      document.dispatchEvent(new CustomEvent('dashboard:view-changed', { detail: { id } }));
    },
    async logout() {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.Dashboard.csrfToken
          }
        });
      } catch (err) {
        console.warn('[Dashboard] Logout failed:', err);
      }
      // Wipes memory caches and redirects cleanly
      window.location.reload();
    }
  };

  // ── Clock ──
  function updateClock() {
    const clock = document.getElementById('header-clock');
    if (!clock) return;
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ── Stats ──
  function updateStats() {
    const statActive = document.getElementById('stat-active');
    const statCompleted = document.getElementById('stat-completed');
    const statTasks = document.getElementById('stat-tasks');
    
    if (!statActive || !statCompleted || !statTasks) return;

    let active = 0, completed = 0, tasksDone = 0;
    window.Dashboard.agents.forEach(a => {
      if (a.status === 'executing' || a.status === 'planning' || a.status === 'review') active++;
      if (a.status === 'complete') completed++;
      tasksDone += a.completedTasks || 0;
    });
    statActive.textContent = active;
    statCompleted.textContent = completed;
    statTasks.textContent = tasksDone;
  }

  // ── Setup Socket events ──
  function setupSocketEvents() {
    socket.on('agents-snapshot', (agents) => {
      agents.forEach(a => {
        window.Dashboard.agents.set(a.id, a);
      });
      updateStats();
      document.dispatchEvent(new CustomEvent('dashboard:agents-snapshot', { detail: agents }));
    });

    socket.on('agent-created', (agent) => {
      window.Dashboard.agents.set(agent.id, agent);
      updateStats();
      
      // Shift background to violet/pink on agent creation
      if (window.bgEffect) {
        window.bgEffect.setHue(260);
        window.bgEffect.pulse();
        window.bgEffect.triggerEvent('agent-created');
      }
      document.dispatchEvent(new CustomEvent('dashboard:agent-created', { detail: agent }));
    });

    socket.on('agent-updated', (agent) => {
      window.Dashboard.agents.set(agent.id, agent);
      updateStats();

      // Visual feedback — shift background based on agent state
      if (window.bgEffect) {
        if (agent.status === 'complete') {
          window.bgEffect.setHue(140); // emerald success
          window.bgEffect.pulse();
          window.bgEffect.triggerEvent('task-complete');
          setTimeout(() => {
            if (window.Dashboard.activeModuleId === 'orchestrator') {
              window.bgEffect.setHue(220);
            }
          }, 4000);
        } else if (agent.status === 'error') {
          window.bgEffect.setHue(15); // warm ember warning
          window.bgEffect.triggerEvent('error');
          setTimeout(() => {
            if (window.Dashboard.activeModuleId === 'orchestrator') {
              window.bgEffect.setHue(220);
            }
          }, 3000);
        } else if (agent.status === 'executing') {
          window.bgEffect.setHue(200); // ocean blue
        }
      }
      document.dispatchEvent(new CustomEvent('dashboard:agent-updated', { detail: agent }));
    });

    socket.on('agent-removed', (data) => {
      window.Dashboard.agents.delete(data.id);
      updateStats();
      document.dispatchEvent(new CustomEvent('dashboard:agent-removed', { detail: data }));
    });

    socket.on('agent-log', (data) => {
      const agent = window.Dashboard.agents.get(data.id);
      if (agent) {
        if (!agent.logs) agent.logs = [];
        agent.logs.push({ time: new Date().toISOString(), message: data.log });
        if (agent.logs.length > 200) agent.logs = agent.logs.slice(-200);
      }
      
      if (data.log.toLowerCase().includes('error') || data.log.toLowerCase().includes('fail')) {
        if (window.bgEffect) window.bgEffect.triggerEvent('error');
      } else if (data.log.toLowerCase().includes('success') || data.log.toLowerCase().includes('completed')) {
        if (window.bgEffect) window.bgEffect.triggerEvent('task-complete');
      }
      document.dispatchEvent(new CustomEvent('dashboard:agent-log', { detail: data }));
    });

    socket.on('agent-logs-response', (data) => {
      document.dispatchEvent(new CustomEvent('dashboard:agent-logs-response', { detail: data }));
    });
  }

  // ── Module Loader ──
  async function loadModules() {
    try {
      const response = await fetch('/api/modules');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const modules = await response.json();
      
      window.Dashboard.modules = modules;

      const viewContainer = document.getElementById('views-container');
      const sidebar = document.getElementById('sidebar');
      const spacer = sidebar.querySelector('.sidebar-spacer');

      for (const module of modules) {
        // 1. Inject Stylesheet
        if (module.css) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = module.css;
          document.head.appendChild(link);
        }

        // 2. Inject HTML View Panel
        if (module.htmlContent) {
          const panel = document.createElement('div');
          panel.className = 'view-panel main-view hidden';
          panel.id = `view-${module.id}`;
          panel.innerHTML = module.htmlContent;
          viewContainer.appendChild(panel);
        }

        // 3. Inject Sidebar Button
        const btn = document.createElement('button');
        btn.className = 'sidebar-btn';
        btn.id = `nav-${module.id}`;
        btn.title = module.name;
        btn.innerHTML = module.icon;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.vibePlayer) window.vibePlayer.playClick();
          window.Dashboard.showView(module.id);
        });
        sidebar.insertBefore(btn, spacer);

        // 4. Register Speech Commands
        if (module.speechCommands && Array.isArray(module.speechCommands)) {
          module.speechCommands.forEach(cmd => {
            if (window.VoiceCommands && window.VoiceCommands.registerIntent) {
              window.VoiceCommands.registerIntent(
                cmd.intent,
                cmd.triggers,
                () => {
                  window.Dashboard.showView(module.id);
                },
                { label: cmd.label, icon: cmd.icon }
              );
            }
          });
        }

        // 5. Inject Script (loads asynchronously but ordered)
        if (module.js) {
          await new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = module.js;
            script.async = false;
            script.onload = () => resolve();
            script.onerror = (e) => {
              console.error(`[Dashboard] Failed to load script for module ${module.id}:`, e);
              resolve();
            };
            document.body.appendChild(script);
          });
        }
      }

      // Show initial view (defaults to settings if orchestrator missing, or fallback to first)
      if (modules.length > 0) {
        const hasOrchestrator = modules.some(m => m.id === 'orchestrator');
        window.Dashboard.showView(hasOrchestrator ? 'orchestrator' : modules[0].id);
      }

    } catch (err) {
      console.error('[Dashboard] Error during module initialization:', err);
    }
  }

  // ── Authentication Check & Guard ──
  async function checkAuth() {
    try {
      const resp = await fetch('/api/auth/status');
      const data = await resp.json();
      if (data.authenticated) {
        // Fetch CSRF token
        const csrfResp = await fetch('/api/auth/csrf');
        const csrfData = await csrfResp.json();
        csrfToken = csrfData.csrfToken;
        
        // Hide login, show main content
        document.getElementById('login-overlay').classList.add('hidden');
        document.getElementById('ui-root').classList.remove('hidden');
        
        bootApp(data.user);
      } else {
        // Hide main content, show login
        document.getElementById('ui-root').classList.add('hidden');
        document.getElementById('login-overlay').classList.remove('hidden');
        
        setupLoginHandler();
      }
    } catch (err) {
      console.error('[Dashboard] Auth validation failed:', err);
    }
  }

  function setupLoginHandler() {
    const form = document.getElementById('login-form');
    const errorMsg = document.getElementById('login-error-msg');
    if (!form) return;
    
    // Clear any previous submit listeners
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    
    const inputUser = newForm.querySelector('#login-username');
    const inputPass = newForm.querySelector('#login-password');
    const labelError = newForm.querySelector('#login-error-msg');
    
    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      labelError.textContent = '';
      
      const username = inputUser.value.trim();
      const password = inputPass.value;
      
      try {
        const resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        const data = await resp.json();
        if (resp.ok && data.success) {
          // Fetch CSRF
          const csrfResp = await fetch('/api/auth/csrf');
          const csrfData = await csrfResp.json();
          csrfToken = csrfData.csrfToken;
          
          document.getElementById('login-overlay').classList.add('hidden');
          document.getElementById('ui-root').classList.remove('hidden');
          
          bootApp(data.user);
        } else {
          labelError.textContent = data.error || 'Invalid credentials';
        }
      } catch (err) {
        labelError.textContent = 'Connection error. Please try again.';
        console.error('[Dashboard] Login submit failed:', err);
      }
    });
  }

  async function bootApp(user) {
    window.Dashboard.csrfToken = csrfToken;
    window.Dashboard.currentUser = user;
    
    // Initialize secure websocket connection
    socket = io();
    window.Dashboard.socket = socket;
    
    setupSocketEvents();
    await loadModules();
    enableSidebarDragAndDrop();

    // Wire permanent sign out button
    const logoutBtn = document.getElementById('nav-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.vibePlayer && window.vibePlayer.playClick) {
          window.vibePlayer.playClick();
        }
        window.Dashboard.logout();
      });
    }
    
    console.log(`[Dashboard] Session established securely for user: ${user.username} (${user.role})`);
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
      if (!dragElement) return;

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

      // Synchronously remove classes
      elementToClean.classList.remove('wobbling');
      elementToClean.classList.remove('dragging');

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
      
      console.log('[Dashboard] Saving new module order preference:', moduleOrder);

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
        console.error('[Dashboard] Failed to save module order:', err);
      }
    }
  }

  // Load app on DOM load
  document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
  });

})();
