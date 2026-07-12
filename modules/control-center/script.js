(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) api.initialize(root.document, root.fetch.bind(root));
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const EMPTY_MESSAGES = Object.freeze({
    providers: 'No providers are configured.',
    activity: 'No recent coordination activity.',
    approvals: 'No approvals are waiting.',
    verifications: 'No verification outcomes are available.',
    artifacts: 'No artifact references are available.'
  });

  function asList(value) { return Array.isArray(value) ? value : []; }
  function value(value, fallback = '—') { return value === null || value === undefined || value === '' ? fallback : String(value); }
  function formatTime(input) {
    if (!input) return 'Time unavailable';
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? String(input) : date.toLocaleString();
  }

  function buildViewModel(data) {
    if (!data || !data.available) {
      const message = data?.reason === 'not_configured'
        ? 'Agent Communication MCP is not configured. Set the server-side connection settings to enable live data.'
        : 'Agent Communication MCP is currently unreachable. No live coordination values are being shown.';
      return {
        available: false, statusMessage: message,
        metrics: { readyProviders: '—', recentActivity: '—', pendingApprovals: '—', verificationOutcomes: '—' },
        providers: { items: [], empty: message }, activity: { items: [], empty: message },
        approvals: { items: [], empty: message }, verifications: { items: [], empty: message }, artifacts: { items: [], empty: message }
      };
    }
    const providers = asList(data.providers);
    const activity = asList(data.activity);
    const approvals = asList(data.pendingApprovals);
    const verifications = asList(data.verificationOutcomes);
    const artifacts = asList(data.artifactReferences);
    const ready = providers.filter(provider => provider.readiness === 'ready').length;
    return {
      available: true,
      statusMessage: `Live coordination data · updated ${formatTime(data.updatedAt)}`,
      metrics: {
        readyProviders: `${ready} / ${providers.length}`,
        recentActivity: String(activity.length),
        pendingApprovals: String(approvals.length),
        verificationOutcomes: String(verifications.length)
      },
      providers: { items: providers, empty: EMPTY_MESSAGES.providers },
      activity: { items: activity, empty: EMPTY_MESSAGES.activity },
      approvals: { items: approvals, empty: EMPTY_MESSAGES.approvals },
      verifications: { items: verifications, empty: EMPTY_MESSAGES.verifications },
      artifacts: { items: artifacts, empty: EMPTY_MESSAGES.artifacts }
    };
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function element(document, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function appendEmpty(document, container, message) {
    container.appendChild(element(document, 'p', 'control-center__empty', message));
  }
  function appendItem(document, container, title, state, meta) {
    const card = element(document, 'article', 'control-center__item');
    const top = element(document, 'div', 'control-center__item-top');
    top.appendChild(element(document, 'span', 'control-center__item-title', value(title)));
    const badge = element(document, 'span', 'control-center__badge', value(state, 'unknown'));
    badge.dataset.state = value(state, 'unknown').toLowerCase();
    top.appendChild(badge);
    card.appendChild(top);
    card.appendChild(element(document, 'p', 'control-center__item-meta', value(meta, 'No details supplied')));
    container.appendChild(card);
  }

  function render(document, model) {
    const byId = id => document.getElementById(id);
    const status = byId('control-center-status');
    status.textContent = model.statusMessage;
    status.dataset.state = model.available ? 'available' : 'unavailable';
    byId('control-center-ready-count').textContent = model.metrics.readyProviders;
    byId('control-center-activity-count').textContent = model.metrics.recentActivity;
    byId('control-center-approval-count').textContent = model.metrics.pendingApprovals;
    byId('control-center-verification-count').textContent = model.metrics.verificationOutcomes;

    const providers = byId('control-center-providers'); clear(providers);
    model.providers.items.forEach(item => appendItem(document, providers, item.displayName, item.readiness,
      `${item.binaryAvailable ? 'Binary available' : 'Binary unavailable'} · ${asList(item.capabilities).join(', ') || 'No capabilities reported'} · checked ${formatTime(item.checkedAt)}`));
    if (!model.providers.items.length) appendEmpty(document, providers, model.providers.empty);

    const specs = [
      ['control-center-activity', model.activity, item => [item.summary, item.state, `${value(item.project, 'No project')} · ${value(item.agentId, 'No agent')} · ${formatTime(item.timestamp)}`]],
      ['control-center-approvals', model.approvals, item => [item.summary, item.state, `${value(item.taskId, 'No task')} · ${formatTime(item.timestamp)}`]],
      ['control-center-verifications', model.verifications, item => [item.summary, item.state, `${value(item.project, 'No project')} · ${formatTime(item.timestamp)}`]],
      ['control-center-artifacts', model.artifacts, item => [item.reference, item.label, `Activity ${value(item.activityId)}`]]
    ];
    specs.forEach(([id, section, describe]) => {
      const container = byId(id); clear(container);
      section.items.forEach(item => appendItem(document, container, ...describe(item)));
      if (!section.items.length) appendEmpty(document, container, section.empty);
    });
  }

  function initialize(document, fetchImpl) {
    const panel = document.getElementById('view-control-center');
    if (!panel) return;
    const refresh = document.getElementById('control-center-refresh');
    let requestId = 0;
    async function load() {
      const current = ++requestId;
      refresh.disabled = true;
      try {
        const response = await fetchImpl('/api/control-center', { headers: { Accept: 'application/json' } });
        const data = await response.json().catch(() => ({ available: false, reason: 'unreachable' }));
        if (current === requestId) render(document, buildViewModel(data));
      } catch (_) {
        if (current === requestId) render(document, buildViewModel({ available: false, reason: 'unreachable' }));
      } finally {
        if (current === requestId) refresh.disabled = false;
      }
    }
    refresh.addEventListener('click', load);
    document.addEventListener('dashboard:view-changed', event => { if (event.detail?.id === 'control-center') load(); });
    load();
  }

  return { buildViewModel, formatTime, initialize, render };
});
