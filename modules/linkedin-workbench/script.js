(function () {
  'use strict';

  const STORAGE_KEY = 'vibes.linkedin-overview.base-url';
  const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
  const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

  let viewPanel = null;
  let statusDot = null;
  let statusLabel = null;
  let statusUrl = null;
  let statusMeta = null;
  let baseUrlInput = null;
  let refreshBtn = null;
  let openDashboardBtn = null;
  let openReviewBtn = null;
  let openRssBtn = null;
  let rssRunBtn = null;
  let rssCountInput = null;
  let copyPathBtn = null;
  let totalPostsEl = null;
  let pendingReviewEl = null;
  let approvedEl = null;
  let publishedEl = null;
  let nextPostEl = null;
  let statusChipsEl = null;
  let recentListEl = null;
  let approvalQueueEl = null;
  let queueCountEl = null;
  let rssJobCountEl = null;
  let rssStatusDot = null;
  let rssStatusLabel = null;
  let rssStatusMeta = null;
  let rssBackendAlertEl = null;
  let rssLogEl = null;
  let rssChipsEl = null;

  let currentBaseUrl = DEFAULT_BASE_URL;
  let currentOverview = null;
  let currentRssStatus = null;
  let latestRequestId = 0;

  function $(selector) {
    return viewPanel ? viewPanel.querySelector(selector) : null;
  }

  function normalizeBaseUrl(raw) {
    const value = (raw || '').trim();
    if (!value) return DEFAULT_BASE_URL;

    let candidate = value;
    if (value.startsWith('//')) {
      candidate = `http:${value}`;
    } else if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/|$)/i.test(value)) {
      candidate = `http://${value}`;
    }

    try {
      const parsed = new URL(candidate, DEFAULT_BASE_URL);
      if (!['http:', 'https:'].includes(parsed.protocol)) return DEFAULT_BASE_URL;
      if (!ALLOWED_HOSTS.has(parsed.hostname)) return DEFAULT_BASE_URL;
      return parsed.origin;
    } catch (_) {
      return DEFAULT_BASE_URL;
    }
  }

  function getStoredBaseUrl() {
    try {
      return normalizeBaseUrl(window.localStorage.getItem(STORAGE_KEY) || DEFAULT_BASE_URL);
    } catch (_) {
      return DEFAULT_BASE_URL;
    }
  }

  function persistBaseUrl(url) {
    try {
      window.localStorage.setItem(STORAGE_KEY, url);
    } catch (_) {
      // ignore storage failures
    }
  }

  function setStatus(state, label, meta) {
    if (statusDot) statusDot.dataset.state = state;
    if (statusLabel) statusLabel.textContent = label;
    if (statusMeta) statusMeta.textContent = meta;
    if (statusUrl) statusUrl.textContent = `Source: /var/www/html/LinkedIn/data/content_calendar.json · Base URL: ${currentBaseUrl}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusClass(status) {
    const normalized = String(status || 'unknown').toLowerCase();
    if (normalized.includes('published')) return 'published';
    if (normalized.includes('approved')) return 'approved';
    if (normalized.includes('reject')) return 'rejected';
    if (normalized.includes('pending')) return 'pending';
    return 'neutral';
  }

  function openInTab(url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function dashboardUrl(path = '/index.php') {
    return `${currentBaseUrl}${path}`;
  }

  async function copyDataPath() {
    const path = '/var/www/html/LinkedIn/data/content_calendar.json';
    try {
      await navigator.clipboard.writeText(path);
      setStatus('online', 'Data path copied', 'The local content calendar path is now on your clipboard.');
    } catch (err) {
      console.warn('[LinkedIn Overview] Copy failed:', err);
      setStatus('offline', 'Clipboard unavailable', 'Your browser blocked clipboard access.');
    }
  }

  function updateMetrics(overview) {
    const totalPosts = overview?.totalPosts ?? 0;
    const pendingReview = overview?.pendingReviewCount ?? overview?.statusCounts?.pending_review ?? 0;
    const approved = overview?.statusCounts?.approved ?? 0;
    const published = overview?.statusCounts?.published ?? 0;

    if (totalPostsEl) totalPostsEl.textContent = String(totalPosts);
    if (pendingReviewEl) pendingReviewEl.textContent = String(pendingReview);
    if (approvedEl) approvedEl.textContent = String(approved);
    if (publishedEl) publishedEl.textContent = String(published);
    if (queueCountEl) queueCountEl.textContent = `${pendingReview} queued`;
  }

  function renderStatusChips(statusCounts) {
    if (!statusChipsEl) return;

    const entries = Object.entries(statusCounts || {});
    if (entries.length === 0) {
      statusChipsEl.innerHTML = '<span class="linkedin-chip muted">No status data</span>';
      return;
    }

    statusChipsEl.innerHTML = entries
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => `<span class="linkedin-chip ${statusClass(status)}">${escapeHtml(status)} · ${count}</span>`)
      .join('');
  }

  function renderNextPost(nextScheduled) {
    if (!nextPostEl) return;

    if (!nextScheduled) {
      nextPostEl.innerHTML = '<div class="linkedin-empty-note">No scheduled post found.</div>';
      return;
    }

    const viewUrl = `${dashboardUrl('/view.php')}?id=${encodeURIComponent(nextScheduled.id)}`;
    const sourceUrl = nextScheduled.link || dashboardUrl('/index.php');

    nextPostEl.innerHTML = `
      <div class="linkedin-next-title">${escapeHtml(nextScheduled.topic)}</div>
      <div class="linkedin-next-meta">
        <span class="linkedin-chip ${statusClass(nextScheduled.status)}">${escapeHtml(nextScheduled.status)}</span>
        <span>Scheduled: ${escapeHtml(formatDate(nextScheduled.scheduled_time))}</span>
      </div>
      <div class="linkedin-next-actions">
        <button class="linkedin-action-btn primary linkedin-inline-btn" data-action="open-view" data-url="${escapeHtml(viewUrl)}">Open in LinkedIn</button>
        <button class="linkedin-action-btn linkedin-inline-btn" data-action="open-source" data-url="${escapeHtml(sourceUrl)}">Source Link</button>
      </div>
    `;

    nextPostEl.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.vibePlayer) window.vibePlayer.playClick();
        openInTab(btn.getAttribute('data-url'));
      });
    });
  }

  function renderRecentPosts(posts) {
    if (!recentListEl) return;

    const list = Array.isArray(posts) ? posts : [];
    if (!list.length) {
      recentListEl.innerHTML = '<div class="linkedin-empty-note">No posts available yet.</div>';
      return;
    }

    recentListEl.innerHTML = list.map((post) => {
      const viewUrl = `${dashboardUrl('/view.php')}?id=${encodeURIComponent(post.id)}`;
      const editUrl = `${dashboardUrl('/edit.php')}?id=${encodeURIComponent(post.id)}`;
      const sourceUrl = post.link || dashboardUrl('/index.php');

      return `
        <article class="linkedin-post-card">
          <div class="linkedin-post-card-topline">
            <h4>${escapeHtml(post.topic)}</h4>
            <span class="linkedin-chip ${statusClass(post.status)}">${escapeHtml(post.status)}</span>
          </div>
          <div class="linkedin-post-meta">
            <span>Created: ${escapeHtml(formatDate(post.created_at))}</span>
            <span>Scheduled: ${escapeHtml(formatDate(post.scheduled_time))}</span>
            ${post.hasImage ? '<span>Image attached</span>' : ''}
          </div>
          <p class="linkedin-post-summary">${escapeHtml(post.summaryPreview || 'No summary available.')}</p>
          <div class="linkedin-post-actions">
            <button class="linkedin-action-btn primary linkedin-inline-btn" data-url="${escapeHtml(viewUrl)}" data-action="open-view">Open in LinkedIn</button>
            <button class="linkedin-action-btn linkedin-inline-btn" data-url="${escapeHtml(editUrl)}" data-action="open-edit">Edit</button>
            <button class="linkedin-action-btn linkedin-inline-btn" data-url="${escapeHtml(sourceUrl)}" data-action="open-source">Source Link</button>
          </div>
        </article>
      `;
    }).join('');

    recentListEl.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.vibePlayer) window.vibePlayer.playClick();
        openInTab(btn.getAttribute('data-url'));
      });
    });
  }

  function renderApprovalQueue(posts) {
    if (!approvalQueueEl) return;

    const list = Array.isArray(posts) ? posts : [];
    if (!list.length) {
      approvalQueueEl.innerHTML = '<div class="linkedin-empty-note">No posts are waiting for review.</div>';
      return;
    }

    approvalQueueEl.innerHTML = list.map((post) => {
      const viewUrl = `${dashboardUrl('/view.php')}?id=${encodeURIComponent(post.id)}`;
      const editUrl = `${dashboardUrl('/edit.php')}?id=${encodeURIComponent(post.id)}`;
      const sourceUrl = post.link || dashboardUrl('/index.php');

      return `
        <article class="linkedin-queue-item">
          <div class="linkedin-post-card-topline">
            <h4>${escapeHtml(post.topic)}</h4>
            <span class="linkedin-chip ${statusClass(post.status)}">${escapeHtml(post.status)}</span>
          </div>
          <div class="linkedin-post-meta">
            <span>Created: ${escapeHtml(formatDate(post.created_at))}</span>
            <span>Scheduled: ${escapeHtml(formatDate(post.scheduled_time))}</span>
            ${post.hasImage ? '<span>Image attached</span>' : ''}
          </div>
          <p class="linkedin-post-summary">${escapeHtml(post.summaryPreview || 'No summary available.')}</p>
          <div class="linkedin-post-actions">
            <button class="linkedin-action-btn primary linkedin-inline-btn" data-url="${escapeHtml(viewUrl)}" data-action="open-view">Open Review</button>
            <button class="linkedin-action-btn linkedin-inline-btn" data-url="${escapeHtml(editUrl)}" data-action="open-edit">Edit</button>
            <button class="linkedin-action-btn linkedin-inline-btn" data-url="${escapeHtml(sourceUrl)}" data-action="source-link">Source Link</button>
          </div>
        </article>
      `;
    }).join('');

    approvalQueueEl.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.vibePlayer) window.vibePlayer.playClick();
        openInTab(btn.getAttribute('data-url'));
      });
    });
  }

  function isRssBackendUnavailable(latestJob) {
    if (!latestJob || latestJob.success) return false;
    const text = `${latestJob.lastMarker || ''}\n${latestJob.logExcerpt || ''}`.toLowerCase();
    return text.includes('ollama is not available') || text.includes('please check the endpoint') || text.includes('connection refused') || text.includes('timed out');
  }

  function renderRssStatus(rssStatus) {
    currentRssStatus = rssStatus || null;

    const latestJob = rssStatus?.latestJob || null;
    if (rssJobCountEl) rssJobCountEl.textContent = `${rssStatus?.jobCount ?? 0} log${(rssStatus?.jobCount ?? 0) === 1 ? '' : 's'}`;

    if (!rssStatusDot || !rssStatusLabel || !rssStatusMeta || !rssLogEl || !rssChipsEl) return;

    if (rssBackendAlertEl) {
      rssBackendAlertEl.hidden = true;
      rssBackendAlertEl.textContent = '';
    }

    if (!latestJob) {
      rssStatusDot.dataset.state = 'offline';
      rssStatusLabel.textContent = 'No RSS logs found';
      rssStatusMeta.textContent = 'The importer has not written any log files yet.';
      rssLogEl.innerHTML = '<div class="linkedin-empty-note">No RSS logs available yet.</div>';
      rssChipsEl.innerHTML = '<span class="linkedin-chip muted">No runs</span>';
      return;
    }

    const state = latestJob.success ? 'online' : (latestJob.error ? 'offline' : (latestJob.running ? 'checking' : 'neutral'));
    rssStatusDot.dataset.state = state;
    rssStatusLabel.textContent = latestJob.success
      ? 'RSS import completed'
      : latestJob.error
        ? 'RSS import finished with errors'
        : latestJob.running
          ? 'RSS import running'
          : 'RSS status available';

    const marker = latestJob.lastMarker || 'No marker available';
    rssStatusMeta.textContent = `Job ${latestJob.jobId} · Updated ${formatDate(latestJob.updatedAt)} · ${latestJob.ageSeconds}s ago · ${marker}`;
    rssLogEl.innerHTML = `<pre class="linkedin-rss-log-text">${escapeHtml(latestJob.logExcerpt || 'No log excerpt available.')}</pre>`;

    if (rssBackendAlertEl && isRssBackendUnavailable(latestJob)) {
      rssBackendAlertEl.hidden = false;
      rssBackendAlertEl.textContent = 'Ollama is unreachable from the LinkedIn project right now. The manual trigger is still available, but the RSS import will not complete until the backend comes back online or the host URL is updated.';
    }

    const chips = [
      `logs · ${rssStatus.jobCount ?? 0}`,
      `processing · ${latestJob.processingCount ?? 0}`,
      `saved · ${latestJob.savedCount ?? 0}`,
      `errors · ${latestJob.errorCount ?? 0}`,
      latestJob.running ? 'running' : 'idle'
    ];

    rssChipsEl.innerHTML = chips
      .map((label, index) => {
        const className = index === 4
          ? (latestJob.running ? 'pending' : 'published')
          : 'neutral';
        return `<span class="linkedin-chip ${className}">${escapeHtml(label)}</span>`;
      })
      .join('');
  }

  function applyOverview(data) {
    currentOverview = data;
    updateMetrics(data);
    renderStatusChips(data?.statusCounts || {});
    renderNextPost(data?.nextScheduled || null);
    renderApprovalQueue(data?.pendingReviewPosts || []);
    renderRecentPosts(data?.recentPosts || []);

    const updatedAt = data?.updatedAt ? formatDate(data.updatedAt) : 'unknown';
    const total = data?.totalPosts ?? 0;
    setStatus('online', 'Overview ready', `Loaded ${total} posts · last updated ${updatedAt}`);
  }

  async function fetchJson(url) {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    return resp.json();
  }

  async function postJson(url, body) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': window.Dashboard?.csrfToken || ''
      },
      body: JSON.stringify(body || {})
    });

    if (!resp.ok) {
      let message = `HTTP ${resp.status}`;
      try {
        const data = await resp.json();
        message = data?.error || message;
      } catch (_) {
        // ignore JSON parse failures on error bodies
      }
      throw new Error(message);
    }

    return resp.json();
  }

  async function fetchDashboardData() {
    const requestId = ++latestRequestId;
    setStatus('checking', 'Refreshing overview…', 'Reading the local LinkedIn content calendar and RSS logs.');

    const [overviewResult, rssResult] = await Promise.allSettled([
      fetchJson('/api/linkedin/overview'),
      fetchJson('/api/linkedin/rss-status')
    ]);

    if (requestId !== latestRequestId) return;

    if (overviewResult.status === 'fulfilled') {
      applyOverview(overviewResult.value);
    } else {
      console.error('[LinkedIn Overview] Failed to load overview:', overviewResult.reason);
      setStatus('offline', 'Overview unavailable', 'Unable to read the local content calendar right now.');
      if (totalPostsEl) totalPostsEl.textContent = '—';
      if (pendingReviewEl) pendingReviewEl.textContent = '—';
      if (approvedEl) approvedEl.textContent = '—';
      if (publishedEl) publishedEl.textContent = '—';
      if (statusChipsEl) statusChipsEl.innerHTML = '<span class="linkedin-chip muted">No data loaded</span>';
      if (nextPostEl) nextPostEl.innerHTML = '<div class="linkedin-empty-note">Refresh the module to try again.</div>';
      if (approvalQueueEl) approvalQueueEl.innerHTML = '<div class="linkedin-empty-note">Queue data unavailable.</div>';
      if (recentListEl) recentListEl.innerHTML = '<div class="linkedin-empty-note">No posts loaded.</div>';
    }

    if (rssResult.status === 'fulfilled') {
      renderRssStatus(rssResult.value);
    } else {
      console.warn('[LinkedIn Overview] Failed to load RSS status:', rssResult.reason);
      renderRssStatus({ jobCount: 0, latestJob: null });
    }
  }

  function openFirstQueueItem() {
    const id = currentOverview?.pendingReviewPosts?.[0]?.id;
    if (id) {
      openInTab(`${dashboardUrl('/view.php')}?id=${encodeURIComponent(id)}`);
    } else {
      openInTab(dashboardUrl('/index.php'));
    }
  }

  async function triggerRssImport() {
    const requestedCount = Number.parseInt(rssCountInput?.value, 10);
    const count = Number.isFinite(requestedCount) ? Math.max(1, Math.min(10, requestedCount)) : 5;

    if (rssRunBtn) rssRunBtn.disabled = true;
    if (rssStatusDot) rssStatusDot.dataset.state = 'checking';
    if (rssStatusLabel) rssStatusLabel.textContent = 'Queuing RSS import…';
    if (rssStatusMeta) rssStatusMeta.textContent = `Starting a fresh RSS import with up to ${count} posts.`;

    try {
      const result = await postJson('/api/linkedin/rss-trigger', { count });
      setStatus('checking', 'RSS import queued', `Job ${result.jobId} started for up to ${result.count} posts.`);
      await fetchDashboardData();
    } catch (err) {
      console.error('[LinkedIn Overview] Failed to trigger RSS import:', err);
      if (rssStatusDot) rssStatusDot.dataset.state = 'offline';
      if (rssStatusLabel) rssStatusLabel.textContent = 'RSS import failed to start';
      if (rssStatusMeta) rssStatusMeta.textContent = err?.message || 'Unknown error';
    } finally {
      if (rssRunBtn) rssRunBtn.disabled = false;
    }
  }

  function bindEvents() {
    refreshBtn = $('#linkedin-refresh-btn');
    openDashboardBtn = $('#linkedin-open-dashboard-btn');
    openReviewBtn = $('#linkedin-open-review-btn');
    openRssBtn = $('#linkedin-open-rss-btn');
    rssRunBtn = $('#linkedin-run-rss-btn');
    rssCountInput = $('#linkedin-rss-count-input');
    copyPathBtn = $('#linkedin-copy-path-btn');
    baseUrlInput = $('#linkedin-base-url-input');
    statusDot = $('#linkedin-status-dot');
    statusLabel = $('#linkedin-status-label');
    statusUrl = $('#linkedin-status-url');
    statusMeta = $('#linkedin-status-meta');
    totalPostsEl = $('#linkedin-total-posts');
    pendingReviewEl = $('#linkedin-pending-review');
    approvedEl = $('#linkedin-approved');
    publishedEl = $('#linkedin-published');
    nextPostEl = $('#linkedin-next-post');
    statusChipsEl = $('#linkedin-status-chips');
    recentListEl = $('#linkedin-recent-list');
    approvalQueueEl = $('#linkedin-approval-queue');
    queueCountEl = $('#linkedin-queue-count');
    rssJobCountEl = $('#linkedin-rss-job-count');
    rssStatusDot = $('#linkedin-rss-status-dot');
    rssStatusLabel = $('#linkedin-rss-status-label');
    rssStatusMeta = $('#linkedin-rss-status-meta');
    rssBackendAlertEl = $('#linkedin-rss-backend-alert');
    rssLogEl = $('#linkedin-rss-log');
    rssChipsEl = $('#linkedin-rss-chips');

    refreshBtn.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      fetchDashboardData();
    });

    openDashboardBtn.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      openInTab(dashboardUrl('/index.php'));
    });

    openReviewBtn.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      openFirstQueueItem();
    });

    openRssBtn.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      openInTab(dashboardUrl('/index.php'));
    });

    rssRunBtn.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      triggerRssImport();
    });

    copyPathBtn.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      copyDataPath();
    });

    baseUrlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        if (window.vibePlayer) window.vibePlayer.playClick();
        currentBaseUrl = normalizeBaseUrl(baseUrlInput.value);
        baseUrlInput.value = currentBaseUrl;
        persistBaseUrl(currentBaseUrl);
        fetchDashboardData();
      }
    });

    rssCountInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        if (window.vibePlayer) window.vibePlayer.playClick();
        triggerRssImport();
      }
    });

    baseUrlInput.addEventListener('blur', () => {
      currentBaseUrl = normalizeBaseUrl(baseUrlInput.value);
      baseUrlInput.value = currentBaseUrl;
      persistBaseUrl(currentBaseUrl);
      if (currentOverview) {
        setStatus('online', 'Base URL updated', `The dashboard links now point to ${currentBaseUrl}.`);
      }
    });

    document.addEventListener('dashboard:view-changed', (event) => {
      if (event.detail && event.detail.id === 'linkedin-overview') {
        fetchDashboardData();
      }
    });
  }

  function init() {
    viewPanel = document.getElementById('view-linkedin-overview');
    if (!viewPanel) return;

    currentBaseUrl = getStoredBaseUrl();
    bindEvents();
    baseUrlInput.value = currentBaseUrl;
    setStatus('checking', 'Loading overview…', 'Reading the local LinkedIn content calendar and RSS logs.');
    fetchDashboardData();
  }

  init();
})();
