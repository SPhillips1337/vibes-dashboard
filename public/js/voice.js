/* ═══════════════════════════════════════
   Vibes Dashboard — Voice Control
   CommandParser, Web Speech API, TTS,
   Toast notifications, Confirm dialogs
   ═══════════════════════════════════════ */

(function () {
  'use strict';

  // ── DOM Refs ──
  const voiceBtn = document.getElementById('voice-btn');
  const micIcon = voiceBtn?.querySelector('.voice-mic-icon');
  const waveIcon = voiceBtn?.querySelector('.voice-wave-icon');
  const noMicIcon = voiceBtn?.querySelector('.voice-nomic-icon');
  const toastContainer = document.getElementById('toast-container');
  const confirmOverlay = document.getElementById('confirm-overlay');

  // ── State ──
  const state = {
    isListening: false,
    isProcessing: false,
    micDenied: false,
    recognition: null,
    synth: window.speechSynthesis,
    audioDucked: false,
    previousVolume: null,
    pendingConfirm: null,      // { resolve, reject } for confirm dialog
    wakeRecognition: null,
    isWakeListening: false,
    wakeSuspended: false,
  };

  // ── Settings (loaded from localStorage) ──
  function loadVoicePrefs() {
    try {
      const raw = localStorage.getItem('vibes-voice-prefs');
      if (raw) return JSON.parse(raw);
    } catch (_) { /* fall through */ }
    return { voice: '', rate: 1.0, volume: 0.8, feedbackEnabled: true };
  }

  function loadGeneralPrefs() {
    try {
      const raw = localStorage.getItem('vibes-general-prefs');
      if (raw) return JSON.parse(raw);
    } catch (_) { /* fall through */ }
    return { autoLaunchOnCommand: true, theme: 'dark' };
  }

  let voicePrefs = loadVoicePrefs();
  let generalPrefs = loadGeneralPrefs();

  // Listen for settings changes from settings.js
  document.addEventListener('settings-changed', () => {
    voicePrefs = loadVoicePrefs();
    generalPrefs = loadGeneralPrefs();
    updateWakeWordState();
  });

  // ── Toast System ──
  function showToast(message, type = 'info', duration = 3000) {
    if (!toastContainer) return;
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.textContent = icons[type] || 'ℹ️';

    const textSpan = document.createElement('span');
    textSpan.className = 'toast-text';
    textSpan.textContent = message;

    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── Confirm Dialog ──
  function showConfirm(title, message) {
    return new Promise((resolve) => {
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      confirmOverlay.classList.remove('hidden');

      const cleanup = () => {
        confirmOverlay.classList.add('hidden');
        document.getElementById('confirm-ok').removeEventListener('click', onOk);
        document.getElementById('confirm-cancel').removeEventListener('click', onCancel);
      };

      const onOk = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };

      document.getElementById('confirm-ok').addEventListener('click', onOk);
      document.getElementById('confirm-cancel').addEventListener('click', onCancel);

      // Close on Escape
      const onKey = (e) => {
        if (e.key === 'Escape') { onCancel(); document.removeEventListener('keydown', onKey); }
      };
      document.addEventListener('keydown', onKey);
    });
  }

  // ── TTS ──
  function speak(text) {
    if (!state.synth || !voicePrefs.feedbackEnabled) return;
    state.synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = voicePrefs.rate;
    utterance.volume = voicePrefs.volume;
    if (voicePrefs.voice) {
      const found = state.synth.getVoices().find(v => v.name === voicePrefs.voice);
      if (found) utterance.voice = found;
    }
    state.synth.speak(utterance);
  }

  // ── Web Audio Sci-Fi Chime for Wake Word ──
  function playWakeBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      // Dual-tone futuristic synth beep (C5 to E5)
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.03); // Soft
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
      console.warn('[Voice] AudioContext blocked or not supported');
    }
  }

  // ── Audio Ducking ──
  function duckAudio() {
    const slider = document.getElementById('volume-slider');
    if (!slider || state.audioDucked) return;
    state.previousVolume = slider.value;
    slider.value = '0.2';
    slider.dispatchEvent(new Event('input'));
    state.audioDucked = true;
  }

  function restoreAudio() {
    const slider = document.getElementById('volume-slider');
    if (!slider || !state.audioDucked) return;
    if (state.previousVolume !== null) {
      slider.value = state.previousVolume;
      slider.dispatchEvent(new Event('input'));
    }
    state.previousVolume = null;
    state.audioDucked = false;
  }

  // ── Speech Recognition ──
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognitionSupported = !!SpeechRecognition;

  if (voiceBtn && recognitionSupported) {
    state.recognition = new SpeechRecognition();
    state.recognition.lang = 'en-US';
    state.recognition.continuous = false;
    state.recognition.interimResults = false;

    state.recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim();
      handleCommand(transcript);
    };

    state.recognition.onend = () => {
      // Don't reset if we're already processing (handleCommand may have set it)
      if (!state.isProcessing) {
        setVoiceState('idle');
        restoreAudio();
      }
    };

    state.recognition.onerror = (e) => {
      if (e.error === 'not-allowed') {
        state.micDenied = true;
        setVoiceState('no-mic');
        showToast('Microphone access denied. Enable it in browser site settings.', 'error');
      } else if (e.error === 'no-speech') {
        showToast('No speech detected. Try again.', 'info');
        setVoiceState('idle');
        restoreAudio();
      } else if (e.error === 'network') {
        console.warn('[Voice] Recognition network error');
        showToast('Speech recognition failed (Network/SSL). Use localhost or a valid certificate.', 'error', 5000);
        setVoiceState('idle');
        restoreAudio();
      } else {
        console.error('[Voice] Recognition error:', e.error);
        showToast(`Recognition error: ${e.error}`, 'error');
        setVoiceState('idle');
        restoreAudio();
      }
    };

    // Click handler
    voiceBtn.addEventListener('click', () => {
      if (!window.isSecureContext) {
        showToast('Voice recognition requires a secure context (HTTPS or localhost).', 'error', 5000);
        return;
      }
      if (state.micDenied) return;
      if (state.isListening) {
        stopListening();
      } else {
        stopWakeWordListening();
        startListening();
      }
    });

    // Check permission state on load
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' }).then((status) => {
        if (status.state === 'denied') {
          state.micDenied = true;
          setVoiceState('no-mic');
        }
        status.onchange = () => {
          if (status.state === 'denied') {
            state.micDenied = true;
            setVoiceState('no-mic');
          } else if (status.state === 'granted') {
            state.micDenied = false;
            setVoiceState('idle');
          }
        };
      }).catch(() => { /* permissions API not supported */ });
    }
  } else if (voiceBtn) {
    // SpeechRecognition not supported
    voiceBtn.title = 'Voice control not supported in this browser';
    voiceBtn.style.display = 'none';
  }

  function startListening() {
    if (!state.recognition || state.micDenied || state.isListening || state.isProcessing) return;
    try {
      duckAudio();
      state.recognition.start();
      setVoiceState('listening');
      showToast('Listening...', 'info', 2000);
    } catch (e) {
      console.error('[Voice] start failed:', e);
      setVoiceState('idle');
      restoreAudio();
    }
  }

  function stopListening() {
    try { state.recognition?.stop(); } catch (_) { /* ignore */ }
    setVoiceState('idle');
    restoreAudio();
  }

  function setVoiceState(newState) {
    if (!voiceBtn) return;
    state.isListening = newState === 'listening';
    state.isProcessing = newState === 'processing';

    voiceBtn.classList.remove('listening', 'processing', 'no-mic');
    micIcon?.classList.remove('hidden');
    waveIcon?.classList.add('hidden');
    noMicIcon?.classList.add('hidden');

    if (newState === 'listening') {
      voiceBtn.classList.add('listening');
      micIcon?.classList.add('hidden');
      waveIcon?.classList.remove('hidden');
      voiceBtn.dataset.tooltip = 'Listening...';
    } else if (newState === 'processing') {
      voiceBtn.classList.add('processing');
      voiceBtn.dataset.tooltip = 'Processing...';
    } else if (newState === 'no-mic') {
      voiceBtn.classList.add('no-mic');
      micIcon?.classList.add('hidden');
      noMicIcon?.classList.remove('hidden');
      voiceBtn.dataset.tooltip = 'Microphone access denied';
    } else {
      voiceBtn.dataset.tooltip = 'Voice Command';
      // Automatically restart wake word if enabled when returning to idle
      if (generalPrefs.wakeWordEnabled) {
        setTimeout(startWakeWordListening, 400);
      }
    }
  }

  // ── Command Parser ──
  const intents = [];

  function registerIntent(name, triggers, action, options = {}) {
    let destructive = false;
    let label = '';
    let icon = '🎤';
    if (typeof options === 'boolean') {
      destructive = options;
    } else if (options && typeof options === 'object') {
      destructive = !!options.destructive;
      label = options.label || '';
      icon = options.icon || '🎤';
    }
    intents.push({
      name,
      triggers: triggers.map(t => t.toLowerCase()),
      action,
      destructive,
      label,
      icon
    });
  }

  function classify(transcript) {
    // Strip trailing punctuation and common filler words
    const clean = transcript.toLowerCase()
      .replace(/[.,!?;]$/, '')
      .replace(/^(?:hey|hi|hello|please|okay|ok|can you|could you)\s+/i, '')
      .trim();

    const lower = transcript.toLowerCase().replace(/[.,!?;]$/, '').trim();

    for (const intent of intents) {
      for (const trigger of intent.triggers) {
        const cleanTrigger = trigger.toLowerCase().trim();
        // Match exact or starts with (for params)
        if (lower === cleanTrigger || lower.startsWith(cleanTrigger + ' ') ||
          clean === cleanTrigger || clean.startsWith(cleanTrigger + ' ')) {
          return intent;
        }
      }
    }
    return null;
  }

  function extractParams(transcript, intent) {
    if (intent.name === 'LAUNCH_AGENT') {
      // Try to extract: "launch agent to [mission]" or "create agent [mission]"
      const match = transcript.match(/(?:launch|create|new)\s+(?:agent|mission)\s+(?:to\s+)?(.+)/i);
      return { mission: match ? match[1].trim() : '' };
    }
    return {};
  }

  async function handleCommand(transcript) {
    if (!transcript) return;
    setVoiceState('processing');
    showToast(`Command: "${transcript}"`, 'info', 2000);

    const matched = classify(transcript);
    if (!matched) {
      showToast('Command not recognised. Try "launch new agent" or "play music".', 'error', 4000);
      speak('Command not recognised.');
      setVoiceState('idle');
      restoreAudio();
      return;
    }

    // Confirm destructive commands
    if (matched.destructive) {
      const confirmed = await showConfirm(
        'Confirm Action',
        `Are you sure you want to "${transcript}"? This action cannot be undone.`
      );
      if (!confirmed) {
        showToast('Command cancelled.', 'info');
        setVoiceState('idle');
        restoreAudio();
        return;
      }
    }

    // Execute
    try {
      const params = extractParams(transcript, matched);
      matched.action(params, transcript);
      speak(matched.name === 'LAUNCH_AGENT' ? 'Launching agent' : `OK`);
    } catch (err) {
      console.error('[Voice] Command execution failed:', err);
      showToast('Command failed. See console for details.', 'error');
    }

    setVoiceState('idle');
    restoreAudio();
  }

  // ── Intent Catalog ──
  registerIntent('HELLO', [
    'hello', 'hi', 'hey', 'greetings', 'is anyone there',
  ], () => {
    const responses = [
      'Hello! How can I help you orchestrate today?',
      'Greetings. Mission control is online and ready.',
      'Hi there. What vibes are we chasing today?',
      'Hello. Systems are green and awaiting your command.',
    ];
    const pick = responses[Math.floor(Math.random() * responses.length)];
    showToast(pick, 'success');
    speak(pick);
  }, { label: 'Greeting', icon: '👋' });

  registerIntent('MUSIC_PLAY', [
    'play music', 'start music', 'music play', 'music start', 'play', 'start playing',
  ], () => {
    const playBtn = document.getElementById('btn-play-pause');
    if (playBtn) playBtn.click();
    showToast('Playing music', 'success');
  }, { label: 'Play Music', icon: '▶️' });

  registerIntent('MUSIC_PAUSE', [
    'stop music', 'pause music', 'music stop', 'music pause', 'stop', 'pause',
  ], () => {
    const playBtn = document.getElementById('btn-play-pause');
    if (playBtn) playBtn.click();
    showToast('Music paused', 'success');
  }, { label: 'Pause Music', icon: '⏸' });

  registerIntent('MUSIC_NEXT', [
    'next track', 'skip song', 'next song', 'skip track', 'next',
  ], () => {
    document.getElementById('btn-next')?.click();
    showToast('Next track', 'success');
  }, { label: 'Next Track', icon: '⏭' });

  registerIntent('MUSIC_PREV', [
    'previous track', 'previous song', 'go back', 'prev',
  ], () => {
    document.getElementById('btn-prev')?.click();
    showToast('Previous track', 'success');
  }, { label: 'Previous Track', icon: '⏮' });

  registerIntent('NAV_SETTINGS', [
    'open settings', 'show settings', 'settings', 'go to settings',
  ], () => {
    document.getElementById('nav-settings')?.click();
    showToast('Opening settings', 'success');
  }, { label: 'Open Settings', icon: '⚙️' });

  registerIntent('TOGGLE_THEME', [
    'toggle theme', 'light mode', 'dark mode', 'switch theme',
  ], () => {
    document.getElementById('theme-toggle')?.click();
    showToast('Theme toggled', 'success');
  }, { label: 'Toggle Theme', icon: '🎨' });

  registerIntent('CANCEL', [
    'cancel', 'stop listening', 'go away', 'nevermind', 'never mind', 'abort',
  ], () => {
    showToast('Cancelled', 'info');
    // Does nothing else, just acknowledges and exits
  }, { label: 'Cancel', icon: '🚫' });

  // ── Plugin Support (for Phase 3 system discovery) ──
  window.VoiceCommands = {
    registerIntent,
    showToast,
    showConfirm,
    speak,
    startListening,
    stopListening,
    handleCommand,
    playWakeBeep,
    duckAudio,
    restoreAudio,
    suspendWakeWord: (suspend) => {
      state.wakeSuspended = suspend;
      if (suspend) {
        if (state.wakeRecognition && state.isWakeListening) {
          return new Promise((resolve) => {
            let resolved = false;
            state.resolveWakeStop = () => {
              if (!resolved) {
                resolved = true;
                resolve();
              }
            };
            stopWakeWordListening();
            // Safety fallback timeout
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                resolve();
              }
            }, 400);
          });
        }
        return Promise.resolve();
      } else {
        updateWakeWordState();
        return Promise.resolve();
      }
    }
  };

  console.log('[Voice] Voice control loaded with', intents.length, 'commands');

  // ── Voice Help Modal ──
  const helpBtn = document.getElementById('voice-help-btn');
  const helpOverlay = document.getElementById('voice-help-overlay');
  const helpList = document.getElementById('help-commands-list');
  const helpClose = document.getElementById('voice-help-close');
  const helpGotIt = document.getElementById('voice-help-gotit');

  function openHelpModal() {
    if (!helpList) return;
    helpList.replaceChildren();
    
    // De-duplicate commands by label and icon to keep the modal neat
    const seen = new Set();

    intents.forEach(intent => {
      const label = intent.label || intent.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const icon = intent.icon || '🎤';
      
      const key = `${label}-${icon}`;
      if (seen.has(key)) return;
      seen.add(key);

      const triggers = intent.triggers.slice(0, 3).join(', ');
      const more = intent.triggers.length > 3 ? ` +${intent.triggers.length - 3} more` : '';
      const item = document.createElement('div');
      item.className = 'help-command-item';
      
      const iconDiv = document.createElement('div');
      iconDiv.className = 'help-cmd-icon';
      iconDiv.style.background = intent.destructive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.12)';
      
      if (icon.trim().startsWith('<')) {
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(icon, 'image/svg+xml');
          iconDiv.appendChild(doc.documentElement);
        } catch (err) {
          iconDiv.textContent = icon;
        }
      } else {
        iconDiv.textContent = icon;
      }

      const textDiv = document.createElement('div');
      textDiv.className = 'help-cmd-text';
      
      const labelText = document.createTextNode(label + ' ');
      
      const triggersSpan = document.createElement('span');
      triggersSpan.className = 'help-cmd-triggers';
      triggersSpan.textContent = `"${triggers}"${more}`;

      textDiv.appendChild(labelText);
      textDiv.appendChild(triggersSpan);

      item.appendChild(iconDiv);
      item.appendChild(textDiv);
      
      helpList.appendChild(item);
    });

    helpOverlay.classList.remove('hidden');
  }

  function closeHelpModal() {
    helpOverlay.classList.add('hidden');
  }

  if (helpBtn) helpBtn.addEventListener('click', openHelpModal);
  if (helpClose) helpClose.addEventListener('click', closeHelpModal);
  if (helpGotIt) helpGotIt.addEventListener('click', closeHelpModal);
  if (helpOverlay) {
    helpOverlay.addEventListener('click', (e) => {
      if (e.target === helpOverlay) closeHelpModal();
    });
  }

  // Expose for programmatic opening
  window.VoiceCommands.openHelpModal = openHelpModal;
  window.VoiceCommands.closeHelpModal = closeHelpModal;

  // ── Wake Word Continuous Recognition Engine ──
  function startWakeWordListening() {
    if (!recognitionSupported || state.micDenied || state.isListening || state.isProcessing || state.isWakeListening) return;

    if (!state.wakeRecognition) {
      state.wakeRecognition = new SpeechRecognition();
      state.wakeRecognition.lang = 'en-US';
      state.wakeRecognition.continuous = true;
      state.wakeRecognition.interimResults = true;

      state.wakeRecognition.onresult = (e) => {
        const lastResult = e.results[e.results.length - 1];
        const transcript = lastResult[0].transcript.toLowerCase();

        // Scan for the wake word "vibes"
        if (transcript.includes('vibes')) {
          console.log('[Voice] Wake word "Vibes" detected!');
          triggerWakeWord();
        }
      };

      state.wakeRecognition.onend = () => {
        state.isWakeListening = false;
        if (state.resolveWakeStop) {
          state.resolveWakeStop();
          state.resolveWakeStop = null;
        }
        // Auto-restart if still enabled and we aren't in another active state
        if (generalPrefs.wakeWordEnabled && !state.isListening && !state.isProcessing && !state.micDenied && !state.wakeSuspended) {
          setTimeout(startWakeWordListening, 300);
        }
      };

      state.wakeRecognition.onerror = (e) => {
        if (e.error === 'not-allowed') {
          state.micDenied = true;
          setVoiceState('no-mic');
          stopWakeWordListening();
        }
        console.warn('[Voice] Wake recognition error:', e.error);
      };
    }

    try {
      state.wakeRecognition.start();
      state.isWakeListening = true;
      console.log('[Voice] Wake word detection active ("Vibes")');
    } catch (err) {
      console.error('[Voice] Failed to start wake word engine:', err);
    }
  }

  function stopWakeWordListening() {
    if (state.wakeRecognition && state.isWakeListening) {
      try {
        state.wakeRecognition.stop();
      } catch (_) { }
    }
  }

  function triggerWakeWord() {
    stopWakeWordListening();
    playWakeBeep();
    showToast('Awaiting command...', 'success', 2000);
    setTimeout(() => {
      startListening();
    }, 150);
  }

  function updateWakeWordState() {
    const indicator = document.getElementById('wake-word-indicator');
    if (generalPrefs.wakeWordEnabled && recognitionSupported && !state.micDenied) {
      indicator?.classList.remove('hidden');
      startWakeWordListening();
    } else {
      indicator?.classList.add('hidden');
      stopWakeWordListening();
    }
  }

  // tab visibility optimization
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopWakeWordListening();
    } else {
      updateWakeWordState();
    }
  });

  // Startup activation
  setTimeout(updateWakeWordState, 1000);
})();
