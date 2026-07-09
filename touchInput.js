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
      this.show(); // Show the parent container
      this.hideGameControls(); // But hide action buttons until game starts
    } else {
      this.hide();
    }
    // Menu navigation state
    this.menuSelectIdx = -1;
    this.menuSelectCooldown = 0;

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

    // Back button (menu navigation)
    const backBtn = document.getElementById('touch-back-btn');
    if (backBtn) {
      backBtn.addEventListener('touchstart', e => {
        e.preventDefault();
        this.game.onTouchBack();
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

    // ── BACK BUTTON (top-left, next to pause) ──
    const backBtn = document.getElementById('touch-back-btn');
    if (backBtn) {
      const bs = Math.max(32, Math.min(44, minDim * 0.055));
      backBtn.style.width = bs + 'px';
      backBtn.style.height = bs + 'px';
      backBtn.style.fontSize = Math.max(16, Math.round(bs * 0.5)) + 'px';
      backBtn.style.top = Math.max(10, h * 0.015) + 'px';
      // Position to the right of the pause button
      const pauseLeft = Math.max(10, w * 0.025);
      const pauseSize = Math.max(32, Math.min(44, minDim * 0.055));
      backBtn.style.left = (pauseLeft + pauseSize + 8) + 'px';
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
        // If in menu and an item was selected, trigger click
        const g = this.game;
        if (this.menuSelectIdx >= 0 && g.state !== 'PLAYING' && g.state !== 'MENU_PAUSE') {
          const rects = g.menuRects;
          if (rects && this.menuSelectIdx < rects.length) {
            const r = rects[this.menuSelectIdx].rect;
            g.mouse.x = r.x + r.w / 2;
            g.mouse.y = r.y + r.h / 2;
            // Fire mousedown at the rect position to activate the button
            if (rects[this.menuSelectIdx].action) rects[this.menuSelectIdx].action();
          }
        }
        this.menuSelectIdx = -1;
        this._menuNavActive = false;
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
    const normFactor = deltaMs / 16.6667;
    this.inputAccumulator.x += this.joystickVec.x * normFactor;
    this.inputAccumulator.y += this.joystickVec.y * normFactor;

    // Update visibility based on game state
    const state = this.game.state;
    const inPlay = state === 'PLAYING';
    if (inPlay) {
      this.showGameControls();
    } else {
      this.hideGameControls();
    }

    // Back button: show during menu navigation, hide during gameplay & pause
    const inMenu = !inPlay && state !== 'MENU_PAUSE';
    const backBtn = document.getElementById('touch-back-btn');
    if (backBtn) {
      backBtn.style.display = inMenu ? 'flex' : 'none';
    }

    // Menu navigation via joystick
    if (!inPlay && state !== 'MENU_PAUSE') {
      this.updateMenuNav();
      return; // Don't apply WASD in menu
    }

    // Apply to game keys (only during gameplay)
    const threshold = 0.15;
    this.game.keys['w'] = this.joystickVec.y < -threshold;
    this.game.keys['s'] = this.joystickVec.y > threshold;
    this.game.keys['a'] = this.joystickVec.x < -threshold;
    this.game.keys['d'] = this.joystickVec.x > threshold;
  }

  updateMenuNav() {
    const g = this.game;
    if (this.menuSelectCooldown > 0) { this.menuSelectCooldown--; return; }
    const rects = g.menuRects;
    if (!rects || rects.length === 0) return;

    const joyY = this.joystickVec.y;
    const threshold = 0.35;

    // Navigate on joystick Y movement
    if (Math.abs(joyY) > threshold && !this._menuNavActive) {
      this._menuNavActive = true;
      if (joyY < -threshold) {
        // Up → previous item
        this.menuSelectIdx = Math.max(0, (this.menuSelectIdx <= 0 ? rects.length : this.menuSelectIdx) - 1);
      } else if (joyY > threshold) {
        // Down → next item
        this.menuSelectIdx = Math.min(rects.length - 1, this.menuSelectIdx + 1);
      }
      // Move mouse to selected rect
      if (this.menuSelectIdx >= 0 && this.menuSelectIdx < rects.length) {
        const r = rects[this.menuSelectIdx].rect;
        g.mouse.x = r.x + r.w / 2;
        g.mouse.y = r.y + r.h / 2;
      }
    } else if (Math.abs(joyY) <= threshold) {
      this._menuNavActive = false;
    }
  }

  showJoystick() {
    const zone = this.joystickZone;
    if (zone) zone.style.display = 'flex';
  }

  showGameControls() {
    const act = document.getElementById('action-buttons');
    const items = document.getElementById('item-buttons');
    const pause = document.getElementById('touch-pause-btn');
    if (act) act.style.display = 'flex';
    if (items) items.style.display = 'flex';
    if (pause) pause.style.display = 'flex';
  }

  hideGameControls() {
    const act = document.getElementById('action-buttons');
    const items = document.getElementById('item-buttons');
    const pause = document.getElementById('touch-pause-btn');
    if (act) act.style.display = 'none';
    if (items) items.style.display = 'none';
    if (pause) pause.style.display = 'none';
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
      if (this.game.state === 'PLAYING') this.showGameControls();
      this.onResize();
    } else {
      this.hide();
    }
  }
}

// Expose globally for game.js to use
window.TouchInput = TouchInput;
