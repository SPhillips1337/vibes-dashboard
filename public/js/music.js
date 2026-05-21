/* ═══════════════════════════════════════
   Vibes Dashboard — Music System
   AudioContext, Analyser, and Visualizer
   ═══════════════════════════════════════ */

(function () {
  'use strict';

  // ── Track Data ──
  let PLAYLIST = [];

  // ── State ──
  const state = {
    currentIndex: 0,
    isPlaying: false,
    audioContext: null,
    analyser: null,
    source: null,
    dataArray: null,
    animationId: null
  };

  // ── DOM ──
  const musicPanel = document.getElementById('music-panel');
  const btnMusic = document.getElementById('nav-audio');
  const btnClose = document.getElementById('music-close');
  const btnPlayPause = document.getElementById('btn-play-pause');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const volSlider = document.getElementById('volume-slider');
  const trackName = document.getElementById('track-name');
  const trackArtist = document.getElementById('track-artist');
  const playlistEl = document.getElementById('playlist');
  const visualizerCanvas = document.getElementById('player-visualizer');
  const miniCanvas = document.getElementById('mini-visualizer');
  const vCtx = visualizerCanvas.getContext('2d');
  const mCtx = miniCanvas ? miniCanvas.getContext('2d') : null;

  // Sound Effects (Disabled due to external 403 errors)
  const sounds = {
    click: { play: () => { }, currentTime: 0 },
    modal: { play: () => { }, currentTime: 0 },
  };

  // Icons
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');

  // Audio Element
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.volume = 0.5;

  // ── Initialization ──
  async function init() {
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
      console.error('Failed to load playlist:', e);
    }

    // Sidebar Toggle
    btnMusic.addEventListener('click', () => {
      musicPanel.classList.toggle('hidden');
      if (!musicPanel.classList.contains('hidden')) {
        btnMusic.classList.add('active');
      } else {
        btnMusic.classList.remove('active');
      }
    });

    btnClose.addEventListener('click', () => {
      musicPanel.classList.add('hidden');
      btnMusic.classList.remove('active');
    });

    // Controls
    btnPlayPause.addEventListener('click', togglePlay);
    btnNext.addEventListener('click', nextTrack);
    btnPrev.addEventListener('click', prevTrack);
    volSlider.addEventListener('input', (e) => {
      audio.volume = e.target.value;
    });

    // Audio Events
    audio.addEventListener('ended', nextTrack);

    // Resize visualizer
    window.addEventListener('resize', resizeVisualizers);
    resizeVisualizers();
  }

  function resizeVisualizers() {
    const rect = visualizerCanvas.parentElement.getBoundingClientRect();
    visualizerCanvas.width = rect.width;
    visualizerCanvas.height = rect.height;

    const mainCanvas = document.getElementById('main-visualizer');
    if (mainCanvas && mainCanvas.parentElement) {
      const mainRect = mainCanvas.parentElement.getBoundingClientRect();
      mainCanvas.width = mainRect.width || window.innerWidth;
      mainCanvas.height = mainRect.height || window.innerHeight;
    }
  }

  function renderPlaylist() {
    playlistEl.innerHTML = '';
    PLAYLIST.forEach((track, i) => {
      const item = document.createElement('div');
      item.className = `playlist-item ${i === state.currentIndex ? 'active' : ''}`;
      item.innerHTML = `
        <div class="item-index">${(i + 1).toString().padStart(2, '0')}</div>
        <div class="item-info">
          <div class="item-name">${track.name}</div>
          <div class="item-artist">${track.artist}</div>
        </div>
      `;
      item.addEventListener('click', () => loadTrack(i, true));
      playlistEl.appendChild(item);
    });
  }

  function loadTrack(index, autoPlay = false) {
    state.currentIndex = index;
    const track = PLAYLIST[index];
    audio.src = track.url;
    trackName.textContent = track.name;
    trackArtist.textContent = track.artist;

    // Update active class
    document.querySelectorAll('.playlist-item').forEach((item, i) => {
      item.classList.toggle('active', i === index);
    });

    // Auto-map visualizer background mode to track names/themes
    if (window.bgEffect && track && track.name) {
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
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
    startVisualizer();
  }

  function pauseTrack() {
    audio.pause();
    state.isPlaying = false;
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
  }

  function nextTrack() {
    let index = state.currentIndex + 1;
    if (index >= PLAYLIST.length) index = 0;
    loadTrack(index, true);
  }

  function prevTrack() {
    let index = state.currentIndex - 1;
    if (index < 0) index = PLAYLIST.length - 1;
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
          // Use theme colors
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

  init();

})();
