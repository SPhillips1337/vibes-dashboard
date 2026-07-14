/* ═══════════════════════════════════════
   Vibes Dashboard — Settings Manager
   Tabbed settings modal, localStorage persistence,
   voice population, LLM connection test
   ═══════════════════════════════════════ */

(function () {
  'use strict';

  // ── DOM Refs ──
  const overlay = document.getElementById('settings-overlay');
  const closeBtn = document.getElementById('settings-close-btn');
  const tabs = document.querySelectorAll('.settings-tab');
  const panels = {
    general: document.getElementById('settings-general'),
    voice: document.getElementById('settings-voice'),
    llm: document.getElementById('settings-llm'),
    orchestration: document.getElementById('settings-orchestration'),
  };

  // ── Defaults ──
  const DEFAULT_VOICE = { voice: '', rate: 1.0, volume: 0.8, feedbackEnabled: true };
  const DEFAULT_GENERAL = { autoLaunchOnCommand: true, wakeWordEnabled: false, theme: 'dark' };
  const DEFAULT_LLM = { provider: 'disabled', hostUrl: '', model: '', apiKey: '', maxTokens: 1024 };
  const DEFAULT_ORCHESTRATION = { executionMode: 'auto', vibesPath: '' };

  // ── Load / Save ──
  function loadPrefs(key, defaults) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
    } catch (_) { return { ...defaults }; }
  }

  function savePrefs(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // ── Tab Switching ──
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      Object.entries(panels).forEach(([key, panel]) => {
        panel.classList.toggle('hidden', key !== target);
      });
    });
  });

  // ── Open / Close ──
  function openSettings() {
    overlay.classList.remove('hidden');
    loadSettingsIntoUI();
    // Populate voices on open (they may have loaded since page init)
    populateVoices();
  }

  function closeSettings() {
    overlay.classList.add('hidden');
  }

  closeBtn.addEventListener('click', closeSettings);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSettings();
  });

  // Esc key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeSettings();
  });

  // ── Wire settings sidebar button ──
  const navSettings = document.getElementById('nav-settings');
  if (navSettings) {
    navSettings.addEventListener('click', (e) => {
      e.preventDefault();
      openSettings();
    });
  }

  // ── Populate Voices ──
  function populateVoices() {
    const select = document.getElementById('setting-voice');
    if (!select) return;
    const synth = window.speechSynthesis;
    const voices = synth.getVoices().filter(v => v.lang.startsWith('en'));
    select.replaceChildren();
    const optDefault = document.createElement('option');
    optDefault.value = '';
    optDefault.textContent = 'Default (System Voice)';
    select.appendChild(optDefault);
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      select.appendChild(opt);
    });
  }

  if (window.speechSynthesis) {
    if (window.speechSynthesis.getVoices().length) {
      populateVoices();
    }
    window.speechSynthesis.onvoiceschanged = populateVoices;
  }

  // ── Load settings into UI ──
  function loadSettingsIntoUI() {
    const voice = loadPrefs('vibes-voice-prefs', DEFAULT_VOICE);
    const general = loadPrefs('vibes-general-prefs', DEFAULT_GENERAL);
    const llm = loadPrefs('vibes-llm-prefs', DEFAULT_LLM);
    const orchestration = loadPrefs('vibes-orchestration-prefs', DEFAULT_ORCHESTRATION);

    // General tab
    setToggle('setting-feedback-toggle', voice.feedbackEnabled);
    setToggle('setting-autolaunch-toggle', general.autoLaunchOnCommand);
    setToggle('setting-wakeword-toggle', general.wakeWordEnabled);
    setSelect('setting-theme', general.theme);

    // Voice tab
    setSelect('setting-voice', voice.voice);
    setSlider('setting-rate', Math.round(voice.rate * 100));
    setSlider('setting-volume', Math.round(voice.volume * 100));

    // LLM tab
    setSelect('setting-provider', llm.provider);
    setInput('setting-ollama-host', llm.hostUrl || 'http://localhost:11434');
    setSelect('setting-ollama-model', llm.model || 'llama3.2');
    setInput('setting-lm-host', llm.hostUrl || 'http://localhost:1234/v1');
    setInput('setting-lm-model', llm.model || 'local-model');
    setInput('setting-openai-host', llm.hostUrl || 'https://api.openai.com/v1');
    setInput('setting-openai-model', llm.model || 'gpt-4o-mini');
    setInput('setting-openai-key', llm.apiKey || '');
    setInput('setting-max-tokens', llm.maxTokens || 1024);

    // Orchestration tab
    setSelect('setting-execution-mode', orchestration.executionMode || 'auto');
    setInput('setting-vibes-path', orchestration.vibesPath || '');

    // Show correct LLM fields
    showLLMFields(llm.provider);
    clearTestResult();
  }

  // ── Helper: set toggle state ──
  function setToggle(id, active) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', active);
  }

  function setSelect(id, value) {
    const el = document.getElementById(id);
    if (el && value) el.value = value;
  }

  function setInput(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function setSlider(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
    // Trigger display update
    const event = new Event('input', { bubbles: true });
    el?.dispatchEvent(event);
  }

  // ── Toggle behavior ──
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.toggle');
    if (toggle) {
      toggle.classList.toggle('active');
    }
  });

  // ── Show/hide LLM fields based on provider ──
  function showLLMFields(provider) {
    document.querySelectorAll('.llm-fields').forEach(el => el.classList.add('hidden'));
    if (provider && provider !== 'disabled') {
      const target = document.getElementById(`llm-fields-${provider}`);
      if (target) target.classList.remove('hidden');
    }
  }

  // ── Live slider display ──
  document.getElementById('setting-rate')?.addEventListener('input', function () {
    document.getElementById('setting-rate-val').textContent = (this.value / 100).toFixed(1) + 'x';
  });
  document.getElementById('setting-volume')?.addEventListener('input', function () {
    document.getElementById('setting-volume-val').textContent = this.value + '%';
  });

  // ── LLM provider change — show relevant fields ──
  document.getElementById('setting-provider')?.addEventListener('change', function () {
    showLLMFields(this.value);
    clearTestResult();
  });

  // ── Ollama model select — show custom field ──
  document.getElementById('setting-ollama-model')?.addEventListener('change', function () {
    const customRow = document.getElementById('ollama-custom-model-row');
    if (customRow) customRow.style.display = this.value === 'other' ? 'flex' : 'none';
  });

  // ── API key show/hide ──
  document.getElementById('setting-key-toggle')?.addEventListener('click', function () {
    const input = document.getElementById('setting-openai-key');
    if (input) {
      input.type = input.type === 'password' ? 'text' : 'password';
      this.textContent = input.type === 'password' ? '👁' : '🙈';
    }
  });

  // ── Test Connection ──
  document.getElementById('setting-test-connection')?.addEventListener('click', async function () {
    const resultEl = document.getElementById('setting-test-result');
    resultEl.textContent = 'Testing...';
    resultEl.className = 'test-result';

    const provider = document.getElementById('setting-provider')?.value || 'disabled';
    let hostUrl = '';
    let model = '';

    if (provider === 'ollama') {
      hostUrl = document.getElementById('setting-ollama-host')?.value || 'http://localhost:11434';
      const modelSelect = document.getElementById('setting-ollama-model');
      model = modelSelect?.value === 'other'
        ? document.getElementById('setting-ollama-custom-model')?.value || ''
        : modelSelect?.value || '';
    } else if (provider === 'lm-studio') {
      hostUrl = document.getElementById('setting-lm-host')?.value || 'http://localhost:1234/v1';
      model = document.getElementById('setting-lm-model')?.value || '';
    } else if (provider === 'openai-compatible') {
      hostUrl = document.getElementById('setting-openai-host')?.value || 'https://api.openai.com/v1';
      model = document.getElementById('setting-openai-model')?.value || '';
    }

    try {
      let ok = false;
      let models = [];

      if (provider === 'ollama') {
        // Test /api/tags via proxy and discover models
        const resp = await fetch('/api/llm/proxy/ollama-tags', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.Dashboard.csrfToken
          },
          body: JSON.stringify({ host: hostUrl })
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        models = (data.models || []).map(m => m.name);
        ok = true;
      } else if (provider === 'lm-studio' || provider === 'openai-compatible') {
        const key = document.getElementById('setting-openai-key')?.value || '';
        // Use backend proxy to avoid CORS issues with local LLM hosts
        const resp = await fetch('/api/llm/proxy/models', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.Dashboard.csrfToken
          },
          body: JSON.stringify({ host: hostUrl, key: key })
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        resultEl.textContent = `✅ Connected (${data.data?.length || 0} models)`;
        resultEl.className = 'test-result success';
        ok = true;
      } else {
        throw new Error('No provider selected');
      }

      resultEl.textContent = '✅ Connected successfully';
      resultEl.className = 'test-result success';

      // Auto-populate Ollama models
      if (provider === 'ollama' && models.length) {
        const modelSelect = document.getElementById('setting-ollama-model');
        if (modelSelect) {
          const current = modelSelect.value;
          modelSelect.replaceChildren();
          models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
          });
          // Add "Other" option
          const other = document.createElement('option');
          other.value = 'other';
          other.textContent = 'Other (type below)';
          modelSelect.appendChild(other);
          // Restore selection if possible
          if ([...modelSelect.options].some(o => o.value === current)) {
            modelSelect.value = current;
          }
          const customRow = document.getElementById('ollama-custom-model-row');
          if (customRow) customRow.style.display = 'none';
        }
      }
    } catch (err) {
      resultEl.textContent = `❌ Connection failed: ${err.message}`;
      resultEl.className = 'test-result error';
    }
  });

  function clearTestResult() {
    const el = document.getElementById('setting-test-result');
    if (el) { el.textContent = ''; el.className = 'test-result'; }
  }

  // ── Test Voice ──
  document.getElementById('setting-test-voice')?.addEventListener('click', function () {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance('This is a test of the voice system.');
    const voiceName = document.getElementById('setting-voice')?.value;
    if (voiceName) {
      const voice = synth.getVoices().find(v => v.name === voiceName);
      if (voice) utterance.voice = voice;
    }
    utterance.rate = (parseInt(document.getElementById('setting-rate')?.value || '100')) / 100;
    utterance.volume = (parseInt(document.getElementById('setting-volume')?.value || '80')) / 100;
    synth.speak(utterance);
  });

  // ── Save ──
  document.getElementById('settings-save-btn')?.addEventListener('click', function () {
    // Gather General
    const feedbackEnabled = document.getElementById('setting-feedback-toggle')?.classList.contains('active') ?? true;
    const autoLaunchOnCommand = document.getElementById('setting-autolaunch-toggle')?.classList.contains('active') ?? true;
    const wakeWordEnabled = document.getElementById('setting-wakeword-toggle')?.classList.contains('active') ?? false;
    const theme = document.getElementById('setting-theme')?.value || 'dark';

    // Gather Voice
    const voice = document.getElementById('setting-voice')?.value || '';
    const rate = (parseInt(document.getElementById('setting-rate')?.value || '100')) / 100;
    const volume = (parseInt(document.getElementById('setting-volume')?.value || '80')) / 100;

    // Gather LLM
    const provider = document.getElementById('setting-provider')?.value || 'disabled';
    let hostUrl = '', model = '', apiKey = '';
    const maxTokens = parseInt(document.getElementById('setting-max-tokens')?.value || '1024');

    if (provider === 'ollama') {
      hostUrl = document.getElementById('setting-ollama-host')?.value || '';
      const modelSelect = document.getElementById('setting-ollama-model');
      model = modelSelect?.value === 'other'
        ? document.getElementById('setting-ollama-custom-model')?.value || ''
        : modelSelect?.value || '';
    } else if (provider === 'lm-studio') {
      hostUrl = document.getElementById('setting-lm-host')?.value || '';
      model = document.getElementById('setting-lm-model')?.value || '';
    } else if (provider === 'openai-compatible') {
      hostUrl = document.getElementById('setting-openai-host')?.value || '';
      model = document.getElementById('setting-openai-model')?.value || '';
      apiKey = document.getElementById('setting-openai-key')?.value || '';
    }

    // Gather Orchestration
    const executionMode = document.getElementById('setting-execution-mode')?.value || 'auto';
    const vibesPath = document.getElementById('setting-vibes-path')?.value || '';

    savePrefs('vibes-voice-prefs', { voice, rate, volume, feedbackEnabled });
    savePrefs('vibes-general-prefs', { autoLaunchOnCommand, wakeWordEnabled, theme });
    savePrefs('vibes-llm-prefs', { provider, hostUrl, model, apiKey, maxTokens });
    savePrefs('vibes-orchestration-prefs', { executionMode, vibesPath });

    // Apply theme immediately
    if (theme === 'light') {
      document.body.classList.add('light-mode');
      document.querySelector('.sun-icon')?.classList.add('hidden');
      document.querySelector('.moon-icon')?.classList.remove('hidden');
    } else {
      document.body.classList.remove('light-mode');
      document.querySelector('.sun-icon')?.classList.remove('hidden');
      document.querySelector('.moon-icon')?.classList.add('hidden');
    }
    localStorage.setItem('vibes-theme', theme);

    // Save to server filesystem
    fetch('/api/settings', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-CSRF-Token': window.Dashboard.csrfToken
      },
      body: JSON.stringify({
        'vibes-voice-prefs': { voice, rate, volume, feedbackEnabled },
        'vibes-general-prefs': { autoLaunchOnCommand, wakeWordEnabled, theme },
        'vibes-llm-prefs': { provider, hostUrl, model, apiKey, maxTokens },
        'vibes-orchestration-prefs': { executionMode, vibesPath },
        'vibes-theme': theme
      })
    }).catch(err => console.error('[Settings] Failed to save settings to server:', err));

    // Dispatch event for other modules
    document.dispatchEvent(new CustomEvent('settings-changed'));

    // Toast feedback
    const toast = window.VoiceCommands;
    if (toast && toast.showToast) {
      toast.showToast('Settings saved', 'success');
    }

    closeSettings();
  });

  console.log('[Settings] Settings manager loaded');
})();
