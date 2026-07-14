(function () {
  'use strict';

  function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Track Data ──
  let PLAYLIST = [];

  // ── State ──
  const state = {
    currentIndex: 0,
    isPlaying: false,
    isShuffle: false,
    isRepeat: false,
    audioContext: null,
    analyser: null,
    source: null,
    dataArray: null,
    animationId: null
  };

  // ── DOM ──
  let viewPanel = null;
  let visualizerCanvas, miniCanvas, vCtx, mCtx;
  let btnPlayPause, btnPrev, btnNext, btnShuffle, btnRepeat, volSlider, trackName, trackArtist, playlistEl;
  let playIcon, pauseIcon;

  // Sound Effects (Disabled due to external 403 errors)
  const sounds = {
    click: { play: () => { }, currentTime: 0 },
    modal: { play: () => { }, currentTime: 0 },
  };

  // Audio Element
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.volume = 0.5;

  function init(panel) {
    viewPanel = panel;
    visualizerCanvas = viewPanel.querySelector('#player-visualizer');
    miniCanvas = viewPanel.querySelector('#mini-visualizer');
    
    if (!visualizerCanvas) return;
    
    vCtx = visualizerCanvas.getContext('2d');
    mCtx = miniCanvas ? miniCanvas.getContext('2d') : null;

    btnPlayPause = viewPanel.querySelector('#btn-play-pause');
    btnPrev = viewPanel.querySelector('#btn-prev');
    btnNext = viewPanel.querySelector('#btn-next');
    btnShuffle = viewPanel.querySelector('#btn-shuffle');
    btnRepeat = viewPanel.querySelector('#btn-repeat');
    volSlider = viewPanel.querySelector('#volume-slider');
    trackName = viewPanel.querySelector('#track-name');
    trackArtist = viewPanel.querySelector('#track-artist');
    playlistEl = viewPanel.querySelector('#playlist');

    playIcon = viewPanel.querySelector('#play-icon');
    pauseIcon = viewPanel.querySelector('#pause-icon');

    // Tabs
    const tabBtns = viewPanel.querySelectorAll('.music-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        switchTab(tabId);
      });
    });

    // Search
    const searchBtn = viewPanel.querySelector('#btn-music-search');
    const searchInput = viewPanel.querySelector('#music-search-input');
    if (searchBtn && searchInput) {
      searchBtn.addEventListener('click', () => searchMusic(searchInput.value));
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchMusic(searchInput.value);
      });
    }

    // Download playlist
    const downloadBtn = viewPanel.querySelector('#btn-download-playlist');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', downloadFullPlaylist);
    }

    // Controls
    btnPlayPause.addEventListener('click', togglePlay);
    btnNext.addEventListener('click', nextTrack);
    btnPrev.addEventListener('click', prevTrack);
    btnShuffle.addEventListener('click', toggleShuffle);
    btnRepeat.addEventListener('click', toggleRepeat);
    volSlider.addEventListener('input', (e) => {
      audio.volume = e.target.value;
    });

    // Audio Events
    audio.addEventListener('ended', handleTrackEnd);

    // Load Playlist data
    fetchPlaylist();
  }

  async function fetchPlaylist() {
    try {
      const response = await fetch('/api/audio');
      PLAYLIST = await response.json();

      if (PLAYLIST.length > 0) {
        renderPlaylist();
        loadTrack(0);
      } else {
        trackName.textContent = 'No Audio Found';
        trackArtist.textContent = 'Add MP3s to public/audio';
      }
    } catch (e) {
      console.error('[Music] Failed to load playlist:', e);
    }
  }

  function resizeVisualizers() {
    if (!visualizerCanvas) return;
    const rect = visualizerCanvas.parentElement.getBoundingClientRect();
    visualizerCanvas.width = rect.width || 300;
    visualizerCanvas.height = rect.height || 300;

    const mainCanvas = document.getElementById('main-visualizer');
    if (mainCanvas && mainCanvas.parentElement) {
      const mainRect = mainCanvas.parentElement.getBoundingClientRect();
      mainCanvas.width = mainRect.width || window.innerWidth;
      mainCanvas.height = mainRect.height || window.innerHeight;
    }
  }

  function renderPlaylist() {
    if (!playlistEl) return;
    playlistEl.replaceChildren();
    
    PLAYLIST.forEach((track, i) => {
      const item = document.createElement('div');
      item.className = `playlist-item ${i === state.currentIndex ? 'active' : ''}`;
      
      const idxDiv = document.createElement('div');
      idxDiv.className = 'item-index';
      idxDiv.textContent = (i + 1).toString().padStart(2, '0');
      item.appendChild(idxDiv);

      const infoDiv = document.createElement('div');
      infoDiv.className = 'item-info';
      
      const nameDiv = document.createElement('div');
      nameDiv.className = 'item-name';
      nameDiv.textContent = track.name;
      infoDiv.appendChild(nameDiv);

      const artistDiv = document.createElement('div');
      artistDiv.className = 'item-artist';
      artistDiv.textContent = track.artist;
      infoDiv.appendChild(artistDiv);

      item.appendChild(infoDiv);
      
      item.addEventListener('click', () => loadTrack(i, true));
      playlistEl.appendChild(item);
    });
  }

  function loadTrack(index, autoPlay = false) {
    state.currentIndex = index;
    const track = PLAYLIST[index];
    if (!track) return;
    
    audio.src = track.url;
    trackName.textContent = track.name;
    trackArtist.textContent = track.artist;

    // Update active class
    viewPanel.querySelectorAll('.playlist-item').forEach((item, i) => {
      item.classList.toggle('active', i === index);
    });

    // Auto-map visualizer background mode to track names/themes
    if (window.bgEffect && track.name) {
      const name = track.name.toLowerCase();
      if (name.includes('cyber') || name.includes('synth') || name.includes('neon') || name.includes('grid')) {
        window.bgEffect.setMode('Cyber Stream');
      } else if (name.includes('fire') || name.includes('ember') || name.includes('flame') || name.includes('heat')) {
        window.bgEffect.setMode('Ember Storm');
      } else if (name.includes('void') || name.includes('singularity') || name.includes('black hole') || name.includes('gargantua') || name.includes('space') || name.includes('gravity')) {
        window.bgEffect.setMode('Gargantua Singularity');
      } else if (name.includes('aurora') || name.includes('wave') || name.includes('flow') || name.includes('ambient') || name.includes('chill') || name.includes('dream') || name.includes('sky')) {
        window.bgEffect.setMode('Aurora Waves');
      } else if (name.includes('lightning') || name.includes('electricity') || name.includes('thunder') || name.includes('volt') || name.includes('storm')) {
        window.bgEffect.setMode('Electrical Storm');
      } else if (name.includes('gear') || name.includes('clock') || name.includes('kinetic') || name.includes('mechanism') || name.includes('time') || name.includes('machine')) {
        window.bgEffect.setMode('Kinetic Clockwork');
      } else {
        window.bgEffect.setMode('Nebula Flow');
      }

      // Update UI mode selector label if it exists in the DOM
      const vizModeLabel = document.getElementById('viz-mode-label');
      if (vizModeLabel) {
        vizModeLabel.textContent = window.bgEffect.getCurrentModeName();
        vizModeLabel.classList.add('flash');
        setTimeout(() => { vizModeLabel.classList.remove('flash'); }, 600);
      }
    }

    if (autoPlay) {
      playTrack();
    }
  }

  function switchTab(tabId) {
    viewPanel.querySelectorAll('.music-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    viewPanel.querySelectorAll('.music-tab-content').forEach(content => {
      content.classList.toggle('hidden', content.id !== `music-tab-${tabId}`);
    });
    if (window.vibePlayer) window.vibePlayer.playClick();
  }

  async function searchMusic(query) {
    if (!query.trim()) return;
    const resultsEl = viewPanel.querySelector('#discovery-results');
    resultsEl.innerHTML = '<div class="empty-discovery">Searching Jamendo...</div>';

    try {
      const response = await fetch(`/api/music/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();

      if (data.hits && data.hits.length > 0) {
        resultsEl.innerHTML = '';
        data.hits.forEach(hit => {
          const item = document.createElement('div');
          item.className = 'discovery-item';
          item.innerHTML = `
            <div class="discovery-item-info">
              <h4>${escapeHtml(hit.tags || 'Untitled Track')}</h4>
              <p>Duration: ${hit.duration}s · ${hit.user}</p>
            </div>
            <div class="discovery-item-actions">
              <button class="action-btn preview-btn" data-url="${hit.audio}">Preview</button>
              <button class="action-btn primary download-btn" data-id="${hit.id}" data-url="${hit.audio}" data-tags="${hit.tags}" data-artist="${escapeHtml(hit.user)}">Save to Library</button>
            </div>
          `;
          resultsEl.appendChild(item);
        });

        resultsEl.querySelectorAll('.preview-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const url = btn.dataset.url;
            if (audio.src === url && !audio.paused) {
              pauseTrack();
            } else {
              audio.src = url;
              playTrack();
            }
          });
        });

        resultsEl.querySelectorAll('.download-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = 'Saving...';
            try {
              const res = await fetch('/api/music/download', {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': window.Dashboard.csrfToken
                },
                body: JSON.stringify({ 
                  url: btn.dataset.url, 
                  id: btn.dataset.id,
                  tags: btn.dataset.tags,
                  artist: btn.dataset.artist
                })
              });
              const result = await res.json();
              if (result.success) {
                btn.textContent = 'Saved!';
                fetchPlaylist(); // Refresh library
              } else {
                throw new Error(result.error);
              }
            } catch (e) {
              console.error('Save failed:', e);
              btn.textContent = 'Failed';
              btn.disabled = false;
            }
          });
        });
      } else {
        resultsEl.innerHTML = '<div class="empty-discovery">No results found.</div>';
      }
    } catch (e) {
      console.error('Search failed:', e);
      resultsEl.innerHTML = '<div class="empty-discovery">Error connecting to discovery service.</div>';
    }
  }

  function downloadFullPlaylist() {
    window.location.href = '/api/music/download-all';
  }

  async function fetchPlaylist() {
    try {
      const response = await fetch('/api/audio');
      PLAYLIST = await response.json();

      if (PLAYLIST.length > 0) {
        renderPlaylist();
        loadTrack(0);
      } else {
        if (trackName) trackName.textContent = 'No Audio Found';
        if (trackArtist) trackArtist.textContent = 'Add MP3s to public/audio';
      }
    } catch (e) {
      console.error('[Music] Failed to load playlist:', e);
    }
  }

  function resizeVisualizers() {
    if (!visualizerCanvas) return;
    const rect = visualizerCanvas.parentElement.getBoundingClientRect();
    visualizerCanvas.width = rect.width || 300;
    visualizerCanvas.height = rect.height || 300;

    const mainCanvas = document.getElementById('main-visualizer');
    if (mainCanvas && mainCanvas.parentElement) {
      const mainRect = mainCanvas.parentElement.getBoundingClientRect();
      mainCanvas.width = mainRect.width || window.innerWidth;
      mainCanvas.height = mainRect.height || window.innerHeight;
    }
  }

  function renderPlaylist() {
    if (!playlistEl) return;
    playlistEl.replaceChildren();
    
    PLAYLIST.forEach((track, i) => {
      const item = document.createElement('div');
      item.className = `playlist-item ${i === state.currentIndex ? 'active' : ''}`;
      
      const idxDiv = document.createElement('div');
      idxDiv.className = 'item-index';
      idxDiv.textContent = (i + 1).toString().padStart(2, '0');
      item.appendChild(idxDiv);

      const infoDiv = document.createElement('div');
      infoDiv.className = 'item-info';
      
      const nameDiv = document.createElement('div');
      nameDiv.className = 'item-name';
      nameDiv.textContent = track.name;
      infoDiv.appendChild(nameDiv);

      const artistDiv = document.createElement('div');
      artistDiv.className = 'item-artist';
      artistDiv.textContent = track.artist;
      infoDiv.appendChild(artistDiv);

      item.appendChild(infoDiv);

      if (track.id) {
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'remove-track-btn';
        removeButton.textContent = 'Remove';
        removeButton.title = 'Remove saved track';
        removeButton.setAttribute('aria-label', `Remove ${track.name} from library`);
        removeButton.addEventListener('click', (event) => {
          event.stopPropagation();
          removeTrack(track, i);
        });
        item.appendChild(removeButton);
      }
      
      item.addEventListener('click', () => loadTrack(i, true));
      playlistEl.appendChild(item);
    });
  }

  async function removeTrack(track, index) {
    if (!window.confirm(`Remove "${track.name}" from your library?`)) return;

    try {
      const response = await fetch(`/api/music/library/${encodeURIComponent(track.id)}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': window.Dashboard.csrfToken }
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to remove track');
      }

      const removedCurrentTrack = index === state.currentIndex;
      const resumePlayback = removedCurrentTrack && state.isPlaying;
      PLAYLIST.splice(index, 1);

      if (PLAYLIST.length === 0) {
        pauseTrack();
        state.currentIndex = 0;
        audio.removeAttribute('src');
        audio.load();
        if (trackName) trackName.textContent = 'No Audio Found';
        if (trackArtist) trackArtist.textContent = 'Add tracks from Music Discovery';
        renderPlaylist();
        return;
      }

      if (removedCurrentTrack) {
        const nextIndex = Math.min(index, PLAYLIST.length - 1);
        loadTrack(nextIndex, resumePlayback);
      } else {
        if (index < state.currentIndex) state.currentIndex -= 1;
        renderPlaylist();
      }
    } catch (error) {
      console.error('[Music] Failed to remove track:', error);
      window.alert(error.message);
    }
  }

  function loadTrack(index, autoPlay = false) {
    state.currentIndex = index;
    const track = PLAYLIST[index];
    if (!track) return;
    
    audio.src = track.url;
    if (trackName) trackName.textContent = track.name;
    if (trackArtist) trackArtist.textContent = track.artist;

    // Update active class
    document.querySelectorAll('.playlist-item').forEach((item, i) => {
      item.classList.toggle('active', i === index);
    });

    // Auto-map visualizer background mode to track names/themes
    if (window.bgEffect && track.name) {
      const name = track.name.toLowerCase();
      if (name.includes('cyber') || name.includes('synth') || name.includes('neon') || name.includes('grid')) {
        window.bgEffect.setMode('Cyber Stream');
      } else if (name.includes('fire') || name.includes('ember') || name.includes('flame') || name.includes('heat')) {
        window.bgEffect.setMode('Ember Storm');
      } else if (name.includes('void') || name.includes('singularity') || name.includes('black hole') || name.includes('gargantua') || name.includes('space') || name.includes('gravity')) {
        window.bgEffect.setMode('Gargantua Singularity');
      } else if (name.includes('aurora') || name.includes('wave') || name.includes('flow') || name.includes('ambient') || name.includes('chill') || name.includes('dream') || name.includes('sky')) {
        window.bgEffect.setMode('Aurora Waves');
      } else if (name.includes('lightning') || name.includes('electricity') || name.includes('thunder') || name.includes('volt') || name.includes('storm')) {
        window.bgEffect.setMode('Electrical Storm');
      } else if (name.includes('gear') || name.includes('clock') || name.includes('kinetic') || name.includes('mechanism') || name.includes('time') || name.includes('machine')) {
        window.bgEffect.setMode('Kinetic Clockwork');
      } else {
        window.bgEffect.setMode('Nebula Flow');
      }

      // Update UI mode selector label if it exists in the DOM
      const vizModeLabel = document.getElementById('viz-mode-label');
      if (vizModeLabel) {
        vizModeLabel.textContent = window.bgEffect.getCurrentModeName();
        vizModeLabel.classList.add('flash');
        setTimeout(() => { vizModeLabel.classList.remove('flash'); }, 600);
      }
    }

    if (autoPlay) {
      playTrack();
    }
  }

  function handleTrackEnd() {
    if (state.isRepeat) {
      loadTrack(state.currentIndex, true);
    } else {
      nextTrack();
    }
  }

  function togglePlay() {
    if (state.isPlaying) {
      pauseTrack();
    } else {
      playTrack();
    }
  }

  async function playTrack() {
    // Resume AudioContext if suspended
    if (!state.audioContext) {
      setupAudioContext();
    } else if (state.audioContext.state === 'suspended') {
      await state.audioContext.resume();
    }

    audio.play();
    state.isPlaying = true;
    if (playIcon) playIcon.classList.add('hidden');
    if (pauseIcon) pauseIcon.classList.remove('hidden');
    startVisualizer();
  }

  function pauseTrack() {
    audio.pause();
    state.isPlaying = false;
    if (playIcon) playIcon.classList.remove('hidden');
    if (pauseIcon) pauseIcon.classList.add('hidden');
  }

  function toggleShuffle() {
    state.isShuffle = !state.isShuffle;
    btnShuffle.classList.toggle('active', state.isShuffle);
    if (window.vibePlayer) window.vibePlayer.playClick();
  }

  function toggleRepeat() {
    state.isRepeat = !state.isRepeat;
    btnRepeat.classList.toggle('active', state.isRepeat);
    if (window.vibePlayer) window.vibePlayer.playClick();
  }

  function nextTrack() {
    if (!PLAYLIST.length) return;
    let index;
    if (state.isShuffle) {
      index = Math.floor(Math.random() * PLAYLIST.length);
      if (index === state.currentIndex && PLAYLIST.length > 1) {
        index = (index + 1) % PLAYLIST.length;
      }
    } else {
      index = state.currentIndex + 1;
      if (index >= PLAYLIST.length) index = 0;
    }
    loadTrack(index, true);
  }

  function prevTrack() {
    if (!PLAYLIST.length) return;
    let index;
    if (state.isShuffle) {
      index = Math.floor(Math.random() * PLAYLIST.length);
    } else {
      index = state.currentIndex - 1;
      if (index < 0) index = PLAYLIST.length - 1;
    }
    loadTrack(index, true);
  }

  function togglePlay() {
    if (state.isPlaying) {
      pauseTrack();
    } else {
      playTrack();
    }
  }

  async function playTrack() {
    if (!PLAYLIST.length) return;
    if (!state.audioContext) {
      setupAudioContext();
    } else if (state.audioContext.state === 'suspended') {
      await state.audioContext.resume();
    }

    audio.play();
    state.isPlaying = true;
    if (playIcon) playIcon.classList.add('hidden');
    if (pauseIcon) pauseIcon.classList.remove('hidden');
    startVisualizer();
  }

  function pauseTrack() {
    audio.pause();
    state.isPlaying = false;
    if (playIcon) playIcon.classList.remove('hidden');
    if (pauseIcon) pauseIcon.classList.add('hidden');
  }

  function setupAudioContext() {
    try {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 256;

      state.source = state.audioContext.createMediaElementSource(audio);
      state.source.connect(state.analyser);
      state.analyser.connect(state.audioContext.destination);

      const bufferLength = state.analyser.frequencyBinCount;
      state.dataArray = new Uint8Array(bufferLength);
    } catch (e) {
      console.warn('AudioContext setup failed:', e);
    }
  }

  function startVisualizer() {
    if (state.animationId) cancelAnimationFrame(state.animationId);

    function draw() {
      state.animationId = requestAnimationFrame(draw);
      if (!state.analyser || !state.isPlaying) return;

      state.analyser.getByteFrequencyData(state.dataArray);

      const width = visualizerCanvas.width;
      const height = visualizerCanvas.height;
      const barWidth = (width / state.dataArray.length) * 2.5;
      let barHeight;
      let x = 0;

      vCtx.clearRect(0, 0, width, height);

      for (let i = 0; i < state.dataArray.length; i++) {
        barHeight = (state.dataArray[i] / 255) * height * 0.8;
        const r = 59;
        const g = 130 + i;
        const b = 246;
        vCtx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
        vCtx.fillRect(x, height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }

      if (mCtx) {
        mCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
        const mWidth = miniCanvas.width;
        const mHeight = miniCanvas.height;
        const mBarWidth = mWidth / (state.dataArray.length / 2);
        mCtx.beginPath();
        mCtx.lineWidth = 2;
        mCtx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
        for (let i = 0; i < state.dataArray.length / 2; i++) {
          const val = state.dataArray[i] / 255;
          const x = i * mBarWidth;
          const y = mHeight - (val * mHeight);
          if (i === 0) mCtx.moveTo(x, y);
          else mCtx.lineTo(x, y);
        }
        mCtx.stroke();
      }

      const mainCanvas = document.getElementById('main-visualizer');
      const mainCtx = mainCanvas ? mainCanvas.getContext('2d') : null;
      if (mainCtx && mainCanvas.offsetParent !== null) {
        mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
        const cx = mainCanvas.width / 2;
        const cy = mainCanvas.height / 2;
        const radius = Math.min(cx, cy) * 0.4;
        const bars = Math.floor(state.dataArray.length / 2);
        const angleStep = (Math.PI * 2) / bars;
        const avg = state.dataArray.reduce((a, b) => a + b) / state.dataArray.length;
        mainCtx.beginPath();
        mainCtx.arc(cx, cy, radius, 0, Math.PI * 2);
        mainCtx.fillStyle = `rgba(59, 130, 246, ${avg / 255 * 0.3})`;
        mainCtx.fill();
        mainCtx.shadowBlur = 40;
        mainCtx.shadowColor = `rgba(59, 130, 246, ${avg / 255})`;
        for (let i = 0; i < bars; i++) {
          const val = state.dataArray[i] / 255;
          const barLen = val * radius * 1.2;
          const angle = i * angleStep;
          const x1 = cx + Math.cos(angle) * radius;
          const y1 = cy + Math.sin(angle) * radius;
          const x2 = cx + Math.cos(angle) * (radius + barLen);
          const y2 = cy + Math.sin(angle) * (radius + barLen);
          mainCtx.beginPath();
          mainCtx.lineWidth = 6;
          mainCtx.lineCap = 'round';
          const r = Math.min(255, 59 + val * 100);
          const g = Math.min(255, 130 + i * 2);
          const b = 246;
          mainCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.4 + val * 0.6})`;
          mainCtx.moveTo(x1, y1);
          mainCtx.lineTo(x2, y2);
          mainCtx.stroke();
        }
        mainCtx.shadowBlur = 0;
      }

      if (window.bgEffect) {
        window.bgEffect.setAudioData(state.dataArray);
        const average = state.dataArray.reduce((a, b) => a + b) / state.dataArray.length;
        window.bgEffect.setEnergy(Math.max(0.15, average / 255));
        document.documentElement.style.setProperty('--glow-opacity', 0.1 + (average / 255) * 0.4);
      }
    }
    draw();
  }

  function escapeHtml(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Exposed to global for interaction sounds later
  window.vibePlayer = {
    play: playTrack,
    pause: pauseTrack,
    next: nextTrack,
    prev: prevTrack,
    playClick: () => { sounds.click.currentTime = 0; sounds.click.play(); },
    playModal: () => { sounds.modal.currentTime = 0; sounds.modal.play(); }
  };

  // ── Register Module Logic ──
  window.Dashboard.registerModuleLogic('music', {
    onInit: (panel) => {
      init(panel);
    },
    onActivate: () => {
      resizeVisualizers();
      if (state.isPlaying) startVisualizer();
    },
    onDeactivate: () => {
      if (state.animationId) cancelAnimationFrame(state.animationId);
    }
  });

})();
