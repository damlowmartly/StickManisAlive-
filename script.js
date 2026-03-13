/* ═══════════════════════════════════════════════════════════
   The Last Stickman – script.js
   Autonomous stickman life simulation with persistent memory
═══════════════════════════════════════════════════════════ */

const canvas = document.getElementById('world');
const ctx    = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const GROUND = H - 70;

// ─── Palette ─────────────────────────────────────────────
const PAL = {
  sky1: '#0d1a2e', sky2: '#1a2d4a',
  ground: '#2d1f0a', grass: '#3d6b2a',
  stickman: '#f0ddb8', stickmanDark: '#c4a870',
  fire: ['#ff6b00','#ff9500','#ffc800','#fff3a0'],
  food: '#e05c3a', cookedFood: '#a0522d',
  rock: '#5a4a3a', rockLight: '#7a6a5a',
  block: '#6a4a2a', blockLight: '#9a7a5a',
  text: '#f0ddb8', accent: '#e8a44a',
  stars: 'rgba(255,255,200,0.7)'
};

// ─── Stars (static positions) ────────────────────────────
const STARS = Array.from({length:60}, () => ({
  x: Math.random()*W, y: Math.random()*(GROUND-10),
  r: Math.random()*1.5+0.3,
  twinkle: Math.random()*Math.PI*2
}));

// ─── State ────────────────────────────────────────────────
let state, memory, objects, stickman;

// ─── LOAD / SAVE ──────────────────────────────────────────
function now() { return Date.now(); }

function defaultState() {
  return {
    hunger:  30,
    energy:  80,
    boredom: 20,
    anger:   0,
    sadness: 0,
    stomachAche: false,
    fireDiscovered: false,
    lastSaved: now()
  };
}

function defaultMemory() {
  return {
    log: [],
    foodEaten: 0,
    cookedFoodEaten: 0,
    timesSlept: 0,
    objectsRecognized: [],
    interactions: 0
  };
}

function save() {
  state.lastSaved = now();
  localStorage.setItem('stickman_state',  JSON.stringify(state));
  localStorage.setItem('stickman_memory', JSON.stringify(memory));
}

function load() {
  const rawState  = localStorage.getItem('stickman_state');
  const rawMemory = localStorage.getItem('stickman_memory');
  state  = rawState  ? JSON.parse(rawState)  : defaultState();
  memory = rawMemory ? JSON.parse(rawMemory) : defaultMemory();

  // Apply offline time decay
  const elapsed = (now() - state.lastSaved) / 1000; // seconds offline
  if (elapsed > 0 && elapsed < 86400) { // cap at 1 day
    const t = Math.min(elapsed, 3600); // cap effect at 1hr equivalent
    state.hunger  = clamp(state.hunger  + t * 0.005, 0, 100);
    state.energy  = clamp(state.energy  - t * 0.003, 0, 100);
    state.boredom = clamp(state.boredom + t * 0.004, 0, 100);
    state.anger   = clamp(state.anger   - t * 0.002, 0, 100);
    state.sadness = clamp(state.sadness - t * 0.001, 0, 100);
  }
}

// ─── Helpers ──────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function lerp(a, b, t) { return a + (b - a) * t; }

function addMemory(text) {
  const d = new Date();
  const ts = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  memory.log.unshift({ ts, text });
  if (memory.log.length > 40) memory.log.pop();
  renderMemoryLog();
}

function renderMemoryLog() {
  const ul = document.getElementById('memory-list');
  ul.innerHTML = memory.log.map(e =>
    `<li><span class="ts">${e.ts}</span>${e.text}</li>`
  ).join('');
}

// ─── Thought Bubble ───────────────────────────────────────
let thoughtTimer = 0;
let currentThought = '';

function showThought(text, duration=3000) {
  if (text === currentThought && thoughtTimer > 0) return;
  currentThought = text;
  const bubble = document.getElementById('thought-bubble');
  const span   = document.getElementById('thought-text');
  span.textContent = text;
  bubble.classList.remove('hidden');
  thoughtTimer = duration;
}

function updateThought(dt) {
  if (thoughtTimer > 0) {
    thoughtTimer -= dt;
    // Position bubble above stickman
    const bubble = document.getElementById('thought-bubble');
    const scaleX = canvas.offsetWidth / W;
    const scaleY = canvas.offsetHeight / H;
    bubble.style.left = `${stickman.x * scaleX}px`;
    bubble.style.top  = `${(stickman.y - 60) * scaleY}px`;
    if (thoughtTimer <= 0) {
      bubble.classList.add('hidden');
      currentThought = '';
    }
  }
}

// ─── Objects ──────────────────────────────────────────────
function spawnObjects() {
  objects = {
    food: {
      x: rand(80, W - 80),
      y: GROUND - 10,
      cooked: false,
      exists: true,
      wobble: 0
    },
    fire: {
      x: rand(100, W - 100),
      y: GROUND,
      lit: false,
      exists: state.fireDiscovered,
      frame: 0
    },
    blocks: Array.from({length: 3}, (_, i) => ({
      x: rand(60, W - 60),
      y: GROUND - rand(0, 20),
      w: rand(22, 38), h: rand(18, 28),
      recognized: false,
      wobble: 0,
      id: `block_${i}`
    }))
  };
}

// ─── Stickman ─────────────────────────────────────────────
function createStickman() {
  return {
    x: W / 2,
    y: GROUND,
    vx: 0,
    vy: 0,
    dir: 1,
    action: 'idle',
    targetX: W / 2,
    actionTimer: 0,
    blinkTimer: rand(2000, 5000),
    blinking: false,
    blinkDuration: 0,
    headTilt: 0,
    legPhase: 0,
    armSwing: 0,
    sleeping: false,
    sleepZs: [],
    expression: 'neutral', // neutral, happy, sad, angry, surprised
    expressionTimer: 0,
    sitTimer: 0,
    sitting: false,
    eatTimer: 0,
    eating: false,
    buildTimer: 0,
    building: false
  };
}

// ─── Action / AI ──────────────────────────────────────────
const THOUGHTS = {
  hungry:       ["I'm hungry…", "Food please…", "My tummy…"],
  veryHungry:   ["SO HUNGRY.", "FEED ME.", "I need food!!"],
  stomachAche:  ["Ow… my belly…", "That raw meat…", "Maybe cook it?", "Fire… need fire…"],
  fireFound:    ["FIRE!", "I found fire!", "Warm… nice…", "I can cook now!"],
  eating:       ["Nom nom…", "Tasty!", "Mmm…"],
  eatingCooked: ["This is delicious!", "Cooked is better!", "So good…"],
  sleeping:     ["zzz…", "Sleepy…", "Night night…"],
  bored:        ["So bored…", "Nothing to do…", "Explore?"],
  angry:        ["Grr!", "Leave me alone!", "ANNOYED."],
  sad:          ["Feeling blue…", "Sad day.", "…"],
  exploring:    ["Interesting!", "What's over there?", "Exploring!"],
  building:     ["What's this?", "A shape!", "Hm, I know this…", "Recognized!"],
  cheerful:     ["Yay!", "I feel great!", ":)"],
};

function pickThought(key) {
  const arr = THOUGHTS[key];
  return arr[Math.floor(Math.random() * arr.length)];
}

function decideAction() {
  if (stickman.sleeping) return; // handled separately
  if (stickman.eating)   return;
  if (stickman.building) return;

  const s = state;
  const weights = [];

  // Sleep if exhausted
  if (s.energy < 15) {
    weights.push({ action: 'sleep', weight: 80 });
  } else if (s.energy < 35) {
    weights.push({ action: 'sleep', weight: 40 });
  }

  // Eat if hungry
  if (s.hunger > 70) {
    weights.push({ action: 'findFood', weight: 60 + (s.hunger - 70) });
  } else if (s.hunger > 45) {
    weights.push({ action: 'findFood', weight: 30 });
  }

  // Explore if bored
  if (s.boredom > 60) {
    weights.push({ action: 'explore', weight: 40 });
    weights.push({ action: 'recognize', weight: 25 });
  } else {
    weights.push({ action: 'explore', weight: 20 });
  }

  // Sit if sad
  if (s.sadness > 50) {
    weights.push({ action: 'sit', weight: 35 });
  }

  // Idle anger
  if (s.anger > 50) {
    weights.push({ action: 'angryPace', weight: 40 });
  }

  // Default idle
  weights.push({ action: 'idle',    weight: 15 });
  weights.push({ action: 'explore', weight: 10 });

  // Weighted pick
  const total = weights.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of weights) {
    r -= w.weight;
    if (r <= 0) { beginAction(w.action); return; }
  }
  beginAction('idle');
}

function beginAction(action) {
  stickman.action = action;
  stickman.actionTimer = rand(2000, 5000);

  switch (action) {
    case 'explore':
      stickman.targetX = rand(40, W - 40);
      break;
    case 'findFood':
      if (objects.food.exists) stickman.targetX = objects.food.x;
      break;
    case 'sleep':
      stickman.sleeping = true;
      stickman.sitting  = true;
      showThought(pickThought('sleeping'));
      addMemory('😴 Went to sleep');
      break;
    case 'sit':
      stickman.sitting = true;
      stickman.targetX = stickman.x;
      showThought(pickThought('sad'));
      break;
    case 'angryPace':
      stickman.targetX = rand(60, W - 60);
      showThought(pickThought('angry'));
      break;
    case 'recognize':
      const unrecognized = objects.blocks.filter(b => !b.recognized);
      if (unrecognized.length > 0) {
        const b = unrecognized[Math.floor(Math.random() * unrecognized.length)];
        stickman.targetX = b.x;
        stickman.building = true;
        stickman.buildTimer = 2500;
      } else {
        stickman.targetX = rand(40, W - 40);
      }
      break;
    case 'idle':
    default:
      stickman.targetX = stickman.x + rand(-60, 60);
      stickman.targetX = clamp(stickman.targetX, 30, W - 30);
      break;
  }
}

// ─── Update ───────────────────────────────────────────────
let lastTime = 0;
let saveTimer = 0;
let thoughtCooldown = 0;

function update(ts) {
  const dt = Math.min(ts - lastTime, 100); // cap delta
  lastTime = ts;

  saveTimer += dt;
  if (saveTimer > 5000) { save(); saveTimer = 0; }

  thoughtCooldown -= dt;

  // ── State decay ──────────────────────────
  const s = state;
  const speed = 1/60000; // per ms
  s.hunger  = clamp(s.hunger  + dt * speed * 3.5, 0, 100);
  s.energy  = clamp(s.energy  - dt * speed * (stickman.sleeping ? -8 : 2.5), 0, 100);
  s.boredom = clamp(s.boredom + dt * speed * (stickman.sleeping ? 0 : 2), 0, 100);
  s.anger   = clamp(s.anger   - dt * speed * 1.5, 0, 100);
  s.sadness = clamp(s.sadness - dt * speed * 0.8, 0, 100);

  // ── Sleep logic ───────────────────────────
  if (stickman.sleeping) {
    if (s.energy >= 95) {
      stickman.sleeping = false;
      stickman.sitting  = false;
      stickman.action   = 'idle';
      memory.timesSlept++;
      addMemory('🌅 Woke up refreshed');
      showThought('Good morning! 🌅');
    }
    // Float Z particles
    stickman.sleepZs = stickman.sleepZs.filter(z => z.life > 0);
    if (Math.random() < 0.02) {
      stickman.sleepZs.push({ x: stickman.x + 12, y: stickman.y - 30, life: 1500, vy: -0.04 });
    }
    stickman.sleepZs.forEach(z => { z.y += z.vy * dt; z.life -= dt; });
    updateHUD(); draw(ts); updateThought(dt);
    requestAnimationFrame(update);
    return;
  }

  // ── Eating logic ──────────────────────────
  if (stickman.eating) {
    stickman.eatTimer -= dt;
    if (stickman.eatTimer <= 0) {
      finishEating();
    }
    updateHUD(); draw(ts); updateThought(dt);
    requestAnimationFrame(update);
    return;
  }

  // ── Building/recognizing logic ────────────
  if (stickman.building) {
    stickman.buildTimer -= dt;
    if (stickman.buildTimer <= 0) {
      stickman.building = false;
      finishRecognize();
    }
  }

  // ── Movement ──────────────────────────────
  const dx = stickman.targetX - stickman.x;
  const speed_px = (s.sadness > 60 ? 60 : s.anger > 60 ? 130 : stickman.action === 'angryPace' ? 120 : 80);

  if (Math.abs(dx) > 3 && !stickman.sitting && !stickman.building) {
    stickman.dir = dx > 0 ? 1 : -1;
    stickman.vx  = stickman.dir * speed_px * (dt / 1000);
    stickman.x   = clamp(stickman.x + stickman.vx, 20, W - 20);
    stickman.legPhase  += dt * 0.008 * (speed_px / 80);
    stickman.armSwing   = Math.sin(stickman.legPhase) * 0.4;
  } else {
    stickman.vx = 0;
    stickman.legPhase = 0;
    stickman.armSwing = 0;
    // Arrived at target → trigger context action
    if (!stickman.sitting && !stickman.building) {
      handleArrival();
    }
  }

  // ── Action timer ─────────────────────────
  stickman.actionTimer -= dt;
  if (stickman.actionTimer <= 0) {
    stickman.sitting = false;
    decideAction();
  }

  // ── Blink ─────────────────────────────────
  stickman.blinkTimer -= dt;
  if (stickman.blinkTimer <= 0) {
    stickman.blinking = true;
    stickman.blinkDuration = 150;
    stickman.blinkTimer = rand(2500, 5500);
  }
  if (stickman.blinking) {
    stickman.blinkDuration -= dt;
    if (stickman.blinkDuration <= 0) stickman.blinking = false;
  }

  // ── Expression ────────────────────────────
  stickman.expressionTimer -= dt;
  if (stickman.expressionTimer <= 0) {
    updateExpression();
  }

  // ── Head tilt ─────────────────────────────
  const tiltTarget = stickman.sitting ? -0.15 : (s.sadness > 50 ? 0.18 : s.anger > 50 ? -0.12 : 0);
  stickman.headTilt = lerp(stickman.headTilt, tiltTarget, 0.05);

  // ── Passive thoughts ──────────────────────
  if (thoughtCooldown <= 0) {
    triggerPassiveThought();
    thoughtCooldown = rand(5000, 12000);
  }

  // ── Fire & food wobble ───────────────────
  objects.fire.frame += dt * 0.01;
  if (objects.food.exists) objects.food.wobble = Math.sin(ts * 0.002) * 1.5;
  objects.blocks.forEach(b => { b.wobble = Math.sin(ts * 0.0015 + b.x) * 0.5; });

  updateHUD();
  draw(ts);
  updateThought(dt);
  requestAnimationFrame(update);
}

function handleArrival() {
  const s = state;

  // Arrived near food?
  if (objects.food.exists && dist(stickman, objects.food) < 30 &&
      (stickman.action === 'findFood' || s.hunger > 50)) {

    // If stomach ache or discovered fire exists, try to cook first
    if ((s.stomachAche || s.fireDiscovered) && objects.fire.exists && !objects.food.cooked) {
      stickman.targetX = objects.fire.x;
      stickman.action  = 'findFire';
      return;
    }
    startEating();
    return;
  }

  // Arrived near fire (to cook)?
  if (objects.fire.exists && dist(stickman, objects.fire) < 35 && stickman.action === 'findFire') {
    if (objects.food.exists && !objects.food.cooked) {
      objects.food.cooked = true;
      showThought('Cooking… 🔥');
      addMemory('🍖 Cooked food over the fire!');
      setTimeout(() => {
        stickman.targetX = objects.food.x;
        stickman.action  = 'findFood';
      }, 1800);
    }
    return;
  }
}

function startEating() {
  stickman.eating    = true;
  stickman.eatTimer  = 2200;
  stickman.sitting   = true;
  showThought(objects.food.cooked ? pickThought('eatingCooked') : pickThought('eating'));
  stickman.expression = 'happy';
  stickman.expressionTimer = 3000;
}

function finishEating() {
  stickman.eating  = false;
  stickman.sitting = false;
  const cooked = objects.food.cooked;
  objects.food.exists = false;

  state.hunger = clamp(state.hunger - (cooked ? 50 : 30), 0, 100);

  if (!cooked) {
    memory.foodEaten++;
    addMemory('🍖 Ate raw food');
    if (!state.fireDiscovered && memory.foodEaten >= 2) {
      // Stomach ache triggers fire discovery
      state.stomachAche = true;
      showThought(pickThought('stomachAche'));
      addMemory('🤢 Got a stomach ache from raw food!');
      state.sadness = clamp(state.sadness + 20, 0, 100);
      // Spawn fire after delay
      setTimeout(discoverFire, 3500);
    } else if (state.stomachAche) {
      showThought(pickThought('stomachAche'));
    }
  } else {
    memory.cookedFoodEaten++;
    state.stomachAche = false;
    addMemory('✅ Ate cooked food — delicious!');
    showThought(pickThought('eatingCooked'));
    state.sadness = clamp(state.sadness - 10, 0, 100);
  }

  state.boredom = clamp(state.boredom - 10, 0, 100);

  // Respawn food after a while
  setTimeout(respawnFood, rand(8000, 18000));
  stickman.action = 'idle';
  decideAction();
}

function discoverFire() {
  if (state.fireDiscovered) return;
  state.fireDiscovered = true;
  objects.fire.exists = true;
  objects.fire.lit    = true;
  objects.fire.x      = rand(120, W - 120);
  objects.fire.y      = GROUND;
  stickman.expression = 'surprised';
  stickman.expressionTimer = 2000;
  showThought(pickThought('fireFound'));
  addMemory('🔥 Discovered fire! Can now cook food.');
  if (!memory.objectsRecognized.includes('fire')) {
    memory.objectsRecognized.push('fire');
  }
  save();
}

function respawnFood() {
  objects.food.exists = true;
  objects.food.cooked = false;
  objects.food.x = rand(60, W - 60);
  addMemory('🍖 New food appeared');
}

function finishRecognize() {
  const unrecognized = objects.blocks.filter(b => !b.recognized);
  if (unrecognized.length > 0) {
    const closest = unrecognized.reduce((a, b) =>
      dist(stickman, a) < dist(stickman, b) ? a : b
    );
    if (dist(stickman, closest) < 60) {
      closest.recognized = true;
      const shapes = ['rectangle','square','block','stone','cube'];
      const name   = shapes[Math.floor(Math.random() * shapes.length)];
      if (!memory.objectsRecognized.includes(name)) {
        memory.objectsRecognized.push(name);
      }
      showThought(`A ${name}! I know this!`);
      addMemory(`🔷 Recognized a ${name}`);
      state.boredom = clamp(state.boredom - 15, 0, 100);
      stickman.expression = 'happy';
      stickman.expressionTimer = 2000;
    }
  }
  stickman.action = 'idle';
  decideAction();
}

function updateExpression() {
  const s = state;
  if (s.anger > 65)       { stickman.expression = 'angry';    stickman.expressionTimer = 3000; }
  else if (s.sadness > 60) { stickman.expression = 'sad';      stickman.expressionTimer = 3000; }
  else if (s.hunger < 20 && s.energy > 50 && s.boredom < 30)
                           { stickman.expression = 'happy';    stickman.expressionTimer = 2000; }
  else                     { stickman.expression = 'neutral';  stickman.expressionTimer = 2000; }
}

function triggerPassiveThought() {
  const s = state;
  if (s.hunger > 75)       showThought(pickThought('veryHungry'));
  else if (s.hunger > 50)  showThought(pickThought('hungry'));
  else if (s.stomachAche)  showThought(pickThought('stomachAche'));
  else if (s.energy < 20)  showThought(pickThought('sleeping'));
  else if (s.boredom > 65) showThought(pickThought('bored'));
  else if (s.anger > 60)   showThought(pickThought('angry'));
  else if (s.sadness > 55) showThought(pickThought('sad'));
  else if (Math.random() < 0.3) showThought(pickThought('exploring'));
}

// ─── HUD Update ───────────────────────────────────────────
function updateHUD() {
  const s = state;
  document.getElementById('bar-hunger' ).style.width = `${s.hunger}%`;
  document.getElementById('bar-energy' ).style.width = `${s.energy}%`;
  document.getElementById('bar-boredom').style.width = `${s.boredom}%`;
  document.getElementById('bar-anger'  ).style.width = `${s.anger}%`;
  document.getElementById('bar-sadness').style.width = `${s.sadness}%`;
}

// ─── DRAW ─────────────────────────────────────────────────
function draw(ts) {
  ctx.clearRect(0, 0, W, H);
  drawBackground(ts);
  drawObjects(ts);
  drawStickman(ts);
}

function drawBackground(ts) {
  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, PAL.sky1);
  sky.addColorStop(1, PAL.sky2);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, GROUND);

  // Stars
  STARS.forEach(star => {
    const twinkle = 0.5 + 0.5 * Math.sin(ts * 0.001 + star.twinkle);
    ctx.save();
    ctx.globalAlpha = twinkle * 0.8;
    ctx.fillStyle = PAL.stars;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Moon
  ctx.save();
  const moonX = W - 80, moonY = 55;
  ctx.fillStyle = '#fffde8';
  ctx.shadowColor = '#fffde8';
  ctx.shadowBlur  = 20;
  ctx.beginPath(); ctx.arc(moonX, moonY, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.sky1;
  ctx.beginPath(); ctx.arc(moonX + 8, moonY - 4, 17, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Ground
  ctx.fillStyle = PAL.ground;
  ctx.fillRect(0, GROUND, W, H - GROUND);

  // Grass strip
  ctx.fillStyle = PAL.grass;
  ctx.fillRect(0, GROUND, W, 6);

  // Ground texture bumps
  for (let gx = 10; gx < W; gx += 18) {
    ctx.fillStyle = '#3a2710';
    ctx.beginPath();
    ctx.ellipse(gx, GROUND + 3, 4, 2, 0, 0, Math.PI);
    ctx.fill();
  }
}

function drawObjects(ts) {
  // Blocks
  objects.blocks.forEach(b => {
    const recognized = b.recognized;
    ctx.save();
    ctx.translate(b.x, b.y + b.wobble);
    ctx.fillStyle = recognized ? PAL.blockLight : PAL.block;
    ctx.strokeStyle = recognized ? PAL.accent : '#4a3020';
    ctx.lineWidth = recognized ? 2 : 1;
    roundRect(ctx, -b.w/2, -b.h, b.w, b.h, 4);
    ctx.fill();
    ctx.stroke();
    if (recognized) {
      ctx.fillStyle = PAL.accent;
      ctx.font = '9px Space Mono';
      ctx.textAlign = 'center';
      ctx.fillText('✓', 0, -b.h - 5);
    }
    ctx.restore();
  });

  // Food
  if (objects.food.exists) {
    ctx.save();
    ctx.translate(objects.food.x, GROUND - 14 + objects.food.wobble);
    // Bone / food shape
    ctx.fillStyle = objects.food.cooked ? PAL.cookedFood : PAL.food;
    ctx.shadowColor = objects.food.cooked ? '#a0522d' : '#e05c3a';
    ctx.shadowBlur  = 8;
    drawBone(ctx, objects.food.cooked);
    ctx.restore();
  }

  // Fire
  if (objects.fire.exists) {
    ctx.save();
    ctx.translate(objects.fire.x, GROUND);
    drawFire(ctx, ts, objects.fire.frame);
    ctx.restore();
  }
}

function drawBone(ctx, cooked) {
  ctx.save();
  ctx.scale(0.8, 0.8);
  // Shaft
  ctx.fillStyle = cooked ? '#8b4513' : '#e05c3a';
  ctx.fillRect(-3, -16, 6, 16);
  // Ends
  [[-6,-2],[0,-2]].forEach(([ox]) => {
    ctx.beginPath();
    ctx.arc(ox, -16, 5, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ox, 0,  5, 0, Math.PI*2);
    ctx.fill();
  });
  if (cooked) {
    // Steam wisps
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-4 + i*8, -18);
      ctx.bezierCurveTo(-4+i*8, -26, -4+i*8+4, -30, -4+i*8, -36);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawFire(ctx, ts, frame) {
  ctx.save();
  // Log base
  ctx.fillStyle = '#5a3020';
  ctx.fillRect(-18, -6, 36, 6);
  ctx.fillRect(-12, -4, 8, 8);
  ctx.fillRect(4,   -4, 8, 8);

  // Flame layers
  const flicker = Math.sin(ts * 0.004 + frame) * 3;
  const layers = [
    { color: PAL.fire[3], scale: 0.6, offset: flicker * 0.5 },
    { color: PAL.fire[2], scale: 0.8, offset: flicker * 0.7 },
    { color: PAL.fire[1], scale: 1.0, offset: flicker },
    { color: PAL.fire[0], scale: 1.0, offset: flicker * 1.2 },
  ];
  layers.forEach(l => {
    ctx.fillStyle = l.color;
    ctx.shadowColor = PAL.fire[1];
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.moveTo(-12 * l.scale, -4);
    ctx.bezierCurveTo(-10 * l.scale, -18 * l.scale + l.offset, 0, -28 * l.scale, 0, -30 * l.scale);
    ctx.bezierCurveTo(0, -28 * l.scale, 10 * l.scale, -18 * l.scale + l.offset, 12 * l.scale, -4);
    ctx.closePath();
    ctx.fill();
  });

  // Embers
  ctx.shadowBlur = 0;
  for (let i = 0; i < 4; i++) {
    const ex = Math.sin(ts * 0.003 + i * 1.6) * 14;
    const ey = -Math.abs(Math.sin(ts * 0.005 + i)) * 24 - 6;
    ctx.fillStyle = PAL.fire[Math.floor(Math.random() * 3)];
    ctx.beginPath();
    ctx.arc(ex, ey, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ─── Stickman Renderer ────────────────────────────────────
function drawStickman(ts) {
  const sm = stickman;
  const s  = state;
  ctx.save();
  ctx.translate(sm.x, sm.y);

  // Sitting/sleeping offset
  let bodyOffsetY = 0;
  if (sm.sleeping) bodyOffsetY = 8;
  else if (sm.sitting) bodyOffsetY = 4;

  ctx.translate(0, bodyOffsetY);

  // Flip direction
  ctx.scale(sm.dir, 1);

  // Head tilt
  const headY = sm.sleeping ? -18 : -38;
  const headR  = 10;

  // ── Legs ──────────────────────────
  const walking = Math.abs(sm.vx) > 0.5;
  const legSwing = walking ? Math.sin(sm.legPhase) * 18 : 0;
  const legSwing2 = walking ? -legSwing : 0;

  if (sm.sleeping || sm.sitting) {
    // Folded legs (sitting)
    ctx.strokeStyle = PAL.stickman;
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(-12, 8);  ctx.lineTo(-4, 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2,  0); ctx.lineTo(12,  8);  ctx.lineTo(4,  16); ctx.stroke();
  } else {
    ctx.strokeStyle = PAL.stickman;
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.save();
    ctx.rotate(legSwing * Math.PI / 180);
    ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-6, 16); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.rotate(legSwing2 * Math.PI / 180);
    ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(6, 16); ctx.stroke();
    ctx.restore();
  }

  // ── Torso ─────────────────────────
  ctx.strokeStyle = PAL.stickman;
  ctx.lineWidth   = 2.5;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -24); ctx.stroke();

  // ── Arms ──────────────────────────
  const armAngleBase = sm.sleeping ? 40 : sm.eating ? 30 : -20;
  const armWave = sm.eating ? Math.sin(ts * 0.01) * 15 : sm.armSwing * 30;

  ctx.save();
  ctx.translate(0, -18);
  // Left arm
  ctx.save();
  ctx.rotate((armAngleBase + armWave) * Math.PI / 180);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-14, 10); ctx.stroke();
  ctx.restore();
  // Right arm
  ctx.save();
  ctx.rotate((-armAngleBase - armWave) * Math.PI / 180);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14, 10); ctx.stroke();
  ctx.restore();
  ctx.restore();

  // ── Head ──────────────────────────
  ctx.save();
  ctx.translate(0, headY);
  ctx.rotate(sm.headTilt);

  // Neck
  ctx.strokeStyle = PAL.stickman;
  ctx.lineWidth   = 2;
  ctx.beginPath(); ctx.moveTo(0, headR); ctx.lineTo(0, headR + 6); ctx.stroke();

  // Head circle
  ctx.fillStyle   = PAL.stickman;
  ctx.strokeStyle = PAL.stickmanDark;
  ctx.lineWidth   = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, headR, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // Eyes
  drawEyes(ctx, sm);

  // Mouth
  drawMouth(ctx, sm);

  ctx.restore();

  // ── Sleep Zs ──────────────────────
  if (sm.sleeping) {
    ctx.restore();
    sm.sleepZs.forEach(z => {
      const alpha = z.life / 1500;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = '#e0f0ff';
      ctx.font        = 'bold 14px Caveat';
      ctx.textAlign   = 'center';
      ctx.fillText('z', z.x - sm.x, z.y - sm.y - bodyOffsetY);
      ctx.restore();
    });
    return;
  }

  ctx.restore();
}

function drawEyes(ctx, sm) {
  const eyeOffsets = [-4, 4];
  eyeOffsets.forEach(ox => {
    if (sm.blinking) {
      // Closed eye
      ctx.strokeStyle = '#1a1208';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(ox - 2, -1); ctx.lineTo(ox + 2, -1);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#1a1208';
      let eyeH = 2;
      if (sm.expression === 'angry')     eyeH = 1.5;
      if (sm.expression === 'surprised') eyeH = 3.5;
      ctx.beginPath();
      ctx.ellipse(ox, -1, 2, eyeH, 0, 0, Math.PI * 2);
      ctx.fill();
      // Pupil shine
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(ox + 0.8, -1.5, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Eyebrows
  if (sm.expression === 'angry') {
    ctx.strokeStyle = '#1a1208';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(-2, -3.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6,  -5); ctx.lineTo(2,  -3.5); ctx.stroke();
  } else if (sm.expression === 'sad') {
    ctx.strokeStyle = '#1a1208';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(-6, -3.5); ctx.lineTo(-2, -5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6,  -3.5); ctx.lineTo(2,  -5); ctx.stroke();
  }
}

function drawMouth(ctx, sm) {
  ctx.strokeStyle = '#1a1208';
  ctx.lineWidth   = 1.5;
  ctx.lineCap     = 'round';
  ctx.beginPath();

  switch (sm.expression) {
    case 'happy':
      ctx.arc(0, 3, 4, 0.15 * Math.PI, 0.85 * Math.PI);
      break;
    case 'sad':
      ctx.arc(0, 8, 4, 1.2 * Math.PI, 1.8 * Math.PI);
      break;
    case 'angry':
      ctx.moveTo(-4, 6); ctx.lineTo(4, 4);
      break;
    case 'surprised':
      ctx.ellipse(0, 5, 3, 4, 0, 0, Math.PI * 2);
      break;
    default:
      ctx.moveTo(-3, 5); ctx.lineTo(3, 5);
  }
  ctx.stroke();
}

// ─── Utility drawing ─────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── User Interaction ────────────────────────────────────
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * (W / rect.width);
  const cy = (e.clientY - rect.top)  * (H / rect.height);
  const d  = dist({ x: cx, y: cy }, { x: stickman.x, y: stickman.y });

  if (d < 40) {
    // Clicked stickman
    memory.interactions++;
    const roll = Math.random();
    if (roll < 0.5) {
      state.anger = clamp(state.anger + rand(5, 15), 0, 100);
      stickman.expression = 'angry';
      stickman.expressionTimer = 2000;
      showThought(pickThought('angry'));
    } else {
      state.anger = clamp(state.anger - 5, 0, 100);
      state.sadness = clamp(state.sadness - 10, 0, 100);
      stickman.expression = 'happy';
      stickman.expressionTimer = 2000;
      showThought(pickThought('cheerful'));
    }
  } else {
    // Clicked elsewhere — stickman gets curious
    stickman.targetX = cx;
    stickman.action  = 'explore';
    stickman.actionTimer = rand(3000, 6000);
    showThought(pickThought('exploring'));
  }
});

document.getElementById('btn-click-happy').addEventListener('click', () => {
  state.sadness = clamp(state.sadness - 20, 0, 100);
  state.anger   = clamp(state.anger   - 15, 0, 100);
  state.boredom = clamp(state.boredom - 10, 0, 100);
  stickman.expression = 'happy';
  stickman.expressionTimer = 3000;
  showThought(pickThought('cheerful'));
  addMemory('😊 Someone cheered me up!');
  memory.interactions++;
});

document.getElementById('btn-click-angry').addEventListener('click', () => {
  state.anger   = clamp(state.anger   + 20, 0, 100);
  state.sadness = clamp(state.sadness + 5,  0, 100);
  stickman.expression = 'angry';
  stickman.expressionTimer = 3000;
  showThought(pickThought('angry'));
  addMemory('😠 Someone annoyed me!');
  memory.interactions++;
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('Reset the world? All memories will be lost.')) {
    localStorage.removeItem('stickman_state');
    localStorage.removeItem('stickman_memory');
    location.reload();
  }
});

// ─── Init ─────────────────────────────────────────────────
load();
spawnObjects();
stickman = createStickman();
renderMemoryLog();

// Kick off first decision
setTimeout(() => {
  decideAction();
  requestAnimationFrame(ts => {
    lastTime = ts;
    update(ts);
  });
}, 200);

// Save on page hide
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
window.addEventListener('beforeunload', save);
