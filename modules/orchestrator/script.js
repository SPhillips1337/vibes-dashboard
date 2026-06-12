/* ═══════════════════════════════════════
   Vibes Dashboard — Orchestrator Module Script
   Handles agent card rendering, dictation, directory
   autocomplete, detail overlay, and lifecycle events.
   ═══════════════════════════════════════ */

(function () {
  'use strict';

  // ── References & Setup ──
  const socket = window.Dashboard.socket;
  const $ = (sel) => document.querySelector(sel);

  // DOM Elements
  const grid = $('#dashboard-grid');
  const addCard = $('#add-agent-card');

  // Modals / Overlays
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

  const detailOverlay = $('#agent-detail-overlay');
  const detailTitle = $('#detail-title');
  const detailStatus = $('#detail-status');
  const detailProgress = $('#detail-progress');
  const detailCwd = $('#detail-cwd');
  const detailMission = $('#detail-mission');
  const detailTasksList = $('#detail-tasks-list');
  const detailLogs = $('#detail-logs');

  // State
  let currentModalAgentId = null;
  let currentDetailAgentId = null;
  let cwdDebounce = null;
  let cwdSuggestionIndex = -1;
  let missionRecognition = null;

  // ── Auto Path Completion ──
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
          cwdSuggestions.replaceChildren();
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
  
  document.addEventListener('click', (e) => {
    if (e.target !== inputCwd && e.target !== cwdSuggestions) {
      cwdSuggestions.classList.add('hidden');
    }
  });

  // ── Voice Dictation ──
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

  // ── Card Rendering ──
  function createCardElement(agent) {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.dataset.agentId = agent.id;
    renderCardInner(card, agent);

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

  function renderCardInner(card, agent) {
    const statusClass = `status-${agent.status}`;
    const statusLabel = agent.status.charAt(0).toUpperCase() + agent.status.slice(1);

    const html = `
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

    card.replaceChildren();
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      while (doc.body.firstChild) {
        card.appendChild(doc.body.firstChild);
      }
    } catch (err) {
      console.error('[Orchestrator] Failed to parse card inner HTML:', err);
    }
  }

  function updateCardElement(agent) {
    const card = grid.querySelector(`[data-agent-id="${agent.id}"]`);
    if (!card) return;

    renderCardInner(card, agent);

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
    currentModalAgentId = null;
    if (window.bgEffect && window.Dashboard.activeModuleId === 'orchestrator') {
      window.bgEffect.setHue(220);
    }
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
  function openDetail(id) {
    const agent = window.Dashboard.agents.get(id);
    if (!agent) return;
    currentDetailAgentId = id;
    renderDetail(agent);
    detailOverlay.classList.remove('hidden');
    socket.emit('agent-logs', { id });
  }

  function closeDetail() {
    detailOverlay.classList.add('hidden');
    currentDetailAgentId = null;
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

    detailTasksList.replaceChildren();
    (agent.tasks || []).forEach(task => {
      const el = document.createElement('div');
      el.className = `detail-task task-${task.status}`;
      const icon = task.status === 'complete' ? '✓'
        : task.status === 'in-progress' ? '⟳'
        : task.status === 'failed' ? '✗'
        : '○';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'task-icon';
      iconSpan.textContent = icon;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'task-name-text';
      nameSpan.style.flex = '1';
      nameSpan.textContent = task.name;

      const retryBtn = document.createElement('button');
      retryBtn.className = 'task-retry-btn';
      retryBtn.title = 'Restart from here';
      retryBtn.dataset.taskId = task.id;

      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" /></svg>`,
          'text/html'
        );
        const svg = doc.body.querySelector('svg');
        if (svg) retryBtn.appendChild(svg);
      } catch (err) {
        console.error('[Orchestrator] Failed to parse retry icon:', err);
      }

      el.appendChild(iconSpan);
      el.appendChild(nameSpan);
      el.appendChild(retryBtn);

      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('agent-retry-task', { id: agent.id, taskId: task.id });
        if (window.vibePlayer) window.vibePlayer.playClick();
      });

      detailTasksList.appendChild(el);
    });

    renderLogs(agent.logs || []);
  }

  function renderLogs(logs) {
    if (!logs.length) {
      detailLogs.replaceChildren();
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'log-empty';
      emptyDiv.textContent = 'No logs yet...';
      detailLogs.appendChild(emptyDiv);
      return;
    }
    detailLogs.replaceChildren();
    logs.forEach(entry => appendLogLine(entry.message, entry.time));
  }

  function appendLogLine(message, time) {
    const empty = detailLogs.querySelector('.log-empty');
    if (empty) empty.remove();

    const line = document.createElement('div');
    line.className = 'log-line';
    const t = time ? new Date(time).toLocaleTimeString('en-GB') : new Date().toLocaleTimeString('en-GB');

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = t;

    const messageText = document.createTextNode(message);

    line.appendChild(timeSpan);
    line.appendChild(messageText);

    detailLogs.appendChild(line);
    detailLogs.scrollTop = detailLogs.scrollHeight;
  }

  // ── CustomEvent Handlers ──
  document.addEventListener('dashboard:agents-snapshot', (e) => {
    const agents = e.detail;
    // Clear dynamic cards (keep addCard)
    const cards = grid.querySelectorAll('.agent-card:not(.add-card)');
    cards.forEach(c => c.remove());

    agents.forEach(a => {
      grid.appendChild(createCardElement(a));
    });
  });

  document.addEventListener('dashboard:agent-created', (e) => {
    const agent = e.detail;
    grid.appendChild(createCardElement(agent));
    currentModalAgentId = agent.id;
  });

  document.addEventListener('dashboard:agent-updated', (e) => {
    const agent = e.detail;
    updateCardElement(agent);

    if (currentModalAgentId === agent.id && agent.status === 'review') {
      showStep('review');
      reviewMission.textContent = agent.mission;
      reviewTasksList.replaceChildren();
      agent.tasks.forEach((t, i) => {
        const el = document.createElement('div');
        el.className = 'review-task';
        
        const numSpan = document.createElement('span');
        numSpan.className = 'review-task-num';
        numSpan.textContent = i + 1;

        const nameSpan = document.createElement('span');
        nameSpan.textContent = t.name;

        el.appendChild(numSpan);
        el.appendChild(nameSpan);
        
        reviewTasksList.appendChild(el);
      });
    }

    if (currentDetailAgentId === agent.id) {
      renderDetail(agent);
    }
  });

  document.addEventListener('dashboard:agent-removed', (e) => {
    const data = e.detail;
    removeCardElement(data.id);
    if (currentDetailAgentId === data.id) closeDetail();
    if (currentModalAgentId === data.id) closeModal();
  });

  document.addEventListener('dashboard:agent-log', (e) => {
    const data = e.detail;
    if (currentDetailAgentId === data.id) {
      appendLogLine(data.log);
    }
  });

  document.addEventListener('dashboard:agent-logs-response', (e) => {
    const data = e.detail;
    if (currentDetailAgentId === data.id) {
      renderLogs(data.logs || []);
    }
  });

  // ── UI Listeners ──
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
    socket.emit('agent-decline', { id: currentModalAgentId });
    closeModal();
  });
  $('#btn-decline').addEventListener('click', () => {
    socket.emit('agent-decline', { id: currentModalAgentId });
    closeModal();
  });
  $('#btn-regenerate').addEventListener('click', () => {
    socket.emit('agent-decline', { id: currentModalAgentId });
    submitAgent();
    if (window.vibePlayer) window.vibePlayer.playClick();
  });
  $('#btn-accept').addEventListener('click', () => {
    socket.emit('agent-accept', { id: currentModalAgentId });
    closeModal();
    if (window.bgEffect) window.bgEffect.pulse();
    if (window.vibePlayer) window.vibePlayer.playClick();
  });

  $('#detail-back-btn').addEventListener('click', () => {
    closeDetail();
    if (window.vibePlayer) window.vibePlayer.playClick();
  });
  $('#detail-terminate-btn').addEventListener('click', (e) => {
    if (currentDetailAgentId) {
      socket.emit('agent-terminate', { id: currentDetailAgentId });
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
      if (currentDetailAgentId) {
        socket.emit('agent-retry', { id: currentDetailAgentId });
        if (window.vibePlayer) window.vibePlayer.playClick();
      }
    });
  }

  // Close modals on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!detailOverlay.classList.contains('hidden')) closeDetail();
      else if (!modalOverlay.classList.contains('hidden')) closeModal();
    }
  });

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  detailOverlay.addEventListener('click', (e) => {
    if (e.target === detailOverlay) closeDetail();
  });

  // ── Helper Utilities ──
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getAgentTitle(mission) {
    if (!mission) return 'Unnamed Mission';
    let title = mission.trim();
    title = title.replace(/^(please|your task is to|i need you to|can you|help me to)\s+/i, '');
    title = title.charAt(0).toUpperCase() + title.slice(1);
    
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

  // Handle reload/initial agents snapshot if already cached
  if (window.Dashboard.agents.size > 0) {
    const cards = grid.querySelectorAll('.agent-card:not(.add-card)');
    cards.forEach(c => c.remove());
    window.Dashboard.agents.forEach(a => {
      grid.appendChild(createCardElement(a));
    });
  }

  // ── Module Voice Commands ──
  if (window.VoiceCommands && window.VoiceCommands.registerIntent) {
    // 1. Launch Agent Command
    window.VoiceCommands.registerIntent('LAUNCH_AGENT', [
      'launch new agent', 'create new agent', 'new agent', 'spawn agent', 'launch agent',
      'create agent', 'generate agent'
    ], (params) => {
      window.Dashboard.showView('orchestrator');
      openModal();
      if (params && params.mission) {
        const missionInput = document.getElementById('input-mission');
        if (missionInput) {
          missionInput.value = params.mission;
          missionInput.dispatchEvent(new Event('input'));
        }
      }
      if (window.VoiceCommands.showToast) {
        window.VoiceCommands.showToast('Launching new agent...', 'success');
      }
    }, { label: 'Launch New Agent', icon: '🚀' });

    // 2. Terminate All Agents Command
    window.VoiceCommands.registerIntent('TERMINATE_ALL', [
      'terminate all agents', 'stop all agents', 'kill all agents',
      'terminate everything', 'stop everything'
    ], () => {
      if (window.Dashboard && window.Dashboard.agents) {
        window.Dashboard.agents.forEach(agent => {
          socket.emit('agent-terminate', { id: agent.id });
        });
      }
      if (window.VoiceCommands.showToast) {
        window.VoiceCommands.showToast('All agents terminated', 'success');
      }
    }, { label: 'Terminate All Agents', icon: '🛑', destructive: true });
  }

  // ── Register Settings Tabs (LLM & Orchestration) ──
  if (window.Dashboard && window.Dashboard.registerSettingsTab) {
    const DEFAULT_LLM = { provider: 'disabled', hostUrl: '', model: '', apiKey: '', maxTokens: 1024 };
    const DEFAULT_ORCHESTRATION = { executionMode: 'auto', vibesPath: '' };

    function loadPrefs(key, defaults) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
      } catch (_) { return { ...defaults }; }
    }

    // LLM Tab Specs
    const llmTab = {
      id: 'llm',
      title: 'LLM Backend',
      iconHTML: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tab-icon"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>`,
      htmlContent: `
        <div class="settings-section">
          <h3 class="settings-section-title">AI Engine Provider</h3>
          <div class="settings-row">
            <div class="settings-info">
              <span class="settings-label">Model Backend</span>
              <span class="settings-desc">Choose which LLM provider engine to orchestrate your agents</span>
            </div>
            <div class="settings-field">
              <select id="setting-provider">
                <option value="disabled">Disabled / Local Only</option>
                <option value="ollama">Ollama (Local)</option>
                <option value="lm-studio">LM Studio (Local)</option>
                <option value="openai-compatible">OpenAI Compatible (Remote/API)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-section llm-fields hidden" id="llm-fields-ollama">
          <h3 class="settings-section-title">Ollama Details</h3>
          <div class="settings-grid-row">
            <div class="settings-field">
              <label>Host URL</label>
              <input type="text" id="setting-ollama-host" placeholder="http://localhost:11434">
            </div>
            <div class="settings-field">
              <label>Model selection</label>
              <select id="setting-ollama-model">
                <option value="llama3.2">llama3.2</option>
                <option value="llama3.1">llama3.1</option>
                <option value="mistral">mistral</option>
                <option value="other">Other (type below)</option>
              </select>
            </div>
          </div>
          <div class="settings-field hidden" id="ollama-custom-model-row" style="margin-top:12px;">
            <label>Custom Model Name</label>
            <input type="text" id="setting-ollama-custom-model" placeholder="e.g. qwen2.5">
          </div>
        </div>

        <div class="settings-section llm-fields hidden" id="llm-fields-lm-studio">
          <h3 class="settings-section-title">LM Studio Details</h3>
          <div class="settings-grid-row">
            <div class="settings-field">
              <label>Host URL</label>
              <input type="text" id="setting-lm-host" placeholder="http://localhost:1234/v1">
            </div>
            <div class="settings-field">
              <label>Model Identifier</label>
              <input type="text" id="setting-lm-model" placeholder="local-model">
            </div>
          </div>
        </div>

        <div class="settings-section llm-fields hidden" id="llm-fields-openai-compatible">
          <h3 class="settings-section-title">OpenAI Compatible Gateway</h3>
          <div class="settings-grid-row" style="margin-bottom:12px;">
            <div class="settings-field">
              <label>API Endpoint Host</label>
              <input type="text" id="setting-openai-host" placeholder="https://api.openai.com/v1">
            </div>
            <div class="settings-field">
              <label>Model ID</label>
              <input type="text" id="setting-openai-model" placeholder="gpt-4o-mini">
            </div>
          </div>
          
          <div class="settings-grid-row">
            <div class="settings-field">
              <label>Secure API Access Key</label>
              <div style="display:flex; gap:8px;">
                <input type="password" id="setting-openai-key" style="flex:1;" placeholder="sk-...">
                <button class="btn" id="setting-key-toggle" style="padding:10px 14px;">👁</button>
              </div>
            </div>
            <div class="settings-field">
              <label>Max Generation Tokens</label>
              <input type="number" id="setting-max-tokens" min="64" max="32768" value="1024">
            </div>
          </div>
        </div>

        <div class="settings-section" id="llm-actions-section" style="display:none;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid var(--border); padding-top:16px;">
            <button class="btn btn-primary" id="setting-test-connection" style="padding:10px 18px; font-size:13px;">Test Backend Connection</button>
            <span class="save-status-msg" id="setting-test-result" style="font-size:13.5px; font-weight:500;"></span>
          </div>
        </div>
      `,
      onLoad: (panel) => {
        const llm = loadPrefs('vibes-llm-prefs', DEFAULT_LLM);
        
        const provSelect = panel.querySelector('#setting-provider');
        provSelect.value = llm.provider;

        // Populate fields
        panel.querySelector('#setting-ollama-host').value = llm.hostUrl || 'http://localhost:11434';
        panel.querySelector('#setting-ollama-model').value = llm.model || 'llama3.2';
        panel.querySelector('#setting-lm-host').value = llm.hostUrl || 'http://localhost:1234/v1';
        panel.querySelector('#setting-lm-model').value = llm.model || 'local-model';
        panel.querySelector('#setting-openai-host').value = llm.hostUrl || 'https://api.openai.com/v1';
        panel.querySelector('#setting-openai-model').value = llm.model || 'gpt-4o-mini';
        panel.querySelector('#setting-openai-key').value = llm.apiKey || '';
        panel.querySelector('#setting-max-tokens').value = llm.maxTokens || 1024;

        // Custom ollama model row toggle
        const ollamaModelSel = panel.querySelector('#setting-ollama-model');
        const ollamaCustomRow = panel.querySelector('#ollama-custom-model-row');
        
        const toggleOllamaCustom = () => {
          ollamaCustomRow.classList.toggle('hidden', ollamaModelSel.value !== 'other');
        };
        ollamaModelSel.addEventListener('change', toggleOllamaCustom);
        if (llm.provider === 'ollama' && !['llama3.2', 'llama3.1', 'mistral'].includes(llm.model)) {
          ollamaModelSel.value = 'other';
          panel.querySelector('#setting-ollama-custom-model').value = llm.model;
          toggleOllamaCustom();
        }

        // Show fields based on provider
        const showLLMFields = (prov) => {
          panel.querySelectorAll('.llm-fields').forEach(el => el.classList.add('hidden'));
          panel.querySelector('#llm-actions-section').style.display = prov === 'disabled' ? 'none' : 'block';
          if (prov !== 'disabled') {
            panel.querySelector(`#llm-fields-${prov}`).classList.remove('hidden');
          }
        };

        provSelect.addEventListener('change', function() {
          showLLMFields(this.value);
          panel.querySelector('#setting-test-result').textContent = '';
        });
        showLLMFields(llm.provider);

        // Key masking toggle
        panel.querySelector('#setting-key-toggle').addEventListener('click', (e) => {
          e.preventDefault();
          const keyInput = panel.querySelector('#setting-openai-key');
          const isPass = keyInput.type === 'password';
          keyInput.type = isPass ? 'text' : 'password';
          e.target.textContent = isPass ? '🙈' : '👁';
        });

        // Test connection logic
        panel.querySelector('#setting-test-connection').addEventListener('click', async (e) => {
          e.preventDefault();
          const resultEl = panel.querySelector('#setting-test-result');
          resultEl.textContent = 'Testing connection...';
          resultEl.className = 'save-status-msg';

          const prov = provSelect.value;
          let host = '';
          let model = '';
          let key = '';

          if (prov === 'ollama') {
            host = panel.querySelector('#setting-ollama-host').value.trim();
            model = ollamaModelSel.value === 'other' ? panel.querySelector('#setting-ollama-custom-model').value.trim() : ollamaModelSel.value;
          } else if (prov === 'lm-studio') {
            host = panel.querySelector('#setting-lm-host').value.trim();
            model = panel.querySelector('#setting-lm-model').value.trim();
          } else if (prov === 'openai-compatible') {
            host = panel.querySelector('#setting-openai-host').value.trim();
            model = panel.querySelector('#setting-openai-model').value.trim();
            key = panel.querySelector('#setting-openai-key').value;
          }

          try {
            if (prov === 'ollama') {
              const resp = await fetch('/api/llm/proxy/ollama-tags', {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': window.Dashboard.csrfToken
                },
                body: JSON.stringify({ host: host })
              });
              if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${resp.status}`);
              }
              const data = await resp.json();
              const models = (data.models || []).map(m => m.name);
              
              resultEl.textContent = '✅ Connected successfully';
              resultEl.className = 'save-status-msg success';

              if (models.length) {
                const cur = ollamaModelSel.value;
                ollamaModelSel.replaceChildren();
                models.forEach(m => {
                  const opt = document.createElement('option');
                  opt.value = m;
                  opt.textContent = m;
                  ollamaModelSel.appendChild(opt);
                });
                const optOther = document.createElement('option');
                optOther.value = 'other';
                optOther.textContent = 'Other (type below)';
                ollamaModelSel.appendChild(optOther);
                if (models.includes(cur)) ollamaModelSel.value = cur;
              }
            } else if (prov === 'lm-studio' || prov === 'openai-compatible') {
              // Use backend proxy to avoid CORS issues with local LLM hosts
              const resp = await fetch('/api/llm/proxy/models', {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': window.Dashboard.csrfToken
                },
                body: JSON.stringify({ host: host, key: key })
              });
              if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${resp.status}`);
              }
              const data = await resp.json();
              resultEl.textContent = `✅ Connected (${data.data?.length || 0} models)`;
              resultEl.className = 'save-status-msg success';
            }
          } catch (err) {
            resultEl.textContent = `❌ Test failed: ${err.message}`;
            resultEl.className = 'save-status-msg error';
          }
        });
      },
      onSave: (panel) => {
        const provider = panel.querySelector('#setting-provider').value;
        let hostUrl = '', model = '', apiKey = '';
        const maxTokens = parseInt(panel.querySelector('#setting-max-tokens').value || '1024');

        if (provider === 'ollama') {
          hostUrl = panel.querySelector('#setting-ollama-host').value.trim();
          const selectVal = panel.querySelector('#setting-ollama-model').value;
          model = selectVal === 'other' ? panel.querySelector('#setting-ollama-custom-model').value.trim() : selectVal;
        } else if (provider === 'lm-studio') {
          hostUrl = panel.querySelector('#setting-lm-host').value.trim();
          model = panel.querySelector('#setting-lm-model').value.trim();
        } else if (provider === 'openai-compatible') {
          hostUrl = panel.querySelector('#setting-openai-host').value.trim();
          model = panel.querySelector('#setting-openai-model').value.trim();
          apiKey = panel.querySelector('#setting-openai-key').value;
        }

        return {
          key: 'vibes-llm-prefs',
          data: { provider, hostUrl, model, apiKey, maxTokens }
        };
      }
    };

    // Orchestration Tab Specs
    const orchTab = {
      id: 'orchestration',
      title: 'Agent Orchestration',
      iconHTML: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tab-icon"><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></svg>`,
      htmlContent: `
        <div class="settings-section">
          <h3 class="settings-section-title">Process Configuration</h3>
          <div class="settings-row">
            <div class="settings-info">
              <span class="settings-label">Execution Mode</span>
              <span class="settings-desc">Control whether agent spawns execute real CLI tasks or simulated runs</span>
            </div>
            <div class="settings-field">
              <select id="setting-execution-mode">
                <option value="auto">Auto-Detect Execution</option>
                <option value="real">Force Real Vibes Spawns</option>
                <option value="demo">Demo / Mock Execution Only</option>
              </select>
            </div>
          </div>
          
          <div class="settings-row">
            <div class="settings-info">
              <span class="settings-label">Vibes Repository Path</span>
              <span class="settings-desc">Absolute local directory where the Vibes engine package resides</span>
            </div>
            <div class="settings-field">
              <input type="text" id="setting-vibes-path" style="width: 280px;" placeholder="e.g. /home/stephen/Vibes">
            </div>
          </div>
        </div>
      `,
      onLoad: (panel) => {
        const prefs = loadPrefs('vibes-orchestration-prefs', DEFAULT_ORCHESTRATION);
        panel.querySelector('#setting-execution-mode').value = prefs.executionMode || 'auto';
        panel.querySelector('#setting-vibes-path').value = prefs.vibesPath || '';
      },
      onSave: (panel) => {
        const executionMode = panel.querySelector('#setting-execution-mode').value;
        const vibesPath = panel.querySelector('#setting-vibes-path').value.trim();
        return {
          key: 'vibes-orchestration-prefs',
          data: { executionMode, vibesPath }
        };
      }
    };

    // Register into the global dashboard
    window.Dashboard.registerSettingsTab(llmTab);
    window.Dashboard.registerSettingsTab(orchTab);
  }

})();
