(function () {
  'use strict';

  let viewPanel = null;
  let installedGrid = null;
  let catalogGrid = null;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ALLOWED_SVG_ELEMENTS = new Set([
    'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'
  ]);
  const ALLOWED_SVG_ATTRIBUTES = new Set([
    'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
    'width', 'height', 'points'
  ]);
  const UNSAFE_SVG_VALUE = /(?:javascript:|data:|url\s*\()/i;

  function cloneSafeSvgNode(node) {
    const tagName = node.localName;
    if (!ALLOWED_SVG_ELEMENTS.has(tagName)) return null;

    const clone = document.createElementNS(SVG_NS, tagName);
    Array.from(node.attributes || []).forEach(attribute => {
      if (ALLOWED_SVG_ATTRIBUTES.has(attribute.name) && !UNSAFE_SVG_VALUE.test(attribute.value)) {
        clone.setAttribute(attribute.name, attribute.value);
      }
    });
    Array.from(node.children || []).forEach(child => {
      const safeChild = cloneSafeSvgNode(child);
      if (safeChild) clone.appendChild(safeChild);
    });
    return clone;
  }

  function renderModuleIcon(icon) {
    const container = document.createElement('div');
    container.className = 'module-icon';
    container.setAttribute('aria-hidden', 'true');

    const source = String(icon || '').trim();
    if (!source.startsWith('<svg')) {
      container.textContent = source || '◇';
      return container;
    }

    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
    const safeSvg = parsed.documentElement.localName === 'svg'
      ? cloneSafeSvgNode(parsed.documentElement)
      : null;
    if (safeSvg) container.appendChild(safeSvg);
    else container.textContent = '◇';
    return container;
  }

  function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function createModuleCard(item, options = {}) {
    const card = document.createElement('article');
    card.className = 'module-card';

    const header = document.createElement('div');
    header.className = 'module-card-header';
    header.appendChild(renderModuleIcon(item.icon));

    const info = document.createElement('div');
    info.className = 'module-info';
    info.appendChild(createTextElement('h3', '', item.name));
    info.appendChild(createTextElement('p', '', item.subtitle || 'Installed Module'));
    header.appendChild(info);

    const footer = document.createElement('div');
    footer.className = 'module-card-footer';
    footer.appendChild(createTextElement(
      'span',
      `status-badge${options.active ? ' active' : ''}`,
      options.status
    ));

    const action = createTextElement('button', `action-btn${options.primary ? ' primary' : ''}`, options.action);
    action.type = 'button';
    action.disabled = Boolean(options.disabled);
    if (options.onAction) action.addEventListener('click', options.onAction);
    footer.appendChild(action);

    card.appendChild(header);
    card.appendChild(footer);
    return card;
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
      installedGrid.appendChild(createModuleCard(mod, {
        active: true,
        status: 'Active',
        action: 'Open',
        onAction: () => window.Dashboard.showView(mod.id)
      }));
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
      catalogGrid.appendChild(createModuleCard(item, {
        status: 'Available at a2m.one',
        action: 'Install',
        primary: true,
        disabled: true
      }));
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
