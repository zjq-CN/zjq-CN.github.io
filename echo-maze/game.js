// Base cell size — will be scaled based on screen size
const BASE_CELL_SIZE = 80;
const CHUNK_SIZE = 10;
const FPS = 60;
const BASE_WALL_THICKNESS = 8;

// Dynamic sizing — computed once at init
let CELL_SIZE = BASE_CELL_SIZE;
let WALL_THICKNESS = BASE_WALL_THICKNESS;
let UI_SCALE = 1.0;

const COLORS = {
  bg:       '#080c14',
  panel:    '#0d1220',
  accent:   '#58c4dd',
  accentDim:'#3a8fa8',
  text:     '#e0e6f0',
  textDim:  '#5a6070',
  title:    '#6cd4e8',
  player:   '#00e5ff',
  wall:     '#18202a',
  echo:     '#00ff96',
  goal:     '#ffd700',
  enemy:    '#ff3b4a',
  bullet:   '#ffff96',
  toggleOn: '#4fe34f',
  toggleBg: '#1a1f30',
  itemShield:  '#00bfff',
  itemScatter: '#ff8800',
  itemBoost:   '#ffdd00',
  itemTeleport:'#cc44ff',
  barBg:    '#111522',
  barBorder:'#1e2640',
};

// Difficulty config: used when brightMode=false and godMode=false
const DIFFICULTY_CONFIG = {
  EASY:  { label:'Easy',    enemySpeed:0.7, triggerDist:250, maxSpeed:2.7, fadeRate:0.995, pingRadius:1100, pingSpeed:15, pingCost:4,  dashCost:8,  dashCd:25, energyDrain:0.005, enemySpawn:[0,1], itemChance:0.8, powerupChance:0.5, killEnergy:25, dropChance:0.5 },
  NORMAL:{ label:'Normal',  enemySpeed:1.5, triggerDist:450, maxSpeed:2.1, fadeRate:0.99, pingRadius:700,  pingSpeed:14, pingCost:10, dashCost:16, dashCd:45, energyDrain:0.015, enemySpawn:[1,3], itemChance:0.5, powerupChance:0.3, killEnergy:12, dropChance:0.25 },
  HARD:  { label:'Hard',    enemySpeed:2.5, triggerDist:800, maxSpeed:2.0, fadeRate:0.985, pingRadius:450,  pingSpeed:12, pingCost:20, dashCost:22, dashCd:80, energyDrain:0.035, enemySpawn:[3,5], itemChance:0.2, powerupChance:0.1, killEnergy:5,  dropChance:0.15 },
};

const ITEM_DEFS = {
  shield:   { key:'1', label:'Shield',   color:'#00bfff', desc:'Block & kill enemy',  shape:'hex' },
  scatter:  { key:'2', label:'Scatter',  color:'#ff8800', desc:'Split bullets',      shape:'diamond' },
  boost:    { key:'3', label:'Boost',    color:'#ffdd00', desc:'Shift = +40% speed', shape:'tri' },
  teleport: { key:'4', label:'Teleport', color:'#cc44ff', desc:'Random warp',        shape:'star' },
};
const ITEM_KEYS = ['shield','scatter','boost','teleport'];

const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
function floorDiv(value, divisor) { return Math.floor(value / divisor); }

class SeededRandom {
  constructor(seed) { this.seed = seed | 0; }
  random() { this.seed = (this.seed * 1664525 + 1013904223) | 0; return ((this.seed >>> 0) / 0x100000000); }
  randInt(min, max) { return min + Math.floor(this.random() * (max - min + 1)); }
  choice(array) { return array[Math.floor(this.random() * array.length)]; }
}

class Chunk {
  constructor(cx, cy, difficulty, seed) {
    this.cx = cx; this.cy = cy; this.difficulty = difficulty;
    this.rng = new SeededRandom(seed); this.cells = {}; this.items = [];
    this.generate();
  }
  makeKey(x, y) { return `${x},${y}`; }
  powerupKey() { return `pw_${this.cx}_${this.cy}`; }
  generate() {
    for (let x = 0; x < CHUNK_SIZE; x++)
      for (let y = 0; y < CHUNK_SIZE; y++)
        this.cells[this.makeKey(x, y)] = { walls:[true,true,true,true], visited:false };
    const stack = [[0,0]];
    this.cells[this.makeKey(0,0)].visited = true;
    while (stack.length) {
      const [x,y] = stack[stack.length-1];
      const neighbors = [];
      DIRS.forEach((dir,idx) => {
        const nx=x+dir.dx, ny=y+dir.dy;
        if (nx>=0&&nx<CHUNK_SIZE&&ny>=0&&ny<CHUNK_SIZE&&!this.cells[this.makeKey(nx,ny)].visited)
          neighbors.push([idx,nx,ny]);
      });
      if (neighbors.length) {
        const [di,nx,ny] = this.rng.choice(neighbors);
        this.cells[this.makeKey(x,y)].walls[di]=false;
        this.cells[this.makeKey(nx,ny)].walls[(di+2)%4]=false;
        this.cells[this.makeKey(nx,ny)].visited=true;
        stack.push([nx,ny]);
      } else stack.pop();
    }
    const mid=Math.floor(CHUNK_SIZE/2);
    this.cells[this.makeKey(mid,0)].walls[0]=false;
    this.cells[this.makeKey(mid,CHUNK_SIZE-1)].walls[2]=false;
    this.cells[this.makeKey(0,mid)].walls[3]=false;
    this.cells[this.makeKey(CHUNK_SIZE-1,mid)].walls[1]=false;
    const config = DIFFICULTY_CONFIG[this.difficulty] || DIFFICULTY_CONFIG.EASY;
    if (this.rng.random() < config.itemChance)
      this.items.push({ pos:[this.rng.randInt(0,CHUNK_SIZE-1),this.rng.randInt(0,CHUNK_SIZE-1)], type:'energy' });
    // Powerup spawn
    if (this.rng.random() < (config.powerupChance||0.3)) {
      const t = this.rng.choice(ITEM_KEYS);
      this.items.push({ pos:[this.rng.randInt(0,CHUNK_SIZE-1),this.rng.randInt(0,CHUNK_SIZE-1)], type:t, powerup:true });
    }
  }
}

class Bullet {
  constructor(x, y, dx, dy, speedMult=12) {
    this.pos=[x,y]; this.vel=[dx*speedMult,dy*speedMult]; this.bounces=6; this.radius=4; this.damage=50; this.dead=false;
    this.scatterType = 0; // 0=normal, 1=split after timer, 2=split on wall
    this.scatterTimer = 15;
    this.isScatterChild = false;
  }
  update(game) {
    if (this.scatterType === 1) {
      this.scatterTimer--;
      if (this.scatterTimer <= 0) { this.dead = true; this.spawnScatter(game); return; }
    }
    this.pos[0]+=this.vel[0];
    if(this.checkWallCollision(game,true)){
      if (this.scatterType === 2 && !this.isScatterChild) { this.dead = true; this.spawnScatter(game); return; }
      this.vel[0]*=-1;this.bounces--;
    }
    this.pos[1]+=this.vel[1];
    if(this.checkWallCollision(game,false)){
      if (this.scatterType === 2 && !this.isScatterChild) { this.dead = true; this.spawnScatter(game); return; }
      this.vel[1]*=-1;this.bounces--;
    }
    if(this.bounces<0)this.dead=true;
  }
  spawnScatter(game) {
    const angles = [0,60,120,180,240,300];
    const speed = Math.hypot(this.vel[0], this.vel[1]) || 10;
    angles.forEach(a => {
      const rad = a * Math.PI / 180;
      const b = new Bullet(this.pos[0], this.pos[1], Math.cos(rad), Math.sin(rad), 1);
      b.vel = [Math.cos(rad)*speed*0.9, Math.sin(rad)*speed*0.9];
      b.isScatterChild = true;
      b.scatterType = 0;
      b.bounces = 3;
      game.bullets.push(b);
    });
  }
  checkWallCollision(game, isX) {
    const gx=floorDiv(this.pos[0],CELL_SIZE), gy=floorDiv(this.pos[1],CELL_SIZE);
    const lx=((gx%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE, ly=((gy%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    const chunk=game.getChunk(gx,gy), cell=chunk.cells[`${lx},${ly}`];
    if(!cell)return false;
    const cx=gx*CELL_SIZE, cy=gy*CELL_SIZE, p=this.radius;
    if(cell.walls[0]&&this.pos[1]<cy+p)return true;
    if(cell.walls[2]&&this.pos[1]>cy+CELL_SIZE-p)return true;
    if(cell.walls[3]&&this.pos[0]<cx+p)return true;
    if(cell.walls[1]&&this.pos[0]>cx+CELL_SIZE-p)return true;
    return false;
  }
}

class Enemy {
  constructor(x, y, diffConfig) {
    this.pos=[x,y]; this.speed=diffConfig.enemySpeed; this.triggerDist=diffConfig.triggerDist;
    this.hp=100; this.state='idle'; this.path=[]; this.pulseTimer=0; this.targetPos=null;
  }
  update(playerPos, game) {
    this.pulseTimer=(this.pulseTimer+1)%120;
    const dx=playerPos[0]-this.pos[0], dy=playerPos[1]-this.pos[1], dist=Math.hypot(dx,dy);
    if(dist<this.triggerDist){this.state='hunting';this.targetPos=[...playerPos];}
    if(this.state!=='hunting'){this.path=[];return;}
    if(!this.path.length||Math.random()<0.05)this.path=this.findPath(game,playerPos);
    if(this.path.length){
      const [tx,ty]=this.path[0];
      const txW=(tx+0.5)*CELL_SIZE, tyW=(ty+0.5)*CELL_SIZE;
      const dirx=txW-this.pos[0], diry=tyW-this.pos[1], d=Math.hypot(dirx,diry);
      if(d>this.speed){this.pos[0]+=(dirx/d)*this.speed;this.pos[1]+=(diry/d)*this.speed;}
      else{this.pos[0]=txW;this.pos[1]=tyW;this.path.shift();}
    }else if(dist>0){this.pos[0]+=(dx/dist)*this.speed;this.pos[1]+=(dy/dist)*this.speed;}
  }
  findPath(game, targetPos) {
    const sgx=floorDiv(this.pos[0],CELL_SIZE), sgy=floorDiv(this.pos[1],CELL_SIZE);
    const egx=floorDiv(targetPos[0],CELL_SIZE), egy=floorDiv(targetPos[1],CELL_SIZE);
    if(sgx===egx&&sgy===egy)return [];
    const queue=[{gx:sgx,gy:sgy,path:[]}], visited=new Set([`${sgx},${sgy}`]);
    for(let d=0;queue.length&&d<1000;d++){
      const c=queue.shift();
      if(c.gx===egx&&c.gy===egy)return c.path;
      const lx=((c.gx%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE, ly=((c.gy%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
      const chunk=game.getChunk(c.gx,c.gy), cell=chunk.cells[`${lx},${ly}`];
      if(!cell)continue;
      DIRS.forEach((dir,i)=>{if(!cell.walls[i]){const nx=c.gx+dir.dx,ny=c.gy+dir.dy,k=`${nx},${ny}`;if(!visited.has(k)){visited.add(k);queue.push({gx:nx,gy:ny,path:[...c.path,[nx,ny]]});}}});
    }
    return [];
  }
}

class AiPlayer {
  constructor() {
    this.decisionCooldown=0;
    this.aiController = null;
    this.useNewAI = false;
  }
  
  setNewAIController(controller) {
    this.aiController = controller;
    this.useNewAI = true;
  }
  
  decide(game) {
    if (this.useNewAI && this.aiController) {
      this.decisionCooldown = 0;
      return this.aiController.decide(game);
    }
    if(this.decisionCooldown>0){this.decisionCooldown--;return null;}
    this.decisionCooldown=5;
    if(game.enemies.length>0){
      const n=game.enemies.reduce((b,e)=>{const d=Math.hypot(e.pos[0]-game.playerPos[0],e.pos[1]-game.playerPos[1]);return d<b.dist?{dist:d,enemy:e}:b;},{dist:Infinity,enemy:null});
      if(n.dist<280&&game.shootCooldown<=0)return'shoot';
    }
    if(game.mode==='LEVEL'&&Math.random()<0.3)return'moveToGoal';
    if(game.energy>20&&Math.random()<0.07)return'ping';
    if(Math.random()<0.15)return['up','down','left','right'][Math.floor(Math.random()*4)];
    return ['up','down','left','right'][Math.floor(Math.random()*4)];
  }
  applyAction(game, action) {
    if (this.useNewAI && this.aiController) {
      this.aiController.applyAction(game, action);
      return;
    }
    const s=0.196;
    if(action==='up')game.playerVel[1]-=s;if(action==='down')game.playerVel[1]+=s;
    if(action==='left')game.playerVel[0]-=s;if(action==='right')game.playerVel[0]+=s;
    if(action==='ping'&&game.energy>=15){game.emitPing();game.energy-=15;}
    if(action==='shoot'&&game.shootCooldown<=0)game.shoot();
    if(action==='moveToGoal'){const dx=game.goalPos[0]-game.playerPos[0],dy=game.goalPos[1]-game.playerPos[1],l=Math.hypot(dx,dy)||1;game.playerVel[0]+=(dx/l)*0.25;game.playerVel[1]+=(dy/l)*0.25;}
  }
}

class EchoMaze {
  constructor() {
    this.canvas=document.getElementById('game-canvas');
    this.ctx=this.canvas.getContext('2d');
    this.devicePixelRatio = window.devicePixelRatio || 1;
    this.isTouchDevice = false;
    this.touchInput = null;
    // CSS-pixel dimensions (used for all drawing coordinates)
    this.cssWidth = window.innerWidth;
    this.cssHeight = window.innerHeight;

    // Detect touch
    if (('ontouchstart' in window) || (navigator.maxTouchPoints > 0)) {
      this.isTouchDevice = true;
    }

    this.resize();
    window.addEventListener('resize',()=>this.resize());

    // Initialize touch input system
    if (typeof TouchInput !== 'undefined') {
      this.touchInput = new TouchInput(this);
    }

    this.keys={};this.mouse={x:0,y:0,down:false};this.menuRects=[];
    this.menuParticles=[];this.menuButtonGlow=0;this.menuAnimating=true;
    this.menuTransition=null;
    this.state='MENU_MODE';
    this.mode='SURVIVAL';
    this.difficulty='NORMAL';
    this.brightMode=false;
    this.godMode=false;
    this.aiPlayer=new AiPlayer();
    // Initialize new AI controller (uses trained policy via llmInterface)
    if (typeof AIController !== 'undefined') {
      try {
        const aiController = new AIController();
        this.aiPlayer.setNewAIController(aiController);
        this.aiController = aiController;
        console.log('✓ AI Controller initialized');
      } catch(e) {
        console.log('⚠ AI Controller init failed:', e.message);
      }
    }
    this.message='';this.messageTimer=0;
    this.seed=Math.floor(Math.random()*1_000_000);
    // --- NEW: inventory & buffs ---
    // Training state
    this.trainingState='idle'; // idle | training | evaluating | done | error
    this.trainingProgress=0;
    this.trainingMessage='';
    this.trainingLogs=[];
    this.trainingEstimatedTime=0;
    this.trainingElapsedTime=0;
    this.trainingStartTime=0;
    this.trainingConfig={episodes:35, maxSteps:650, epochs:20};
    this.trainingServerReady=false;
    this.initTrainingServer();
    
    this.inventory = { shield:0, scatter:0, boost:0, teleport:0 };
    this.buffs = {
      shield:  { active:false, timer:0 },
      scatter: { active:false, shotsFired:0 },
      boost:   { active:false, timer:0 },
      teleport:{ active:false },
    };
    this.boosting = false; // shift held during boost
    this.groundItems = []; // enemy-drop items {pos:[x,y],type}
    this.pickupMessages = []; // [{text,timer}]
    // --- end NEW ---
    this.resetGame();
    this.bindEvents();
    requestAnimationFrame(t=>this.frame(t));
  }

  getConfig() { return DIFFICULTY_CONFIG[this.difficulty] || DIFFICULTY_CONFIG.NORMAL; }
  isBright() { return this.brightMode; }
  isGod() { return this.godMode; }

  transitionTo(newState) {
    if (this.menuTransition) return;
    this.menuTransition = { from: this.state, to: newState, timer: 18 };
  }

  // --- ITEM SYSTEM ---
  pickupItem(item, px, py) {
    const def = ITEM_DEFS[item.type];
    if (!def) return;
    this.inventory[item.type] = 1;
    this.pickupMessages.push({ text: `+${def.label.toUpperCase()}`, timer: 90, color: def.color });
  }
  activateItem(type) {
    if (this.inventory[type] !== 1) return;
    const def = ITEM_DEFS[type];
    if (!def) return;
    this.inventory[type] = 2; // active
    this.buffs[type].active = true;
    switch (type) {
      case 'shield':
        this.buffs.shield.timer = 180 + Math.floor(Math.random() * 121); // 3-5s
        break;
      case 'scatter':
        this.buffs.scatter.shotsFired = 0;
        break;
      case 'boost':
        this.buffs.boost.timer = 120; // 2s
        break;
      case 'teleport':
        this.doTeleport();
        break;
    }
    this.pickupMessages.push({ text: `${def.label} ACTIVATED!`, timer: 60, color: def.color });
  }
  deactivateItem(type) {
    this.inventory[type] = 0;
    this.buffs[type].active = false;
    this.buffs[type].timer = 0;
    this.buffs[type].shotsFired = 0;
  }
  doTeleport() {
    // Collect all walkable cells from loaded chunks
    const candidates = [];
    Object.keys(this.chunks).forEach(key => {
      const chunk = this.chunks[key];
      Object.keys(chunk.cells).forEach(ck => {
        const [lx, ly] = ck.split(',').map(Number);
        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wy = chunk.cy * CHUNK_SIZE + ly;
        const dist = Math.hypot(wx*CELL_SIZE - this.playerPos[0], wy*CELL_SIZE - this.playerPos[1]);
        if (dist > CELL_SIZE * 5) candidates.push([wx, wy]);
      });
    });
    if (candidates.length === 0) return;
    const [gx, gy] = candidates[Math.floor(Math.random() * candidates.length)];
    // Spawn particles at old pos
    for (let i = 0; i < 20; i++) {
      this.teleportParticles = this.teleportParticles || [];
      this.teleportParticles.push({
        x: this.playerPos[0], y: this.playerPos[1],
        vx: (Math.random()-0.5)*6, vy: (Math.random()-0.5)*6,
        life: 30, color: COLORS.itemTeleport
      });
    }
    this.playerPos = [gx * CELL_SIZE + CELL_SIZE/2, gy * CELL_SIZE + CELL_SIZE/2];
    // Free ping at new location
    this.emitPing(true); // free
    this.deactivateItem('teleport');
    // Particles at new pos
    for (let i = 0; i < 20; i++) {
      this.teleportParticles = this.teleportParticles || [];
      this.teleportParticles.push({
        x: this.playerPos[0], y: this.playerPos[1],
        vx: (Math.random()-0.5)*6, vy: (Math.random()-0.5)*6,
        life: 30, color: COLORS.itemTeleport
      });
    }
  }
  spawnItemDrop(x, y) {
    const cfg = this.getConfig();
    if (Math.random() < (cfg.dropChance || 0.25)) {
      const type = ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)];
      this.groundItems.push({ pos: [x, y], type: type });
    }
  }

  // --- MENU PARTICLES ---
  spawnMenuParticle() {
    const w=this.cssWidth,h=this.cssHeight,x=Math.random()*w,y=Math.random()*h;
    this.menuParticles.push({x,y,size:2+Math.random()*5,sx:(Math.random()-0.5)*1.6,sy:(Math.random()-0.5)*1.6,life:80+Math.floor(Math.random()*120),ml:100,color:['#00e5ff','#ff4081','#7c4dff','#00e676','#ffab00'][Math.floor(Math.random()*5)]});
  }
  updateMenuParticles() {
    if(!this.menuAnimating)return;
    const w=this.cssWidth,h=this.cssHeight;
    for(let i=this.menuParticles.length-1;i>=0;i--){
      const p=this.menuParticles[i];p.x+=p.sx;p.y+=p.sy;p.life--;
      if(p.x<0||p.x>w)p.sx*=-1;if(p.y<0||p.y>h)p.sy*=-1;
      if(p.life<=0)this.menuParticles.splice(i,1);
    }
    while(this.menuParticles.length<45)this.spawnMenuParticle();
  }
  resize(){
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = this.devicePixelRatio || 1;

    // Store CSS-pixel dimensions for all drawing
    this.cssWidth = w;
    this.cssHeight = h;

    // Set canvas backing store to match physical pixels
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';

    // Scale context so draw coordinates are in CSS pixels
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Compute dynamic CELL_SIZE based on smallest screen dimension
    const minDim = Math.min(w, h);
    if (this.isTouchDevice) {
      // On phones, make cells bigger for easier touch navigation
      CELL_SIZE = Math.max(BASE_CELL_SIZE * 0.7, Math.min(BASE_CELL_SIZE * 1.1, minDim / 12));
      WALL_THICKNESS = Math.max(5, CELL_SIZE * 0.1);
      UI_SCALE = Math.min(1.0, CELL_SIZE / BASE_CELL_SIZE);
    } else {
      // Desktop: keep cell size reasonable, never exceed base
      CELL_SIZE = Math.min(BASE_CELL_SIZE, Math.max(BASE_CELL_SIZE * 0.6, minDim / 16));
      WALL_THICKNESS = Math.max(5, CELL_SIZE * 0.1);
      UI_SCALE = Math.min(1.0, CELL_SIZE / BASE_CELL_SIZE);
    }
  }
  bindEvents(){
    window.addEventListener('keydown',e=>this.onKeyDown(e));
    window.addEventListener('keyup',e=>this.onKeyUp(e));
    this.canvas.addEventListener('mousemove',e=>this.onMouseMove(e));
    this.canvas.addEventListener('mousedown',e=>this.onMouseDown(e));
    // Help modal toggle
    const overlay = document.getElementById('help-overlay');
    const helpBtn = document.getElementById('help-btn');
    const helpClose = document.getElementById('help-close');
    if (helpBtn) helpBtn.addEventListener('click', () => overlay.classList.add('show'));
    if (helpClose) helpClose.addEventListener('click', () => overlay.classList.remove('show'));
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('show'); });
  }

  // ──── Touch Input Handlers (called by TouchInput) ────
  simulateTap(x, y) {
    // Used for menu interactions on touch devices
    this.mouse.x = x;
    this.mouse.y = y;
    // Check menu rects
    for (const item of this.menuRects) {
      if (item.rect && this.pointInRect(x, y, item.rect) && item.action) {
        item.action();
        // Haptic feedback if available
        if (navigator.vibrate) navigator.vibrate(15);
        return;
      }
    }
    // If no menu match and in playing state, handle pause overlay taps
    if (this.state === 'MENU_PAUSE') {
      // The drawPauseOverlay creates menuRects, so re-check matches
      // (handled by the loop above)
    }
  }

  onTouchPause() {
    if (this.menuTransition) return;
    if (this.state === 'PLAYING') {
      this.state = 'MENU_PAUSE';
    } else if (this.state === 'MENU_PAUSE') {
      this.state = 'PLAYING';
    }
    if (navigator.vibrate) navigator.vibrate(10);
  }

  onTouchPing() {
    if (this.state !== 'PLAYING') return;
    const cost = this.isGod() ? 0 : this.getConfig().pingCost;
    if (this.energy >= cost) {
      this.emitPing();
      if (!this.isGod()) this.energy -= cost;
      if (navigator.vibrate) navigator.vibrate(8);
    }
  }

  onTouchDash() {
    if (this.state !== 'PLAYING') return;
    const cost = this.isGod() ? 0 : this.getConfig().dashCost;
    if (this.dashCooldown <= 0 && this.energy >= cost) {
      this.dash(cost);
      if (navigator.vibrate) navigator.vibrate(25);
    }
  }

  onTouchShoot() {
    if (this.state !== 'PLAYING') return;
    if (this.shootCooldown <= 0) {
      this.shoot();
      if (navigator.vibrate) navigator.vibrate(12);
    }
  }
  onMouseMove(e){const r=this.canvas.getBoundingClientRect();this.mouse.x=e.clientX-r.left;this.mouse.y=e.clientY-r.top;}
  onMouseDown(e){
    const x=this.mouse.x,y=this.mouse.y;
    this.menuRects.forEach(item=>{if(item.rect&&this.pointInRect(x,y,item.rect)&&item.action)item.action();});
  }
  pointInRect(x,y,rect){return x>=rect.x&&x<=rect.x+rect.w&&y>=rect.y&&y<=rect.y+rect.h;}

  onKeyDown(event) {
    // Close help overlay first
    const overlay = document.getElementById('help-overlay');
    if (event.key === 'Escape' && overlay && overlay.classList.contains('show')) {
      overlay.classList.remove('show'); return;
    }
    // Block menu input during transition
    if (this.menuTransition) return;
    if(event.key==='Escape'){
      if(this.state==='MENU_OPTIONS')this.transitionTo('MENU_DIFFICULTY');
      else if(this.state==='MENU_DIFFICULTY')this.transitionTo('MENU_MODE');
      else if(this.state==='MENU_TRAIN')this.state='MENU_MODE';
      else if(this.state==='MENU_PAUSE'){this.state='PLAYING';}
      else if(this.state==='PLAYING'){this.state='MENU_PAUSE';}
    }

    // Main menu: pick mode
    if(this.state==='MENU_MODE'){
      if(event.key==='1'){this.mode='SURVIVAL';this.transitionTo('MENU_DIFFICULTY');}
      if(event.key==='2'){this.mode='LEVEL';this.transitionTo('MENU_DIFFICULTY');}
      if(event.key==='3'){
        this.mode='WATCH';this.difficulty='HARD';this.brightMode=false;this.godMode=false;this.state='PLAYING';this.resetGame();
        // Enable AI controller for Watch mode
        if(this.aiController){
          this.aiController.enabled=true;
          this.aiController.setUseLLM(false);
          this.aiController.initLLM().then(()=>{
            if(this.aiController.isLLMReady()){
              this.aiController.setUseLLM(true);
              console.log('✓ Watch AI using trained policy model');
            } else {
              console.log('⚠ Watch AI using rule-based fallback (train first!)');
            }
          });
        }
      }
      if(event.key.toLowerCase()==='t'){this.state='MENU_TRAIN';}
      if(event.key.toLowerCase()==='l')this.loadGame();
    }

    // Difficulty menu
    if(this.state==='MENU_DIFFICULTY'){
      if(event.key==='1'){this.difficulty='EASY';this.transitionTo('MENU_OPTIONS');}
      if(event.key==='2'){this.difficulty='NORMAL';this.transitionTo('MENU_OPTIONS');}
      if(event.key==='3'){this.difficulty='HARD';this.transitionTo('MENU_OPTIONS');}
    }

    // Toggles menu
    if(this.state==='MENU_OPTIONS'){
      if(event.key==='1')this.brightMode=!this.brightMode;
      if(event.key==='2')this.godMode=!this.godMode;
      if(event.key===' '||event.key==='Enter'){this.state='PLAYING';this.resetGame();}
    }

    // Playing
    if(this.state==='PLAYING'){
      // Item activation keys 1-4
      if(event.key==='1'){ this.activateItem('shield'); return; }
      if(event.key==='2'){ this.activateItem('scatter'); return; }
      if(event.key==='3'){ this.activateItem('boost'); return; }
      if(event.key==='4'){ this.activateItem('teleport'); return; }

      if(event.key===' '){event.preventDefault();const c=this.isGod()?0:this.getConfig().pingCost;if(this.energy>=c){this.emitPing();if(!this.isGod())this.energy-=c;}}
      // Shift: dash normally, or boost speed if boost active
      if(event.key==='Shift'){
        if (this.buffs.boost.active) {
          this.boosting = true;
        } else {
          const c=this.isGod()?0:this.getConfig().dashCost;
          if(this.dashCooldown<=0 && this.energy>=c) this.dash(c);
        }
      }
      if(event.key.toLowerCase()==='s')this.saveGame();
      if(event.key.toLowerCase()==='l')this.loadGame();
      if(event.key.toLowerCase()==='n'){if(this.shootCooldown<=0)this.shoot();}
      if(event.key.toLowerCase()==='r'&&(this.gameOver||this.won))this.state='MENU_MODE';
    }
    this.keys[event.key.toLowerCase()]=true;
    // Also track shift in keys for onKeyUp
    if (event.key === 'Shift') this.keys['shift'] = true;
  }
  onKeyUp(event){
    this.keys[event.key.toLowerCase()]=false;
    if (event.key === 'Shift') { this.keys['shift'] = false; this.boosting = false; }
  }

  resetGame(newSeed=true){
    if(newSeed)this.seed=Math.floor(Math.random()*1_000_000);
    this.chunks={};this.playerPos=[CELL_SIZE*1.5,CELL_SIZE*1.5];this.playerVel=[0,0];
    this.energy=100;this.score=0;this.dashCooldown=0;this.shootCooldown=0;
    this.visibility={};this.visibilityTimer={};this.pings=[];this.enemies=[];this.bullets=[];
    this.gameOver=false;this.won=false;this.lastMoveDir=[1,0];
    // Reset inventory & buffs
    this.inventory = { shield:0, scatter:0, boost:0, teleport:0 };
    this.buffs = { shield:{active:false,timer:0}, scatter:{active:false,shotsFired:0}, boost:{active:false,timer:0}, teleport:{active:false} };
    this.boosting = false;
    this.stuckFrames = 0;
    this.moveDelta = [0, 0];
    this.groundItems = [];
    this.teleportParticles = [];
    this.pickupMessages = [];
    if(this.mode==='LEVEL')this.goalPos=[this.randInt(15,25)*CELL_SIZE,this.randInt(15,25)*CELL_SIZE];
  }
  randInt(min,max){return Math.floor(Math.random()*(max-min+1))+min;}

  getChunk(gx,gy){
    const cx=floorDiv(gx,CHUNK_SIZE),cy=floorDiv(gy,CHUNK_SIZE),key=`${cx},${cy}`;
    if(!this.chunks[key]){
      const seed=this.seed+cx*1000+cy;
      this.chunks[key]=new Chunk(cx,cy,this.difficulty,seed);
      const sp=new SeededRandom(seed), cfg=this.getConfig();
      let cnt=sp.randInt(cfg.enemySpawn[0],cfg.enemySpawn[1]);
      const safeR=3,psgx=floorDiv(this.playerPos[0],CELL_SIZE),psgy=floorDiv(this.playerPos[1],CELL_SIZE);
      for(let cr=0,at=0;cr<cnt&&at<cnt*6;at++){
        const lx=sp.randInt(0,CHUNK_SIZE-1),ly=sp.randInt(0,CHUNK_SIZE-1);
        const wx=cx*CHUNK_SIZE+lx,wy=cy*CHUNK_SIZE+ly;
        if(Math.abs(wx-psgx)<=safeR&&Math.abs(wy-psgy)<=safeR)continue;
        this.enemies.push(new Enemy(wx*CELL_SIZE+CELL_SIZE/2,wy*CELL_SIZE+CELL_SIZE/2,cfg));cr++;
      }
    }
    return this.chunks[key];
  }

  checkCollision(pos, isDashing=false){
    const gx=floorDiv(pos[0],CELL_SIZE),gy=floorDiv(pos[1],CELL_SIZE);
    const lx=((gx%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE,ly=((gy%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    const chunk=this.getChunk(gx,gy),cell=chunk.cells[`${lx},${ly}`];
    if(!cell)return pos;
    const cx=gx*CELL_SIZE,cy=gy*CELL_SIZE,p=15,np=[pos[0],pos[1]];
    if(isDashing){if(cell.walls[0]&&pos[1]<cy)cell.walls[0]=false;if(cell.walls[2]&&pos[1]>cy+CELL_SIZE)cell.walls[2]=false;if(cell.walls[3]&&pos[0]<cx)cell.walls[3]=false;if(cell.walls[1]&&pos[0]>cx+CELL_SIZE)cell.walls[1]=false;return np;}
    if(cell.walls[0]&&pos[1]<cy+p)np[1]=cy+p;
    if(cell.walls[2]&&pos[1]>cy+CELL_SIZE-p)np[1]=cy+CELL_SIZE-p;
    if(cell.walls[3]&&pos[0]<cx+p)np[0]=cx+p;
    if(cell.walls[1]&&pos[0]>cx+CELL_SIZE-p)np[0]=cx+CELL_SIZE-p;
    return np;
  }

  saveGame(){
    const d={playerPos:this.playerPos,energy:this.energy,score:this.score,seed:this.seed,mode:this.mode,difficulty:this.difficulty,brightMode:this.brightMode,godMode:this.godMode,visibility:this.visibility,visibilityTimer:this.visibilityTimer,goalPos:this.goalPos||null,
      inventory:this.inventory, buffs:this.buffs, groundItems:this.groundItems};
    localStorage.setItem('echoMazeSave',JSON.stringify(d));this.showMessage('Game saved.');
  }
  loadGame(){
    const d=localStorage.getItem('echoMazeSave');
    if(!d){this.showMessage('No save found.');return;}
    try{
      const p=JSON.parse(d);this.mode=p.mode;this.difficulty=p.difficulty;this.brightMode=p.brightMode||false;this.godMode=p.godMode||false;
      this.resetGame(false);this.playerPos=p.playerPos;this.energy=p.energy;this.score=p.score;this.seed=p.seed;
      this.visibility=p.visibility||{};this.visibilityTimer=p.visibilityTimer||{};
      if(p.goalPos)this.goalPos=p.goalPos;
      if(p.inventory)this.inventory=p.inventory;
      if(p.buffs)Object.assign(this.buffs, p.buffs);
      if(p.groundItems)this.groundItems=p.groundItems;
      this.state='PLAYING';this.showMessage('Game loaded.');
    }catch(e){this.showMessage('Unable to load save.');}
  }
  showMessage(text){this.message=text;this.messageTimer=120;}

  // ──── Training Methods ────
  async initTrainingServer() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const resp = await fetch('http://127.0.0.1:9999/health', { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        this.trainingServerReady = true;
        console.log('✓ Training server ready at :9999');
      }
    } catch (e) {
      console.log('⚠ Training server not running (will start on demand)');
      this.trainingServerReady = false;
    }
  }

  async startTraining() {
    this.trainingState = 'training';
    this.trainingProgress = 0;
    this.trainingMessage = '';
    this.trainingLogs = [];
    this.trainingStartTime = performance.now() / 1000;
    this.trainingEstimatedTime = 900; // 15 minutes

    const config = {
      episodes: this.trainingConfig.episodes,
      maxSteps: this.trainingConfig.maxSteps,
      epochs: this.trainingConfig.epochs
    };

    try {
      const response = await fetch('http://127.0.0.1:9999/start-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!response.ok) {
        this.trainingState = 'error';
        this.trainingMessage = 'Failed to start training';
        return;
      }
      const result = await response.json();
      if (result.estimatedSeconds) this.trainingEstimatedTime = result.estimatedSeconds;
      this.pollTrainingProgress();
    } catch (e) {
      this.trainingState = 'error';
      this.trainingMessage = `Connection error: ${e.message}`;
    }
  }

  async pollTrainingProgress() {
    if (this.trainingState !== 'training' && this.trainingState !== 'evaluating') return;
    try {
      const response = await fetch('http://127.0.0.1:9999/training-status');
      const status = await response.json();
      this.trainingProgress = status.progress || 0;
      this.trainingState = status.state || this.trainingState;
      this.trainingMessage = status.message || '';
      if (status.logs && status.logs.length > 0) {
        this.trainingLogs = status.logs.slice(-5);
      }
      this.trainingElapsedTime = (performance.now() / 1000) - this.trainingStartTime;
      if (this.trainingState === 'done') {
        console.log('✓ Training completed!');
        this.trainingMessage = 'Model trained and integrated successfully!';
      } else if (this.trainingState === 'error') {
        console.error('✗ Training failed');
      } else {
        setTimeout(() => this.pollTrainingProgress(), 500);
      }
    } catch (e) {
      console.error('Poll error:', e);
      setTimeout(() => this.pollTrainingProgress(), 1000);
    }
  }

  emitPing(free=false){
    const cfg=this.getConfig();
    const r=this.isBright()||this.isGod()?1200:cfg.pingRadius;
    const s=this.isBright()||this.isGod()?20:cfg.pingSpeed;
    this.pings.push({pos:[...this.playerPos],radius:0,maxRadius:r,speed:s});
    if (free) return;
  }
  shoot(){
    let speedMult = 8;
    const cfg=this.getConfig();
    if (cfg.enemySpeed>1.6) speedMult=6;

    let scatterType = 0;
    if (this.buffs.scatter.active) {
      if (this.buffs.scatter.shotsFired < 2) {
        scatterType = 1; // split after timer
      } else if (this.buffs.scatter.shotsFired === 2) {
        scatterType = 2; // split on wall
      }
      this.buffs.scatter.shotsFired++;
      if (this.buffs.scatter.shotsFired >= 3) {
        this.deactivateItem('scatter');
      }
    }

    const b = new Bullet(this.playerPos[0],this.playerPos[1],this.lastMoveDir[0],this.lastMoveDir[1],speedMult);
    b.scatterType = scatterType;
    if (scatterType === 1) b.scatterTimer = 15;
    this.bullets.push(b);
    this.shootCooldown=12;
  }
  dash(cost){
    this.energy-=cost;const cfg=this.getConfig();this.dashCooldown=this.isGod()||this.difficulty==='EASY'?40:cfg.dashCd;
    const dist=80;
    if(this.keys['w'])this.playerPos[1]-=dist;else if(this.keys['s'])this.playerPos[1]+=dist;
    else if(this.keys['a'])this.playerPos[0]-=dist;else if(this.keys['d'])this.playerPos[0]+=dist;
    this.playerPos=this.checkCollision(this.playerPos,true);
  }
  handleAiLogic(){const a=this.aiPlayer.decide(this);if(a)this.aiPlayer.applyAction(this,a);}

  update(){
    if(this.state!=='PLAYING')return;
    if(this.gameOver||this.won){
      if(this.mode==='WATCH'&&!this.restartTimer)this.restartTimer=performance.now();
      if(this.mode==='WATCH'&&this.restartTimer&&performance.now()-this.restartTimer>1500){this.restartTimer=null;this.resetGame();this.gameOver=false;this.won=false;}
      return;
    }
    if(this.mode==='WATCH')this.handleAiLogic();
    const cfg=this.getConfig();
    if(this.dashCooldown>0)this.dashCooldown--;if(this.shootCooldown>0)this.shootCooldown--;
    const accel=0.196,fric=0.86;
    let ax=0,ay=0;
    if(this.keys['w'])ay-=accel;if(this.keys['s'])ay+=accel;
    if(this.keys['a'])ax-=accel;if(this.keys['d'])ax+=accel;
    this.playerVel[0]+=ax;this.playerVel[1]+=ay;
    if(ax===0)this.playerVel[0]*=fric;if(ay===0)this.playerVel[1]*=fric;
    let ms=cfg.maxSpeed;
    // Boost: +40% max speed when shift held and boost active
    if (this.boosting && this.buffs.boost.active) ms *= 1.4;
    this.effectiveMaxSpeed = ms;
    this.lastAccel = [ax, ay];
    const spd=Math.hypot(this.playerVel[0],this.playerVel[1]);
    if(spd>ms){this.playerVel[0]=(this.playerVel[0]/spd)*ms;this.playerVel[1]=(this.playerVel[1]/spd)*ms;}
    this.moveDelta = [0, 0];
    if(Math.abs(this.playerVel[0])>0.1||Math.abs(this.playerVel[1])>0.1){
      const prevPx = this.playerPos[0], prevPy = this.playerPos[1];
      const n=Math.hypot(this.playerVel[0],this.playerVel[1]);
      if(n>0)this.lastMoveDir=[this.playerVel[0]/n,this.playerVel[1]/n];
      this.playerPos[0]+=this.playerVel[0];this.playerPos=this.checkCollision(this.playerPos);
      this.playerPos[1]+=this.playerVel[1];this.playerPos=this.checkCollision(this.playerPos);
      this.moveDelta = [this.playerPos[0] - prevPx, this.playerPos[1] - prevPy];
      // Boost: half energy drain
      const drainMult = (this.boosting && this.buffs.boost.active) ? 0.5 : 1;
      if(!this.isGod())this.energy-=cfg.energyDrain*drainMult;
    }
    // Stuck detection: wall-hugging → screen shake
    const actualSpeed = this.moveDelta ? Math.hypot(this.moveDelta[0], this.moveDelta[1]) : 0;
    const hasInput = this.keys['w'] || this.keys['s'] || this.keys['a'] || this.keys['d'];
    if (hasInput && actualSpeed < 0.3) {
      this.stuckFrames = (this.stuckFrames || 0) + 1;
    } else {
      this.stuckFrames = 0;
    }
    this.pings.slice().forEach(p=>{p.radius+=p.speed;if(p.radius>p.maxRadius){const i=this.pings.indexOf(p);if(i>=0)this.pings.splice(i,1);}else this.revealArea(p.pos,p.radius);});
    if(!this.isBright()){
      const fade=cfg.fadeRate;
      Object.keys(this.visibility).forEach(k=>{if((this.visibilityTimer[k]||0)>0)this.visibilityTimer[k]--;else{this.visibility[k]*=fade;if(this.visibility[k]<0.01){delete this.visibility[k];delete this.visibilityTimer[k];}}});
    }else{
      const cx=floorDiv(this.playerPos[0],CELL_SIZE),cy=floorDiv(this.playerPos[1],CELL_SIZE);
      for(let ox=-15;ox<15;ox++)for(let oy=-15;oy<15;oy++)this.visibility[`${cx+ox},${cy+oy}`]=1.0;
    }
    this.bullets.slice().forEach(b=>{b.update(this);if(b.dead){const i=this.bullets.indexOf(b);if(i>=0)this.bullets.splice(i,1);return;}
      this.enemies.slice().forEach(e=>{
        if(Math.hypot(b.pos[0]-e.pos[0],b.pos[1]-e.pos[1])<20){
          e.hp-=b.damage;b.dead=true;
          if(e.hp<=0){
            const ex=e.pos[0], ey=e.pos[1];
            const idx=this.enemies.indexOf(e);
            if(idx>=0)this.enemies.splice(idx,1);
            this.score+=100;this.energy=Math.min(100,this.energy+cfg.killEnergy);
            this.spawnItemDrop(ex, ey);
          }
        }
      });
    });
    // Enemy collision — check shield
    this.enemies.forEach(e=>{
      e.update(this.playerPos,this);
      if(Math.hypot(e.pos[0]-this.playerPos[0],e.pos[1]-this.playerPos[1])<28) {
        if (this.buffs.shield.active) {
          // Shield: kill enemy, deactivate shield
          const idx=this.enemies.indexOf(e);
          if(idx>=0)this.enemies.splice(idx,1);
          this.score+=100;this.energy=Math.min(100,this.energy+cfg.killEnergy);
          this.deactivateItem('shield');
        } else {
          this.gameOver=true;
        }
      }
    });
    // Item pickups from chunks
    const gx=floorDiv(this.playerPos[0],CELL_SIZE),gy=floorDiv(this.playerPos[1],CELL_SIZE),chunk=this.getChunk(gx,gy);
    chunk.items.slice().forEach(item=>{
      const ix=(floorDiv(gx,CHUNK_SIZE)*CHUNK_SIZE+item.pos[0])*CELL_SIZE+CELL_SIZE/2;
      const iy=(floorDiv(gy,CHUNK_SIZE)*CHUNK_SIZE+item.pos[1])*CELL_SIZE+CELL_SIZE/2;
      if(Math.hypot(ix-this.playerPos[0],iy-this.playerPos[1])<30){
        if (item.type==='energy') {
          this.energy=Math.min(100,this.energy+40);this.score+=20;
        } else if (ITEM_DEFS[item.type]) {
          if (this.inventory[item.type] === 0) this.pickupItem(item, ix, iy);
        }
        const idx=chunk.items.indexOf(item);
        if(idx>=0)chunk.items.splice(idx,1);
      }
    });
    // Ground items pickup (enemy drops)
    for (let i=this.groundItems.length-1; i>=0; i--) {
      const gi = this.groundItems[i];
      if (Math.hypot(gi.pos[0]-this.playerPos[0], gi.pos[1]-this.playerPos[1]) < 30) {
        if (ITEM_DEFS[gi.type] && this.inventory[gi.type] === 0) {
          this.pickupItem(gi, gi.pos[0], gi.pos[1]);
        }
        this.groundItems.splice(i,1);
      }
    }
    if(this.mode==='LEVEL'&&Math.hypot(this.goalPos[0]-this.playerPos[0],this.goalPos[1]-this.playerPos[1])<30)this.won=true;
    if(this.energy<=0)this.gameOver=true;

    // --- Buff timers ---
    if (this.buffs.shield.active) {
      this.buffs.shield.timer--;
      if (this.buffs.shield.timer <= 0) this.deactivateItem('shield');
    }
    if (this.buffs.boost.active) {
      this.buffs.boost.timer--;
      if (this.buffs.boost.timer <= 0) this.deactivateItem('boost');
    }
    // Teleport particles
    if (this.teleportParticles) {
      for (let i=this.teleportParticles.length-1; i>=0; i--) {
        const tp = this.teleportParticles[i];
        tp.x += tp.vx; tp.y += tp.vy; tp.life--;
        if (tp.life <= 0) this.teleportParticles.splice(i,1);
      }
    }
    // Pickup messages
    for (let i=this.pickupMessages.length-1; i>=0; i--) {
      this.pickupMessages[i].timer--;
      if (this.pickupMessages[i].timer <= 0) this.pickupMessages.splice(i,1);
    }
  }
  revealArea(pos,radius){for(let i=0;i<100;i++){const a=(i/100)*Math.PI*2,rx=pos[0]+Math.cos(a)*radius,ry=pos[1]+Math.sin(a)*radius,gx=floorDiv(rx,CELL_SIZE),gy=floorDiv(ry,CELL_SIZE);this.visibility[`${gx},${gy}`]=1.0;this.visibilityTimer[`${gx},${gy}`]=60;}}

  draw() {
    const ctx=this.ctx,w=this.cssWidth,h=this.cssHeight;ctx.clearRect(0,0,w,h);
    if(this.state!=='PLAYING'&&this.state!=='MENU_PAUSE'){this.drawMenu();return;}
    // Draw game (frozen during pause)
    ctx.fillStyle=COLORS.bg;ctx.fillRect(0,0,w,h);
    let shakeX = 0, shakeY = 0;
    if (this.stuckFrames > 30) {
      const intensity = Math.min((this.stuckFrames - 30) / 45, 1) * 5;
      shakeX = (Math.random() - 0.5) * intensity * 2;
      shakeY = (Math.random() - 0.5) * intensity * 2;
    }
    const camX = w / 2, camY = h / 2;
    const ox=camX-this.playerPos[0] + shakeX, oy=camY-this.playerPos[1] + shakeY;
    const sGx=floorDiv(this.playerPos[0]-camX,CELL_SIZE)-1,eGx=floorDiv(this.playerPos[0]+(w-camX),CELL_SIZE)+1;
    const sGy=floorDiv(this.playerPos[1]-camY,CELL_SIZE)-1,eGy=floorDiv(this.playerPos[1]+(h-camY),CELL_SIZE)+1;
    for(let gx=sGx;gx<=eGx;gx++)for(let gy=sGy;gy<=eGy;gy++){
      const vis=this.visibility[`${gx},${gy}`]||0;
      if(vis>0){
        const chunk=this.getChunk(gx,gy),lx=((gx%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE,ly=((gy%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE,cell=chunk.cells[`${lx},${ly}`];
        if(!cell)continue;
        const x=gx*CELL_SIZE+ox,y=gy*CELL_SIZE+oy,wc=`rgba(${Math.floor(40*vis)},${Math.floor(45*vis)},${Math.floor(60*vis)},1)`;
        if(cell.walls[0]){ctx.fillStyle=wc;ctx.fillRect(x,y-WALL_THICKNESS/2,CELL_SIZE,WALL_THICKNESS);}
        if(cell.walls[1]){ctx.fillStyle=wc;ctx.fillRect(x+CELL_SIZE-WALL_THICKNESS/2,y,WALL_THICKNESS,CELL_SIZE);}
        if(cell.walls[2]){ctx.fillStyle=wc;ctx.fillRect(x,y+CELL_SIZE-WALL_THICKNESS/2,CELL_SIZE,WALL_THICKNESS);}
        if(cell.walls[3]){ctx.fillStyle=wc;ctx.fillRect(x-WALL_THICKNESS/2,y,WALL_THICKNESS,CELL_SIZE);}
        // Draw chunk items (energy + powerups)
        chunk.items.forEach(item=>{
          if(item.pos[0]===lx&&item.pos[1]===ly){
            if (item.type==='energy') {
              ctx.fillStyle=COLORS.goal;ctx.beginPath();ctx.arc(x+CELL_SIZE/2,y+CELL_SIZE/2,6,0,Math.PI*2);ctx.fill();
            } else if (ITEM_DEFS[item.type]) {
              this.drawItemShape(ctx, x+CELL_SIZE/2, y+CELL_SIZE/2, ITEM_DEFS[item.type]);
            }
          }
        });
      }
    }
    // Draw ground items (enemy drops)
    this.groundItems.forEach(gi => {
      const gix = floorDiv(gi.pos[0], CELL_SIZE), giy = floorDiv(gi.pos[1], CELL_SIZE);
      if ((this.visibility[`${gix},${giy}`]||0) > 0.1 && ITEM_DEFS[gi.type]) {
        const sx = gi.pos[0] + ox, sy = gi.pos[1] + oy;
        const pulse = 1 + Math.sin(performance.now()/300) * 0.2;
        ctx.save(); ctx.translate(sx, sy); ctx.scale(pulse, pulse);
        this.drawItemShape(ctx, 0, 0, ITEM_DEFS[gi.type]);
        ctx.restore();
      }
    });
    if(this.mode==='LEVEL'){ctx.strokeStyle=COLORS.goal;ctx.lineWidth=3;ctx.beginPath();ctx.arc(this.goalPos[0]+ox,this.goalPos[1]+oy,15,0,Math.PI*2);ctx.stroke();}
    this.enemies.forEach(e=>{const egx=floorDiv(e.pos[0],CELL_SIZE),egy=floorDiv(e.pos[1],CELL_SIZE);if((this.visibility[`${egx},${egy}`]||0)>0.1){const ex=e.pos[0]+ox,ey=e.pos[1]+oy;ctx.fillStyle=COLORS.enemy;ctx.beginPath();ctx.arc(ex,ey,16,0,Math.PI*2);ctx.fill();ctx.fillStyle='#500000';ctx.fillRect(ex-15,ey-25,30,4);ctx.fillStyle='#ff0000';ctx.fillRect(ex-15,ey-25,30*(e.hp/100),4);}});
    this.bullets.forEach(b=>{const bx=b.pos[0]+ox,by=b.pos[1]+oy;ctx.fillStyle=b.scatterType>0||b.isScatterChild?COLORS.itemScatter:COLORS.bullet;ctx.beginPath();ctx.arc(bx,by,b.radius,0,Math.PI*2);ctx.fill();});
    // Shield glow around player
    if (this.buffs.shield.active) {
      const alpha = 0.3 + Math.sin(performance.now()/150) * 0.15;
      ctx.strokeStyle = `rgba(0,191,255,${alpha})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(camX, camY, 22, 0, Math.PI*2); ctx.stroke();
      ctx.strokeStyle = `rgba(0,191,255,${alpha*0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(camX, camY, 30, 0, Math.PI*2); ctx.stroke();
    }
    // Boost trail
    if (this.boosting && this.buffs.boost.active) {
      const t = performance.now() / 100;
      for (let i=0; i<3; i++) {
        const tx = camX + Math.sin(t*8+i)*4, ty = camY + Math.cos(t*8+i)*4;
        ctx.fillStyle = `rgba(255,221,0,${0.6-i*0.15})`;
        ctx.beginPath(); ctx.arc(tx, ty, 3+i, 0, Math.PI*2); ctx.fill();
      }
    }
    ctx.fillStyle=COLORS.player;ctx.beginPath();ctx.arc(camX,camY,10*UI_SCALE,0,Math.PI*2);ctx.fill();
    this.drawPlayerIndicator(camX, camY, w, h);
    this.pings.forEach(p=>{const a=1-p.radius/p.maxRadius;if(a>0){ctx.strokeStyle=`rgba(0,255,150,${a})`;ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.pos[0]+ox,p.pos[1]+oy,p.radius,0,Math.PI*2);ctx.stroke();}});
    // Teleport particles
    if (this.teleportParticles) {
      this.teleportParticles.forEach(tp => {
        const tx = tp.x + ox, ty = tp.y + oy;
        ctx.fillStyle = tp.color;
        ctx.globalAlpha = tp.life / 30;
        ctx.beginPath(); ctx.arc(tx, ty, 3, 0, Math.PI*2); ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    const uiL=70 * UI_SCALE;ctx.fillStyle='#222';ctx.fillRect(uiL,30,220 * UI_SCALE,10);
    if(this.energy>0){ctx.fillStyle=this.energy>30?COLORS.player:COLORS.enemy;ctx.fillRect(uiL,30,220*UI_SCALE*(this.energy/100),10);}
    ctx.fillStyle=COLORS.text;ctx.font=`${Math.round(14*UI_SCALE)}px system-ui,sans-serif`;ctx.textAlign='left';
    ctx.fillText(`SCORE: ${this.score}`,uiL,70);
    ctx.fillText(`MODE: ${this.mode}`,uiL,100);
    ctx.fillText(`DIFFICULTY: ${this.difficulty}${this.isBright()?' +BRIGHT':''}${this.isGod()?' +GOD':''}`,uiL,124);
    // Draw inventory bar
    this.drawInventory();
    // Pickup messages
    this.pickupMessages.forEach((pm, i) => {
      const alpha = pm.timer / 90;
      ctx.fillStyle = pm.color;
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${Math.round(16*UI_SCALE)}px system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(pm.text, w/2, 160 + i*22*UI_SCALE);
    });
    ctx.globalAlpha = 1;
    if(this.mode==='LEVEL'&&!this.gameOver&&!this.won)this.drawEdgeGoalArrow(w,h);
    if(this.gameOver||this.won){
      ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(0,0,w,h);
      ctx.fillStyle=this.won?COLORS.goal:COLORS.enemy;ctx.font=`bold ${Math.round(52*UI_SCALE)}px system-ui,sans-serif`;
      const msg=this.won?'YOU WON!':'GAME OVER',tw=ctx.measureText(msg).width;
      ctx.fillText(msg,w/2-tw/2,h/2-10);
      ctx.fillStyle=COLORS.text;ctx.font=`${Math.round(18*UI_SCALE)}px system-ui,sans-serif`;const ht='Press R to return to menu',hw=ctx.measureText(ht).width;ctx.fillText(ht,w/2-hw/2,h/2+30);
    }
    if(this.messageTimer>0){this.messageTimer--;ctx.fillStyle='rgba(0,0,0,0.65)';ctx.fillRect(w/2-170+10,20,340,36);ctx.fillStyle=COLORS.text;ctx.font=`${Math.round(15*UI_SCALE)}px system-ui,sans-serif`;ctx.textAlign='center';ctx.fillText(this.message,w/2+10,44);}

    // Pause overlay
    if(this.state==='MENU_PAUSE'){this.drawPauseOverlay(w,h);}
  }

  // --- DRAWING HELPERS ---
  drawItemShape(ctx, cx, cy, def) {
    const r = 8 * UI_SCALE;
    ctx.fillStyle = def.color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * UI_SCALE;
    ctx.beginPath();
    switch (def.shape) {
      case 'hex':
        for (let i=0; i<6; i++) { const a=Math.PI/6+i*Math.PI/3; const fn=i===0?'moveTo':'lineTo'; ctx[fn](cx+Math.cos(a)*r, cy+Math.sin(a)*r); }
        break;
      case 'diamond':
        ctx.moveTo(cx, cy-r); ctx.lineTo(cx+r, cy); ctx.lineTo(cx, cy+r); ctx.lineTo(cx-r, cy);
        break;
      case 'tri':
        ctx.moveTo(cx, cy-r); ctx.lineTo(cx+r*0.87, cy+r*0.5); ctx.lineTo(cx-r*0.87, cy+r*0.5);
        break;
      case 'star':
        for (let i=0; i<10; i++) { const a=-Math.PI/2+i*Math.PI/5, rad=i%2===0?r:r*0.45; const fn=i===0?'moveTo':'lineTo'; ctx[fn](cx+Math.cos(a)*rad, cy+Math.sin(a)*rad); }
        break;
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  drawInventory() {
    const ctx = this.ctx, w = this.cssWidth, h = this.cssHeight;
    // Scale inventory relative to UI scale
    const slotW = Math.round(70 * UI_SCALE), slotH = Math.round(56 * UI_SCALE), gap = Math.round(8 * UI_SCALE);
    const totalW = 4*slotW + 3*gap;
    const startX = w/2 - totalW/2, y = h - slotH - Math.round(24 * UI_SCALE);
    ITEM_KEYS.forEach((type, i) => {
      const x = startX + i*(slotW+gap);
      const def = ITEM_DEFS[type];
      const hasItem = this.inventory[type] >= 1;
      const isActive = this.inventory[type] === 2;
      // Slot background
      ctx.fillStyle = isActive ? def.color+'55' : COLORS.barBg;
      ctx.strokeStyle = isActive ? def.color : (hasItem ? COLORS.accentDim : COLORS.barBorder);
      ctx.lineWidth = isActive ? 2 : 1;
      const radius = 6 * UI_SCALE;
      ctx.beginPath(); ctx.moveTo(x+radius,y); ctx.lineTo(x+slotW-radius,y);
      ctx.quadraticCurveTo(x+slotW,y,x+slotW,y+radius); ctx.lineTo(x+slotW,y+slotH-radius);
      ctx.quadraticCurveTo(x+slotW,y+slotH,x+slotW-radius,y+slotH); ctx.lineTo(x+radius,y+slotH);
      ctx.quadraticCurveTo(x,y+slotH,x,y+slotH-radius); ctx.lineTo(x,y+radius);
      ctx.quadraticCurveTo(x,y,x+radius,y); ctx.closePath(); ctx.fill(); ctx.stroke();
      // Key number
      ctx.fillStyle = hasItem ? def.color : COLORS.textDim;
      ctx.font = `bold ${Math.round(16*UI_SCALE)}px system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(def.key, x+16*UI_SCALE, y+slotH-14*UI_SCALE);
      // Item icon
      if (hasItem) {
        this.drawItemShape(ctx, x+slotW-20*UI_SCALE, y+slotH/2, def);
      }
      // Active timer bar
      if (isActive) {
        let progress = 1;
        if (type === 'shield') progress = this.buffs.shield.timer / (this.buffs.shield.timer < 180 ? 300 : 180);
        else if (type === 'boost') progress = this.buffs.boost.timer / 120;
        if (progress > 0) {
          ctx.fillStyle = def.color;
          ctx.fillRect(x+2, y+slotH-4, (slotW-4)*progress, 3);
        }
      }
    });
    ctx.textAlign = 'left';
  }

  drawEdgeGoalArrow(w,h){
    const ctx=this.ctx,dx=this.goalPos[0]-this.playerPos[0],dy=this.goalPos[1]-this.playerPos[1],angle=Math.atan2(dy,dx),border=30,cx=w/2,cy=h/2;
    const x=cx+Math.cos(angle)*(w/2-border),y=cy+Math.sin(angle)*(h/2-border),as=18;
    ctx.fillStyle=COLORS.goal;ctx.beginPath();
    ctx.moveTo(x+Math.cos(angle)*as,y+Math.sin(angle)*as);
    ctx.lineTo(x+Math.cos(angle+2.4)*as*0.7,y+Math.sin(angle+2.4)*as*0.7);
    ctx.lineTo(x+Math.cos(angle-2.4)*as*0.7,y+Math.sin(angle-2.4)*as*0.7);
    ctx.closePath();ctx.fill();
  }

  drawMenu() {
    const ctx=this.ctx,w=this.cssWidth,h=this.cssHeight,t=performance.now()/1000;
    ctx.fillStyle=COLORS.bg;ctx.fillRect(0,0,w,h);
    this.updateMenuParticles();
    this.menuParticles.forEach(p=>{const a=p.life/p.ml;ctx.fillStyle=p.color;ctx.globalAlpha=0.75*a;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(1,p.size*a),0,Math.PI*2);ctx.fill();ctx.globalAlpha=1.0;});
    for(let i=0;i<3;i++){const rad=220+i*140+Math.sin(t+i)*40;ctx.strokeStyle=`rgba(88,196,221,${Math.max(0,0.12-i*0.04)})`;ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(w/2,h/2,rad,0,Math.PI*2);ctx.stroke();}
    const cx=w/2,by=h/4-20;ctx.textAlign='center';
    ctx.save();ctx.shadowColor='rgba(0,0,0,0.5)';ctx.shadowBlur=24;ctx.fillStyle=COLORS.title;ctx.font=`bold ${Math.round(56*UI_SCALE)}px system-ui,sans-serif`;ctx.fillText('Echo Maze',cx,by);ctx.restore();
    ctx.fillStyle=COLORS.accentDim;ctx.font=`${Math.round(22*UI_SCALE)}px system-ui,sans-serif`;ctx.fillText('Combat Edition',cx,by+58*UI_SCALE);

    if (this.menuTransition) {
      this.menuRects = [];
      const progress = this.menuTransition.timer / 18;
      this.menuTransition.timer--;
      // "from" fading out
      ctx.save(); ctx.globalAlpha = progress;
      this.drawMenuContent(this.menuTransition.from, cx, by, w, h);
      ctx.restore();
      // "to" fading in
      ctx.save(); ctx.globalAlpha = 1 - progress;
      this.drawMenuContent(this.menuTransition.to, cx, by, w, h);
      ctx.restore();
      if (this.menuTransition.timer <= 0) {
        this.state = this.menuTransition.to;
        this.menuTransition = null;
      }
    } else {
      this.menuRects = [];
      this.drawMenuContent(this.state, cx, by, w, h);
    }

    if(this.messageTimer>0){this.messageTimer--;ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(w/2-210,20,420,40);ctx.fillStyle=COLORS.text;ctx.font='16px system-ui,sans-serif';ctx.fillText(this.message,w/2,44);}
  }

  drawMenuContent(state, cx, by, w, h) {
    const ctx = this.ctx;
    let bottomY = h - 40;

    if (state === 'MENU_MODE') {
      ctx.fillStyle=COLORS.text;ctx.font=`bold ${Math.round(18*UI_SCALE)}px system-ui,sans-serif`;ctx.fillText('SELECT GAME MODE',cx,by+120*UI_SCALE);
      const bw=Math.min(500,w*0.55), gap=62*UI_SCALE;
      const btns=[
        {label:'1. Survival',action:()=>{this.mode='SURVIVAL';this.transitionTo('MENU_DIFFICULTY');}},
        {label:'2. Level',action:()=>{this.mode='LEVEL';this.transitionTo('MENU_DIFFICULTY');}},
        {label:'3. Watch AI (Hard)',action:()=>{this.mode='WATCH';this.difficulty='HARD';this.brightMode=false;this.godMode=false;this.state='PLAYING';this.resetGame();if(this.aiController){this.aiController.enabled=true;this.aiController.setUseLLM(false);this.aiController.initLLM().then(()=>{if(this.aiController.isLLMReady()){this.aiController.setUseLLM(true);}});}}},
        {label:'T. Train AI (Hard)',action:()=>{this.state='MENU_TRAIN';}},
        {label:'L. Load Game',action:()=>this.loadGame()},
      ];
      btns.forEach((item,i)=>{this.drawMenuButton(ctx,cx,by+160*UI_SCALE+i*gap,bw,48*UI_SCALE,item.label,item.action);});
      bottomY=by+160*UI_SCALE+btns.length*gap+50*UI_SCALE;
      ctx.fillStyle=COLORS.textDim;ctx.font=`${Math.round(14*UI_SCALE)}px system-ui,sans-serif`;ctx.fillText('Click or press key — ESC to return',cx,bottomY);
    }
    else if (state === 'MENU_DIFFICULTY') {
      ctx.fillStyle=COLORS.text;ctx.font=`bold ${Math.round(18*UI_SCALE)}px system-ui,sans-serif`;
      ctx.fillText(`${this.mode==='SURVIVAL'?'Survival':'Level'} — Select Difficulty`,cx,by+120*UI_SCALE);
      const bw=Math.min(440,w*0.5), gap=62*UI_SCALE;
      const diffs=[
        {label:'1. Easy',action:()=>{this.difficulty='EASY';this.transitionTo('MENU_OPTIONS');}},
        {label:'2. Normal',action:()=>{this.difficulty='NORMAL';this.transitionTo('MENU_OPTIONS');}},
        {label:'3. Hard',action:()=>{this.difficulty='HARD';this.transitionTo('MENU_OPTIONS');}},
      ];
      diffs.forEach((item,i)=>{this.drawMenuButton(ctx,cx,by+160*UI_SCALE+i*gap,bw,48*UI_SCALE,item.label,item.action);});
      bottomY=by+160*UI_SCALE+diffs.length*gap+50*UI_SCALE;
      ctx.fillStyle=COLORS.textDim;ctx.font=`${Math.round(14*UI_SCALE)}px system-ui,sans-serif`;ctx.fillText('ESC to go back',cx,bottomY);
    }
    else if (state === 'MENU_OPTIONS') {
      const ml=this.mode==='SURVIVAL'?'Survival':'Level';
      ctx.fillStyle=COLORS.text;ctx.font=`bold ${Math.round(18*UI_SCALE)}px system-ui,sans-serif`;
      ctx.fillText(`${ml} · ${this.getConfig().label} · Options`,cx,by+120*UI_SCALE);
      const tw=360*UI_SCALE, ty=by+175*UI_SCALE, tcx=cx-tw/2;
      this.drawToggle(ctx,tcx,ty,'Bright Mode (full visibility)',this.brightMode,()=>this.brightMode=!this.brightMode);
      this.drawToggle(ctx,tcx,ty+56*UI_SCALE,'God Mode (infinite energy)',this.godMode,()=>this.godMode=!this.godMode);
      const startW=240*UI_SCALE;
      this.drawMenuButton(ctx,cx,ty+140*UI_SCALE,startW,44*UI_SCALE,'Start Game',()=>{this.state='PLAYING';this.resetGame();});
      bottomY=ty+200*UI_SCALE;
      ctx.fillStyle=COLORS.textDim;ctx.font=`${Math.round(14*UI_SCALE)}px system-ui,sans-serif`;ctx.fillText('SPACE/ENTER to start — 1/2 toggle — ESC back',cx,bottomY);
    }
    else if (state === 'MENU_TRAIN') {
      ctx.fillStyle=COLORS.text;ctx.font='bold 18px system-ui,sans-serif';
      ctx.fillText('TRAIN AI (HARD)',cx,by+120);
      
      if(this.trainingState==='idle'){
        ctx.fillStyle=COLORS.text;ctx.font='14px system-ui,sans-serif';
        ctx.fillText('Hardware: M5 MacBook Pro 16GB',cx,by+170);
        ctx.fillText(`Config: ${this.trainingConfig.episodes} episodes × ${this.trainingConfig.maxSteps} steps × ${this.trainingConfig.epochs} epochs`,cx,by+200);
        ctx.fillText('Estimated time: ~15-20 minutes',cx,by+230);
        const btnW=320;
        this.drawMenuButton(ctx,cx,by+310,btnW,50,'🚀 START TRAINING',()=>this.startTraining());
        bottomY=by+380;
        ctx.fillStyle=COLORS.textDim;ctx.font='13px system-ui,sans-serif';
        ctx.fillText('Training runs in background. Auto-integrates when complete.',cx,bottomY);
      }
      else if(this.trainingState==='training'||this.trainingState==='evaluating'){
        ctx.fillStyle=COLORS.text;ctx.font='bold 16px system-ui,sans-serif';
        const phase=this.trainingState==='training'?'TRAINING IN PROGRESS':'EVALUATING MODEL';
        ctx.fillText(phase,cx,by+160);
        const barW=400,barH=24,barX=cx-barW/2,barY=by+210;
        ctx.fillStyle='#1a1f30'; ctx.fillRect(barX,barY,barW,barH);
        ctx.fillStyle=COLORS.player; ctx.fillRect(barX,barY,barW*this.trainingProgress,barH);
        ctx.strokeStyle=COLORS.accent;ctx.lineWidth=2; ctx.strokeRect(barX,barY,barW,barH);
        ctx.fillStyle=COLORS.text;ctx.font='13px system-ui,sans-serif'; ctx.textAlign='center';
        ctx.fillText(Math.round(this.trainingProgress*100)+'%',cx,barY+16);
        ctx.textAlign='left';
        const elapsed=Math.round(this.trainingElapsedTime);
        const remaining=Math.round(Math.max(0,this.trainingEstimatedTime-elapsed));
        ctx.fillStyle=COLORS.textDim;ctx.font='13px system-ui,sans-serif';
        ctx.fillText(`Elapsed: ${elapsed}s  |  Remaining: ${remaining}s`,cx-180,by+280);
        const logs=this.trainingLogs.slice(-3);
        ctx.fillStyle=COLORS.textDim;ctx.font='12px monospace';
        logs.forEach((log,i)=>ctx.fillText(log,cx-190,by+310+i*20));
        bottomY=by+400;
      }
      else if(this.trainingState==='done'){
        ctx.fillStyle=COLORS.goal;ctx.font='bold 24px system-ui,sans-serif';
        ctx.fillText('✓ TRAINING COMPLETE',cx,by+180);
        ctx.fillStyle=COLORS.text;ctx.font='14px system-ui,sans-serif';
        ctx.fillText(this.trainingMessage,cx,by+230);
        ctx.fillText('Model automatically integrated into Watch AI mode',cx,by+260);
        const btnW=280;
        this.drawMenuButton(ctx,cx,by+320,btnW,44,'🎮 Watch AI (Hard)',()=>{this.mode='WATCH';this.difficulty='HARD';this.brightMode=false;this.godMode=false;this.state='PLAYING';this.resetGame();if(this.aiController){this.aiController.enabled=true;this.aiController.setUseLLM(false);this.aiController.initLLM().then(()=>{if(this.aiController.isLLMReady()){this.aiController.setUseLLM(true);}});}});
        this.drawMenuButton(ctx,cx,by+380,btnW,44,'🏠 Main Menu',()=>{this.state='MENU_MODE';this.trainingState='idle';});
        bottomY=by+460;
      }
      else if(this.trainingState==='error'){
        ctx.fillStyle=COLORS.enemy;ctx.font='bold 20px system-ui,sans-serif';
        ctx.fillText('⚠ TRAINING FAILED',cx,by+180);
        ctx.fillStyle=COLORS.text;ctx.font='13px system-ui,sans-serif';
        ctx.fillText(this.trainingMessage,cx,by+230);
        const btnW=240;
        this.drawMenuButton(ctx,cx,by+310,btnW,44,'← Back',()=>{this.state='MENU_MODE';this.trainingState='idle';});
        bottomY=by+380;
      }
      if(this.trainingState==='idle'){
        ctx.fillStyle=COLORS.textDim;ctx.font='13px system-ui,sans-serif';
        ctx.fillText('ESC to return',cx,bottomY);
      }
    }
  }

  drawPauseOverlay(w, h) {
    const ctx=this.ctx, cx=w/2, cy=h/2;
    // Semi-transparent dark overlay
    ctx.fillStyle='rgba(0,0,0,0.55)';ctx.fillRect(0,0,w,h);
    // Panel
    const pw=340*UI_SCALE, ph=220*UI_SCALE, px=cx-pw/2, py=cy-ph/2, r=12*UI_SCALE;
    ctx.fillStyle=COLORS.panel;ctx.strokeStyle=COLORS.accentDim;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(px+r,py);ctx.lineTo(px+pw-r,py);
    ctx.quadraticCurveTo(px+pw,py,px+pw,py+r);ctx.lineTo(px+pw,py+ph-r);
    ctx.quadraticCurveTo(px+pw,py+ph,px+pw-r,py+ph);ctx.lineTo(px+r,py+ph);
    ctx.quadraticCurveTo(px,py+ph,px,py+ph-r);ctx.lineTo(px,py+r);
    ctx.quadraticCurveTo(px,py,px+r,py);ctx.closePath();ctx.fill();ctx.stroke();
    // Title
    ctx.fillStyle=COLORS.title;ctx.font=`bold ${Math.round(26*UI_SCALE)}px system-ui,sans-serif`;ctx.textAlign='center';
    ctx.fillText('Paused',cx,py+50*UI_SCALE);
    // Buttons
    const btnW=220*UI_SCALE, btnH=44*UI_SCALE, gap=56*UI_SCALE;
    this.menuRects=[];
    this.drawMenuButton(ctx,cx,py+100*UI_SCALE,btnW,btnH,'Resume (ESC)',()=>{this.state='PLAYING';});
    this.drawMenuButton(ctx,cx,py+160*UI_SCALE,btnW,btnH,'Quit',()=>{this.state='MENU_MODE';});
    ctx.fillStyle=COLORS.textDim;ctx.font=`${Math.round(13*UI_SCALE)}px system-ui,sans-serif`;
    ctx.fillText('Press ESC or click to resume',cx,py+ph-12*UI_SCALE);
  }

  drawMenuButton(ctx, x, y, w, h, label, action){
    const radius=8*UI_SCALE, lx=x-w/2, hover=this.pointInRect(this.mouse.x,this.mouse.y,{x:lx,y,w,h});
    const lift=hover?-3:0;
    ctx.fillStyle=hover?'#141d30':COLORS.panel;
    ctx.strokeStyle=hover?COLORS.accent:COLORS.accentDim;
    ctx.lineWidth=hover?2:1.5;
    ctx.beginPath();ctx.moveTo(lx+radius,y+lift);ctx.lineTo(lx+w-radius,y+lift);
    ctx.quadraticCurveTo(lx+w,y+lift,lx+w,y+lift+radius);ctx.lineTo(lx+w,y+lift+h-radius);
    ctx.quadraticCurveTo(lx+w,y+lift+h,lx+w-radius,y+lift+h);ctx.lineTo(lx+radius,y+lift+h);
    ctx.quadraticCurveTo(lx,y+lift+h,lx,y+lift+h-radius);ctx.lineTo(lx,y+lift+radius);
    ctx.quadraticCurveTo(lx,y+lift,lx+radius,y+lift);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=hover?COLORS.text:COLORS.textDim;ctx.font=`bold ${Math.round(14*UI_SCALE)}px system-ui,sans-serif`;
    ctx.fillText(label,x,y+lift+h/2+5*UI_SCALE);
    this.menuRects.push({rect:{x:lx,y,w,h},action});
  }

  drawToggle(ctx, x, y, label, on, action){
    const w=360*UI_SCALE,h=42*UI_SCALE,radius=8*UI_SCALE, hover=this.pointInRect(this.mouse.x,this.mouse.y,{x,y,w,h});
    const lift=hover?-2:0;
    ctx.fillStyle=on?'rgba(88,196,221,0.08)':hover?'rgba(255,255,255,0.03)':COLORS.panel;
    ctx.strokeStyle=on?COLORS.accent:hover?'#3a3f50':'#2a2f40';
    ctx.lineWidth=on?2:1.5;
    ctx.beginPath();ctx.moveTo(x+radius,y+lift);ctx.lineTo(x+w-radius,y+lift);
    ctx.quadraticCurveTo(x+w,y+lift,x+w,y+lift+radius);ctx.lineTo(x+w,y+lift+h-radius);
    ctx.quadraticCurveTo(x+w,y+lift+h,x+w-radius,y+lift+h);ctx.lineTo(x+radius,y+lift+h);
    ctx.quadraticCurveTo(x,y+lift+h,x,y+lift+h-radius);ctx.lineTo(x,y+lift+radius);
    ctx.quadraticCurveTo(x,y+lift,x+radius,y+lift);ctx.closePath();ctx.fill();ctx.stroke();
    const dx=x+w-30*UI_SCALE,dy=y+lift+h/2,dr=12*UI_SCALE;
    ctx.fillStyle=on?COLORS.toggleOn:'#444';ctx.beginPath();ctx.arc(dx,dy,dr,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=on?COLORS.text:COLORS.textDim;ctx.font=`bold ${Math.round(13*UI_SCALE)}px system-ui,sans-serif`;
    ctx.textAlign='left';ctx.fillText(label,x+14*UI_SCALE,y+lift+28*UI_SCALE);ctx.textAlign='center';
    this.menuRects.push({rect:{x,y,w,h},action});
  }

  // ──── Direction Indicator (independent component) ────
  drawPlayerIndicator(cx, cy, w, h) {
    const ctx = this.ctx;
    const angle = Math.atan2(this.lastMoveDir[1], this.lastMoveDir[0]);
    // Comet trail — dynamic particles (uses actual movement, not velocity)
    const actualSpeed = this.moveDelta ? Math.hypot(this.moveDelta[0], this.moveDelta[1]) : 0;
    const maxSpeed = this.effectiveMaxSpeed || 3.0;
    const speedRatio = clamp(actualSpeed / maxSpeed, 0, 1);
    const accelMag = this.lastAccel ? Math.hypot(this.lastAccel[0], this.lastAccel[1]) : 0;
    const accelRatio = clamp(accelMag / 0.196, 0, 1);

    let trailFactor;
    if (speedRatio >= 0.95) {
      trailFactor = 1.0;                     // max speed → always full trail
    } else {
      trailFactor = speedRatio * (0.3 + 0.7 * accelRatio);
    }

    if (trailFactor > 0.03) {
      const MAX_DOTS = 6;
      const numDots = Math.max(1, Math.ceil(trailFactor * MAX_DOTS));
      const spacing = trailFactor * (40 / MAX_DOTS);
      const alphaStart = trailFactor * 0.7;
      const radiusStart = trailFactor * 5 * UI_SCALE;

      for (let i = 0; i < numDots; i++) {
        const dist = (i + 0.6) * spacing;
        const px = cx - Math.cos(angle) * dist;
        const py = cy - Math.sin(angle) * dist;
        const t = i / Math.max(numDots - 1, 1);
        const alpha = alphaStart * (1 - t);
        const r = radiusStart * (1 - t * 0.7);
        ctx.fillStyle = COLORS.player;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1, r), 0, Math.PI * 2);
        ctx.fill();
        // glow ring
        if (r > 1.5) {
          ctx.strokeStyle = COLORS.accent;
          ctx.globalAlpha = alpha * 0.4;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px, py, r + 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Ring — thin circle around player
    ctx.strokeStyle = COLORS.accent;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.8 * UI_SCALE;
    ctx.beginPath();
    ctx.arc(cx, cy, 15 * UI_SCALE, 0, Math.PI * 2);
    ctx.stroke();

    // Arrow — points in movement direction
    const tipDist  = 22.5 * UI_SCALE;
    const baseDist = 14 * UI_SCALE;
    const spread   = 6.5 * UI_SCALE;
    const tx = cx + Math.cos(angle) * tipDist;
    const ty = cy + Math.sin(angle) * tipDist;
    const lx = cx + Math.cos(angle) * baseDist + Math.cos(angle + Math.PI / 2) * spread;
    const ly = cy + Math.sin(angle) * baseDist + Math.sin(angle + Math.PI / 2) * spread;
    const rx = cx + Math.cos(angle) * baseDist + Math.cos(angle - Math.PI / 2) * spread;
    const ry = cy + Math.sin(angle) * baseDist + Math.sin(angle - Math.PI / 2) * spread;

    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(lx, ly);
    ctx.lineTo(rx, ry);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  frame(timestamp){
    if (!this._lastFrame) this._lastFrame = timestamp;
    const elapsed = timestamp - this._lastFrame;
    this._lastFrame = timestamp;

    // Update touch input with delta (for variable refresh rate normalization)
    if (this.touchInput) {
      this.touchInput.update(elapsed);
      // Update item button visual states
      this.touchInput.updateItemButtonStates();
    }

    this._acc = (this._acc || 0) + elapsed;
    const TICK = 16.6667;
    while (this._acc >= TICK) {
      this.update();
      this._acc -= TICK;
    }
    this.draw();
    requestAnimationFrame(t=>this.frame(t));
  }
}

window.addEventListener('load',()=>{new EchoMaze();});
