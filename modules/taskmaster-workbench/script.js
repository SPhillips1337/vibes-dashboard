(function () {
  'use strict';

  const STORAGE_KEY = 'vibes.taskmaster.tasks.v1';
  const PREFS_KEY = 'vibes.taskmaster.prefs.v1';
  const root = document.getElementById('taskmaster-module');
  if (!root) return;

  const els = {
    total: document.getElementById('taskmaster-stat-total'),
    active: document.getElementById('taskmaster-stat-active'),
    complete: document.getElementById('taskmaster-stat-complete'),
    subtasks: document.getElementById('taskmaster-stat-subtasks'),
    saveState: document.getElementById('taskmaster-save-state'),
    visibleCount: document.getElementById('taskmaster-visible-count'),
    searchInput: document.getElementById('taskmaster-search-input'),
    sortSelect: document.getElementById('taskmaster-sort-select'),
    exportBtn: document.getElementById('taskmaster-export-btn'),
    importBtn: document.getElementById('taskmaster-import-btn'),
    clearDoneBtn: document.getElementById('taskmaster-clear-done-btn'),
    importInput: document.getElementById('taskmaster-import-input'),
    addForm: document.getElementById('taskmaster-add-form'),
    addTitle: document.getElementById('taskmaster-add-title'),
    addDescription: document.getElementById('taskmaster-add-description'),
    taskList: document.getElementById('taskmaster-task-list'),
    detail: document.getElementById('taskmaster-detail'),
    filterButtons: Array.from(root.querySelectorAll('[data-filter]'))
  };

  const state = {
    tasks: [],
    selectedId: null,
    search: '',
    filter: 'all',
    sort: 'updated-desc'
  };

  let saveMessageTimer = null;

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function normalizeSubtask(raw) {
    const createdAt = raw?.createdAt || nowIso();
    return {
      id: raw?.id || uid('subtask'),
      title: String(raw?.title || '').trim(),
      description: String(raw?.description || ''),
      complete: Boolean(raw?.complete),
      createdAt,
      updatedAt: raw?.updatedAt || createdAt
    };
  }

  function normalizeTask(raw) {
    const createdAt = raw?.createdAt || nowIso();
    const status = ['pending', 'in-progress', 'completed'].includes(raw?.status) ? raw.status : 'pending';
    return {
      id: raw?.id || uid('task'),
      title: String(raw?.title || 'Untitled task').trim() || 'Untitled task',
      description: String(raw?.description || ''),
      notes: String(raw?.notes || ''),
      status,
      createdAt,
      updatedAt: raw?.updatedAt || createdAt,
      subtasks: Array.isArray(raw?.subtasks) ? raw.subtasks.map(normalizeSubtask) : []
    };
  }

  function readJSON(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[TaskMaster] Failed to read localStorage payload:', err);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('[TaskMaster] Failed to write localStorage payload:', err);
      return false;
    }
  }

  function loadState() {
    const savedTasks = readJSON(STORAGE_KEY, []);
    const prefs = readJSON(PREFS_KEY, {});

    state.tasks = Array.isArray(savedTasks) ? savedTasks.map(normalizeTask) : [];
    state.selectedId = typeof prefs.selectedId === 'string' ? prefs.selectedId : null;
    state.search = typeof prefs.search === 'string' ? prefs.search : '';
    state.filter = ['all', 'pending', 'in-progress', 'completed'].includes(prefs.filter) ? prefs.filter : 'all';
    state.sort = typeof prefs.sort === 'string' ? prefs.sort : 'updated-desc';

    if (!state.tasks.length) {
      state.selectedId = null;
    } else if (!state.selectedId || !state.tasks.some(task => task.id === state.selectedId)) {
      state.selectedId = state.tasks[0].id;
    }
  }

  function persistState(note) {
    writeJSON(STORAGE_KEY, state.tasks);
    writeJSON(PREFS_KEY, {
      selectedId: state.selectedId,
      search: state.search,
      filter: state.filter,
      sort: state.sort
    });

    if (els.saveState) {
      els.saveState.textContent = note || 'Saved locally';
      els.saveState.dataset.state = 'saved';
      window.clearTimeout(saveMessageTimer);
      saveMessageTimer = window.setTimeout(() => {
        if (els.saveState) {
          els.saveState.textContent = 'Ready';
          els.saveState.dataset.state = 'idle';
        }
      }, 1400);
    }
  }

  function getSelectedTask() {
    return state.tasks.find(task => task.id === state.selectedId) || null;
  }

  function statusLabel(status) {
    switch (status) {
      case 'completed': return 'Completed';
      case 'in-progress': return 'In Progress';
      default: return 'Pending';
    }
  }

  function statusClass(status) {
    return status === 'completed' ? 'completed' : (status === 'in-progress' ? 'in-progress' : 'pending');
  }

  function taskMatchesQuery(task, query) {
    if (!query) return true;
    const haystack = [task.title, task.description, task.notes, task.status]
      .concat(task.subtasks.flatMap(sub => [sub.title, sub.description]))
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  }

  function sortTasks(tasks) {
    const list = tasks.slice();
    const statusRank = { 'pending': 0, 'in-progress': 1, 'completed': 2 };
    switch (state.sort) {
      case 'created-asc':
        return list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      case 'created-desc':
        return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      case 'title-asc':
        return list.sort((a, b) => a.title.localeCompare(b.title));
      case 'title-desc':
        return list.sort((a, b) => b.title.localeCompare(a.title));
      case 'status':
        return list.sort((a, b) => (statusRank[a.status] ?? 0) - (statusRank[b.status] ?? 0) || new Date(b.updatedAt) - new Date(a.updatedAt));
      case 'updated-desc':
      default:
        return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }
  }

  function getVisibleTasks() {
    const query = state.search.trim().toLowerCase();
    const filtered = state.tasks.filter(task => {
      if (state.filter !== 'all' && task.status !== state.filter) return false;
      return taskMatchesQuery(task, query);
    });
    return sortTasks(filtered);
  }

  function computeStats() {
    const total = state.tasks.length;
    const complete = state.tasks.filter(task => task.status === 'completed').length;
    const active = total - complete;
    const subtasks = state.tasks.reduce((sum, task) => sum + task.subtasks.length, 0);
    return { total, active, complete, subtasks };
  }

  function renderStats() {
    const stats = computeStats();
    if (els.total) els.total.textContent = String(stats.total);
    if (els.active) els.active.textContent = String(stats.active);
    if (els.complete) els.complete.textContent = String(stats.complete);
    if (els.subtasks) els.subtasks.textContent = String(stats.subtasks);
    if (els.visibleCount) {
      const visible = getVisibleTasks().length;
      els.visibleCount.textContent = `${visible} visible`;
    }
  }

  function renderList() {
    const tasks = getVisibleTasks();
    if (!els.taskList) return;

    if (!tasks.length) {
      els.taskList.innerHTML = '<div class="taskmaster-empty-state">No tasks match the current search/filter.</div>';
      return;
    }

    els.taskList.innerHTML = tasks.map(task => {
      const selected = task.id === state.selectedId ? 'selected' : '';
      const subtaskDone = task.subtasks.filter(sub => sub.complete).length;
      const subtaskLabel = task.subtasks.length
        ? `${subtaskDone}/${task.subtasks.length} subtasks`
        : 'No subtasks';

      return `
        <article class="taskmaster-task-card ${selected}" data-task-id="${escapeHtml(task.id)}">
          <div class="taskmaster-task-card-topline">
            <div>
              <button class="taskmaster-status-chip ${statusClass(task.status)}" type="button" data-action="cycle-status">${escapeHtml(statusLabel(task.status))}</button>
              <h4>${escapeHtml(task.title)}</h4>
            </div>
            <div class="taskmaster-card-actions">
              <button class="taskmaster-icon-btn" type="button" title="Open details" data-action="select">Open</button>
              <button class="taskmaster-icon-btn danger" type="button" title="Delete task" data-action="delete">Delete</button>
            </div>
          </div>
          <p class="taskmaster-card-description">${escapeHtml(task.description || 'No description yet.')}</p>
          <div class="taskmaster-task-meta">
            <span>${escapeHtml(subtaskLabel)}</span>
            <span>Updated ${escapeHtml(formatDate(task.updatedAt))}</span>
          </div>
        </article>
      `;
    }).join('');

    els.taskList.querySelectorAll('[data-task-id]').forEach(card => {
      const taskId = card.getAttribute('data-task-id');
      card.addEventListener('click', (event) => {
        const action = event.target?.closest?.('[data-action]')?.getAttribute('data-action');
        if (action === 'cycle-status') {
          event.preventDefault();
          event.stopPropagation();
          cycleTaskStatus(taskId);
          return;
        }
        if (action === 'delete') {
          event.preventDefault();
          event.stopPropagation();
          deleteTask(taskId);
          return;
        }
        selectTask(taskId);
      });
    });
  }

  function renderDetail() {
    const task = getSelectedTask();
    if (!els.detail) return;

    if (!task) {
      els.detail.innerHTML = '<div class="taskmaster-empty-state">Select a task to edit its details, notes, and subtasks.</div>';
      return;
    }

    els.detail.innerHTML = `
      <div class="taskmaster-panel-heading compact-top">
        <div>
          <h3>Task details</h3>
          <p>Edit the selected task in place. Changes persist automatically.</p>
        </div>
        <span class="taskmaster-badge ${statusClass(task.status)}">${escapeHtml(statusLabel(task.status))}</span>
      </div>

      <div class="taskmaster-detail-grid">
        <label class="taskmaster-field">
          <span>Title</span>
          <input id="taskmaster-detail-title" type="text" value="${escapeHtml(task.title)}" maxlength="180" />
        </label>

        <label class="taskmaster-field">
          <span>Status</span>
          <select id="taskmaster-detail-status" class="taskmaster-select">
            <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="in-progress" ${task.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
            <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>Completed</option>
          </select>
        </label>

        <label class="taskmaster-field wide">
          <span>Description</span>
          <textarea id="taskmaster-detail-description" rows="4" maxlength="600">${escapeHtml(task.description)}</textarea>
        </label>

        <label class="taskmaster-field wide">
          <span>Notes</span>
          <textarea id="taskmaster-detail-notes" rows="5" maxlength="1400" placeholder="Add implementation notes, links, or reminders…">${escapeHtml(task.notes)}</textarea>
        </label>
      </div>

      <div class="taskmaster-detail-meta">
        <span>Created ${escapeHtml(formatDate(task.createdAt))}</span>
        <span>Updated ${escapeHtml(formatDate(task.updatedAt))}</span>
        <span>${escapeHtml(task.subtasks.length)} subtasks</span>
      </div>

      <div class="taskmaster-subtasks-section">
        <div class="taskmaster-subtasks-heading">
          <div>
            <h4>Subtasks</h4>
            <p>Track the steps inside the selected task.</p>
          </div>
          <button id="taskmaster-add-subtask-btn" class="taskmaster-action-btn" type="button">Add Subtask</button>
        </div>

        <div class="taskmaster-subtask-list">
          ${task.subtasks.length ? task.subtasks.map((subtask) => `
            <div class="taskmaster-subtask-row ${subtask.complete ? 'complete' : ''}" data-subtask-id="${escapeHtml(subtask.id)}">
              <label class="taskmaster-subtask-check">
                <input type="checkbox" data-subtask-action="toggle" ${subtask.complete ? 'checked' : ''} />
                <span></span>
              </label>
              <div class="taskmaster-subtask-fields">
                <input type="text" class="taskmaster-subtask-title" value="${escapeHtml(subtask.title)}" placeholder="Subtask title" maxlength="180" data-subtask-action="title" />
                <textarea class="taskmaster-subtask-description" rows="2" placeholder="Optional details…" maxlength="420" data-subtask-action="description">${escapeHtml(subtask.description)}</textarea>
              </div>
              <button class="taskmaster-icon-btn danger" type="button" data-subtask-action="delete">Delete</button>
            </div>
          `).join('') : '<div class="taskmaster-empty-state">No subtasks yet. Add one to break the task down.</div>'}
        </div>
      </div>
    `;

    const titleInput = document.getElementById('taskmaster-detail-title');
    const statusSelect = document.getElementById('taskmaster-detail-status');
    const descriptionInput = document.getElementById('taskmaster-detail-description');
    const notesInput = document.getElementById('taskmaster-detail-notes');
    const addSubtaskBtn = document.getElementById('taskmaster-add-subtask-btn');

    if (titleInput) {
      titleInput.addEventListener('input', () => updateTaskField(task.id, 'title', titleInput.value, false));
    }
    if (statusSelect) {
      statusSelect.addEventListener('change', () => updateTaskField(task.id, 'status', statusSelect.value, true));
    }
    if (descriptionInput) {
      descriptionInput.addEventListener('input', () => updateTaskField(task.id, 'description', descriptionInput.value, false));
    }
    if (notesInput) {
      notesInput.addEventListener('input', () => updateTaskField(task.id, 'notes', notesInput.value, false));
    }
    if (addSubtaskBtn) {
      addSubtaskBtn.addEventListener('click', () => addSubtask(task.id));
    }

    els.detail.querySelectorAll('[data-subtask-id]').forEach(row => {
      const subtaskId = row.getAttribute('data-subtask-id');
      const checkbox = row.querySelector('[data-subtask-action="toggle"]');
      const title = row.querySelector('[data-subtask-action="title"]');
      const description = row.querySelector('[data-subtask-action="description"]');
      const remove = row.querySelector('[data-subtask-action="delete"]');

      if (checkbox) {
        checkbox.addEventListener('change', () => updateSubtask(task.id, subtaskId, 'complete', checkbox.checked, true));
      }
      if (title) {
        title.addEventListener('input', () => updateSubtask(task.id, subtaskId, 'title', title.value, false));
      }
      if (description) {
        description.addEventListener('input', () => updateSubtask(task.id, subtaskId, 'description', description.value, false));
      }
      if (remove) {
        remove.addEventListener('click', () => deleteSubtask(task.id, subtaskId));
      }
    });
  }

  function renderAll(note) {
    renderStats();
    renderList();
    renderDetail();
    persistState(note);
  }

  function selectTask(taskId) {
    state.selectedId = taskId;
    renderAll('Task selected');
  }

  function cycleTaskStatus(taskId) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    task.status = task.status === 'pending' ? 'in-progress' : (task.status === 'in-progress' ? 'completed' : 'pending');
    task.updatedAt = nowIso();
    renderAll('Status updated');
  }

  function deleteTask(taskId) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    if (!window.confirm(`Delete "${task.title}"?`)) return;

    state.tasks = state.tasks.filter(item => item.id !== taskId);
    if (state.selectedId === taskId) {
      state.selectedId = state.tasks[0]?.id || null;
    }
    renderAll('Task deleted');
  }

  function addTaskFromForm(event) {
    event.preventDefault();
    const title = String(els.addTitle?.value || '').trim();
    const description = String(els.addDescription?.value || '').trim();
    if (!title) {
      if (els.addTitle) els.addTitle.focus();
      return;
    }

    const task = normalizeTask({
      id: uid('task'),
      title,
      description,
      notes: '',
      status: 'pending',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      subtasks: []
    });

    state.tasks.unshift(task);
    state.selectedId = task.id;
    if (els.addTitle) els.addTitle.value = '';
    if (els.addDescription) els.addDescription.value = '';
    renderAll('Task added');
  }

  function updateTaskField(taskId, field, value, rerenderDetail) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;

    if (field === 'status') {
      task.status = ['pending', 'in-progress', 'completed'].includes(value) ? value : 'pending';
    } else if (field === 'title') {
      task.title = String(value || '').trim() || 'Untitled task';
    } else {
      task[field] = String(value ?? '');
    }

    task.updatedAt = nowIso();
    persistState('Task saved');
    renderStats();
    renderList();
    if (rerenderDetail) renderDetail();
  }

  function addSubtask(taskId) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    task.subtasks.push(normalizeSubtask({ title: '', description: '', complete: false }));
    task.updatedAt = nowIso();
    renderAll('Subtask added');
  }

  function updateSubtask(taskId, subtaskId, field, value, rerenderDetail) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    const subtask = task.subtasks.find(item => item.id === subtaskId);
    if (!subtask) return;

    if (field === 'complete') {
      subtask.complete = Boolean(value);
    } else if (field === 'title') {
      subtask.title = String(value || '').trim();
    } else {
      subtask.description = String(value ?? '');
    }

    subtask.updatedAt = nowIso();
    task.updatedAt = nowIso();
    persistState('Subtask saved');
    renderStats();
    renderList();
    if (rerenderDetail) renderDetail();
  }

  function deleteSubtask(taskId, subtaskId) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    task.subtasks = task.subtasks.filter(item => item.id !== subtaskId);
    task.updatedAt = nowIso();
    renderAll('Subtask deleted');
  }

  function clearCompleted() {
    const completedCount = state.tasks.filter(task => task.status === 'completed').length;
    if (!completedCount) return;
    if (!window.confirm(`Remove ${completedCount} completed task${completedCount === 1 ? '' : 's'}?`)) return;
    state.tasks = state.tasks.filter(task => task.status !== 'completed');
    if (state.selectedId && !state.tasks.some(task => task.id === state.selectedId)) {
      state.selectedId = state.tasks[0]?.id || null;
    }
    renderAll('Completed tasks cleared');
  }

  function exportData() {
    const payload = {
      exportedAt: nowIso(),
      module: 'TaskMaster',
      tasks: state.tasks,
      preferences: {
        selectedId: state.selectedId,
        search: state.search,
        filter: state.filter,
        sort: state.sort
      }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'taskmaster-export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    persistState('Export downloaded');
  }

  async function importData(file) {
    if (!file) return;
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      window.alert('That file is not valid JSON.');
      return;
    }

    const importedTasks = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tasks) ? parsed.tasks : null;
    if (!importedTasks) {
      window.alert('The import file does not contain a task array.');
      return;
    }

    state.tasks = importedTasks.map(normalizeTask);
    state.selectedId = state.tasks[0]?.id || null;

    const preferences = parsed?.preferences || {};
    state.search = typeof preferences.search === 'string' ? preferences.search : state.search;
    state.filter = ['all', 'pending', 'in-progress', 'completed'].includes(preferences.filter) ? preferences.filter : state.filter;
    state.sort = typeof preferences.sort === 'string' ? preferences.sort : state.sort;
    if (els.searchInput) els.searchInput.value = state.search;
    if (els.sortSelect) els.sortSelect.value = state.sort;
    syncFilterButtons();

    renderAll('Tasks imported');
  }

  function syncFilterButtons() {
    els.filterButtons.forEach(btn => {
      btn.classList.toggle('is-active', btn.getAttribute('data-filter') === state.filter);
    });
  }

  function bindEvents() {
    if (els.searchInput) {
      els.searchInput.addEventListener('input', () => {
        state.search = els.searchInput.value;
        renderStats();
        renderList();
        persistState('Search updated');
      });
    }

    if (els.sortSelect) {
      els.sortSelect.addEventListener('change', () => {
        state.sort = els.sortSelect.value;
        renderStats();
        renderList();
        persistState('Sort updated');
      });
    }

    els.filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        state.filter = btn.getAttribute('data-filter') || 'all';
        syncFilterButtons();
        renderStats();
        renderList();
        persistState('Filter updated');
      });
    });

    if (els.addForm) {
      els.addForm.addEventListener('submit', addTaskFromForm);
    }

    if (els.exportBtn) {
      els.exportBtn.addEventListener('click', exportData);
    }

    if (els.importBtn && els.importInput) {
      els.importBtn.addEventListener('click', () => els.importInput.click());
      els.importInput.addEventListener('change', async () => {
        const file = els.importInput.files && els.importInput.files[0];
        els.importInput.value = '';
        if (file) await importData(file);
      });
    }

    if (els.clearDoneBtn) {
      els.clearDoneBtn.addEventListener('click', clearCompleted);
    }
  }

  function init() {
    loadState();
    if (els.searchInput) els.searchInput.value = state.search;
    if (els.sortSelect) els.sortSelect.value = state.sort;
    syncFilterButtons();
    bindEvents();
    renderAll('Loaded');
  }

  init();
})();
