/* ═══════════════════════════════════════
   Animated Particle Background Engine
   Reactive to user actions & audio energy
   ═══════════════════════════════════════ */

(function () {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width, height;
  let particles = [];
  let hueShift = 0;
  let targetHue = 220;
  let energy = 0.3;
  let mouseX = 0, mouseY = 0;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // Particle class
  class Particle {
    constructor() {
      this.reset();
    }
    reset() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.size = Math.random() * 2 + 0.5;
      this.speedX = (Math.random() - 0.5) * 0.4;
      this.speedY = (Math.random() - 0.5) * 0.4;
      this.opacity = Math.random() * 0.4 + 0.1;
      this.life = Math.random() * 200 + 100;
      this.maxLife = this.life;
    }
    update() {
      this.x += this.speedX + (energy * 0.2);
      this.y += this.speedY;
      this.life--;

      // Mouse attraction
      const dx = mouseX - this.x;
      const dy = mouseY - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 200) {
        this.x += dx * 0.001;
        this.y += dy * 0.001;
      }

      if (this.life <= 0 || this.x < -10 || this.x > width + 10 || this.y < -10 || this.y > height + 10) {
        this.reset();
      }
    }
    draw() {
      const fade = Math.min(this.life / 30, 1);
      const h = (targetHue + hueShift) % 360;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * (1 + energy * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${h}, 80%, 65%, ${this.opacity * fade})`;
      ctx.fill();
    }
  }

  // Initialize particles
  const PARTICLE_COUNT = 120;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(new Particle());
  }

  // Connection lines
  function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100) {
          const h = (targetHue + hueShift) % 360;
          const alpha = (1 - dist / 100) * 0.08;
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

  // Animation loop
  function animate() {
    ctx.fillStyle = 'rgba(10, 10, 12, 0.15)';
    ctx.fillRect(0, 0, width, height);

    // Smooth hue transition
    hueShift += (0 - hueShift) * 0.02;

    particles.forEach(p => {
      p.update();
      p.draw();
    });

    drawConnections();
    requestAnimationFrame(animate);
  }
  animate();

  // Track mouse for particle attraction
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  // Public API for reactivity
  window.bgEffect = {
    setHue(h) { targetHue = h; },
    setEnergy(e) { energy = Math.max(0, Math.min(1, e)); },
    pulse() {
      hueShift = 40;
      energy = Math.min(energy + 0.3, 1);
      setTimeout(() => { energy = Math.max(energy - 0.3, 0.3); }, 600);
    }
  };
})();
