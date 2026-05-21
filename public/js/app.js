/* ═══════════════════════════════════════
   Vibes Dashboard — Main App Logic (Modular Core)
   Manages module loading, routing, and event forwarding.
   ═══════════════════════════════════════ */

(function () {
  'use strict';

  // ── Socket Connection ──
  const socket = io();

  // ── Core Namespace ──
  window.Dashboard = {
    socket: socket,
    agents: new Map(),
    modules: [],
    activeModuleId: null,
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
        } else if (btn.id !== 'nav-audio' && btn.id !== 'nav-settings') {
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

  // ── Socket Events Event Forwarders ──
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

  // ── Module Loader ──
  async function loadModules() {
    try {
      const response = await fetch('/api/modules');
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
          panel.className = 'view-panel hidden';
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
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = module.js;
            script.async = false; // Preserve execution order if needed
            script.onload = () => resolve();
            script.onerror = (e) => {
              console.error(`[Dashboard] Failed to load script for module ${module.id}:`, e);
              resolve(); // Don't block subsequent modules
            };
            document.body.appendChild(script);
          });
        }
      }

      // Show initial view (defaults to orchestrator, or fallback to first)
      if (modules.length > 0) {
        const hasOrchestrator = modules.some(m => m.id === 'orchestrator');
        window.Dashboard.showView(hasOrchestrator ? 'orchestrator' : modules[0].id);
      }

    } catch (err) {
      console.error('[Dashboard] Error during module initialization:', err);
    }
  }

  // Load modules on startup
  loadModules();

})();
