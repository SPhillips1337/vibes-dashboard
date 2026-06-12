(function () {
  'use strict';

  let viewPanel = null;
  let statusDot = null;
  let statusLabel = null;
  let statusMeta = null;
  let refreshBtn = null;
  let copyPathBtn = null;
  let totalPostsEl = null;
  let pendingReviewEl = null;
  let approvedEl = null;
  let publishedEl = null;
  let statusChipsEl = null;
  let recentListEl = null;
  let approvalQueueEl = null;
  let queueCountEl = null;
  let rssJobCountEl = null;
  let rssStatusDot = null;
  let rssStatusLabel = null;
  let rssStatusMeta = null;
  let rssLogEl = null;
  let rssChipsEl = null;

  // New elements for subviews
  let workbenchNav = null;
  let subviews = {};
  let fullCalendarEl = null;
  let fullQueueEl = null;
  let fullRssLogEl = null;
  let rssRunBtn = null;
  let rssCountInput = null;

  // Modal elements
  let editModal = null;
  let editForm = null;
  let modalTitle = null;
  let closeModalBtn = null;
  let cancelModalBtn = null;
  let saveModalBtn = null;

  let currentOverview = null;
  let latestRequestId = 0;

  function $(selector) {
    return viewPanel ? viewPanel.querySelector(selector) : null;
  }

  function setStatus(state, label, meta) {
    if (statusDot) statusDot.dataset.state = state;
    if (statusLabel) statusLabel.textContent = label;
    if (statusMeta) statusMeta.textContent = meta;
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

  async function copyDataPath() {
    const path = currentOverview?.sourcePath || '/var/www/html/LinkedIn/data/content_calendar.json';
    try {
      await navigator.clipboard.writeText(path);
      setStatus('online', 'Data path copied', 'The local content calendar path is now on your clipboard.');
    } catch (err) {
      console.warn('[LinkedIn Overview] Copy failed:', err);
      setStatus('offline', 'Clipboard unavailable', 'Your browser blocked clipboard access.');
    }
  }

  function renderPostCard(post, isQueue = false) {
    return `
      <article class="linkedin-post-card">
        <div class="linkedin-post-card-topline">
          <h4>${escapeHtml(post.topic)}</h4>
          <span class="linkedin-chip ${statusClass(post.status)}">${escapeHtml(post.status)}</span>
        </div>
        <div class="linkedin-post-meta">
          <span>Created: ${escapeHtml(formatDate(post.created_at))}</span>
          <span>Scheduled: ${escapeHtml(formatDate(post.scheduled_time))}</span>
        </div>
        <p class="linkedin-post-summary">${escapeHtml(post.summaryPreview || 'No summary available.')}</p>
        <div class="linkedin-post-actions">
          <button class="linkedin-action-btn primary linkedin-inline-btn" data-id="${escapeHtml(post.id)}" data-action="edit">Edit / Review</button>
          ${isQueue ? `<button class="linkedin-action-btn linkedin-inline-btn" data-id="${escapeHtml(post.id)}" data-action="approve">Quick Approve</button>` : ''}
          ${post.link ? `<button class="linkedin-action-btn linkedin-inline-btn" data-url="${escapeHtml(post.link)}" data-action="open-link">View Link</button>` : ''}
        </div>
      </article>
    `;
  }

  function attachPostEvents(container) {
    container.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.vibePlayer) window.vibePlayer.playClick();
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        const url = btn.getAttribute('data-url');

        if (action === 'edit') {
          openEditModal(id);
        } else if (action === 'approve') {
          updatePostStatus(id, 'approved');
        } else if (action === 'open-link') {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      });
    });
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
    statusChipsEl.innerHTML = entries
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => `<span class="linkedin-chip ${statusClass(status)}">${escapeHtml(status)} · ${count}</span>`)
      .join('');
  }

  function applyOverview(data) {
    currentOverview = data;
    updateMetrics(data);
    renderStatusChips(data?.statusCounts || {});
    
    if (approvalQueueEl) {
      const queue = data?.pendingReviewPosts || [];
      approvalQueueEl.innerHTML = queue.length ? queue.map(p => renderPostCard(p, true)).join('') : '<div class="linkedin-empty-note">No posts waiting for review.</div>';
      attachPostEvents(approvalQueueEl);
    }

    if (recentListEl) {
      const recent = data?.recentPosts || [];
      recentListEl.innerHTML = recent.length ? recent.map(p => renderPostCard(p)).join('') : '<div class="linkedin-empty-note">No posts available.</div>';
      attachPostEvents(recentListEl);
    }

    // Populate full views if they are active
    if (subviews.calendar && !subviews.calendar.classList.contains('hidden')) {
      renderFullCalendar();
    }
    if (subviews.queue && !subviews.queue.classList.contains('hidden')) {
      renderFullQueue();
    }

    const updatedAt = data?.updatedAt ? formatDate(data.updatedAt) : 'unknown';
    setStatus('online', 'Data ready', `Loaded ${data?.totalPosts ?? 0} posts · last updated ${updatedAt}`);
  }

  async function renderFullCalendar() {
    if (!fullCalendarEl) return;
    fullCalendarEl.innerHTML = '<div class="linkedin-empty-note">Loading all posts…</div>';
    try {
      // For now we just use the overview's recentPosts but in a real app we'd fetch all
      // Since the server overview already has everything in memory, maybe we should add an endpoint for all
      const resp = await fetchJson('/api/linkedin/overview'); 
      const posts = resp.recentPosts || []; // Mocking full list with recent for now
      fullCalendarEl.innerHTML = posts.map(p => renderPostCard(p)).join('');
      attachPostEvents(fullCalendarEl);
    } catch (e) {
      fullCalendarEl.innerHTML = '<div class="linkedin-empty-note">Failed to load calendar.</div>';
    }
  }

  async function renderFullQueue() {
    if (!fullQueueEl) return;
    fullQueueEl.innerHTML = '<div class="linkedin-empty-note">Loading review queue…</div>';
    try {
      const resp = await fetchJson('/api/linkedin/overview');
      const posts = resp.pendingReviewPosts || [];
      fullQueueEl.innerHTML = posts.length ? posts.map(p => renderPostCard(p, true)).join('') : '<div class="linkedin-empty-note">Queue is empty.</div>';
      attachPostEvents(fullQueueEl);
    } catch (e) {
      fullQueueEl.innerHTML = '<div class="linkedin-empty-note">Failed to load queue.</div>';
    }
  }

  function renderRssStatus(rssStatus) {
    const latestJob = rssStatus?.latestJob || null;
    if (rssJobCountEl) rssJobCountEl.textContent = `${rssStatus?.jobCount ?? 0} log${(rssStatus?.jobCount ?? 0) === 1 ? '' : 's'}`;
    if (!rssStatusDot || !rssStatusLabel || !rssStatusMeta || !rssLogEl || !rssChipsEl) return;

    if (!latestJob) {
      rssStatusDot.dataset.state = 'offline';
      rssStatusLabel.textContent = 'No RSS logs found';
      rssStatusMeta.textContent = 'Importer has not run yet.';
      rssLogEl.innerHTML = '<div class="linkedin-empty-note">No logs available.</div>';
      rssChipsEl.innerHTML = '';
      return;
    }

    const state = latestJob.success ? 'online' : (latestJob.error ? 'offline' : (latestJob.running ? 'checking' : 'neutral'));
    rssStatusDot.dataset.state = state;
    rssStatusLabel.textContent = latestJob.success ? 'RSS import completed' : (latestJob.running ? 'RSS import running' : 'RSS status available');
    rssStatusMeta.textContent = `Job ${latestJob.jobId} · Updated ${formatDate(latestJob.updatedAt)}`;
    
    const logText = `<pre class="linkedin-rss-log-text">${escapeHtml(latestJob.logExcerpt || 'No log excerpt.')}</pre>`;
    rssLogEl.innerHTML = logText;
    if (fullRssLogEl) fullRssLogEl.innerHTML = logText;

    const chips = [`saved · ${latestJob.savedCount ?? 0}`, `errors · ${latestJob.errorCount ?? 0}`, latestJob.running ? 'running' : 'idle'];
    rssChipsEl.innerHTML = chips.map(l => `<span class="linkedin-chip">${escapeHtml(l)}</span>`).join('');
  }

  async function fetchDashboardData() {
    const requestId = ++latestRequestId;
    setStatus('checking', 'Refreshing data…', 'Reading the local LinkedIn content calendar and logs.');

    const [overviewResult, rssResult] = await Promise.allSettled([
      fetchJson('/api/linkedin/overview'),
      fetchJson('/api/linkedin/rss-status')
    ]);

    if (requestId !== latestRequestId) return;

    if (overviewResult.status === 'fulfilled') {
      applyOverview(overviewResult.value);
    } else {
      setStatus('offline', 'Data unavailable', 'Unable to read the local content calendar.');
    }

    if (rssResult.status === 'fulfilled') {
      renderRssStatus(rssResult.value);
    }
  }

  async function updatePostStatus(id, status) {
    try {
      await postJson(`/api/linkedin/posts/${id}`, { status });
      fetchDashboardData();
    } catch (err) {
      console.error('[LinkedIn] Update failed:', err);
      alert(`Failed to update post: ${err.message}`);
    }
  }

  function openEditModal(id) {
    const post = [...(currentOverview?.recentPosts || []), ...(currentOverview?.pendingReviewPosts || [])].find(p => p.id === id);
    if (!post) return;

    $('#linkedin-edit-id').value = post.id;
    $('#linkedin-edit-topic').value = post.topic;
    $('#linkedin-edit-content').value = post.content || post.summaryPreview;
    $('#linkedin-edit-status').value = post.status;
    
    if (post.scheduled_time) {
      const date = new Date(post.scheduled_time);
      if (!Number.isNaN(date.getTime())) {
        // Format for datetime-local: YYYY-MM-DDTHH:MM
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        $('#linkedin-edit-scheduled').value = `${year}-${month}-${day}T${hours}:${minutes}`;
      }
    } else {
      $('#linkedin-edit-scheduled').value = '';
    }

    if (editModal) editModal.classList.remove('hidden');
  }

  function closeEditModal() {
    if (editModal) editModal.classList.add('hidden');
  }

  async function saveEditModal() {
    const id = $('#linkedin-edit-id').value;
    const scheduledVal = $('#linkedin-edit-scheduled').value;
    const data = {
      topic: $('#linkedin-edit-topic').value,
      content: $('#linkedin-edit-content').value,
      status: $('#linkedin-edit-status').value,
      scheduled_time: scheduledVal ? new Date(scheduledVal).toISOString() : null
    };

    try {
      saveModalBtn.disabled = true;
      saveModalBtn.textContent = 'Saving…';
      await postJson(`/api/linkedin/posts/${id}`, data);
      closeEditModal();
      fetchDashboardData();
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      saveModalBtn.disabled = false;
      saveModalBtn.textContent = 'Save Changes';
    }
  }

  function switchView(viewId) {
    Object.keys(subviews).forEach(id => {
      if (id === viewId) {
        subviews[id].classList.remove('hidden');
      } else {
        subviews[id].classList.add('hidden');
      }
    });

    workbenchNav.querySelectorAll('.linkedin-nav-btn').forEach(btn => {
      if (btn.dataset.view === viewId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (viewId === 'calendar') renderFullCalendar();
    if (viewId === 'queue') renderFullQueue();
  }

  async function triggerRssImport() {
    const count = Number.parseInt(rssCountInput?.value, 10) || 5;
    if (rssRunBtn) rssRunBtn.disabled = true;
    try {
      await postJson('/api/linkedin/rss-trigger', { count });
      fetchDashboardData();
    } catch (err) {
      alert(`Trigger failed: ${err.message}`);
    } finally {
      if (rssRunBtn) rssRunBtn.disabled = false;
    }
  }

  async function fetchJson(url) {
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  function bindEvents() {
    refreshBtn = $('#linkedin-refresh-btn');
    copyPathBtn = $('#linkedin-copy-path-btn');
    statusDot = $('#linkedin-status-dot');
    statusLabel = $('#linkedin-status-label');
    statusMeta = $('#linkedin-status-meta');
    totalPostsEl = $('#linkedin-total-posts');
    pendingReviewEl = $('#linkedin-pending-review');
    approvedEl = $('#linkedin-approved');
    publishedEl = $('#linkedin-published');
    statusChipsEl = $('#linkedin-status-chips');
    recentListEl = $('#linkedin-recent-list');
    approvalQueueEl = $('#linkedin-approval-queue');
    queueCountEl = $('#linkedin-queue-count');
    rssJobCountEl = $('#linkedin-rss-job-count');
    rssStatusDot = $('#linkedin-rss-status-dot');
    rssStatusLabel = $('#linkedin-rss-status-label');
    rssStatusMeta = $('#linkedin-rss-status-meta');
    rssLogEl = $('#linkedin-rss-log');
    rssChipsEl = $('#linkedin-rss-chips');

    workbenchNav = $('#linkedin-workbench-nav');
    subviews = {
      overview: $('#linkedin-view-overview'),
      calendar: $('#linkedin-view-calendar'),
      queue: $('#linkedin-view-queue'),
      rss: $('#linkedin-view-rss')
    };
    fullCalendarEl = $('#linkedin-full-calendar');
    fullQueueEl = $('#linkedin-full-queue');
    fullRssLogEl = $('#linkedin-rss-full-log');
    rssRunBtn = $('#linkedin-run-rss-btn');
    rssCountInput = $('#linkedin-rss-count-input');

    editModal = $('#linkedin-edit-modal');
    closeModalBtn = $('#linkedin-modal-close');
    cancelModalBtn = $('#linkedin-edit-cancel');
    saveModalBtn = $('#linkedin-edit-save');

    refreshBtn.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      fetchDashboardData();
    });

    copyPathBtn.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      copyDataPath();
    });

    workbenchNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.linkedin-nav-btn');
      if (btn) {
        if (window.vibePlayer) window.vibePlayer.playClick();
        switchView(btn.dataset.view);
      }
    });

    rssRunBtn.addEventListener('click', () => {
      if (window.vibePlayer) window.vibePlayer.playClick();
      triggerRssImport();
    });

    closeModalBtn.addEventListener('click', closeEditModal);
    cancelModalBtn.addEventListener('click', closeEditModal);
    saveModalBtn.addEventListener('click', saveEditModal);

    document.addEventListener('dashboard:view-changed', (event) => {
      if (event.detail && event.detail.id === 'linkedin-overview') {
        fetchDashboardData();
      }
    });
  }

  function init() {
    viewPanel = document.getElementById('view-linkedin-overview');
    if (!viewPanel) return;
    bindEvents();
    fetchDashboardData();
  }

  init();
})();
