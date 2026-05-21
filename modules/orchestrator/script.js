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
    const empty = detailLogs.querySelector('.log-empty');
    if (empty) empty.remove();

    const line = document.createElement('div');
    line.className = 'log-line';
    const t = time ? new Date(time).toLocaleTimeString('en-GB') : new Date().toLocaleTimeString('en-GB');
    line.innerHTML = `<span class="log-time">${t}</span>${escapeHtml(message)}`;
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
      reviewTasksList.innerHTML = '';
      agent.tasks.forEach((t, i) => {
        const el = document.createElement('div');
        el.className = 'review-task';
        el.innerHTML = `<span class="review-task-num">${i + 1}</span><span>${escapeHtml(t.name)}</span>`;
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
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

})();
