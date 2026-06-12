(function () {
  'use strict';

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

  function init() {
    visualizerCanvas = document.getElementById('player-visualizer');
    miniCanvas = document.getElementById('mini-visualizer');
    
    if (!visualizerCanvas) return; // Guard for script load timing
    
    vCtx = visualizerCanvas.getContext('2d');
    mCtx = miniCanvas ? miniCanvas.getContext('2d') : null;

    btnPlayPause = document.getElementById('btn-play-pause');
    btnPrev = document.getElementById('btn-prev');
    btnNext = document.getElementById('btn-next');
    btnShuffle = document.getElementById('btn-shuffle');
    btnRepeat = document.getElementById('btn-repeat');
    volSlider = document.getElementById('volume-slider');
    trackName = document.getElementById('track-name');
    trackArtist = document.getElementById('track-artist');
    playlistEl = document.getElementById('playlist');

    playIcon = document.getElementById('play-icon');
    pauseIcon = document.getElementById('pause-icon');

    // Tabs
    const tabBtns = document.querySelectorAll('.music-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        switchTab(tabId);
      });
    });

    // Search
    const searchBtn = document.getElementById('btn-music-search');
    const searchInput = document.getElementById('music-search-input');
    if (searchBtn && searchInput) {
      searchBtn.addEventListener('click', () => searchMusic(searchInput.value));
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchMusic(searchInput.value);
      });
    }

    // Download playlist
    const downloadBtn = document.getElementById('btn-download-playlist');
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

    // Resize visualizer
    window.addEventListener('resize', resizeVisualizers);
    
    // Listen for dashboard view changed events to handle canvas resizing correctly
    document.addEventListener('dashboard:view-changed', (e) => {
      if (e.detail.id === 'music') {
        resizeVisualizers();
      }
    });

    // Load Playlist data
    fetchPlaylist();
  }

  function switchTab(tabId) {
    document.querySelectorAll('.music-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.music-tab-content').forEach(content => {
      content.classList.toggle('hidden', content.id !== `music-tab-${tabId}`);
    });
    if (window.vibePlayer) window.vibePlayer.playClick();
  }

  async function searchMusic(query) {
    if (!query.trim()) return;
    const resultsEl = document.getElementById('discovery-results');
    resultsEl.innerHTML = '<div class="empty-discovery">Searching Pixabay...</div>';

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
              <button class="action-btn primary download-btn" data-id="${hit.id}" data-url="${hit.audio}" data-tags="${hit.tags}">Add to Library</button>
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
            btn.textContent = 'Adding...';
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
                  tags: btn.dataset.tags
                })
              });
              const result = await res.json();
              if (result.success) {
                btn.textContent = 'Added!';
                fetchPlaylist(); // Refresh library
              } else {
                throw new Error(result.error);
              }
            } catch (e) {
              console.error('Download failed:', e);
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
    // Create a zip or just trigger downloads? 
    // Usually browser allows one download per trigger without permission issues.
    // We'll just alert for now or implement a backend zip endpoint.
    window.location.href = '/api/music/download-all';
  }

  function handleTrackEnd() {
    if (state.isRepeat) {
      loadTrack(state.currentIndex, true);
    } else {
      nextTrack();
    }
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
    let index;
    if (state.isShuffle) {
      index = Math.floor(Math.random() * PLAYLIST.length);
      // Ensure we don't play the same track again if possible
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
    let index;
    if (state.isShuffle) {
      index = Math.floor(Math.random() * PLAYLIST.length);
    } else {
      index = state.currentIndex - 1;
      if (index < 0) index = PLAYLIST.length - 1;
    }
    loadTrack(index, true);
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

      // Simple bar visualizer
      for (let i = 0; i < state.dataArray.length; i++) {
        barHeight = (state.dataArray[i] / 255) * height * 0.8;

        const r = 59;
        const g = 130 + i;
        const b = 246;

        vCtx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
        vCtx.fillRect(x, height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }

      // Mini Visualizer
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

      // Main Visualizer (Circular Glow)
      const mainCanvas = document.getElementById('main-visualizer');
      const mainCtx = mainCanvas ? mainCanvas.getContext('2d') : null;
      if (mainCtx && mainCanvas.offsetParent !== null) {
        mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
        
        const cx = mainCanvas.width / 2;
        const cy = mainCanvas.height / 2;
        const radius = Math.min(cx, cy) * 0.4;
        const bars = Math.floor(state.dataArray.length / 2);
        const angleStep = (Math.PI * 2) / bars;

        // Draw inner glow circle
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
        mainCtx.shadowBlur = 0; // reset
      }

      // Feed audio data to the immersive background engine
      if (window.bgEffect) {
        window.bgEffect.setAudioData(state.dataArray);
        const average = state.dataArray.reduce((a, b) => a + b) / state.dataArray.length;
        window.bgEffect.setEnergy(Math.max(0.15, average / 255));
        document.documentElement.style.setProperty('--glow-opacity', 0.1 + (average / 255) * 0.4);
      }
    }

    draw();
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

  // Initialize
  init();

})();
