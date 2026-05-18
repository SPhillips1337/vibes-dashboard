/* ═══════════════════════════════════════
   Vibes Dashboard — Main App Logic
   Agent lifecycle, modals, detail views
   ═══════════════════════════════════════ */

(function () {
  'use strict';

  // ── Socket Connection ──
  const socket = io();

  // ── State ──
  const state = {
    agents: new Map(),
    currentModalAgentId: null,
    currentDetailAgentId: null,
  };

  // ── DOM References ──
  const $ = (sel) => document.querySelector(sel);
  const grid = $('#dashboard-grid');
  const addCard = $('#add-agent-card');

  // Stats
  const statActive = $('#stat-active');
  const statCompleted = $('#stat-completed');
  const statTasks = $('#stat-tasks');

  // Modal
  const modalOverlay = $('#modal-overlay');
  const stepInput = $('#modal-step-input');
  const stepLoading = $('#modal-step-loading');
  const stepReview = $('#modal-step-review');
  const inputCwd = $('#input-cwd');
  const inputMission = $('#input-mission');
  const reviewMission = $('#review-mission');
  const reviewTasksList = $('#review-tasks-list');

  // Detail
  const detailOverlay = $('#agent-detail-overlay');
  const detailTitle = $('#detail-title');
  const detailStatus = $('#detail-status');
  const detailProgress = $('#detail-progress');
  const detailCwd = $('#detail-cwd');
  const detailMission = $('#detail-mission');
  const detailTasksList = $('#detail-tasks-list');

  // Clock
  const clockEl = $('#header-clock');

  // Theme Toggle
  const themeToggle = $('#theme-toggle');
  const sunIcon = $('.sun-icon');
  const moonIcon = $('.moon-icon');

  function initTheme() {
    const savedTheme = localStorage.getItem('vibes-theme') || 'dark';
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    }
  }

  themeToggle.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('vibes-theme', isLight ? 'light' : 'dark');
    sunIcon.classList.toggle('hidden');
    moonIcon.classList.toggle('hidden');
    if (window.vibePlayer) window.vibePlayer.playClick();
  });

  initTheme();

  // ── Clock ──
  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ── Stats ──
  function updateStats() {
    let active = 0, completed = 0, tasksDone = 0;
    state.agents.forEach(a => {
      if (a.status === 'executing' || a.status === 'planning' || a.status === 'review') active++;
      if (a.status === 'complete') completed++;
      tasksDone += a.completedTasks || 0;
    });
    statActive.textContent = active;
    statCompleted.textContent = completed;
    statTasks.textContent = tasksDone;
  }

  // ── Card Rendering ──
  function createCardElement(agent) {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.dataset.agentId = agent.id;
    card.innerHTML = renderCardInner(agent);

    // Close button
    card.querySelector('.card-close').addEventListener('click', (e) => {
      e.stopPropagation();
      socket.emit('agent-terminate', { id: agent.id });
      if (window.bgEffect) window.bgEffect.pulse();
    });

    // Click to expand
    card.addEventListener('click', () => openDetail(agent.id));

    return card;
  }

  function renderCardInner(agent) {
    const statusClass = `status-${agent.status}`;
    const statusLabel = agent.status.charAt(0).toUpperCase() + agent.status.slice(1);

    return `
      <div class="card-header">
        <div class="card-mission">${escapeHtml(agent.mission)}</div>
        <button class="card-close" title="Terminate Agent">&times;</button>
      </div>
      <div class="card-body">
        <div class="card-status ${statusClass}">
          <span class="status-dot"></span>
          ${statusLabel}
        </div>
        <div class="card-cwd">${escapeHtml(agent.cwd)}</div>
      </div>
      <div class="card-progress">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${agent.progress || 0}%"></div>
        </div>
        <div class="card-progress-text">
          <span>${agent.completedTasks || 0} / ${agent.totalTasks || '?'} tasks</span>
          <span>${agent.progress || 0}%</span>
        </div>
      </div>
    `;
  }

  function updateCardElement(agent) {
    const card = grid.querySelector(`[data-agent-id="${agent.id}"]`);
    if (!card) return;

    // Preserve close handler by updating inner content carefully
    const closeBtn = card.querySelector('.card-close');
    card.innerHTML = renderCardInner(agent);

    // Re-bind close
    card.querySelector('.card-close').addEventListener('click', (e) => {
      e.stopPropagation();
      socket.emit('agent-terminate', { id: agent.id });
      if (window.bgEffect) window.bgEffect.pulse();
    });
  }

  function removeCardElement(id) {
    const card = grid.querySelector(`[data-agent-id="${id}"]`);
    if (card) {
      card.style.opacity = '0';
      card.style.transform = 'scale(0.9)';
      setTimeout(() => card.remove(), 300);
    }
  }

  // ── Modal Flow ──
  function openModal() {
    inputCwd.value = '';
    inputMission.value = '';
    showStep('input');
    modalOverlay.classList.remove('hidden');
    inputCwd.focus();
    if (window.bgEffect) window.bgEffect.setHue(260);
    if (window.vibePlayer) window.vibePlayer.playModal();
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    state.currentModalAgentId = null;
    if (window.bgEffect) window.bgEffect.setHue(220);
    if (window.vibePlayer) window.vibePlayer.playModal();
  }

  function showStep(step) {
    stepInput.classList.toggle('hidden', step !== 'input');
    stepLoading.classList.toggle('hidden', step !== 'loading');
    stepReview.classList.toggle('hidden', step !== 'review');
  }

  function submitAgent() {
    const cwd = inputCwd.value.trim() || '~/';
    const mission = inputMission.value.trim();
    if (!mission) {
      inputMission.style.borderColor = 'var(--danger)';
      setTimeout(() => { inputMission.style.borderColor = ''; }, 1500);
      return;
    }
    let llmPrefs = null;
    try {
      const rawPrefs = localStorage.getItem('vibes-llm-prefs');
      if (rawPrefs) llmPrefs = JSON.parse(rawPrefs);
    } catch (_) { }

    showStep('loading');
    socket.emit('agent-create', { cwd, mission, llmPrefs });
    if (window.bgEffect) window.bgEffect.pulse();
  }

  // ── Detail View ──
  const detailLogs = document.getElementById('detail-logs');

  function openDetail(id) {
    const agent = state.agents.get(id);
    if (!agent) return;
    state.currentDetailAgentId = id;
    renderDetail(agent);
    detailOverlay.classList.remove('hidden');
    // Request full log history
    socket.emit('agent-logs', { id });
  }

  function closeDetail() {
    detailOverlay.classList.add('hidden');
    state.currentDetailAgentId = null;
  }

  function renderDetail(agent) {
    detailTitle.textContent = agent.mission;
    detailStatus.textContent = agent.status.charAt(0).toUpperCase() + agent.status.slice(1);
    detailProgress.textContent = `${agent.progress || 0}%`;
    detailCwd.textContent = agent.cwd;
    detailMission.textContent = agent.mission;

    detailTasksList.innerHTML = '';
    (agent.tasks || []).forEach(task => {
      const el = document.createElement('div');
      el.className = `detail-task task-${task.status}`;
      const icon = task.status === 'complete' ? '✓'
        : task.status === 'in-progress' ? '⟳'
          : '○';
      el.innerHTML = `
        <span class="task-icon">${icon}</span>
        <span>${escapeHtml(task.name)}</span>
      `;
      detailTasksList.appendChild(el);
    });

    // Render cached logs
    renderLogs(agent.logs || []);
  }

  function renderLogs(logs) {
    if (!logs.length) {
      detailLogs.innerHTML = '<div class="log-empty">No logs yet...</div>';
      return;
    }
    detailLogs.innerHTML = '';
    logs.forEach(entry => appendLogLine(entry.message, entry.time));
  }

  function appendLogLine(message, time) {
    // Remove "no logs" placeholder
    const empty = detailLogs.querySelector('.log-empty');
    if (empty) empty.remove();

    const line = document.createElement('div');
    line.className = 'log-line';
    const t = time ? new Date(time).toLocaleTimeString('en-GB') : new Date().toLocaleTimeString('en-GB');
    line.innerHTML = `<span class="log-time">${t}</span>${escapeHtml(message)}`;
    detailLogs.appendChild(line);
    detailLogs.scrollTop = detailLogs.scrollHeight;
  }

  // ── Socket Events ──
  socket.on('agents-snapshot', (agents) => {
    agents.forEach(a => {
      state.agents.set(a.id, a);
      grid.appendChild(createCardElement(a));
    });
    updateStats();
  });

  socket.on('agent-created', (agent) => {
    state.agents.set(agent.id, agent);
    grid.appendChild(createCardElement(agent));
    state.currentModalAgentId = agent.id;
    updateStats();
  });

  socket.on('agent-updated', (agent) => {
    state.agents.set(agent.id, agent);
    updateCardElement(agent);
    updateStats();

    // If modal is showing and this agent now has tasks (review phase)
    if (state.currentModalAgentId === agent.id && agent.status === 'review') {
      showStep('review');
      reviewMission.textContent = agent.mission;
      reviewTasksList.innerHTML = '';
      agent.tasks.forEach((t, i) => {
        const el = document.createElement('div');
        el.className = 'review-task';
        el.innerHTML = `<span class="review-task-num">${i + 1}</span><span>${escapeHtml(t.name)}</span>`;
        reviewTasksList.appendChild(el);
      });
    }

    // Update detail view if open
    if (state.currentDetailAgentId === agent.id) {
      renderDetail(agent);
    }

    // Visual feedback
    if (agent.status === 'complete' && window.bgEffect) {
      window.bgEffect.setHue(140);
      setTimeout(() => window.bgEffect.setHue(220), 3000);
    }
  });

  socket.on('agent-removed', (data) => {
    state.agents.delete(data.id);
    removeCardElement(data.id);
    updateStats();
    if (state.currentDetailAgentId === data.id) closeDetail();
    if (state.currentModalAgentId === data.id) closeModal();
  });

  // Live log streaming
  socket.on('agent-log', (data) => {
    const agent = state.agents.get(data.id);
    if (agent) {
      if (!agent.logs) agent.logs = [];
      agent.logs.push({ time: new Date().toISOString(), message: data.log });
      if (agent.logs.length > 200) agent.logs = agent.logs.slice(-200);
    }
    // If detail view is open for this agent, append log line
    if (state.currentDetailAgentId === data.id) {
      appendLogLine(data.log);
    }
  });

  socket.on('agent-logs-response', (data) => {
    if (state.currentDetailAgentId === data.id) {
      renderLogs(data.logs || []);
    }
  });

  // ── Event Listeners ──
  addCard.addEventListener('click', () => {
    openModal();
    if (window.vibePlayer) window.vibePlayer.playClick();
  });

  $('#btn-cancel').addEventListener('click', closeModal);
  $('#modal-close-btn').addEventListener('click', closeModal);
  $('#btn-submit').addEventListener('click', () => {
    submitAgent();
    if (window.vibePlayer) window.vibePlayer.playClick();
  });

  $('#modal-close-btn-review').addEventListener('click', () => {
    socket.emit('agent-decline', { id: state.currentModalAgentId });
    closeModal();
  });
  $('#btn-decline').addEventListener('click', () => {
    socket.emit('agent-decline', { id: state.currentModalAgentId });
    closeModal();
  });
  $('#btn-regenerate').addEventListener('click', () => {
    socket.emit('agent-decline', { id: state.currentModalAgentId });
    submitAgent();
    if (window.vibePlayer) window.vibePlayer.playClick();
  });
  $('#btn-accept').addEventListener('click', () => {
    socket.emit('agent-accept', { id: state.currentModalAgentId });
    closeModal();
    if (window.bgEffect) window.bgEffect.pulse();
    if (window.vibePlayer) window.vibePlayer.playClick();
  });

  $('#detail-back-btn').addEventListener('click', () => {
    closeDetail();
    if (window.vibePlayer) window.vibePlayer.playClick();
  });
  $('#detail-terminate-btn').addEventListener('click', () => {
    if (state.currentDetailAgentId) {
      socket.emit('agent-terminate', { id: state.currentDetailAgentId });
      closeDetail();
      if (window.vibePlayer) window.vibePlayer.playClick();
    }
  });

  // Close modals on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!detailOverlay.classList.contains('hidden')) closeDetail();
      else if (!modalOverlay.classList.contains('hidden')) closeModal();
    }
  });

  // Close modal on overlay click
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  detailOverlay.addEventListener('click', (e) => {
    if (e.target === detailOverlay) closeDetail();
  });

  // ── Sidebar Navigation ──
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      // Don't treat utility buttons as main page navigation
      if (btn.id === 'nav-audio' || btn.id === 'nav-settings') {
        if (window.bgEffect) window.bgEffect.pulse();
        return;
      }

      document.querySelectorAll('.sidebar-btn').forEach(b => {
        if (b.id !== 'nav-audio' && b.id !== 'nav-settings') {
          b.classList.remove('active');
        }
      });

      btn.classList.add('active');
      if (window.bgEffect) window.bgEffect.pulse();

      // Update page title based on nav
      const title = btn.title || 'Dashboard';
      $('#page-title').textContent = title === 'Dashboard' ? 'Mission Control' : title;
    });
  });

  // ── Utility ──
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
