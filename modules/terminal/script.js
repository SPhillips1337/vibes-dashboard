(function () {
  'use strict';

  const socket = window.Dashboard.socket;
  const $ = (sel) => document.querySelector(sel);

  const termBody = $('#terminal-body-scroll');
  const termOutput = $('#terminal-output-area');
  const termInput = $('#terminal-input');
  const termPromptCwd = $('#terminal-prompt-cwd');
  const btnClear = $('#btn-terminal-clear');
  const btnSigint = $('#btn-terminal-sigint');

  let currentCwd = '/home/stephen/projects/glass-vibes-dashboard';
  let commandHistory = [];
  let historyIndex = -1;
  let isRunning = false;

  // Set initial CWD display
  updatePromptCwd(currentCwd);

  function updatePromptCwd(cwd) {
    let display = cwd;
    const home = '/home/stephen';
    if (cwd.startsWith(home)) {
      display = '~' + cwd.substring(home.length);
    }
    termPromptCwd.textContent = display;
  }

  function executeCommand(command) {
    if (!command.trim()) {
      // Just print a blank prompt line
      const line = document.createElement('div');
      line.className = 'terminal-input-line-echo';
      line.innerHTML = `
        <span class="terminal-prompt">
          <span class="terminal-user">stephen</span><span class="terminal-at">@</span><span class="terminal-host">vibes-dashboard</span><span class="terminal-colon">:</span><span class="terminal-cwd">${escapeHtml(termPromptCwd.textContent)}</span><span class="terminal-char">$</span>
        </span>
        <span class="terminal-command-echo"></span>
      `;
      termOutput.appendChild(line);
      termBody.scrollTop = termBody.scrollHeight;
      return;
    }

    // Add to history
    commandHistory.push(command);
    historyIndex = commandHistory.length;

    // Print command echo
    const line = document.createElement('div');
    line.className = 'terminal-input-line-echo';
    line.innerHTML = `
      <span class="terminal-prompt">
        <span class="terminal-user">stephen</span><span class="terminal-at">@</span><span class="terminal-host">vibes-dashboard</span><span class="terminal-colon">:</span><span class="terminal-cwd">${escapeHtml(termPromptCwd.textContent)}</span><span class="terminal-char">$</span>
      </span>
      <span class="terminal-command-echo">${escapeHtml(command)}</span>
    `;
    termOutput.appendChild(line);
    termBody.scrollTop = termBody.scrollHeight;

    // Special clear command (client-side only)
    if (command.trim() === 'clear') {
      termOutput.innerHTML = '';
      return;
    }

    isRunning = true;
    termInput.disabled = true;
    btnSigint.classList.remove('hidden');

    socket.emit('terminal-run', { command, cwd: currentCwd });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Socket output listeners
  socket.on('terminal-output', (data) => {
    // Process only if terminal module is currently loaded/active
    if (window.Dashboard.activeModuleId !== 'terminal') return;

    if (data.type === 'stdout') {
      const span = document.createElement('span');
      span.className = 'terminal-stdout';
      span.textContent = data.data;
      termOutput.appendChild(span);
      termBody.scrollTop = termBody.scrollHeight;
    } else if (data.type === 'stderr') {
      const span = document.createElement('span');
      span.className = 'terminal-stderr';
      span.textContent = data.data;
      termOutput.appendChild(span);
      termBody.scrollTop = termBody.scrollHeight;
    } else if (data.type === 'cwd-update') {
      currentCwd = data.cwd;
      updatePromptCwd(currentCwd);
    } else if (data.type === 'exit') {
      isRunning = false;
      termInput.disabled = false;
      btnSigint.classList.add('hidden');
      termInput.focus();
      
      const codeSpan = document.createElement('div');
      codeSpan.className = 'terminal-exit-code';
      codeSpan.textContent = `[Process completed with exit code ${data.code}]`;
      termOutput.appendChild(codeSpan);
      termBody.scrollTop = termBody.scrollHeight;
    }
  });

  // UI Event Listeners
  termInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = termInput.value;
      termInput.value = '';
      executeCommand(val);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        termInput.value = commandHistory[historyIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        historyIndex++;
        termInput.value = commandHistory[historyIndex];
      } else {
        historyIndex = commandHistory.length;
        termInput.value = '';
      }
    }
  });

  btnClear.addEventListener('click', () => {
    termOutput.innerHTML = '';
    termInput.focus();
  });

  btnSigint.addEventListener('click', () => {
    socket.emit('terminal-kill');
  });

  // Focus input when clicking anywhere inside terminal body
  termBody.addEventListener('click', () => {
    termInput.focus();
  });

  // Automatically focus on load/show
  document.addEventListener('dashboard:view-changed', (e) => {
    if (e.detail.id === 'terminal') {
      setTimeout(() => termInput.focus(), 100);
    }
  });

})();
