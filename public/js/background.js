/* ═══════════════════════════════════════
   Vibes Dashboard — Immersive Background Engine
   Multi-layered reactive visualizer with
   flowing gradients, particles, nebula clouds,
   and audio-reactive geometry.
   Always visible behind all views.
   ═══════════════════════════════════════ */

(function () {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width, height;

  // ── Core State ──
  const state = {
    // Hue palette — shifts on interaction
    hue1: 220,       // primary hue
    hue2: 280,       // secondary hue
    hue3: 180,       // accent hue
    targetHue1: 220,
    targetHue2: 280,
    targetHue3: 180,
    // Energy — driven by audio or user interaction
    energy: 0.15,
    targetEnergy: 0.15,
    // Mouse position
    mouseX: 0,
    mouseY: 0,
    // Time
    time: 0,
    // Palette mode
    paletteIndex: 0,
    // Visualizer mode index
    currentModeIndex: 0,
    // Audio data (fed from music.js)
    audioData: null,
    audioAvg: 0,
    audioBass: 0,
    audioMid: 0,
    audioTreble: 0,
  };

  // ── Color Palettes ── (each is [hue1, hue2, hue3])
  const PALETTES = [
    [220, 280, 180],   // Default: Blue / Purple / Teal
    [260, 320, 200],   // Violet / Pink / Mint
    [15, 45, 340],     // Ember / Gold / Magenta
    [140, 200, 60],    // Emerald / Cyan / Lime
    [320, 260, 20],    // Hot Pink / Indigo / Orange
    [190, 240, 300],   // Ocean / Sky / Lavender
  ];

  // ── Resize ──
  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    initNebulae();
  }
  window.addEventListener('resize', resize);

  // ── Pools & Constants ──
  const PARTICLE_COUNT = 160;
  const particles = [];
  const NEBULA_COUNT = 5;
  const nebulae = [];
  
  const EMBER_COUNT = 100;
  const embers = [];
  
  const CYBER_COUNT = 150;
  const cyberParticles = [];
  
  const STAR_COUNT = 100;
  const stars = [];
  
  const RAIN_COUNT = 120;
  const rain = [];

  // ── Particle (Nebula Flow) ──
  class Particle {
    constructor() { this.reset(true); }
    reset(initial = false) {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.size = Math.random() * 2.5 + 0.3;
      this.baseSpeed = (Math.random() - 0.5) * 0.3;
      this.speedX = this.baseSpeed;
      this.speedY = (Math.random() - 0.5) * 0.3;
      this.opacity = Math.random() * 0.5 + 0.1;
      this.hueOffset = Math.random() * 60 - 30;
      this.life = initial ? Math.random() * 300 + 100 : 300 + Math.random() * 200;
      this.maxLife = this.life;
      this.pulsePhase = Math.random() * Math.PI * 2;
    }
    update(dt) {
      const e = state.energy;

      // Audio reactivity
      this.speedX = this.baseSpeed + e * 0.4;
      this.x += this.speedX * dt;
      this.y += (this.speedY + Math.sin(state.time * 0.5 + this.pulsePhase) * 0.15) * dt;
      this.life -= dt;

      // Mouse attraction
      const dx = state.mouseX - this.x;
      const dy = state.mouseY - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 250) {
        const force = (1 - dist / 250) * 0.003 * (1 + e);
        this.x += dx * force * dt;
        this.y += dy * force * dt;
      }

      if (this.life <= 0 || this.x < -20 || this.x > width + 20 || this.y < -20 || this.y > height + 20) {
        this.reset();
      }
    }
    draw() {
      const isLight = document.body.classList.contains('light-mode');
      const fade = Math.min(this.life / 40, (this.maxLife - this.life) / 20, 1);
      const pulseFactor = 1 + Math.sin(state.time * 2 + this.pulsePhase) * 0.3 * state.energy;
      const h = (state.hue1 + this.hueOffset) % 360;
      const s = isLight ? '65%' : '75%';
      const l = isLight ? '50%' : '68%';
      const r = this.size * pulseFactor * (1 + state.energy * 0.5);

      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${h}, ${s}, ${l}, ${this.opacity * fade})`;
      ctx.fill();

      // Glow for larger particles
      if (r > 1.5) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${h}, ${s}, ${l}, ${this.opacity * fade * 0.08})`;
        ctx.fill();
      }
    }
  }

  // ── Connection lines (Nebula Flow) ──
  function drawConnections() {
    const maxDist = 90 + state.energy * 40;
    const isLight = document.body.classList.contains('light-mode');

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < maxDist) {
          const h = (state.hue1 + state.hue2) / 2;
          const alpha = (1 - dist / maxDist) * (isLight ? 0.1 : 0.06) * (1 + state.energy * 0.5);
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `hsla(${h}, 60%, 55%, ${alpha})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
  }

  // ── Nebula / Gradient Blobs (Nebula Flow) ──
  class Nebula {
    constructor() { this.init(); }
    init() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.radius = 150 + Math.random() * 250;
      this.vx = (Math.random() - 0.5) * 0.2;
      this.vy = (Math.random() - 0.5) * 0.2;
      this.hueOffset = Math.random() * 120 - 60;
      this.phase = Math.random() * Math.PI * 2;
      this.breathSpeed = 0.3 + Math.random() * 0.4;
    }
    update() {
      this.x += this.vx + Math.sin(state.time * 0.1 + this.phase) * 0.3;
      this.y += this.vy + Math.cos(state.time * 0.08 + this.phase) * 0.3;

      // Wrap around edges with padding
      if (this.x < -this.radius * 2) this.x = width + this.radius;
      if (this.x > width + this.radius * 2) this.x = -this.radius;
      if (this.y < -this.radius * 2) this.y = height + this.radius;
      if (this.y > height + this.radius * 2) this.y = -this.radius;
    }
    draw(hue, opacity) {
      const isLight = document.body.classList.contains('light-mode');
      const breathing = 1 + Math.sin(state.time * this.breathSpeed + this.phase) * 0.2;
      const r = this.radius * breathing * (1 + state.energy * 0.3);
      const h = (hue + this.hueOffset) % 360;
      const s = isLight ? '50%' : '70%';
      const l = isLight ? '65%' : '40%';

      const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
      gradient.addColorStop(0, `hsla(${h}, ${s}, ${l}, ${opacity * 0.4})`);
      gradient.addColorStop(0.5, `hsla(${h}, ${s}, ${l}, ${opacity * 0.15})`);
      gradient.addColorStop(1, `hsla(${h}, ${s}, ${l}, 0)`);

      ctx.fillStyle = gradient;
      ctx.fillRect(this.x - r, this.y - r, r * 2, r * 2);
    }
  }

  function initNebulae() {
    nebulae.length = 0;
    for (let i = 0; i < NEBULA_COUNT; i++) {
      nebulae.push(new Nebula());
    }
  }

  // ── EmberParticle (Ember Storm) ──
  class EmberParticle {
    constructor() { this.reset(true); }
    reset(initial = false) {
      this.x = Math.random() * width;
      this.y = initial ? Math.random() * height : height + 20;
      this.size = Math.random() * 2.8 + 0.6;
      this.speedY = -(Math.random() * 1.1 + 0.4);
      this.speedX = (Math.random() - 0.5) * 0.4;
      this.wobbleSpeed = Math.random() * 0.05 + 0.02;
      this.wobbleAmp = Math.random() * 1.8 + 0.5;
      this.phase = Math.random() * Math.PI * 2;
      this.life = initial ? Math.random() * 200 + 50 : 200 + Math.random() * 100;
      this.maxLife = this.life;
      this.alpha = Math.random() * 0.6 + 0.3;
    }
    update(dt) {
      const e = state.energy;
      this.y += this.speedY * (1 + e * 1.5) * dt;
      this.x += (this.speedX + Math.sin(state.time * this.wobbleSpeed + this.phase) * this.wobbleAmp * 0.15) * dt;
      this.life -= dt;
      if (this.life <= 0 || this.x < -20 || this.x > width + 20 || this.y < -20) {
        this.reset();
      }
    }
    draw() {
      const isLight = document.body.classList.contains('light-mode');
      const fade = Math.min(this.life / 40, 1);
      const progress = 1 - (this.life / this.maxLife);
      
      // Shift from bright yellow/orange to amber/red
      const h = (state.hue3 + progress * 35) % 360;
      const s = isLight ? '80%' : '95%';
      const l = isLight ? '52%' : '66%';
      
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * (1 + state.audioBass * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${h}, ${s}, ${l}, ${this.alpha * fade})`;
      ctx.fill();

      if (this.size > 1.8) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * 3.5, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${h}, ${s}, ${l}, ${this.alpha * fade * 0.12})`;
        ctx.fill();
      }
    }
  }

  // ── CyberParticle (Cyber Stream) ──
  class CyberParticle {
    constructor() { this.reset(true); }
    reset(initial = false) {
      this.x = Math.random() * width;
      this.y = initial ? Math.random() * height : -40;
      this.length = Math.random() * 35 + 15;
      this.speed = Math.random() * 3.2 + 0.8;
      this.width = Math.random() * 1.6 + 0.6;
      this.alpha = Math.random() * 0.45 + 0.1;
      this.hue = (state.hue1 + Math.random() * 40 - 20) % 360;
    }
    update(dt) {
      const e = state.energy;
      this.y += this.speed * (1 + e * 2.2) * dt;
      if (this.y > height + 40) {
        this.reset();
      }
    }
    draw() {
      const isLight = document.body.classList.contains('light-mode');
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x, this.y + this.length);
      ctx.lineWidth = this.width * (1 + state.audioTreble * 0.7);
      ctx.strokeStyle = `hsla(${this.hue}, 90%, ${isLight ? '45%' : '65%'}, ${this.alpha})`;
      ctx.stroke();

      if (this.width > 1.3) {
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x, this.y + this.length);
        ctx.lineWidth = this.width * 3.5;
        ctx.strokeStyle = `hsla(${this.hue}, 90%, ${isLight ? '45%' : '65%'}, ${this.alpha * 0.18})`;
        ctx.stroke();
      }
    }
  }

  function drawCyberGrid() {
    const isLight = document.body.classList.contains('light-mode');
    const gridSize = 65;
    const alpha = (isLight ? 0.025 : 0.012) * (1 + state.audioBass * 0.6);
    ctx.strokeStyle = `hsla(${state.hue1}, 80%, ${isLight ? '35%' : '65%'}, ${alpha})`;
    ctx.lineWidth = 0.5;
    
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  // ── Star (Aurora & Storm) ──
  class Star {
    constructor() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.size = Math.random() * 1.3 + 0.3;
      this.alpha = Math.random() * 0.75 + 0.25;
      this.twinkleSpeed = 0.4 + Math.random() * 1.4;
      this.phase = Math.random() * Math.PI * 2;
    }
    draw() {
      const twinkle = Math.sin(state.time * this.twinkleSpeed + this.phase) * 0.45 + 0.55;
      ctx.fillStyle = `rgba(255, 255, 255, ${this.alpha * twinkle})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Aurora Waves (Aurora Waves Mode) ──
  function drawAuroraWaves() {
    const isLight = document.body.classList.contains('light-mode');
    const layers = 3;
    const points = 16;
    const step = width / (points - 1);
    
    for (let l = 0; l < layers; l++) {
      const h = (state.hue2 + l * 40) % 360;
      const yBase = height * (0.35 + l * 0.16);
      const amp = 35 + state.audioMid * 65;
      
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, yBase);
      
      for (let i = 0; i < points; i++) {
        const x = i * step;
        const wave = Math.sin(i * 0.32 + state.time * 0.18 + l * Math.PI / 3) * amp + 
                     Math.cos(i * 0.12 - state.time * 0.08) * amp * 0.4;
        ctx.lineTo(x, yBase + wave);
      }
      
      ctx.lineTo(width, height);
      ctx.closePath();
      
      const grad = ctx.createLinearGradient(0, yBase - amp, 0, height);
      const alpha = isLight ? 0.03 : 0.045;
      grad.addColorStop(0, `hsla(${h}, 80%, ${isLight ? '58%' : '48%'}, ${alpha})`);
      grad.addColorStop(0.5, `hsla(${h}, 80%, ${isLight ? '50%' : '40%'}, ${alpha * 0.35})`);
      grad.addColorStop(1, `hsla(${h}, 80%, ${isLight ? '50%' : '40%'}, 0)`);
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }

  // ── RainDrop & Lightning (Electrical Storm Mode) ──
  class RainDrop {
    constructor() { this.reset(true); }
    reset(initial = false) {
      this.x = Math.random() * width;
      this.y = initial ? Math.random() * height : -30;
      this.length = Math.random() * 20 + 10;
      this.speed = Math.random() * 10 + 7;
      this.angle = 0.12; // slanting down right
      this.alpha = Math.random() * 0.18 + 0.04;
    }
    update(dt) {
      this.y += this.speed * dt;
      this.x += this.speed * Math.sin(this.angle) * dt;
      if (this.y > height + 30 || this.x > width + 30) {
        this.reset();
      }
    }
    draw() {
      const isLight = document.body.classList.contains('light-mode');
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + this.length * Math.sin(this.angle), this.y + this.length);
      ctx.lineWidth = 1;
      ctx.strokeStyle = isLight 
        ? `rgba(30, 41, 59, ${this.alpha * 0.8})`
        : `rgba(220, 230, 255, ${this.alpha})`;
      ctx.stroke();
    }
  }

  let lightningStrike = null;
  let flashOpacity = 0;
  
  function drawLightningStorm() {
    const isLight = document.body.classList.contains('light-mode');
    
    if (state.audioBass > 0.76 && Math.random() < 0.05 && !lightningStrike) {
      const startX = Math.random() * width;
      const endX = startX + (Math.random() - 0.5) * 220;
      lightningStrike = {
        x1: startX,
        y1: 0,
        x2: endX,
        y2: height * (0.55 + Math.random() * 0.4),
        branch: Math.random() < 0.6,
        life: 14 // frames
      };
      flashOpacity = isLight ? 0.18 : 0.26;
    }
    
    if (flashOpacity > 0) {
      ctx.fillStyle = isLight 
        ? `rgba(255, 255, 255, ${flashOpacity})`
        : `rgba(215, 230, 255, ${flashOpacity})`;
      ctx.fillRect(0, 0, width, height);
      flashOpacity -= 0.025;
    }
    
    if (lightningStrike) {
      ctx.strokeStyle = isLight ? `rgba(40, 110, 250, 0.85)` : `rgba(240, 245, 255, 0.98)`;
      ctx.shadowColor = `rgba(110, 160, 255, 0.9)`;
      ctx.shadowBlur = 25;
      ctx.lineWidth = Math.random() * 3 + 1.8;
      
      drawLightningBolt(lightningStrike.x1, lightningStrike.y1, lightningStrike.x2, lightningStrike.y2, 5, 75);
      
      if (lightningStrike.branch) {
        ctx.lineWidth = 1.2;
        const branchX = (lightningStrike.x1 + lightningStrike.x2) / 2;
        const branchY = (lightningStrike.y1 + lightningStrike.y2) / 2;
        drawLightningBolt(branchX, branchY, branchX + (Math.random() - 0.5) * 160, branchY + 160, 3, 35);
      }
      
      ctx.shadowBlur = 0;
      lightningStrike.life--;
      if (lightningStrike.life <= 0) {
        lightningStrike = null;
      }
    }
  }

  function drawLightningBolt(x1, y1, x2, y2, segments, displacement) {
    if (segments === 0) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else {
      const midX = (x1 + x2) / 2 + (Math.random() - 0.5) * displacement;
      const midY = (y1 + y2) / 2 + (Math.random() - 0.5) * displacement;
      drawLightningBolt(x1, y1, midX, midY, segments - 1, displacement / 2);
      drawLightningBolt(midX, midY, x2, y2, segments - 1, displacement / 2);
    }
  }

  // ── Init Pools ──
  function initPools() {
    particles.length = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());
    initNebulae();

    embers.length = 0;
    for (let i = 0; i < EMBER_COUNT; i++) embers.push(new EmberParticle());

    cyberParticles.length = 0;
    for (let i = 0; i < CYBER_COUNT; i++) cyberParticles.push(new CyberParticle());

    stars.length = 0;
    for (let i = 0; i < STAR_COUNT; i++) stars.push(new Star());

    rain.length = 0;
    for (let i = 0; i < RAIN_COUNT; i++) rain.push(new RainDrop());
  }

  // ── Audio-Reactive Ring ──
  function drawAudioRing() {
    if (!state.audioData && state.energy < 0.2) return;

    const cx = width / 2;
    const cy = height / 2;
    const baseRadius = Math.min(width, height) * 0.18;
    const data = state.audioData;
    const isLight = document.body.classList.contains('light-mode');

    // Inner glow disc
    const glowRadius = baseRadius * (1 + state.audioAvg * 0.5);
    const innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius * 1.5);
    const h1 = state.hue1;
    const h2 = state.hue2;
    const glowAlpha = 0.03 + state.audioAvg * 0.08;
    innerGrad.addColorStop(0, `hsla(${h1}, 80%, ${isLight ? '50%' : '60%'}, ${glowAlpha})`);
    innerGrad.addColorStop(0.6, `hsla(${h2}, 70%, ${isLight ? '45%' : '50%'}, ${glowAlpha * 0.3})`);
    innerGrad.addColorStop(1, `hsla(${h2}, 60%, 40%, 0)`);
    ctx.fillStyle = innerGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowRadius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    if (!data) return;

    // Frequency bars radiating from center
    const bars = Math.floor(data.length / 2);
    const angleStep = (Math.PI * 2) / bars;

    for (let i = 0; i < bars; i++) {
      const val = data[i] / 255;
      const barLen = val * baseRadius * 1.0;
      const angle = i * angleStep + state.time * 0.05;

      const x1 = cx + Math.cos(angle) * (baseRadius * 0.8);
      const y1 = cy + Math.sin(angle) * (baseRadius * 0.8);
      const x2 = cx + Math.cos(angle) * (baseRadius * 0.8 + barLen);
      const y2 = cy + Math.sin(angle) * (baseRadius * 0.8 + barLen);

      const h = (state.hue1 + i * (120 / bars)) % 360;
      const alpha = 0.15 + val * 0.6;

      ctx.beginPath();
      ctx.lineWidth = 3 + val * 3;
      ctx.lineCap = 'round';
      ctx.strokeStyle = `hsla(${h}, 80%, ${isLight ? '50%' : '65%'}, ${alpha})`;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Outer orbit ring
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius * 0.8, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${h1}, 60%, 55%, ${0.05 + state.audioAvg * 0.15})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ── Flowing wave lines ──
  function drawWaves() {
    const isLight = document.body.classList.contains('light-mode');
    const waveCount = 3;

    for (let w = 0; w < waveCount; w++) {
      const h = (state.hue1 + w * 40) % 360;
      const yBase = height * (0.3 + w * 0.2);
      const amp = 30 + state.energy * 50 + state.audioBass * 40;
      const freq = 0.003 + w * 0.001;
      const speed = state.time * (0.3 + w * 0.1);
      const alpha = isLight ? 0.04 : 0.03;

      ctx.beginPath();
      ctx.moveTo(0, yBase);
      for (let x = 0; x <= width; x += 4) {
        const y = yBase +
          Math.sin(x * freq + speed) * amp +
          Math.sin(x * freq * 2.3 + speed * 1.5) * amp * 0.3;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, yBase - amp, 0, height);
      grad.addColorStop(0, `hsla(${h}, 70%, ${isLight ? '55%' : '50%'}, ${alpha})`);
      grad.addColorStop(1, `hsla(${h}, 70%, ${isLight ? '55%' : '50%'}, 0)`);
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }

  // ── Modes Registry ──
  const MODES = [
    {
      name: 'Nebula Flow',
      draw: (dt, isLight) => {
        drawWaves();
        const nebulaOpacity = isLight ? 0.06 : 0.08;
        nebulae.forEach((n, i) => {
          n.update();
          const hue = i % 2 === 0 ? state.hue1 : state.hue2;
          n.draw(hue, nebulaOpacity + state.energy * 0.05);
        });
        drawAudioRing();
        particles.forEach(p => {
          p.update(dt);
          p.draw();
        });
        drawConnections();
      }
    },
    {
      name: 'Ember Storm',
      draw: (dt, isLight) => {
        const cx = width / 2;
        const cy = height / 2;
        const r = Math.min(width, height) * 0.65;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const h = state.hue3;
        grad.addColorStop(0, `hsla(${h}, 75%, ${isLight ? '90%' : '14%'}, 0.28)`);
        grad.addColorStop(1, isLight ? 'rgba(241, 245, 249, 0)' : 'rgba(8, 8, 12, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
        
        embers.forEach(e => {
          e.update(dt);
          e.draw();
        });
      }
    },
    {
      name: 'Cyber Stream',
      draw: (dt, isLight) => {
        drawCyberGrid();
        cyberParticles.forEach(cp => {
          cp.update(dt);
          cp.draw();
        });
      }
    },
    {
      name: 'Aurora Waves',
      draw: (dt, isLight) => {
        stars.forEach(s => s.draw());
        drawAuroraWaves();
      }
    },
    {
      name: 'Electrical Storm',
      draw: (dt, isLight) => {
        stars.forEach(s => s.draw());
        rain.forEach(drop => {
          drop.update(dt);
          drop.draw();
        });
        drawLightningStorm();
      }
    }
  ];

  // Try to load saved mode index
  try {
    const savedMode = localStorage.getItem('vibes-visualizer-mode');
    if (savedMode !== null) {
      const idx = parseInt(savedMode, 10);
      if (idx >= 0 && idx < MODES.length) {
        state.currentModeIndex = idx;
      }
    }
  } catch (_) {}

  // ── Main Animation Loop ──
  let lastTime = performance.now();

  function animate(now) {
    const dt = Math.min((now - lastTime) / 16.67, 3); // normalize to 60fps
    lastTime = now;
    state.time += 0.016 * dt;

    const isLight = document.body.classList.contains('light-mode');

    // Smooth transitions
    state.hue1 += (state.targetHue1 - state.hue1) * 0.015 * dt;
    state.hue2 += (state.targetHue2 - state.hue2) * 0.015 * dt;
    state.hue3 += (state.targetHue3 - state.hue3) * 0.015 * dt;
    state.energy += (state.targetEnergy - state.energy) * 0.04 * dt;

    // Clear with trail
    // Cyber mode and aurora look better with slightly longer trails
    const modeIndex = state.currentModeIndex || 0;
    let bgAlpha = isLight ? 0.12 : 0.1;
    if (modeIndex === 2) bgAlpha = isLight ? 0.08 : 0.07; // cyber stream trail
    else if (modeIndex === 3) bgAlpha = isLight ? 0.1 : 0.08;  // aurora trail
    
    ctx.fillStyle = isLight ? `rgba(241, 245, 249, ${bgAlpha})` : `rgba(8, 8, 12, ${bgAlpha})`;
    ctx.fillRect(0, 0, width, height);

    // Draw active mode
    const activeMode = MODES[modeIndex] || MODES[0];
    activeMode.draw(dt, isLight);

    requestAnimationFrame(animate);
  }

  // ── Init ──
  // Make sure pools are initialized on resize
  const originalResize = resize;
  resize = function() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    initPools();
  };
  
  resize();
  requestAnimationFrame(animate);

  // Track mouse
  document.addEventListener('mousemove', (e) => {
    state.mouseX = e.clientX;
    state.mouseY = e.clientY;
  });

  // ── Public API ──
  window.bgEffect = {
    /** Shift the entire palette to a new primary hue */
    setHue(h) {
      state.targetHue1 = h;
      state.targetHue2 = (h + 60) % 360;
      state.targetHue3 = (h + 160) % 360;
    },

    /** Set the energy level (0-1) — controls particle speed, glow, wave amplitude */
    setEnergy(e) {
      state.targetEnergy = Math.max(0.05, Math.min(1, e));
    },

    /** Feed audio frequency data from the music analyser */
    setAudioData(dataArray) {
      state.audioData = dataArray;
      if (dataArray) {
        const len = dataArray.length;
        let sum = 0;
        let bass = 0;
        let mid = 0;
        let treble = 0;
        const bassEnd = Math.floor(len * 0.15);
        const midEnd = Math.floor(len * 0.5);

        for (let i = 0; i < len; i++) {
          sum += dataArray[i];
          if (i < bassEnd) bass += dataArray[i];
          else if (i < midEnd) mid += dataArray[i];
          else treble += dataArray[i];
        }

        state.audioAvg = sum / len / 255;
        state.audioBass = bass / bassEnd / 255;
        state.audioMid = mid / (midEnd - bassEnd) / 255;
        state.audioTreble = treble / (len - midEnd) / 255;
      } else {
        state.audioAvg = 0;
        state.audioBass = 0;
        state.audioMid = 0;
        state.audioTreble = 0;
      }
    },

    /** Quick burst of energy + hue shift on interaction */
    pulse() {
      state.targetEnergy = Math.min(state.energy + 0.35, 1);
      state.targetHue1 = (state.targetHue1 + 15) % 360;
      state.targetHue2 = (state.targetHue2 + 15) % 360;
      setTimeout(() => {
        state.targetEnergy = Math.max(state.targetEnergy - 0.3, 0.15);
      }, 700);
    },

    /** Cycle to the next color palette with smooth transition */
    nextPalette() {
      state.paletteIndex = (state.paletteIndex + 1) % PALETTES.length;
      const p = PALETTES[state.paletteIndex];
      state.targetHue1 = p[0];
      state.targetHue2 = p[1];
      state.targetHue3 = p[2];
    },

    /** Set a specific palette by index */
    setPalette(index) {
      state.paletteIndex = index % PALETTES.length;
      const p = PALETTES[state.paletteIndex];
      state.targetHue1 = p[0];
      state.targetHue2 = p[1];
      state.targetHue3 = p[2];
    },

    getPaletteIndex() { return state.paletteIndex; },
    getPaletteCount() { return PALETTES.length; },

    // ── Multi-mode Controls ──
    nextMode() {
      state.currentModeIndex = (state.currentModeIndex + 1) % MODES.length;
      this.saveModePreference();
      this.applyModeColorShift();
      return MODES[state.currentModeIndex].name;
    },

    prevMode() {
      state.currentModeIndex = (state.currentModeIndex - 1 + MODES.length) % MODES.length;
      this.saveModePreference();
      this.applyModeColorShift();
      return MODES[state.currentModeIndex].name;
    },

    setMode(indexOrName) {
      if (typeof indexOrName === 'number') {
        if (indexOrName >= 0 && indexOrName < MODES.length) {
          state.currentModeIndex = indexOrName;
          this.saveModePreference();
          this.applyModeColorShift();
        }
      } else if (typeof indexOrName === 'string') {
        const idx = MODES.findIndex(m => m.name.toLowerCase() === indexOrName.toLowerCase());
        if (idx !== -1) {
          state.currentModeIndex = idx;
          this.saveModePreference();
          this.applyModeColorShift();
        }
      }
      return MODES[state.currentModeIndex].name;
    },

    getCurrentModeName() {
      return MODES[state.currentModeIndex || 0].name;
    },

    getModeNames() {
      return MODES.map(m => m.name);
    },

    saveModePreference() {
      try {
        localStorage.setItem('vibes-visualizer-mode', state.currentModeIndex);
        // Persist setting to server
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 'vibes-visualizer-mode': state.currentModeIndex })
        }).catch(err => console.warn('[Settings] Failed to save mode to server:', err));
      } catch (_) {}
    },

    applyModeColorShift() {
      // Shift colors slightly depending on mode to give immediate accent feedback
      const modeIdx = state.currentModeIndex;
      if (modeIdx === 0) this.setHue(220); // nebula flow - blue/purple
      else if (modeIdx === 1) this.setHue(15);  // ember storm - red/orange
      else if (modeIdx === 2) this.setHue(170); // cyber stream - green/cyan
      else if (modeIdx === 3) this.setHue(290); // aurora waves - purple/teal
      else if (modeIdx === 4) this.setHue(205); // electrical storm - deep blue/white
    }
  };

  console.log('[Background] Multi-mode reactive background engine loaded');
})();
