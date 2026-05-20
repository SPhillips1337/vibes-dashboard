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
    globalLogs: [],
  };

  // ── DOM References ──
  const $ = (sel) => document.querySelector(sel);
  const grid = $('#dashboard-grid');
  const addCard = $('#add-agent-card');

  // Views
  const viewDashboard = $('#view-dashboard');
  const viewLogs = $('#view-logs');
  const viewVisualizer = $('#view-visualizer');
  const globalLogsContent = $('#global-logs-content');
  const btnClearLogs = $('#btn-clear-logs');

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
  const cwdSuggestions = $('#cwd-suggestions');
  const inputMission = $('#input-mission');
  const btnDictateMission = $('#btn-dictate-mission');
  const reviewMission = $('#review-mission');
  const reviewTasksList = $('#review-tasks-list');

  // ── Auto Path Completion ──
  let cwdDebounce;
  let cwdSuggestionIndex = -1;

  function updateCwdSelection() {
    const items = cwdSuggestions.querySelectorAll('li');
    items.forEach((item, index) => {
      if (index === cwdSuggestionIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  inputCwd.addEventListener('keydown', (e) => {
    if (cwdSuggestions.classList.contains('hidden')) return;
    const items = cwdSuggestions.querySelectorAll('li');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cwdSuggestionIndex = (cwdSuggestionIndex + 1) % items.length;
      updateCwdSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cwdSuggestionIndex = (cwdSuggestionIndex - 1 + items.length) % items.length;
      updateCwdSelection();
    } else if (e.key === 'Enter' && cwdSuggestionIndex >= 0) {
      e.preventDefault();
      items[cwdSuggestionIndex].click();
    } else if (e.key === 'Escape') {
      cwdSuggestions.classList.add('hidden');
    }
  });

  inputCwd.addEventListener('input', () => {
    clearTimeout(cwdDebounce);
    cwdSuggestionIndex = -1;
    const val = inputCwd.value;
    if (!val || val.length < 1) {
      cwdSuggestions.classList.add('hidden');
      return;
    }
    cwdDebounce = setTimeout(async () => {
      try {
        const res = await fetch(`/api/fs/suggestions?path=${encodeURIComponent(val)}`);
        const suggestions = await res.json();
        if (suggestions.length > 0) {
          cwdSuggestions.innerHTML = '';
          suggestions.forEach(s => {
            const li = document.createElement('li');
            li.textContent = s;
            li.addEventListener('click', () => {
              inputCwd.value = s;
              cwdSuggestions.classList.add('hidden');
              inputCwd.focus();
            });
            cwdSuggestions.appendChild(li);
          });
          cwdSuggestions.classList.remove('hidden');
        } else {
          cwdSuggestions.classList.add('hidden');
        }
      } catch (e) {
        cwdSuggestions.classList.add('hidden');
      }
    }, 200);
  });
  
  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (e.target !== inputCwd && e.target !== cwdSuggestions) {
      cwdSuggestions.classList.add('hidden');
    }
  });

  // ── Voice Dictation ──
  let missionRecognition = null;
  btnDictateMission.addEventListener('click', () => {
    if (btnDictateMission.classList.contains('recording') && missionRecognition) {
      missionRecognition.stop();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Your browser doesn't support speech recognition.");
      return;
    }

    const startDictation = () => {
      missionRecognition = new SpeechRecognition();
      missionRecognition.lang = 'en-US';
      missionRecognition.interimResults = true;
      
      missionRecognition.onstart = () => {
        btnDictateMission.classList.add('recording');
        inputMission.placeholder = "Listening...";
      };
      
      let finalTranscript = inputMission.value ? inputMission.value + " " : "";
      
      missionRecognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        inputMission.value = finalTranscript + interimTranscript;
      };
      
      missionRecognition.onerror = (e) => {
        console.warn('[Dictation] Error:', e.error);
        btnDictateMission.classList.remove('recording');
        inputMission.placeholder = "Describe the agent's objective...";
        if (window.VoiceCommands) {
          window.VoiceCommands.suspendWakeWord(false);
          window.VoiceCommands.restoreAudio();
        }
      };
      
      missionRecognition.onend = () => {
        btnDictateMission.classList.remove('recording');
        inputMission.placeholder = "Describe the agent's objective...";
        if (window.VoiceCommands) {
          window.VoiceCommands.suspendWakeWord(false);
          window.VoiceCommands.restoreAudio();
        }
      };
      
      try {
        missionRecognition.start();
      } catch (err) {
        console.error('[Dictation] Start failed:', err);
      }
    };

    // Duck music and suspend background wake word before starting dictation
    if (window.VoiceCommands) {
      window.VoiceCommands.duckAudio();
      window.VoiceCommands.playWakeBeep();
      window.VoiceCommands.suspendWakeWord(true).then(() => {
        setTimeout(startDictation, 150);
      });
    } else {
      setTimeout(startDictation, 150);
    }
  });

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
    const theme = isLight ? 'light' : 'dark';
    localStorage.setItem('vibes-theme', theme);

    // Sync theme with vibes-general-prefs too
    let generalPrefs = { autoLaunchOnCommand: true, theme: theme };
    try {
      const raw = localStorage.getItem('vibes-general-prefs');
      if (raw) {
        generalPrefs = { ...JSON.parse(raw), theme: theme };
      }
    } catch (_) {}
    localStorage.setItem('vibes-general-prefs', JSON.stringify(generalPrefs));

    // Save theme to server filesystem
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'vibes-theme': theme,
        'vibes-general-prefs': generalPrefs
      })
    }).catch(err => console.error('[Settings] Failed to save theme to server:', err));

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
      if (window.bgEffect) {
        window.bgEffect.pulse();
        window.bgEffect.triggerEvent('terminate', e.clientX, e.clientY);
      }
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
        <div class="card-mission">${escapeHtml(getAgentTitle(agent.mission))}</div>
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
      if (window.bgEffect) {
        window.bgEffect.pulse();
        window.bgEffect.triggerEvent('terminate', e.clientX, e.clientY);
      }
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
    detailTitle.textContent = getAgentTitle(agent.mission);
    detailStatus.textContent = agent.status.charAt(0).toUpperCase() + agent.status.slice(1);
    detailProgress.textContent = `${agent.progress || 0}%`;
    detailCwd.textContent = agent.cwd;
    detailMission.textContent = agent.mission;

    // Toggle Retry Mission button based on status
    const canRetry = agent.status === 'executing' || agent.status === 'complete' || agent.status === 'error' || agent.status === 'terminated';
    const retryBtn = $('#detail-retry-btn');
    if (retryBtn) {
      retryBtn.classList.toggle('hidden', !canRetry);
    }

    detailTasksList.innerHTML = '';
    (agent.tasks || []).forEach(task => {
      const el = document.createElement('div');
      el.className = `detail-task task-${task.status}`;
      const icon = task.status === 'complete' ? '✓'
        : task.status === 'in-progress' ? '⟳'
        : task.status === 'failed' ? '✗'
        : '○';
      el.innerHTML = `
        <span class="task-icon">${icon}</span>
        <span class="task-name-text" style="flex: 1;">${escapeHtml(task.name)}</span>
        <button class="task-retry-btn" title="Restart from here" data-task-id="${task.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
        </button>
      `;

      el.querySelector('.task-retry-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('agent-retry-task', { id: agent.id, taskId: task.id });
        if (window.vibePlayer) window.vibePlayer.playClick();
      });

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
    appendGlobalLog(`Agent created: ${getAgentTitle(agent.mission)}`, agent.id, 'info');
    // Shift background to violet/pink on agent creation
    if (window.bgEffect) {
      window.bgEffect.setHue(260);
      window.bgEffect.pulse();
      window.bgEffect.triggerEvent('agent-created');
    }
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

    // Visual feedback — shift background based on agent state
    if (window.bgEffect) {
      if (agent.status === 'complete') {
        window.bgEffect.setHue(140); // emerald success
        window.bgEffect.pulse();
        window.bgEffect.triggerEvent('task-complete');
        setTimeout(() => window.bgEffect.setHue(220), 4000);
      } else if (agent.status === 'error') {
        window.bgEffect.setHue(15); // warm ember warning
        window.bgEffect.triggerEvent('error');
        setTimeout(() => window.bgEffect.setHue(220), 3000);
      } else if (agent.status === 'executing') {
        window.bgEffect.setHue(200); // ocean blue
      }
    }
  });

  socket.on('agent-removed', (data) => {
    state.agents.delete(data.id);
    removeCardElement(data.id);
    updateStats();
    if (state.currentDetailAgentId === data.id) closeDetail();
    if (state.currentModalAgentId === data.id) closeModal();
    appendGlobalLog(`Agent removed: ${data.id}`, 'system', 'danger');
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
    
    // Determine log type based on content
    let logType = 'info';
    if (data.log.toLowerCase().includes('error') || data.log.toLowerCase().includes('fail')) {
      logType = 'danger';
      if (window.bgEffect) window.bgEffect.triggerEvent('error');
    } else if (data.log.toLowerCase().includes('success') || data.log.toLowerCase().includes('completed')) {
      logType = 'success';
      if (window.bgEffect) window.bgEffect.triggerEvent('task-complete');
    } else if (data.log.toLowerCase().includes('warning')) {
      logType = 'warning';
    }
    
    appendGlobalLog(data.log, agent ? getAgentTitle(agent.mission) : data.id, logType);
  });

  socket.on('agent-logs-response', (data) => {
    if (state.currentDetailAgentId === data.id) {
      renderLogs(data.logs || []);
    }
  });

  // ── Global Logs Functions ──
  function appendGlobalLog(message, origin = 'system', type = 'info') {
    const time = new Date().toLocaleTimeString('en-GB');
    const logEntry = { time, message, origin, type };
    
    state.globalLogs.push(logEntry);
    if (state.globalLogs.length > 500) state.globalLogs.shift();
    
    if (globalLogsContent) {
      const line = document.createElement('div');
      line.className = 'global-log-line';
      
      const badgeClass = `badge-${type}`;
      line.innerHTML = `
        <span class="log-time" style="opacity: 0.5; width: 60px; flex-shrink: 0;">${time}</span>
        <span class="log-origin ${badgeClass}">${escapeHtml(origin)}</span>
        <span class="log-message" style="flex: 1;">${escapeHtml(message)}</span>
      `;
      globalLogsContent.appendChild(line);
      
      // Auto-scroll
      if (globalLogsContent.scrollHeight - globalLogsContent.scrollTop < globalLogsContent.clientHeight + 50) {
        globalLogsContent.scrollTop = globalLogsContent.scrollHeight;
      }
    }
  }

  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', () => {
      state.globalLogs = [];
      if (globalLogsContent) globalLogsContent.innerHTML = '';
      appendGlobalLog('System logs cleared.', 'system', 'info');
    });
  }

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
  $('#detail-terminate-btn').addEventListener('click', (e) => {
    if (state.currentDetailAgentId) {
      socket.emit('agent-terminate', { id: state.currentDetailAgentId });
      closeDetail();
      if (window.vibePlayer) window.vibePlayer.playClick();
      if (window.bgEffect) {
        window.bgEffect.pulse();
        window.bgEffect.triggerEvent('terminate', e.clientX, e.clientY);
      }
    }
  });

  const detailRetryBtn = $('#detail-retry-btn');
  if (detailRetryBtn) {
    detailRetryBtn.addEventListener('click', () => {
      if (state.currentDetailAgentId) {
        socket.emit('agent-retry', { id: state.currentDetailAgentId });
        if (window.vibePlayer) window.vibePlayer.playClick();
      }
    });
  }

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

      // Handle View Routing
      if (btn.id === 'nav-dashboard') {
        viewDashboard.classList.remove('hidden');
        viewDashboard.classList.add('active');
        viewLogs.classList.add('hidden');
        viewLogs.classList.remove('active');
        viewVisualizer.classList.add('hidden');
        viewVisualizer.classList.remove('active');
        // Shift to default blue palette
        if (window.bgEffect) window.bgEffect.setHue(220);
      } else if (btn.id === 'nav-logs') {
        viewDashboard.classList.add('hidden');
        viewDashboard.classList.remove('active');
        viewLogs.classList.remove('hidden');
        viewLogs.classList.add('active');
        viewVisualizer.classList.add('hidden');
        viewVisualizer.classList.remove('active');
        
        // Scroll to bottom when opening logs
        if (globalLogsContent) {
          globalLogsContent.scrollTop = globalLogsContent.scrollHeight;
        }
        // Shift to teal/cyan palette for logs
        if (window.bgEffect) window.bgEffect.setHue(190);
      } else if (btn.id === 'nav-visualizer') {
        viewDashboard.classList.add('hidden');
        viewDashboard.classList.remove('active');
        viewLogs.classList.add('hidden');
        viewLogs.classList.remove('active');
        viewVisualizer.classList.remove('hidden');
        viewVisualizer.classList.add('active');
        
        // Trigger resize to fix canvas layout issues
        window.dispatchEvent(new Event('resize'));
        // Let the current background mode set its hue
        if (window.bgEffect) window.bgEffect.applyModeColorShift();
      }
    });
  });

  // ── Visualizer Mode Controls ──
  const vizPrev = $('#viz-prev');
  const vizNext = $('#viz-next');
  const vizModeLabel = $('#viz-mode-label');

  if (vizPrev && vizNext && vizModeLabel) {
    const updateLabel = (modeName) => {
      vizModeLabel.textContent = modeName;
      vizModeLabel.classList.add('flash');
      setTimeout(() => {
        vizModeLabel.classList.remove('flash');
      }, 600);
    };

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

    // Initialize mode label on load
    if (window.bgEffect) {
      vizModeLabel.textContent = window.bgEffect.getCurrentModeName();
    }
  }

  // ── Utility ──
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getAgentTitle(mission) {
    if (!mission) return 'Unnamed Mission';
    let title = mission.trim();
    // Strip common prefixes
    title = title.replace(/^(please|your task is to|i need you to|can you|help me to)\s+/i, '');
    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);
    
    // Truncate to first sentence or first 50 chars
    const firstSentence = title.split(/[.!?]\s/)[0];
    if (firstSentence.length > 50) {
      const words = firstSentence.split(' ');
      let shortTitle = '';
      for (const word of words) {
        if ((shortTitle + ' ' + word).length > 45) {
          return shortTitle.trim() + '...';
        }
        shortTitle += ' ' + word;
      }
      return firstSentence.substring(0, 45).trim() + '...';
    }
    return firstSentence;
  }

})();
