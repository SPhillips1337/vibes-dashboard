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

  function createPromptSpan() {
    const promptSpan = document.createElement('span');
    promptSpan.className = 'terminal-prompt';

    const userSpan = document.createElement('span');
    userSpan.className = 'terminal-user';
    userSpan.textContent = 'stephen';

    const atSpan = document.createElement('span');
    atSpan.className = 'terminal-at';
    atSpan.textContent = '@';

    const hostSpan = document.createElement('span');
    hostSpan.className = 'terminal-host';
    hostSpan.textContent = 'vibes-dashboard';

    const colonSpan = document.createElement('span');
    colonSpan.className = 'terminal-colon';
    colonSpan.textContent = ':';

    const cwdSpan = document.createElement('span');
    cwdSpan.className = 'terminal-cwd';
    cwdSpan.textContent = termPromptCwd.textContent;

    const charSpan = document.createElement('span');
    charSpan.className = 'terminal-char';
    charSpan.textContent = '$';

    promptSpan.appendChild(userSpan);
    promptSpan.appendChild(atSpan);
    promptSpan.appendChild(hostSpan);
    promptSpan.appendChild(colonSpan);
    promptSpan.appendChild(cwdSpan);
    promptSpan.appendChild(charSpan);
    return promptSpan;
  }

  function executeCommand(command) {
    if (!command.trim()) {
      // Just print a blank prompt line
      const line = document.createElement('div');
      line.className = 'terminal-input-line-echo';
      
      const promptSpan = createPromptSpan();
      const commandSpan = document.createElement('span');
      commandSpan.className = 'terminal-command-echo';

      line.appendChild(promptSpan);
      line.appendChild(commandSpan);

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

    const promptSpan = createPromptSpan();
    const commandSpan = document.createElement('span');
    commandSpan.className = 'terminal-command-echo';
    commandSpan.textContent = command;

    line.appendChild(promptSpan);
    line.appendChild(commandSpan);

    termOutput.appendChild(line);
    termBody.scrollTop = termBody.scrollHeight;

    // Special clear command (client-side only)
    if (command.trim() === 'clear') {
      termOutput.replaceChildren();
      return;
    }

    isRunning = true;
    termInput.disabled = true;
    btnSigint.classList.remove('hidden');

    socket.emit('terminal-run', { command, cwd: currentCwd });
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
    termOutput.replaceChildren();
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
