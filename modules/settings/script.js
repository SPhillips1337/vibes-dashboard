(function () {
  'use strict';

  // ── Settings Configuration and Registries ──
  const registeredTabs = [];
  let currentActiveTabId = null;

  function init() {
    const rootPanel = document.getElementById('view-settings');
    if (!rootPanel) return;

    // Register default core tabs on load
    registerCoreTabs();

    // Setup listener for future dynamic registration
    document.addEventListener('dashboard:settings-tab-registered', (e) => {
      const tabSpec = e.detail;
      renderTab(tabSpec);
    });

    // Setup static event handlers
    const logoutBtn = document.getElementById('settings-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (window.Dashboard && window.Dashboard.logout) {
          window.Dashboard.logout();
        }
      });
    }

    const saveBtn = document.getElementById('settings-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', handleSave);
    }

    // Render all pre-registered or pending tabs
    initializeTabs();

    // Setup logical focus flow and keyboard navigation
    setupKeyboardNavigation(rootPanel);
  }

  // Initialize immediately since script is dynamically loaded
  init();

  // ── Tab Injection Engine ──
  function initializeTabs() {
    const list = document.getElementById('settings-tabs-list');
    const container = document.getElementById('settings-panels-container');
    if (!list || !container) return;

    list.replaceChildren();
    container.replaceChildren();

    // Retrieve pending tabs from Dashboard namespace
    if (window.Dashboard && window.Dashboard.settingsTabs) {
      window.Dashboard.settingsTabs.forEach(tab => {
        if (!registeredTabs.some(t => t.id === tab.id)) {
          registeredTabs.push(tab);
        }
      });
    }

    // Render authorized tabs based on user role
    const currentUser = window.Dashboard.currentUser || { role: 'operator' };
    const authTabs = registeredTabs.filter(tab => {
      return !tab.roles || tab.roles.includes(currentUser.role);
    });

    authTabs.forEach(tab => {
      renderTabElements(tab, list, container);
    });

    // Activate first tab
    if (authTabs.length > 0) {
      activateTab(authTabs[0].id);
    }
  }

  function renderTab(tabSpec) {
    if (registeredTabs.some(t => t.id === tabSpec.id)) return;
    registeredTabs.push(tabSpec);

    const list = document.getElementById('settings-tabs-list');
    const container = document.getElementById('settings-panels-container');
    const currentUser = window.Dashboard.currentUser || { role: 'operator' };

    if (list && container && (!tabSpec.roles || tabSpec.roles.includes(currentUser.role))) {
      renderTabElements(tabSpec, list, container);
      // If no active tab, activate this
      if (!currentActiveTabId) {
        activateTab(tabSpec.id);
      }
    }
  }

  function renderTabElements(tab, list, container) {
    // 1. Create Tab Button
    const btn = document.createElement('button');
    btn.className = 'settings-tab';
    btn.id = `tab-btn-${tab.id}`;
    btn.dataset.tab = tab.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('tabindex', '-1');
    btn.setAttribute('aria-controls', `tab-panel-${tab.id}`);

    // Safe inline icons support
    if (tab.iconHTML) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(tab.iconHTML, 'image/svg+xml');
      btn.appendChild(doc.documentElement);
    }
    const labelSpan = document.createElement('span');
    labelSpan.textContent = tab.title;
    btn.appendChild(labelSpan);

    btn.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      activateTab(tab.id);
    });

    list.appendChild(btn);

    // 2. Create Panel Container
    const panel = document.createElement('div');
    panel.className = 'settings-panel hidden';
    panel.id = `tab-panel-${tab.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tab-btn-${tab.id}`);
    
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(tab.htmlContent, 'text/html');
      while (doc.body.firstChild) {
        panel.appendChild(doc.body.firstChild);
      }
    } catch (err) {
      console.error(`[Settings] Failed to parse HTML content for tab ${tab.id}:`, err);
    }

    container.appendChild(panel);

    // 3. Execute onLoad Lifecycle
    try {
      if (tab.onLoad) tab.onLoad(panel);
    } catch (err) {
      console.error(`[Settings] Error loading tab ${tab.id}:`, err);
    }
  }

  function activateTab(id) {
    currentActiveTabId = id;
    const buttons = document.querySelectorAll('.settings-tab');
    const panels = document.querySelectorAll('.settings-panel');

    buttons.forEach(btn => {
      const active = btn.dataset.tab === id;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
      btn.setAttribute('tabindex', active ? '0' : '-1');
    });

    panels.forEach(panel => {
      const active = panel.id === `tab-panel-${id}`;
      panel.classList.toggle('hidden', !active);
    });
  }

  // ── Preferences Saving Logic ──
  async function handleSave() {
    const statusMsg = document.getElementById('settings-save-status');
    if (statusMsg) {
      statusMsg.textContent = 'Saving...';
      statusMsg.className = 'save-status-msg';
    }

    const payload = {};
    let valid = true;

    // Gather and validate configs from each tab
    for (const tab of registeredTabs) {
      const panel = document.getElementById(`tab-panel-${tab.id}`);
      if (panel && tab.onSave) {
        try {
          const result = tab.onSave(panel);
          if (result) {
            if (result.error) {
              if (statusMsg) {
                statusMsg.textContent = `Error in ${tab.title}: ${result.error}`;
                statusMsg.className = 'save-status-msg error';
              }
              valid = false;
              break;
            }
            if (result.key && result.data) {
              payload[result.key] = result.data;
              // Write to localStorage
              localStorage.setItem(result.key, JSON.stringify(result.data));
            }
            if (result.additionalKeys) {
              for (const [k, val] of Object.entries(result.additionalKeys)) {
                payload[k] = val;
                localStorage.setItem(k, val);
              }
            }
          }
        } catch (err) {
          console.error(`[Settings] Save error in ${tab.id}:`, err);
          valid = false;
        }
      }
    }

    if (!valid) return;

    try {
      // POST payload to filesystem settings.json
      const resp = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.Dashboard.csrfToken
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      if (statusMsg) {
        statusMsg.textContent = '✅ Configurations saved successfully';
        statusMsg.className = 'save-status-msg success';
        setTimeout(() => { statusMsg.textContent = ''; }, 4000);
      }

      // Apply changes globally
      if (payload['vibes-theme']) {
        const theme = payload['vibes-theme'];
        if (theme === 'light') {
          document.body.classList.add('light-mode');
        } else {
          document.body.classList.remove('light-mode');
        }
      }

      // Dispatch global settings change event
      document.dispatchEvent(new CustomEvent('settings-changed'));
      
      // Toast notification feedback
      if (window.VoiceCommands && window.VoiceCommands.showToast) {
        window.VoiceCommands.showToast('Settings Saved', 'success');
      }

    } catch (err) {
      console.error('[Settings] Server save failed:', err);
      if (statusMsg) {
        statusMsg.textContent = '❌ Failed to save configurations on server';
        statusMsg.className = 'save-status-msg error';
      }
    }
  }

  // ── Register Default Core Tabs ──
  function registerCoreTabs() {
    // 1. General Tab
    const generalSpec = {
      id: 'general',
      title: 'General',
      iconHTML: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tab-icon"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>`,
      htmlContent: `
        <div class="settings-section">
          <h3 class="settings-section-title">UI Customization</h3>
          <div class="settings-row">
            <div class="settings-info">
              <span class="settings-label">Color Theme</span>
              <span class="settings-desc">Choose between deep dark cybernetic or high-visibility light mode</span>
            </div>
            <div class="settings-field">
              <select id="setting-theme">
                <option value="dark">Dark Cyber</option>
                <option value="light">Light Glass</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">Behavioral Directives</h3>
          <div class="settings-row">
            <div class="settings-info">
              <span class="settings-label">Auto-Launch Process</span>
              <span class="settings-desc">Allow the backend to automatically execute agents upon prompt classification</span>
            </div>
            <div class="toggle" id="setting-autolaunch-toggle"></div>
          </div>
          
          <div class="settings-row">
            <div class="settings-info">
              <span class="settings-label">Wake-Word Processing</span>
              <span class="settings-desc">Enable continuous listening search for the trigger phrase "Vibes"</span>
            </div>
            <div class="toggle" id="setting-wakeword-toggle"></div>
          </div>
        </div>
      `,
      onLoad: (panel) => {
        const prefs = loadPrefs('vibes-general-prefs', { autoLaunchOnCommand: true, wakeWordEnabled: false, theme: 'dark' });
        panel.querySelector('#setting-theme').value = prefs.theme;
        panel.querySelector('#setting-autolaunch-toggle').classList.toggle('active', prefs.autoLaunchOnCommand);
        panel.querySelector('#setting-wakeword-toggle').classList.toggle('active', prefs.wakeWordEnabled);
        
        // Handle toggle switch behaviors securely
        panel.querySelectorAll('.toggle').forEach(tog => {
          tog.addEventListener('click', () => {
            tog.classList.toggle('active');
          });
        });
      },
      onSave: (panel) => {
        const theme = panel.querySelector('#setting-theme').value;
        const autoLaunchOnCommand = panel.querySelector('#setting-autolaunch-toggle').classList.contains('active');
        const wakeWordEnabled = panel.querySelector('#setting-wakeword-toggle').classList.contains('active');

        return {
          key: 'vibes-general-prefs',
          data: { autoLaunchOnCommand, wakeWordEnabled, theme },
          additionalKeys: { 'vibes-theme': theme }
        };
      }
    };

    // 2. Voice Tab
    const voiceSpec = {
      id: 'voice',
      title: 'Speech Feedback',
      iconHTML: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tab-icon"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>`,
      htmlContent: `
        <div class="settings-section">
          <h3 class="settings-section-title">TTS Engine Controls</h3>
          <div class="settings-row">
            <div class="settings-info">
              <span class="settings-label">Audible Feedback</span>
              <span class="settings-desc">Allow agent feedback and notifications to be spoken via Text-To-Speech</span>
            </div>
            <div class="toggle" id="setting-feedback-toggle"></div>
          </div>

          <div class="settings-row">
            <div class="settings-info">
              <span class="settings-label">Voice Selection</span>
              <span class="settings-desc">Choose custom English synthesis voice profiles</span>
            </div>
            <div class="settings-field">
              <select id="setting-voice">
                <option value="">System Default</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">Synthesis Modulation</h3>
          <div class="settings-grid-row">
            <div class="settings-field">
              <label>Speech Rate</label>
              <div class="settings-slider-wrapper">
                <input type="range" id="setting-rate" min="50" max="200" value="100">
                <span class="settings-slider-val" id="setting-rate-val">1.0x</span>
              </div>
            </div>
            <div class="settings-field">
              <label>Audio Volume</label>
              <div class="settings-slider-wrapper">
                <input type="range" id="setting-volume" min="0" max="100" value="80">
                <span class="settings-slider-val" id="setting-volume-val">80%</span>
              </div>
            </div>
          </div>
          
          <div style="display:flex; justify-content:flex-end; margin-top:16px;">
            <button class="btn btn-primary" id="setting-test-voice" style="padding:10px 18px; font-size:13px;">Test Audio Output</button>
          </div>
        </div>
      `,
      onLoad: (panel) => {
        const prefs = loadPrefs('vibes-voice-prefs', { voice: '', rate: 1.0, volume: 0.8, feedbackEnabled: true });
        panel.querySelector('#setting-feedback-toggle').classList.toggle('active', prefs.feedbackEnabled);
        panel.querySelector('#setting-feedback-toggle').addEventListener('click', function() {
          this.classList.toggle('active');
        });

        // Set inputs
        const rateSlider = panel.querySelector('#setting-rate');
        const rateVal = panel.querySelector('#setting-rate-val');
        rateSlider.value = Math.round(prefs.rate * 100);
        rateVal.textContent = prefs.rate.toFixed(1) + 'x';
        rateSlider.addEventListener('input', function() {
          rateVal.textContent = (this.value / 100).toFixed(1) + 'x';
        });

        const volSlider = panel.querySelector('#setting-volume');
        const volVal = panel.querySelector('#setting-volume-val');
        volSlider.value = Math.round(prefs.volume * 100);
        volVal.textContent = Math.round(prefs.volume * 100) + '%';
        volSlider.addEventListener('input', function() {
          volVal.textContent = this.value + '%';
        });

        // Populate Custom English dropdown profiles
        const select = panel.querySelector('#setting-voice');
        const populate = () => {
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
          if (prefs.voice) select.value = prefs.voice;
        };

        if (window.speechSynthesis) {
          if (window.speechSynthesis.getVoices().length) {
            populate();
          }
          window.speechSynthesis.onvoiceschanged = populate;
        }

        // Test Voice button binding
        panel.querySelector('#setting-test-voice').addEventListener('click', () => {
          const synth = window.speechSynthesis;
          if (!synth) return;
          synth.cancel();
          const utt = new SpeechSynthesisUtterance('Speech synthesis engine online.');
          const selectedVoice = select.value;
          if (selectedVoice) {
            const voiceObj = synth.getVoices().find(v => v.name === selectedVoice);
            if (voiceObj) utt.voice = voiceObj;
          }
          utt.rate = parseInt(rateSlider.value) / 100;
          utt.volume = parseInt(volSlider.value) / 100;
          synth.speak(utt);
        });
      },
      onSave: (panel) => {
        const feedbackEnabled = panel.querySelector('#setting-feedback-toggle').classList.contains('active');
        const voice = panel.querySelector('#setting-voice').value;
        const rate = parseInt(panel.querySelector('#setting-rate').value) / 100;
        const volume = parseInt(panel.querySelector('#setting-volume').value) / 100;

        return {
          key: 'vibes-voice-prefs',
          data: { voice, rate, volume, feedbackEnabled }
        };
      }
    };

    // 3. User Management Tab (Admin Only)
    const userManagementSpec = {
      id: 'users',
      title: 'User Access Control',
      roles: ['admin'],
      iconHTML: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tab-icon"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>`,
      htmlContent: `
        <div class="settings-section">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--border); padding-bottom:8px;">
            <h3 style="font-family:'Outfit', sans-serif; font-size:16px; font-weight:600; color:var(--text-primary);">Configured Operators</h3>
            <button class="btn btn-primary" id="btn-add-user" style="padding:6px 14px; font-size:12px;">+ Add Operator</button>
          </div>
          
          <!-- User Create/Edit card panel -->
          <div class="user-form-card hidden" id="user-form-card">
            <div class="user-form-header">
              <h4 id="user-form-title">Add New Operator</h4>
              <button class="btn-icon delete" id="btn-close-user-form" style="border:none;">&times;</button>
            </div>
            <form id="user-config-form">
              <input type="hidden" id="user-form-id">
              <div class="settings-grid-row" style="margin-bottom:12px;">
                <div class="settings-field">
                  <label for="user-form-name">Name</label>
                  <input type="text" id="user-form-name" required placeholder="Display Name">
                </div>
                <div class="settings-field">
                  <label for="user-form-username">Username</label>
                  <input type="text" id="user-form-username" required placeholder="username">
                </div>
              </div>
              <div class="settings-grid-row" style="margin-bottom:12px;">
                <div class="settings-field">
                  <label for="user-form-password">Password</label>
                  <input type="password" id="user-form-password" placeholder="Password (Min 8 chars)">
                  <span style="font-size:10px; color:var(--text-secondary); margin-top:2px;" id="password-hint"></span>
                </div>
                <div class="settings-field">
                  <label for="user-form-role">Privilege Role</label>
                  <select id="user-form-role">
                    <option value="operator">Operator (ReadOnly Settings)</option>
                    <option value="admin">Administrator (Full Control)</option>
                  </select>
                </div>
              </div>
              <div class="user-form-buttons">
                <button type="submit" class="btn btn-primary" style="padding:8px 18px; font-size:13px;">Save Operator</button>
              </div>
            </form>
          </div>

          <div class="user-table-container">
            <table class="user-table">
              <thead>
                <tr>
                  <th>Display Name</th>
                  <th>Username</th>
                  <th>Privilege Level</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="user-table-body">
                <!-- User rows rendered dynamically -->
              </tbody>
            </table>
          </div>
        </div>
      `,
      onLoad: (panel) => {
        const tableBody = panel.querySelector('#user-table-body');
        const formCard = panel.querySelector('#user-form-card');
        const form = panel.querySelector('#user-config-form');
        const formTitle = panel.querySelector('#user-form-title');
        const formId = panel.querySelector('#user-form-id');
        const inputName = panel.querySelector('#user-form-name');
        const inputUser = panel.querySelector('#user-form-username');
        const inputPass = panel.querySelector('#user-form-password');
        const selectRole = panel.querySelector('#user-form-role');
        const passHint = panel.querySelector('#password-hint');

        // Fetch and draw users
        const fetchAndDrawUsers = async () => {
          try {
            const resp = await fetch('/api/users');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const users = await resp.json();
            
            tableBody.replaceChildren();
            
            users.forEach(u => {
              const tr = document.createElement('tr');
              
              const tdName = document.createElement('td');
              tdName.textContent = u.name;
              tr.appendChild(tdName);

              const tdUser = document.createElement('td');
              tdUser.textContent = u.username;
              tr.appendChild(tdUser);

              const tdRole = document.createElement('td');
              const badge = document.createElement('span');
              badge.className = `user-role-badge ${u.role}`;
              badge.textContent = u.role;
              tdRole.appendChild(badge);
              tr.appendChild(tdRole);

              const tdActions = document.createElement('td');
              const actionDiv = document.createElement('div');
              actionDiv.className = 'user-actions';

              // Edit Action
              const editBtn = document.createElement('button');
              editBtn.className = 'btn-icon';
              editBtn.title = 'Edit user';
              try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(
                  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>`,
                  'image/svg+xml'
                );
                editBtn.appendChild(doc.documentElement);
              } catch (err) {
                console.error('[Settings] Failed to parse Edit icon:', err);
              }
              editBtn.addEventListener('click', () => {
                formTitle.textContent = `Modify Operator: ${u.username}`;
                formId.value = u.id;
                inputName.value = u.name;
                inputUser.value = u.username;
                inputUser.disabled = true; // Username is immutable
                inputPass.value = '';
                inputPass.required = false;
                passHint.textContent = 'Leave empty to keep current password';
                selectRole.value = u.role;
                
                // Own profile cannot modify role
                if (u.username === window.Dashboard.currentUser.username) {
                  selectRole.disabled = true;
                } else {
                  selectRole.disabled = false;
                }
                
                formCard.classList.remove('hidden');
              });
              actionDiv.appendChild(editBtn);

              // Delete Action
              if (u.username !== window.Dashboard.currentUser.username) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-icon delete';
                deleteBtn.title = 'Delete user';
                try {
                  const parser = new DOMParser();
                  const doc = parser.parseFromString(
                    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>`,
                    'image/svg+xml'
                  );
                  deleteBtn.appendChild(doc.documentElement);
                } catch (err) {
                  console.error('[Settings] Failed to parse Delete icon:', err);
                }
                deleteBtn.addEventListener('click', async () => {
                  if (confirm(`Are you sure you want to permanently delete operator "${u.name}"?`)) {
                    try {
                      const delResp = await fetch(`/api/users/${u.id}`, {
                        method: 'DELETE',
                        headers: {
                          'Content-Type': 'application/json',
                          'X-CSRF-Token': window.Dashboard.csrfToken
                        }
                      });
                      if (delResp.ok) {
                        fetchAndDrawUsers();
                      } else {
                        const errData = await delResp.json();
                        alert(`Deletion failed: ${errData.error}`);
                      }
                    } catch (e) {
                      console.error('[User-Access] Deletion call failed:', e);
                    }
                  }
                });
                actionDiv.appendChild(deleteBtn);
              }

              tdActions.appendChild(actionDiv);
              tr.appendChild(tdActions);
              tableBody.appendChild(tr);
            });
          } catch (e) {
            console.error('[User-Access] Failed to draw users table:', e);
          }
        };

        // Wire Add operator card toggle
        panel.querySelector('#btn-add-user').addEventListener('click', () => {
          formTitle.textContent = 'Add New Operator';
          formId.value = '';
          inputName.value = '';
          inputUser.value = '';
          inputUser.disabled = false;
          inputPass.value = '';
          inputPass.required = true;
          passHint.textContent = '';
          selectRole.value = 'operator';
          selectRole.disabled = false;
          formCard.classList.remove('hidden');
        });

        panel.querySelector('#btn-close-user-form').addEventListener('click', () => {
          formCard.classList.add('hidden');
        });

        // User save form submit
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const userId = formId.value;
          const name = inputName.value.trim();
          const username = inputUser.value.trim();
          const password = inputPass.value;
          const role = selectRole.value;

          const url = userId ? `/api/users/${userId}` : '/api/users';
          const method = userId ? 'PUT' : 'POST';
          const bodyPayload = { name, role };
          
          if (!userId || password) bodyPayload.password = password;
          if (!userId) bodyPayload.username = username;

          try {
            const postResp = await fetch(url, {
              method: method,
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': window.Dashboard.csrfToken
              },
              body: JSON.stringify(bodyPayload)
            });

            if (postResp.ok) {
              formCard.classList.add('hidden');
              fetchAndDrawUsers();
            } else {
              const errData = await postResp.json();
              alert(`Action failed: ${errData.error}`);
            }
          } catch (err) {
            console.error('[User-Access] Save user failed:', err);
          }
        });

        // Initial draw
        fetchAndDrawUsers();
      },
      onSave: () => {
        // No client preferences stored locally for this tab
        return null;
      }
    };

    // Push into Dashboard namespace registry
    window.Dashboard.registerSettingsTab(generalSpec);
    window.Dashboard.registerSettingsTab(voiceSpec);
    window.Dashboard.registerSettingsTab(userManagementSpec);
  }

  // ── Prefs Local Helper ──
  function loadPrefs(key, defaults) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
    } catch (_) { return { ...defaults }; }
  }

  // ── Keyboard Accessibility & Focus Flow Manager ──
  function setupKeyboardNavigation(rootPanel) {
    rootPanel.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      
      const tabList = rootPanel.querySelector('#settings-tabs-list');
      if (!tabList) return;
      
      const tabs = Array.from(tabList.querySelectorAll('.settings-tab'));
      
      // Arrow Up/Down navigation on setting tab buttons
      if (activeEl && activeEl.classList.contains('settings-tab')) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const index = tabs.indexOf(activeEl);
          if (index !== -1) {
            let nextIndex;
            if (e.key === 'ArrowDown') {
              nextIndex = (index + 1) % tabs.length;
            } else {
              nextIndex = (index - 1 + tabs.length) % tabs.length;
            }
            const nextTab = tabs[nextIndex];
            if (nextTab) {
              activateTab(nextTab.dataset.tab);
              nextTab.focus();
            }
          }
          return;
        }
      }
      
      // Custom Tab / Shift+Tab logical routing
      if (e.key === 'Tab') {
        const activeTab = tabList.querySelector('.settings-tab.active');
        const activePanel = rootPanel.querySelector('.settings-panel:not(.hidden)');
        const saveBtn = rootPanel.querySelector('#settings-save-btn');
        const logoutBtn = rootPanel.querySelector('#settings-logout-btn');
        
        let panelFocusables = [];
        if (activePanel) {
          const candidates = activePanel.querySelectorAll('input, select, textarea, button, [tabindex="0"]');
          panelFocusables = Array.from(candidates).filter(el => {
            if (el.disabled) return false;
            if (el.getAttribute('tabindex') === '-1') return false;
            return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
          });
        }
        
        // Tab from active settings tab -> focus first panel input
        if (activeEl === activeTab && !e.shiftKey) {
          e.preventDefault();
          if (panelFocusables.length > 0) {
            panelFocusables[0].focus();
          } else if (saveBtn) {
            saveBtn.focus();
          } else if (logoutBtn) {
            logoutBtn.focus();
          }
          return;
        }
        
        // Shift+Tab from first panel input -> active settings tab
        if (panelFocusables.length > 0 && activeEl === panelFocusables[0] && e.shiftKey) {
          e.preventDefault();
          if (activeTab) {
            activeTab.focus();
          }
          return;
        }
        
        // Tab from last panel input -> Save configurations button
        if (panelFocusables.length > 0 && activeEl === panelFocusables[panelFocusables.length - 1] && !e.shiftKey) {
          e.preventDefault();
          if (saveBtn) {
            saveBtn.focus();
          } else if (logoutBtn) {
            logoutBtn.focus();
          } else if (activeTab) {
            activeTab.focus();
          }
          return;
        }
        
        // Tab / Shift+Tab from Save Button
        if (activeEl === saveBtn) {
          if (!e.shiftKey) {
            e.preventDefault();
            if (logoutBtn) {
              logoutBtn.focus();
            } else if (activeTab) {
              activeTab.focus();
            }
            return;
          } else {
            e.preventDefault();
            if (panelFocusables.length > 0) {
              panelFocusables[panelFocusables.length - 1].focus();
            } else if (activeTab) {
              activeTab.focus();
            }
            return;
          }
        }
        
        // Tab / Shift+Tab from Logout Button
        if (activeEl === logoutBtn) {
          if (!e.shiftKey) {
            e.preventDefault();
            if (activeTab) {
              activeTab.focus();
            }
            return;
          } else {
            e.preventDefault();
            if (saveBtn) {
              saveBtn.focus();
            } else if (panelFocusables.length > 0) {
              panelFocusables[panelFocusables.length - 1].focus();
            } else if (activeTab) {
              activeTab.focus();
            }
            return;
          }
        }
      }
    });
  }

})();
