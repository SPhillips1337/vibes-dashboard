/* ═══════════════════════════════════════
   Vibes Dashboard — Immersive Background Engine
   Multi-layered reactive visualizer with
   flowing gradients, particles, nebula clouds,
   and audio-reactive geometry.
   Always visible behind all views.
   ═══════════════════════════════════════ */

(function () {
  const canvas2d = document.getElementById('bg-canvas');
  const webglContainer = document.getElementById('webgl-container');
  if (!canvas2d || !webglContainer) return;
  const ctx = canvas2d.getContext('2d');

  let width, height;

  // ── Three.js State ──
  let scene, camera, renderer;
  let currentWebGlMode = null; // Store reference to active WebGL scene manager

  function initThreeJs() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    webglContainer.appendChild(renderer.domElement);
  }

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
    width = canvas2d.width = window.innerWidth;
    height = canvas2d.height = window.innerHeight;
    
    if (camera && renderer) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }
    
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

  const SINGULARITY_PARTICLE_COUNT = 120;
  const singularityParticles = [];
  const gears = [];

  // ── System Event Particles & Flashes ──
  const eventParticles = [];
  let flashIntensity = 0;
  let flashColor = '255, 255, 255';

  class EventParticle {
    constructor(x, y, color) {
      this.x = x;
      this.y = y;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 5 + 2;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.size = Math.random() * 3 + 2;
      this.life = 1.0;
      this.decay = Math.random() * 0.015 + 0.015;
      this.color = color;
    }
    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= 0.96;
      this.vy *= 0.96;
      this.life -= this.decay * dt;
    }
    draw() {
      ctx.fillStyle = this.color.replace('opacity', this.life * 0.9);
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * this.life, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Auto-rotation System ──
  let autoRotateInterval = null;
  let autoRotateEnabled = true;

  function startAutoRotate() {
    stopAutoRotate();
    if (!autoRotateEnabled) return;
    autoRotateInterval = setInterval(() => {
      const current = state.currentModeIndex;
      let next = current;
      while (next === current) {
        next = Math.floor(Math.random() * MODES.length);
      }
      window.bgEffect.setMode(next);
      
      const vizModeLabel = document.getElementById('viz-mode-label');
      if (vizModeLabel) {
        vizModeLabel.textContent = window.bgEffect.getCurrentModeName();
        vizModeLabel.classList.add('flash');
        setTimeout(() => { vizModeLabel.classList.remove('flash'); }, 600);
      }
    }, 60000);
  }

  function stopAutoRotate() {
    if (autoRotateInterval) {
      clearInterval(autoRotateInterval);
      autoRotateInterval = null;
    }
  }

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

  class SingularityParticle {
    constructor() {
      this.reset();
    }
    reset() {
      const Rs = Math.min(width || 800, height || 600) * 0.09;
      this.radius = Math.random() * (Rs * 6.5) + Rs * 1.25;
      this.angle = Math.random() * Math.PI * 2;
      this.speed = Math.sqrt(Rs / this.radius) * 0.035;
      this.size = Math.random() * 2 + 1;
      this.opacity = Math.random() * 0.6 + 0.35;
    }
    update(dt) {
      const Rs = Math.min(width || 800, height || 600) * 0.09;
      this.angle += this.speed * dt * (1 + state.energy * 2.0);
      if (this.radius < Rs) this.reset();
    }
    draw(cx, cy, Rs, isLight) {
      const cosA = Math.cos(this.angle);
      const sinA = Math.sin(this.angle);
      
      const diskX = cosA * this.radius;
      const diskY = sinA * this.radius * 0.28;
      const z = sinA * this.radius;
      
      const approach = -cosA;
      const doppler = Math.max(0.18, 1 + approach * 0.65);
      
      let projectedX = diskX;
      let projectedY = diskY;
      
      if (z < 0) {
        const dist = Math.sqrt(diskX * diskX + diskY * diskY);
        if (dist > Rs) {
          const warp = (Rs * Rs) / dist;
          projectedY -= Math.sign(diskY || 1) * warp * 1.6;
        }
      }
      
      const screenX = cx + projectedX;
      const screenY = cy + projectedY;
      
      const shiftHue = approach > 0 
        ? (state.hue2 + approach * 45) % 360  
        : (state.hue1 - Math.abs(approach) * 35 + 360) % 360;
        
      ctx.beginPath();
      ctx.arc(screenX, screenY, this.size * doppler * (1 + state.audioAvg * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${shiftHue}, 90%, 65%, ${this.opacity * doppler})`;
      ctx.fill();
    }
  }

  class ClockworkGear {
    constructor(xRel, yRel, radius, teeth, speed, hueOffset = 0) {
      this.xRel = xRel;
      this.yRel = yRel;
      this.radius = radius;
      this.teeth = teeth;
      this.speed = speed;
      this.angle = Math.random() * Math.PI;
      this.hueOffset = hueOffset;
    }
    update(dt, energy) {
      this.angle += this.speed * dt * (0.4 + energy * 2.8);
    }
    draw(cx, cy, isLight) {
      const x = cx + this.xRel;
      const y = cy + this.yRel;
      
      ctx.beginPath();
      const toothDepth = 12;
      const totalPoints = this.teeth * 4;
      
      for (let i = 0; i < totalPoints; i++) {
        const angle = this.angle + (i * Math.PI * 2) / totalPoints;
        const phase = i % 4;
        let r = this.radius;
        if (phase === 0 || phase === 1) {
          r += toothDepth;
        }
        
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      
      const h = (state.hue1 + this.hueOffset) % 360;
      ctx.strokeStyle = `hsla(${h}, 70%, ${isLight ? '45%' : '60%'}, 0.22)`;
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.fillStyle = `hsla(${h}, 60%, ${isLight ? '90%' : '15%'}, 0.04)`;
      ctx.fill();
      
      // Inner circular rim
      ctx.beginPath();
      ctx.arc(x, y, this.radius - 8, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${h}, 70%, ${isLight ? '40%' : '65%'}, 0.12)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      
      // Center axle
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${h}, 80%, ${isLight ? '40%' : '70%'}, 0.3)`;
      ctx.fill();
      
      // Spokes
      const spokes = 4;
      ctx.beginPath();
      for (let s = 0; s < spokes; s++) {
        const spokeAngle = this.angle + (s * Math.PI * 2) / spokes;
        const x1 = x + Math.cos(spokeAngle) * 6;
        const y1 = y + Math.sin(spokeAngle) * 6;
        const x2 = x + Math.cos(spokeAngle) * (this.radius - 8);
        const y2 = y + Math.sin(spokeAngle) * (this.radius - 8);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.strokeStyle = `hsla(${h}, 70%, ${isLight ? '45%' : '60%'}, 0.12)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
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

    singularityParticles.length = 0;
    for (let i = 0; i < SINGULARITY_PARTICLE_COUNT; i++) singularityParticles.push(new SingularityParticle());

    gears.length = 0;
    gears.push(new ClockworkGear(0, 0, 70, 12, 0.004, 0));
    gears.push(new ClockworkGear(0, -115, 45, 8, -0.006, 40));
    gears.push(new ClockworkGear(0, 115, 45, 8, -0.006, 40));
    gears.push(new ClockworkGear(-115, 0, 45, 8, -0.006, 80));
    gears.push(new ClockworkGear(115, 0, 45, 8, -0.006, 80));
    
    const w = width || window.innerWidth || 800;
    const h = height || window.innerHeight || 600;
    gears.push(new ClockworkGear(-w * 0.35, h * 0.22, 220, 36, 0.0008, -30));
    gears.push(new ClockworkGear(w * 0.35, -h * 0.22, 260, 42, -0.0006, -60));
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

  // ── Cosmic Anomaly WebGL Mode ──
  class CosmicAnomalyMode {
    constructor() {
      this.group = new THREE.Group();
      
      const particleCount = 20000;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);
      const sizes = new Float32Array(particleCount);
      const phases = new Float32Array(particleCount);

      const color = new THREE.Color();
      for (let i = 0; i < particleCount; i++) {
        // Spiral galaxy distribution
        const radius = Math.random() * 20 + 2;
        const angle = Math.random() * Math.PI * 2;
        const armOffset = (angle + radius * 0.5) % (Math.PI * 2);
        
        // Concentrate near arms
        const armThickness = Math.random() * 2;
        const finalAngle = angle + (Math.random() - 0.5) * armThickness;
        
        const x = Math.cos(finalAngle) * radius;
        const z = Math.sin(finalAngle) * radius;
        const y = (Math.random() - 0.5) * (4 / (radius * 0.2 + 1));

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        color.setHSL(0.6 + (radius * 0.02), 0.8, 0.6);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;

        sizes[i] = Math.random() * 2.0;
        phases[i] = Math.random() * Math.PI * 2;
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
      geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

      // Custom shader material for glowing, pulsing particles
      this.material = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          energy: { value: 0 },
          baseHue: { value: 0.6 }
        },
        vertexShader: `
          uniform float time;
          uniform float energy;
          attribute float size;
          attribute float phase;
          varying vec3 vColor;
          void main() {
            vColor = color;
            vec3 pos = position;
            
            // Rotation based on distance from center
            float dist = length(pos.xz);
            float angle = time * (1.0 / (dist + 1.0)) * (0.5 + energy * 2.0);
            
            float s = sin(angle);
            float c = cos(angle);
            
            float newX = pos.x * c - pos.z * s;
            float newZ = pos.x * s + pos.z * c;
            pos.x = newX;
            pos.z = newZ;
            
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = size * (1.0 + energy * 2.0) * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform float baseHue;
          varying vec3 vColor;
          void main() {
            float dist = length(gl_PointCoord - vec2(0.5));
            if (dist > 0.5) discard;
            float alpha = (0.5 - dist) * 2.0;
            
            // Shift color based on uniforms
            vec3 finalColor = vColor;
            
            gl_FragColor = vec4(finalColor, alpha * 0.8);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      this.particles = new THREE.Points(geometry, this.material);
      this.group.add(this.particles);
      
      // Setup camera position for this scene
      camera.position.set(0, 15, 25);
      camera.lookAt(0, 0, 0);
    }

    mount() {
      scene.add(this.group);
      renderer.domElement.style.opacity = '1';
    }

    unmount() {
      scene.remove(this.group);
      renderer.domElement.style.opacity = '0';
    }

    update(dt, state) {
      this.material.uniforms.time.value = state.time;
      this.material.uniforms.energy.value = state.energy + state.audioBass * 0.5;
      this.material.uniforms.baseHue.value = state.hue1 / 360;
      
      // Gentle tilt based on mouse
      const targetRotX = (state.mouseY / window.innerHeight - 0.5) * 0.5;
      const targetRotY = (state.mouseX / window.innerWidth - 0.5) * 0.5;
      
      this.group.rotation.x += (targetRotX - this.group.rotation.x) * 0.05;
      this.group.rotation.y += (targetRotY - this.group.rotation.y) * 0.05;
    }
  }

  // ── Liquid Fluid FX WebGL Mode ──
  class LiquidFluidMode {
    constructor() {
      this.group = new THREE.Group();
      
      const geometry = new THREE.PlaneGeometry(2, 2);
      
      this.material = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          energy: { value: 0 },
          resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
          baseHue: { value: 0.6 },
          mouse: { value: new THREE.Vector2(0.5, 0.5) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          uniform float energy;
          uniform vec2 resolution;
          uniform float baseHue;
          uniform vec2 mouse;
          varying vec2 vUv;
          
          // Noise function
          vec2 hash(vec2 p) {
            p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
          }

          float noise(in vec2 p) {
            const float K1 = 0.366025404;
            const float K2 = 0.211324865;
            vec2 i = floor(p + (p.x + p.y) * K1);
            vec2 a = p - i + (i.x + i.y) * K2;
            vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec2 b = a - o + K2;
            vec2 c = a - 1.0 + 2.0 * K2;
            vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
            vec3 n = h * h * h * h * vec3(dot(a, hash(i + 0.0)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
            return dot(n, vec3(70.0));
          }

          // FBM
          float fbm(vec2 x) {
            float v = 0.0;
            float a = 0.5;
            vec2 shift = vec2(100.0);
            mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
            for (int i = 0; i < 5; ++i) {
              v += a * noise(x);
              x = rot * x * 2.0 + shift;
              a *= 0.5;
            }
            return v;
          }

          vec3 hsv2rgb(vec3 c) {
            vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
          }

          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            p.x *= resolution.x / resolution.y;

            // Mouse interaction
            vec2 m = (mouse - 0.5) * 2.0;
            m.x *= resolution.x / resolution.y;
            float mouseDist = length(p - m);
            vec2 mouseForce = normalize(p - m) * exp(-mouseDist * 3.0) * 0.5 * (1.0 + energy);

            // Flow domain distortion
            vec2 q = vec2(0.);
            q.x = fbm(p + 0.00 * time);
            q.y = fbm(p + vec2(1.0));

            vec2 r = vec2(0.);
            r.x = fbm(p + 1.0 * q + vec2(1.7, 9.2) + 0.15 * time + mouseForce);
            r.y = fbm(p + 1.0 * q + vec2(8.3, 2.8) + 0.126 * time + mouseForce);

            float f = fbm(p + r * (2.0 + energy * 3.0));

            // Color palette
            float hue = baseHue + f * 0.2 + energy * 0.1;
            vec3 col = hsv2rgb(vec3(fract(hue), 0.7 - f * 0.2, f * 0.8 + 0.2));

            // Contrast & Vignette
            col = col * col * (3.0 - 2.0 * col);
            float vignette = 1.0 - smoothstep(0.5, 1.5, length(p));
            col *= vignette;

            gl_FragColor = vec4(col, 1.0);
          }
        `,
        transparent: true,
        depthWrite: false
      });

      this.mesh = new THREE.Mesh(geometry, this.material);
      this.group.add(this.mesh);
    }

    mount() {
      scene.add(this.group);
      renderer.domElement.style.opacity = '1';
    }

    unmount() {
      scene.remove(this.group);
      renderer.domElement.style.opacity = '0';
    }

    update(dt, state) {
      this.material.uniforms.time.value = state.time * 0.3; // Slower time for fluid
      this.material.uniforms.energy.value = state.energy + state.audioMid * 0.3;
      this.material.uniforms.baseHue.value = state.hue1 / 360;
      this.material.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
      
      // Pass mouse coordinates normalized [0, 1]
      this.material.uniforms.mouse.value.set(
        state.mouseX / window.innerWidth,
        1.0 - (state.mouseY / window.innerHeight) // Invert Y for shader
      );
    }
  }

  // ── Volumetric Clouds WebGL Mode ──
  class VolumetricCloudsMode {
    constructor() {
      this.group = new THREE.Group();
      
      const geometry = new THREE.PlaneGeometry(2, 2);
      
      this.material = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
          baseHue: { value: 0.6 },
          energy: { value: 0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          uniform vec2 resolution;
          uniform float baseHue;
          uniform float energy;
          varying vec2 vUv;

          // Simple 3D noise
          float hash(vec3 p) {
            p = fract(p * 0.3183099 + 0.1);
            p *= 17.0;
            return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
          }

          float noise(vec3 x) {
            vec3 i = floor(x);
            vec3 f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                           mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                           mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
          }

          float fbm(vec3 p) {
            float f = 0.0;
            f += 0.5000 * noise(p); p = p * 2.02;
            f += 0.2500 * noise(p); p = p * 2.03;
            f += 0.1250 * noise(p); p = p * 2.01;
            f += 0.0625 * noise(p);
            return f;
          }

          vec3 hsv2rgb(vec3 c) {
            vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
          }

          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            p.x *= resolution.x / resolution.y;

            vec3 ro = vec3(0.0, 0.0, -time * 2.0 * (1.0 + energy)); // Ray origin (camera moves forward)
            vec3 rd = normalize(vec3(p, -1.0)); // Ray direction

            float den = 0.0;
            float t = 0.0;
            for(int i = 0; i < 40; i++) {
              vec3 pos = ro + rd * t;
              float d = fbm(pos * 0.5) - 0.5;
              if(d > 0.0) {
                den += d * 0.1;
                if(den > 1.0) break;
              }
              t += 0.1 + d * 0.2;
            }

            vec3 skyCol = hsv2rgb(vec3(baseHue, 0.8, 0.3));
            vec3 cloudCol = hsv2rgb(vec3(fract(baseHue + 0.1), 0.4, 0.8 + energy * 0.2));
            
            vec3 col = mix(skyCol, cloudCol, min(den, 1.0));

            gl_FragColor = vec4(col, 1.0);
          }
        `,
        transparent: true,
        depthWrite: false
      });

      this.mesh = new THREE.Mesh(geometry, this.material);
      this.group.add(this.mesh);
    }

    mount() {
      scene.add(this.group);
      renderer.domElement.style.opacity = '1';
    }

    unmount() {
      scene.remove(this.group);
      renderer.domElement.style.opacity = '0';
    }

    update(dt, state) {
      this.material.uniforms.time.value = state.time;
      this.material.uniforms.energy.value = state.energy;
      this.material.uniforms.baseHue.value = state.hue1 / 360;
      this.material.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
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
    },
    {
      name: 'Gargantua Singularity',
      draw: (dt, isLight) => {
        const cx = width / 2;
        const cy = height / 2;
        const Rs = Math.min(width, height) * 0.088;

        // Draw grav-lensed stars
        stars.forEach(s => {
          const twinkle = Math.sin(state.time * s.twinkleSpeed + s.phase) * 0.45 + 0.55;
          const dx = s.x - cx;
          const dy = s.y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist > Rs) {
            const factor = 1 + (Rs * Rs) / (dist * dist);
            const lx = cx + dx * factor;
            const ly = cy + dy * factor;
            ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha * twinkle * 0.9})`;
            ctx.beginPath();
            ctx.arc(lx, ly, s.size, 0, Math.PI * 2);
            ctx.fill();
          }
        });

        // 1. Accretion disk behind the singularity (z < 0)
        singularityParticles.forEach(p => {
          p.update(dt);
          const sinA = Math.sin(p.angle);
          const z = sinA * p.radius;
          if (z < 0) {
            p.draw(cx, cy, Rs, isLight);
          }
        });

        // 2. The dark event horizon shadow
        ctx.beginPath();
        ctx.arc(cx, cy, Rs, 0, Math.PI * 2);
        ctx.fillStyle = '#010103';
        ctx.fill();

        // 3. Accretion disk in front of the singularity (z >= 0)
        singularityParticles.forEach(p => {
          const sinA = Math.sin(p.angle);
          const z = sinA * p.radius;
          if (z >= 0) {
            p.draw(cx, cy, Rs, isLight);
          }
        });

        // 4. Glowing Einstein / Photon Ring overlay
        ctx.beginPath();
        ctx.arc(cx, cy, Rs + 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(28, 85%, 60%, ${0.35 + state.audioAvg * 0.55})`;
        ctx.lineWidth = 2 + state.audioBass * 3;
        ctx.stroke();
      }
    },
    {
      name: 'Kinetic Clockwork',
      draw: (dt, isLight) => {
        const cx = width / 2;
        const cy = height / 2;
        
        // Connect planet gear centers with mechanical frames
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let i = 1; i <= 4; i++) {
          const g = gears[i];
          if (g) {
            ctx.lineTo(cx + g.xRel, cy + g.yRel);
            ctx.moveTo(cx, cy);
          }
        }
        ctx.strokeStyle = `hsla(${state.hue1}, 50%, 55%, ${isLight ? 0.12 : 0.08})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Update and draw gears
        gears.forEach(g => {
          g.update(dt, state.energy);
          g.draw(cx, cy, isLight);
        });

        // Draw an outer glowing ring surrounding the gears
        ctx.beginPath();
        ctx.arc(cx, cy, 180 + state.audioBass * 15, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${state.hue1}, 60%, 55%, 0.04)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },
    {
      name: 'Cosmic Anomaly',
      isWebGl: true,
      init: () => new CosmicAnomalyMode(),
      draw: (dt, isLight, instance) => {
        if (instance) {
          instance.update(dt, state);
        }
      }
    },
    {
      name: 'Liquid Fluid FX',
      isWebGl: true,
      init: () => new LiquidFluidMode(),
      draw: (dt, isLight, instance) => {
        if (instance) {
          instance.update(dt, state);
        }
      }
    },
    {
      name: 'Volumetric Clouds',
      isWebGl: true,
      init: () => new VolumetricCloudsMode(),
      draw: (dt, isLight, instance) => {
        if (instance) {
          instance.update(dt, state);
        }
      }
    }
  ];

  let webGlInstances = {};

  function handleModeSwitch(oldIndex, newIndex) {
    const oldMode = MODES[oldIndex];
    const newMode = MODES[newIndex];

    if (oldMode && oldMode.isWebGl && webGlInstances[oldIndex]) {
      webGlInstances[oldIndex].unmount();
      currentWebGlMode = null;
    }

    if (newMode && newMode.isWebGl) {
      if (!webGlInstances[newIndex] && newMode.init) {
        webGlInstances[newIndex] = newMode.init();
      }
      if (webGlInstances[newIndex]) {
        webGlInstances[newIndex].mount();
        currentWebGlMode = webGlInstances[newIndex];
      }
    }
  }

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
    const activeMode = MODES[modeIndex] || MODES[0];

    let bgAlpha = isLight ? 0.12 : 0.1;
    if (modeIndex === 2) bgAlpha = isLight ? 0.08 : 0.07; // cyber stream trail
    else if (modeIndex === 3) bgAlpha = isLight ? 0.1 : 0.08;  // aurora trail
    else if (modeIndex === 5) bgAlpha = isLight ? 0.08 : 0.06; // singularity gas trail
    else if (modeIndex === 6) bgAlpha = isLight ? 0.22 : 0.18; // clockwork sharp render
    
    // If WebGL is active, make the 2D canvas transparent so WebGL shows through
    if (activeMode.isWebGl) {
      ctx.clearRect(0, 0, width, height);
      if (renderer && scene && camera) {
        activeMode.draw(dt, isLight, currentWebGlMode);
        renderer.render(scene, camera);
      }
    } else {
      ctx.fillStyle = isLight ? `rgba(241, 245, 249, ${bgAlpha})` : `rgba(8, 8, 12, ${bgAlpha})`;
      ctx.fillRect(0, 0, width, height);
      activeMode.draw(dt, isLight);
    }


    // Update and draw event particles
    for (let i = eventParticles.length - 1; i >= 0; i--) {
      const ep = eventParticles[i];
      ep.update(dt);
      if (ep.life <= 0) {
        eventParticles.splice(i, 1);
      } else {
        ep.draw();
      }
    }

    // Screen flash overlay
    if (flashIntensity > 0) {
      ctx.fillStyle = `rgba(${flashColor}, ${flashIntensity})`;
      ctx.fillRect(0, 0, width, height);
      flashIntensity -= 0.02 * dt;
      if (flashIntensity < 0) flashIntensity = 0;
    }

    requestAnimationFrame(animate);
  }

  // ── Init ──
  // Make sure pools are initialized on resize
  const originalResize = resize;
  resize = function() {
    width = canvas2d.width = window.innerWidth;
    height = canvas2d.height = window.innerHeight;
    
    if (camera && renderer) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }
    
    initPools();
  };
  
  initThreeJs();
  resize();
  
  // Mount initial mode if it's WebGL
  const initialMode = MODES[state.currentModeIndex || 0];
  if (initialMode && initialMode.isWebGl) {
    if (!webGlInstances[state.currentModeIndex] && initialMode.init) {
      webGlInstances[state.currentModeIndex] = initialMode.init();
    }
    if (webGlInstances[state.currentModeIndex]) {
      webGlInstances[state.currentModeIndex].mount();
      currentWebGlMode = webGlInstances[state.currentModeIndex];
    }
  }

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
      const oldIndex = state.currentModeIndex;
      state.currentModeIndex = (state.currentModeIndex + 1) % MODES.length;
      handleModeSwitch(oldIndex, state.currentModeIndex);
      this.saveModePreference();
      this.applyModeColorShift();
      startAutoRotate();
      return MODES[state.currentModeIndex].name;
    },

    prevMode() {
      const oldIndex = state.currentModeIndex;
      state.currentModeIndex = (state.currentModeIndex - 1 + MODES.length) % MODES.length;
      handleModeSwitch(oldIndex, state.currentModeIndex);
      this.saveModePreference();
      this.applyModeColorShift();
      startAutoRotate();
      return MODES[state.currentModeIndex].name;
    },

    setMode(indexOrName) {
      const oldIndex = state.currentModeIndex;
      let newIndex = oldIndex;
      
      if (typeof indexOrName === 'number') {
        if (indexOrName >= 0 && indexOrName < MODES.length) {
          newIndex = indexOrName;
        }
      } else if (typeof indexOrName === 'string') {
        const idx = MODES.findIndex(m => m.name.toLowerCase() === indexOrName.toLowerCase());
        if (idx !== -1) {
          newIndex = idx;
        }
      }
      
      if (oldIndex !== newIndex) {
        state.currentModeIndex = newIndex;
        handleModeSwitch(oldIndex, newIndex);
        this.saveModePreference();
        this.applyModeColorShift();
        startAutoRotate();
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
        // Persist setting to server if authenticated
        if (window.Dashboard && window.Dashboard.csrfToken) {
          fetch('/api/settings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': window.Dashboard.csrfToken
            },
            body: JSON.stringify({ 'vibes-visualizer-mode': state.currentModeIndex })
          }).catch(err => console.warn('[Settings] Failed to save mode to server:', err));
        }
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
      else if (modeIdx === 5) this.setHue(22);  // Gargantua Singularity - gold/orange
      else if (modeIdx === 6) this.setHue(195); // Kinetic Clockwork - ocean/sky blue
      else if (modeIdx === 7) this.setHue(260); // Cosmic Anomaly - violet/pink
      else if (modeIdx === 8) this.setHue(320); // Liquid Fluid FX - magenta/blue
      else if (modeIdx === 9) this.setHue(200); // Volumetric Clouds - soft cyan/blue
    },

    triggerEvent(type, x, y) {
      const cx = x !== undefined ? x : width / 2;
      const cy = y !== undefined ? y : height / 2;

      if (type === 'agent-created') {
        flashIntensity = 0.22;
        flashColor = '168, 85, 247'; // purple
        const color = 'hsla(270, 85%, 65%, opacity)';
        for (let i = 0; i < 40; i++) {
          eventParticles.push(new EventParticle(cx, cy, color));
        }
      } else if (type === 'task-complete') {
        flashIntensity = 0.16;
        flashColor = '34, 197, 94'; // green
        const color = 'hsla(140, 85%, 55%, opacity)';
        for (let i = 0; i < 35; i++) {
          eventParticles.push(new EventParticle(cx, cy, color));
        }
      } else if (type === 'error') {
        flashIntensity = 0.26;
        flashColor = '239, 68, 68'; // red
        const color = 'hsla(15, 85%, 60%, opacity)';
        for (let i = 0; i < 45; i++) {
          eventParticles.push(new EventParticle(cx, cy, color));
        }
      } else if (type === 'terminate') {
        flashIntensity = 0.08;
        flashColor = '100, 116, 139'; // slate/gray
        const color = 'hsla(210, 40%, 50%, opacity)';
        for (let i = 0; i < 25; i++) {
          eventParticles.push(new EventParticle(cx, cy, color));
        }
      }
    },

    enableAutoRotation(enable) {
      autoRotateEnabled = !!enable;
      if (autoRotateEnabled) {
        startAutoRotate();
      } else {
        stopAutoRotate();
      }
    },

    isAutoRotationEnabled() {
      return autoRotateEnabled;
    }
  };

  // Start auto-rotation
  startAutoRotate();

  console.log('[Background] Multi-mode reactive background engine loaded');
})();
