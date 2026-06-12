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
    moduleLogics: new Map(), // Map<moduleId, {onInit, onActivate, onDeactivate}>
    activeModuleId: null,
    currentUser: null,
    settingsTabs: [],
    
    registerModuleLogic(id, logic) {
      this.moduleLogics.set(id, logic);
      // If module is already active, trigger onActivate immediately
      if (this.activeModuleId === id && logic.onActivate) {
        try { logic.onActivate(); } catch (e) { console.error(`[Lifecycle] ${id} onActivate failed:`, e); }
      }
    },

    registerSettingsTab(tabSpec) {
      this.settingsTabs.push(tabSpec);
      document.dispatchEvent(new CustomEvent('dashboard:settings-tab-registered', { detail: tabSpec }));
    },

    showView(id) {
      const prevModuleId = this.activeModuleId;
      const targetModule = this.modules.find(m => m.id === id);
      if (!targetModule) return;

      // Lifecycle: Deactivate previous
      if (prevModuleId && prevModuleId !== id) {
        const prevLogic = this.moduleLogics.get(prevModuleId);
        if (prevLogic && prevLogic.onDeactivate) {
          try { prevLogic.onDeactivate(); } catch (e) { console.error(`[Lifecycle] ${prevModuleId} onDeactivate failed:`, e); }
        }
      }

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

      // Lifecycle: Activate new
      const targetLogic = this.moduleLogics.get(id);
      if (targetLogic && targetLogic.onActivate) {
        try { targetLogic.onActivate(); } catch (e) { console.error(`[Lifecycle] ${id} onActivate failed:`, e); }
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
      const rawModules = await response.json();
      
      // Sort modules by dependencies
      const modules = sortModulesByDependencies(rawModules);
      window.Dashboard.modules = modules;

      const viewContainer = document.getElementById('views-container');

      for (const module of modules) {
        // 1. Inject Stylesheet (Standard way for now, Shadow DOM handled later if enabled)
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
          
          let targetContainer = panel;

          // 11/10: Shadow DOM Isolation
          if (module.useShadowDOM) {
            const shadow = panel.attachShadow({ mode: 'open' });
            
            // Inject module styles into shadow root
            if (module.css) {
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = module.css;
              shadow.appendChild(link);
            }
            
            // Inject global theme variables
            const themeLink = document.createElement('link');
            themeLink.rel = 'stylesheet';
            themeLink.href = 'css/style.css'; 
            shadow.appendChild(themeLink);

            targetContainer = shadow;
          }

          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(module.htmlContent, 'text/html');
            while (doc.body.firstChild) {
              targetContainer.appendChild(doc.body.firstChild);
            }
          } catch (err) {
            console.error(`[Dashboard] Failed to parse HTML content for module ${module.id}:`, err);
          }
          
          viewContainer.appendChild(panel);
        }

        // 3. Dispatch Module Registered Event
        document.dispatchEvent(new CustomEvent('dashboard:module-registered', { detail: module }));

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
            script.onload = () => {
              // Lifecycle: onInit
              const logic = window.Dashboard.moduleLogics.get(module.id);
              if (logic && logic.onInit) {
                try {
                  const panel = document.getElementById(`view-${module.id}`);
                  const targetPanel = module.useShadowDOM ? panel.shadowRoot : panel;
                  logic.onInit(targetPanel);
                } catch (e) {
                  console.error(`[Lifecycle] ${module.id} onInit failed:`, e);
                }
              }
              resolve();
            };
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

  function sortModulesByDependencies(modules) {
    const sorted = [];
    const visited = new Set();
    const visiting = new Set();

    function visit(mod) {
      if (visiting.has(mod.id)) {
        console.warn(`[Modules] Circular dependency detected in ${mod.id}`);
        return;
      }
      if (visited.has(mod.id)) return;

      visiting.add(mod.id);
      
      const deps = mod.dependencies || [];
      deps.forEach(depId => {
        const depMod = modules.find(m => m.id === depId);
        if (depMod) {
          visit(depMod);
        } else {
          console.warn(`[Modules] Dependency ${depId} not found for module ${mod.id}`);
        }
      });

      visiting.delete(mod.id);
      visited.add(mod.id);
      sorted.push(mod);
    }

    modules.forEach(m => visit(m));
    return sorted;
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
    
    console.log(`[Dashboard] Session established securely for user: ${user.username} (${user.role})`);
  }

  // Load app on DOM load
  document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
  });

})();
