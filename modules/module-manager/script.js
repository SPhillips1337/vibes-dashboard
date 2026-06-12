(function () {
  'use strict';

  let viewPanel = null;
  let installedGrid = null;
  let catalogGrid = null;

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function init() {
    viewPanel = document.getElementById('view-module-manager');
    if (!viewPanel) return;

    installedGrid = document.getElementById('installed-modules-grid');
    catalogGrid = document.getElementById('catalog-modules-grid');

    // Tabs
    const tabBtns = viewPanel.querySelectorAll('.manager-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    renderInstalled();
    renderCatalog();
  }

  function switchTab(tabId) {
    viewPanel.querySelectorAll('.manager-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    viewPanel.querySelectorAll('.manager-tab-content').forEach(content => {
      content.classList.toggle('hidden', content.id !== `manager-tab-${tabId}`);
    });
    if (window.vibePlayer) window.vibePlayer.playClick();
  }

  function renderInstalled() {
    if (!installedGrid || !window.Dashboard.modules) return;
    
    installedGrid.replaceChildren();
    
    window.Dashboard.modules.forEach(mod => {
      const card = document.createElement('div');
      card.className = 'module-card';
      card.innerHTML = `
        <div class="module-card-header">
          <div class="module-icon">${escapeHtml(mod.icon || '')}</div>
          <div class="module-info">
            <h3>${escapeHtml(mod.name)}</h3>
            <p>${escapeHtml(mod.subtitle || 'Installed Module')}</p>
          </div>
        </div>
        <div class="module-card-footer">
          <span class="status-badge active">Active</span>
          <button class="action-btn" data-id="${escapeHtml(mod.id)}">Open</button>
        </div>
      `;
      
      card.querySelector('.action-btn').addEventListener('click', () => {
        window.Dashboard.showView(mod.id);
      });
      
      installedGrid.appendChild(card);
    });
  }

  function renderCatalog() {
    if (!catalogGrid) return;
    
    const catalogItems = [
      { id: 'spotify-stream', name: 'Spotify Explorer', subtitle: 'Integrated Spotify Web Playback', icon: '🎵', installed: false },
      { id: 'youtube-stream', name: 'YouTube Music', subtitle: 'Global Streaming Interface', icon: '📺', installed: false },
      { id: 'apple-stream', name: 'Apple Music', subtitle: 'Native Library Access', icon: '🍎', installed: false },
      { id: 'amazon-stream', name: 'Amazon Music', subtitle: 'Prime Music Player', icon: '📦', installed: false },
      { id: 'mcp-discover', name: 'MCP Discover', subtitle: 'Auto-find local MCP servers', icon: '🔍', installed: false },
    ];
    
    catalogGrid.replaceChildren();
    
    catalogItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'module-card';
      card.innerHTML = `
        <div class="module-card-header">
          <div class="module-icon">${escapeHtml(item.icon)}</div>
          <div class="module-info">
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.subtitle)}</p>
          </div>
        </div>
        <div class="module-card-footer">
          <span class="status-badge">Available at a2m.one</span>
          <button class="action-btn primary" disabled>Install</button>
        </div>
      `;
      catalogGrid.appendChild(card);
    });
  }

  // Listen for view changes to refresh data
  document.addEventListener('dashboard:view-changed', (e) => {
    if (e.detail.id === 'module-manager') {
      renderInstalled();
    }
  });

  init();
})();
