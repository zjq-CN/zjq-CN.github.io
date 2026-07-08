/**
 * TouchInput — Virtual Joystick + Action Buttons for Echo Maze
 * Handles: devicePixelRatio, variable refresh rates, screen size variance
 */
class TouchInput {
  constructor(game) {
    this.game = game;
    this.active = false; // auto-detected
    this.detectTouch();

    // Joystick state
    this.joystickBase = document.getElementById('joystick-base');
    this.joystickThumb = document.getElementById('joystick-thumb');
    this.joystickZone = document.getElementById('joystick-zone');
    this.joystickActive = false;
    this.joystickId = null;
    this.joystickCenter = { x: 0, y: 0 };
    this.joystickRadius = 0;
    this.joystickVec = { x: 0, y: 0 }; // normalized -1..1

    // Action buttons
    this.actionButtons = document.querySelectorAll('.touch-btn[data-action]');
    this.itemButtons = document.querySelectorAll('.touch-item-btn[data-item]');
    this.activeTouches = new Map(); // touchId -> element

    // Timestamp tracking for refresh-rate-independent input
    this.lastFrameTime = performance.now();
    this.inputAccumulator = { x: 0, y: 0 };

    if (this.active) {
      this.init();
      this.show();
    } else {
      this.hide();
    }

    // Listen for resize to update joystick layout
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.onResize(), 300);
    });
  }

  detectTouch() {
    // Check for touch capability
    const hasTouch = ('ontouchstart' in window) ||
      (navigator.maxTouchPoints > 0) ||
      (navigator.msMaxTouchPoints > 0);
    // Also check hover capability — if no hover, likely touch device
    const hasHover = window.matchMedia('(hover: hover)').matches;
    this.active = hasTouch && !hasHover;
  }

  init() {
    // Prevent default browser behaviors on the game container
    const container = document.getElementById('game-container');
    const canvas = document.getElementById('game-canvas');
    [container, canvas, this.joystickZone].forEach(el => {
      if (!el) return;
      el.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
      el.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
      el.addEventListener('touchend', e => e.preventDefault(), { passive: false });
      el.addEventListener('touchcancel', e => e.preventDefault(), { passive: false });
      el.addEventListener('gesturestart', e => e.preventDefault());
      el.addEventListener('gesturechange', e => e.preventDefault());
      el.addEventListener('gestureend', e => e.preventDefault());
    });

    // Joystick events
    this.joystickZone.addEventListener('touchstart', e => this.onJoystickStart(e), { passive: false });
    this.joystickZone.addEventListener('touchmove', e => this.onJoystickMove(e), { passive: false });
    this.joystickZone.addEventListener('touchend', e => this.onJoystickEnd(e), { passive: false });
    this.joystickZone.addEventListener('touchcancel', e => this.onJoystickEnd(e), { passive: false });

    // Action button events
    this.actionButtons.forEach(btn => {
      btn.addEventListener('touchstart', e => this.onActionStart(e), { passive: false });
      btn.addEventListener('touchend', e => this.onActionEnd(e), { passive: false });
      btn.addEventListener('touchcancel', e => this.onActionEnd(e), { passive: false });
    });

    // Item button events
    this.itemButtons.forEach(btn => {
      btn.addEventListener('touchstart', e => this.onItemActivate(e), { passive: false });
    });

    // Pause button
    const pauseBtn = document.getElementById('touch-pause-btn');
    if (pauseBtn) {
      pauseBtn.addEventListener('touchstart', e => {
        e.preventDefault();
        this.game.onTouchPause();
      }, { passive: false });
    }

    // Menu touch handling on canvas
    this.canvasEl = document.getElementById('game-canvas');
    if (this.canvasEl) {
      this.canvasEl.addEventListener('touchstart', e => this.onCanvasTap(e), { passive: false });
    }

    this.onResize();
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const minDim = Math.min(w, h);
    const isLandscape = w > h;

    // ── JOYSTICK (bottom-left corner) ──
    const jsBase = isLandscape
      ? Math.max(55, Math.min(95, h * 0.18))
      : Math.max(65, Math.min(105, w * 0.17));
    this.joystickRadius = jsBase / 2;

    const zone = this.joystickZone;
    const zoneSize = jsBase * 2.8;
    zone.style.width = zoneSize + 'px';
    zone.style.height = zoneSize + 'px';
    zone.style.left = Math.max(8, w * 0.02) + 'px';
    // Always anchor to bottom-left
    zone.style.top = 'auto';
    zone.style.bottom = Math.max(10, h * 0.1) + 'px';
    zone.style.transform = '';

    this.joystickBase.style.width = (jsBase * 2) + 'px';
    this.joystickBase.style.height = (jsBase * 2) + 'px';

    const thumbSize = jsBase * 0.85;
    this.joystickThumb.style.width = thumbSize + 'px';
    this.joystickThumb.style.height = thumbSize + 'px';

    // ── ACTION BUTTONS (right side) ──
    const actScale = isLandscape ? h : w;
    const btnSize = Math.max(44, Math.min(64, actScale * 0.1));
    const btnGap = Math.max(4, Math.min(8, actScale * 0.01));
    this.actionButtons.forEach(btn => {
      btn.style.width = btnSize + 'px';
      btn.style.height = btnSize + 'px';
      btn.style.fontSize = Math.max(10, Math.round(btnSize * 0.22)) + 'px';
    });

    const actionContainer = document.getElementById('action-buttons');
    if (actionContainer) {
      actionContainer.style.gap = btnGap + 'px';
      actionContainer.style.right = Math.max(10, w * 0.03) + 'px';
      if (isLandscape) {
        actionContainer.style.top = 'auto';
        actionContainer.style.bottom = Math.max(10, h * 0.1) + 'px';
        actionContainer.style.transform = '';
      } else {
        actionContainer.style.top = '50%';
        actionContainer.style.bottom = 'auto';
        actionContainer.style.transform = 'translateY(-50%)';
      }
    }

    // ── ITEM BUTTONS (bottom center) ──
    const itemSize = Math.max(36, Math.min(50, minDim * 0.065));
    const itemGap = Math.max(3, Math.min(6, minDim * 0.008));
    this.itemButtons.forEach(btn => {
      btn.style.width = itemSize + 'px';
      btn.style.height = itemSize + 'px';
      btn.style.fontSize = Math.max(14, Math.round(itemSize * 0.38)) + 'px';
    });

    const itemContainer = document.getElementById('item-buttons');
    if (itemContainer) {
      itemContainer.style.flexDirection = 'row';
      itemContainer.style.gap = itemGap + 'px';
      itemContainer.style.bottom = Math.max(8, h * 0.02) + 'px';
      itemContainer.style.left = '50%';
      itemContainer.style.transform = 'translateX(-50%)';
      itemContainer.style.right = 'auto';
      itemContainer.style.top = 'auto';
    }

    // ── PAUSE BUTTON (top-left) ──
    const pauseBtn = document.getElementById('touch-pause-btn');
    if (pauseBtn) {
      const ps = Math.max(32, Math.min(44, minDim * 0.055));
      pauseBtn.style.width = ps + 'px';
      pauseBtn.style.height = ps + 'px';
      pauseBtn.style.fontSize = Math.max(14, Math.round(ps * 0.45)) + 'px';
      pauseBtn.style.top = Math.max(10, h * 0.015) + 'px';
      pauseBtn.style.left = Math.max(10, w * 0.025) + 'px';
    }
  }

  // --- Joystick ---
  onJoystickStart(e) {
    e.preventDefault();
    if (this.joystickActive) return;
    const touch = e.changedTouches[0];
    this.joystickId = touch.identifier;
    this.joystickActive = true;

    const rect = this.joystickBase.getBoundingClientRect();
    this.joystickCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
    this.joystickBase.classList.add('active');

    this.updateJoystick(touch.clientX, touch.clientY);
  }

  onJoystickMove(e) {
    e.preventDefault();
    if (!this.joystickActive) return;
    // Find the correct touch
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.joystickId) {
        this.updateJoystick(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
        return;
      }
    }
  }

  onJoystickEnd(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.joystickId) {
        this.joystickActive = false;
        this.joystickId = null;
        this.joystickVec = { x: 0, y: 0 };
        this.joystickBase.classList.remove('active');
        this.joystickThumb.style.transform = 'translate(-50%, -50%)';
        return;
      }
    }
  }

  updateJoystick(clientX, clientY) {
    const dx = clientX - this.joystickCenter.x;
    const dy = clientY - this.joystickCenter.y;
    const dist = Math.hypot(dx, dy);
    const maxDist = this.joystickRadius;

    let nx, ny;
    if (dist < 8) {
      // Dead zone
      nx = 0; ny = 0;
    } else if (dist > maxDist) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      nx = dx / maxDist;
      ny = dy / maxDist;
    }

    this.joystickVec = { x: nx, y: ny };

    // Move thumb visually
    const clampedDist = Math.min(dist, maxDist);
    const clampedDx = dist > 0 ? (clampedDist / dist) * dx : 0;
    const clampedDy = dist > 0 ? (clampedDist / dist) * dy : 0;
    this.joystickThumb.style.transform =
      `translate(calc(-50% + ${clampedDx}px), calc(-50% + ${clampedDy}px))`;
  }

  // --- Action Buttons ---
  onActionStart(e) {
    e.preventDefault();
    const touch = e.changedTouches[0];
    const btn = e.currentTarget;
    const action = btn.dataset.action;
    this.activeTouches.set(touch.identifier, { btn, action });
    btn.classList.add('pressed');
    this.applyAction(action, true);
  }

  onActionEnd(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const record = this.activeTouches.get(touch.identifier);
      if (record) {
        record.btn.classList.remove('pressed');
        this.applyAction(record.action, false);
        this.activeTouches.delete(touch.identifier);
      }
    }
  }

  applyAction(action, isDown) {
    if (!this.game || this.game.state !== 'PLAYING') return;
    // Map touch actions to keyboard equivalents
    if (isDown) {
      switch (action) {
        case 'ping':
          this.game.onTouchPing();
          break;
        case 'dash':
          this.game.onTouchDash();
          break;
        case 'shoot':
          this.game.onTouchShoot();
          break;
      }
    }
  }

  // --- Item Buttons ---
  onItemActivate(e) {
    e.preventDefault();
    const btn = e.currentTarget;
    const item = btn.dataset.item;
    if (this.game && this.game.state === 'PLAYING') {
      this.game.activateItem(item);
    }
  }

  // --- Canvas Tap (for menus) ---
  onCanvasTap(e) {
    e.preventDefault();
    const touch = e.changedTouches[0];
    const rect = this.canvasEl.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    // Simulate mouse click at position for menu interaction
    this.game.simulateTap(x, y);
  }

  // --- Frame update (called from game loop) ---
  update(deltaMs) {
    if (!this.active) return;
    // deltaMs is the frame delta in ms; normalize for variable refresh rates
    const normFactor = deltaMs / 16.6667; // normalize to 60fps

    // Accumulate joystick input across variable frame times
    this.inputAccumulator.x += this.joystickVec.x * normFactor;
    this.inputAccumulator.y += this.joystickVec.y * normFactor;

    // Apply to game keys
    const threshold = 0.15;
    this.game.keys['w'] = this.joystickVec.y < -threshold;
    this.game.keys['s'] = this.joystickVec.y > threshold;
    this.game.keys['a'] = this.joystickVec.x < -threshold;
    this.game.keys['d'] = this.joystickVec.x > threshold;
  }

  show() {
    const ctrl = document.getElementById('touch-controls');
    if (ctrl) ctrl.style.display = 'block';
  }

  hide() {
    const ctrl = document.getElementById('touch-controls');
    if (ctrl) ctrl.style.display = 'none';
  }

  // Update active item button states (called from game draw)
  updateItemButtonStates() {
    if (!this.game) return;
    this.itemButtons.forEach(btn => {
      const item = btn.dataset.item;
      const hasItem = this.game.inventory[item] >= 1;
      const isActive = this.game.inventory[item] === 2;
      btn.classList.toggle('has-item', hasItem);
      btn.classList.toggle('item-active', isActive);
    });
  }

  // Check if touch device and re-evaluate
  refresh() {
    this.detectTouch();
    if (this.active) {
      this.show();
      this.onResize();
    } else {
      this.hide();
    }
  }
}

// Expose globally for game.js to use
window.TouchInput = TouchInput;
