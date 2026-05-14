/* ═══════════════════════════════════════
   Glass Vibes Dashboard — Music System
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

  // Sound Effects
  const sounds = {
    click: new Audio('https://cdn.pixabay.com/audio/2022/03/15/audio_731446738c.mp3'),
    modal: new Audio('https://cdn.pixabay.com/audio/2022/03/15/audio_65089c8942.mp3'),
  };
  Object.values(sounds).forEach(s => { s.volume = 0.2; s.crossOrigin = "anonymous"; });

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
    window.addEventListener('resize', resizeVisualizer);
    resizeVisualizer();
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

  function resizeVisualizer() {
    const rect = visualizerCanvas.parentElement.getBoundingClientRect();
    visualizerCanvas.width = rect.width;
    visualizerCanvas.height = rect.height;
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

      // Pulse global background if music is intense
      const average = state.dataArray.reduce((a, b) => a + b) / state.dataArray.length;
      if (window.bgEffect) {
        window.bgEffect.setEnergy(average / 255);
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
