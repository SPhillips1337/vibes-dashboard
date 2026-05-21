/* ═══════════════════════════════════════
   Vibes Dashboard — Log Viewer Module Script
   ═══════════════════════════════════════ */

(function () {
  'use strict';

  // ── State ──
  const globalLogs = [];
  const maxLogs = 500;

  // DOM references (scoped to the view-log-viewer panel)
  let viewPanel = null;
  let logsContent = null;
  let btnClear = null;

  function initDOM() {
    viewPanel = document.getElementById('view-log-viewer');
    if (!viewPanel) return false;
    logsContent = viewPanel.querySelector('#global-logs-content');
    btnClear = viewPanel.querySelector('#btn-clear-logs');
    return true;
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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function appendGlobalLog(message, origin = 'system', type = 'info') {
    const time = new Date().toLocaleTimeString('en-GB');
    const logEntry = { time, message, origin, type };
    
    globalLogs.push(logEntry);
    if (globalLogs.length > maxLogs) globalLogs.shift();
    
    if (!logsContent && !initDOM()) return;

    if (logsContent) {
      const line = document.createElement('div');
      line.className = 'global-log-line';
      
      const badgeClass = `badge-${type}`;
      line.innerHTML = `
        <span class="log-time" style="opacity: 0.5; width: 60px; flex-shrink: 0;">${time}</span>
        <span class="log-origin ${badgeClass}">${escapeHtml(origin)}</span>
        <span class="log-message" style="flex: 1;">${escapeHtml(message)}</span>
      `;
      logsContent.appendChild(line);
      
      // Auto-scroll if close to bottom
      if (logsContent.scrollHeight - logsContent.scrollTop < logsContent.clientHeight + 50) {
        logsContent.scrollTop = logsContent.scrollHeight;
      }
    }
  }

  // ── CustomEvent Handlers ──
  document.addEventListener('dashboard:agent-created', (e) => {
    const agent = e.detail;
    appendGlobalLog(`Agent created: ${getAgentTitle(agent.mission)}`, agent.id, 'info');
  });

  document.addEventListener('dashboard:agent-removed', (e) => {
    const data = e.detail;
    appendGlobalLog(`Agent removed: ${data.id}`, 'system', 'danger');
  });

  document.addEventListener('dashboard:agent-log', (e) => {
    const data = e.detail;
    const agent = window.Dashboard.agents.get(data.id);
    
    let logType = 'info';
    const lowerLog = data.log.toLowerCase();
    if (lowerLog.includes('error') || lowerLog.includes('fail')) {
      logType = 'danger';
    } else if (lowerLog.includes('success') || lowerLog.includes('completed')) {
      logType = 'success';
    } else if (lowerLog.includes('warning')) {
      logType = 'warning';
    }
    
    const origin = agent ? getAgentTitle(agent.mission) : data.id;
    appendGlobalLog(data.log, origin, logType);
  });

  document.addEventListener('dashboard:view-changed', (e) => {
    if (e.detail.id === 'log-viewer') {
      if (!logsContent) initDOM();
      if (logsContent) {
        // Redraw cached logs on show to make sure it's up to date and correct
        logsContent.innerHTML = '';
        globalLogs.forEach(entry => {
          const line = document.createElement('div');
          line.className = 'global-log-line';
          const badgeClass = `badge-${entry.type}`;
          line.innerHTML = `
            <span class="log-time" style="opacity: 0.5; width: 60px; flex-shrink: 0;">${entry.time}</span>
            <span class="log-origin ${badgeClass}">${escapeHtml(entry.origin)}</span>
            <span class="log-message" style="flex: 1;">${escapeHtml(entry.message)}</span>
          `;
          logsContent.appendChild(line);
        });
        logsContent.scrollTop = logsContent.scrollHeight;
      }
    }
  });

  // ── Setup listeners on load ──
  document.addEventListener('DOMContentLoaded', () => {
    initDOM();
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        globalLogs.length = 0;
        if (logsContent) logsContent.innerHTML = '';
        appendGlobalLog('System logs cleared.', 'system', 'info');
      });
    }
  });

  // Fallback if script loaded after DOMContentLoaded
  setTimeout(() => {
    if (!btnClear) {
      if (initDOM() && btnClear) {
        btnClear.addEventListener('click', () => {
          globalLogs.length = 0;
          if (logsContent) logsContent.innerHTML = '';
          appendGlobalLog('System logs cleared.', 'system', 'info');
        });
      }
    }
  }, 100);

  // Log initial system boot entry
  appendGlobalLog('System Terminal Online.', 'system', 'info');

})();
