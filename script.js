/* ═══════════════════════════════════════════════════════════════════
   STICKMAN.EXE — script.js
   Full autonomous life simulator:
   · 9-state psychology model
   · STM / LTM memory with reinforcement learning formula
   · Letter/naming system (lexicon)
   · 3 distinct worlds with autonomous navigation
   · Weighted probabilistic decision engine
   · Persistent localStorage with offline decay
═══════════════════════════════════════════════════════════════════ */

// ─── CANVAS ──────────────────────────────────────────────────────
const canvas  = document.getElementById('world');
const ctx     = canvas.getContext('2d');
const CW = canvas.width;   // 900
const CH = canvas.height;  // 420
const GROUND = CH - 75;

// ─── UTIL ────────────────────────────────────────────────────────
const clamp = (v,lo,hi) => Math.max(lo, Math.min(hi, v));
const rand  = (a,b) => a + Math.random()*(b-a);
const randInt = (a,b) => Math.floor(rand(a,b));
const dist  = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
const lerp  = (a,b,t) => a+(b-a)*t;
const now   = () => Date.now();
const ts    = () => {
  const d=new Date(); 
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

// ─── WORLD DEFINITIONS ───────────────────────────────────────────
const WORLD_DEFS = [
  {
    id: 0,
    name: 'NIGHT WORLD',
    subtitle: 'Box & Triangle',
    skyTop: '#050810',
    skyBot: '#0d1525',
    groundCol: '#111820',
    grassCol: '#1a2830',
    ambientLight: 0.35,
    stars: true,
    moon: true,
    fog: true,
    objects: [
      { type:'box',      x:180, y:GROUND-36, w:46, h:46, letter:null, knownCount:0 },
      { type:'triangle', x:380, y:GROUND,    size:42,   letter:null, knownCount:0 },
      { type:'box',      x:620, y:GROUND-28, w:36, h:36, letter:null, knownCount:0 },
      { type:'triangle', x:780, y:GROUND,    size:32,   letter:null, knownCount:0 },
    ]
  },
  {
    id: 1,
    name: 'ANIMAL WORLD',
    subtitle: 'Dog & Raw Meat',
    skyTop: '#0e1a0a',
    skyBot: '#1a3010',
    groundCol: '#1a2212',
    grassCol: '#2a4a1a',
    ambientLight: 0.7,
    stars: false,
    moon: false,
    fog: false,
    objects: [
      { type:'rawmeat',  x:200, y:GROUND-10, letter:null, knownCount:0 },
      { type:'dog',      x:350, y:GROUND,    letter:null, knownCount:0, eating:false, eatTimer:0 },
      { type:'rawmeat',  x:560, y:GROUND-10, letter:null, knownCount:0 },
      { type:'bone',     x:720, y:GROUND-10, letter:null, knownCount:0 },
    ]
  },
  {
    id: 2,
    name: 'FIRE WORLD',
    subtitle: 'Cook & Learn',
    skyTop: '#1a0800',
    skyBot: '#2d1200',
    groundCol: '#201008',
    grassCol: '#3a1a08',
    ambientLight: 0.9,
    stars: false,
    moon: false,
    fog: false,
    objects: [
      { type:'fire',     x:160, y:GROUND,    letter:null, knownCount:0, frame:0 },
      { type:'rawmeat',  x:300, y:GROUND-10, letter:null, knownCount:0 },
      { type:'fire',     x:520, y:GROUND,    letter:null, knownCount:0, frame:Math.PI },
      { type:'cookedmeat', x:680, y:GROUND-10, letter:null, knownCount:0 },
      { type:'triangle', x:820, y:GROUND,    size:30, letter:null, knownCount:0 },
    ]
  }
];

// ─── LEARNING CONSTANTS ───────────────────────────────────────────
const ALPHA = 0.4;   // interaction_success weight
const BETA  = 0.3;   // frequency weight
const GAMMA = 0.2;   // curiosity modifier
const DELTA = 0.3;   // error/frustration penalty
const LTM_THRESHOLD = 1.2;
const STM_DECAY_RATE = 0.0002; // per ms

// Type → letter mapping (first seen gets assigned)
const TYPE_LETTERS = {
  box:        'B', triangle:'T', fire:'F', rawmeat:'R',
  dog:        'D', bone:'N',     cookedmeat:'C', plate:'P'
};

// ─── STATE ────────────────────────────────────────────────────────
let psy, memory, lexicon, stickman, worlds, currentWorldIndex, activeObjects;
let lastTime = 0, saveTimer = 0, thoughtTimer = 0, currentThought = '';
let thoughtQueue = [];

function defaultPsy() {
  return {
    hunger:     30, energy:  80, boredom:  20,
    anger:       0, sadness:  0, happy:    50,
    curiosity:  60, fear:    15, confidence: 55,
    stomachAche: false,
    lastSaved: now()
  };
}

function defaultMemory() {
  return {
    stm: [],   // { id, text, strength, time, worldId }
    ltm: [],   // { rule, evidence, score }
    log: []    // { ts, text }
  };
}

function defaultLexicon() {
  return {};  // type → { letter, seen, interactions, successes, failures }
}

// ─── SAVE / LOAD ──────────────────────────────────────────────────
function save() {
  psy.lastSaved = now();
  localStorage.setItem('sm_psy',     JSON.stringify(psy));
  localStorage.setItem('sm_memory',  JSON.stringify(memory));
  localStorage.setItem('sm_lexicon', JSON.stringify(lexicon));
  localStorage.setItem('sm_world',   String(currentWorldIndex));
}

function load() {
  const rp = localStorage.getItem('sm_psy');
  const rm = localStorage.getItem('sm_memory');
  const rl = localStorage.getItem('sm_lexicon');
  const rw = localStorage.getItem('sm_world');

  psy     = rp ? JSON.parse(rp) : defaultPsy();
  memory  = rm ? JSON.parse(rm) : defaultMemory();
  lexicon = rl ? JSON.parse(rl) : defaultLexicon();
  currentWorldIndex = rw ? parseInt(rw) : 0;

  // Offline decay
  const elapsed = clamp((now() - psy.lastSaved) / 1000, 0, 3600);
  if (elapsed > 5) {
    psy.hunger    = clamp(psy.hunger    + elapsed * 0.006, 0, 100);
    psy.energy    = clamp(psy.energy    - elapsed * 0.004, 0, 100);
    psy.boredom   = clamp(psy.boredom   + elapsed * 0.005, 0, 100);
    psy.happy     = clamp(psy.happy     - elapsed * 0.003, 0, 100);
    psy.curiosity = clamp(psy.curiosity - elapsed * 0.002, 0, 100);
    psy.anger     = clamp(psy.anger     - elapsed * 0.003, 0, 100);
    psy.sadness   = clamp(psy.sadness   - elapsed * 0.002, 0, 100);
  }

  // STM decay
  const stmElapsed = now() - psy.lastSaved;
  memory.stm.forEach(e => { e.strength = clamp(e.strength - STM_DECAY_RATE * stmElapsed, 0, 1); });
  memory.stm = memory.stm.filter(e => e.strength > 0.05);
}

// ─── MEMORY HELPERS ───────────────────────────────────────────────
function addSTM(text, worldId=currentWorldIndex) {
  const existing = memory.stm.find(e => e.text === text);
  if (existing) { existing.strength = clamp(existing.strength + 0.3, 0, 1); existing.time = now(); return; }
  memory.stm.unshift({ id: now(), text, strength: 0.7, time: now(), worldId });
  if (memory.stm.length > 25) memory.stm.pop();
}

function addLTM(rule, successDelta=0, errorDelta=0) {
  const existing = memory.ltm.find(e => e.rule === rule);
  if (existing) {
    existing.score = clamp(existing.score + successDelta - errorDelta, 0, 5);
    existing.evidence++;
    return;
  }
  const score = clamp(0.5 + successDelta - errorDelta, 0, 5);
  memory.ltm.unshift({ rule, score, evidence: 1, time: now() });
  if (memory.ltm.length > 30) memory.ltm.pop();
}

function logEvent(text) {
  memory.log.unshift({ ts: ts(), text });
  if (memory.log.length > 60) memory.log.pop();
}

// ─── LEXICON ─────────────────────────────────────────────────────
function observeObject(type) {
  if (!lexicon[type]) {
    lexicon[type] = {
      letter: TYPE_LETTERS[type] || String.fromCharCode(65 + Object.keys(lexicon).length % 26),
      seen: 1, interactions: 0, successes: 0, failures: 0
    };
    const letter = lexicon[type].letter;
    queueThought(`I see ${type} → assign "${letter}"`);
    logEvent(`🔤 Learned: ${type} = "${letter}"`);
    renderLexicon(type);
  } else {
    lexicon[type].seen++;
  }
  addSTM(`Observed ${type} in World ${currentWorldIndex+1}`);
}

function computeLearningScore(type, success=false, error=false) {
  if (!lexicon[type]) return 0;
  const l = lexicon[type];
  const freq = clamp(l.seen / 10, 0, 1);
  const curio = psy.curiosity / 100;
  const iScore = success ? 1 : 0;
  const eScore = error ? 1 : 0;
  return ALPHA*iScore + BETA*freq + GAMMA*curio - DELTA*eScore;
}

function reinforceObject(type, success, error=false) {
  if (!lexicon[type]) return;
  const l = lexicon[type];
  l.interactions++;
  if (success) l.successes++;
  else if (error) l.failures++;

  const score = computeLearningScore(type, success, error);
  if (score > LTM_THRESHOLD / 3) {
    const rule = success
      ? `${type} → beneficial action`
      : `${type} → caused problem`;
    addLTM(rule, success ? score : 0, error ? score : 0);
  }
}

// ─── THOUGHT SYSTEM ───────────────────────────────────────────────
function queueThought(text, duration=3500) {
  thoughtQueue.push({ text, duration });
}

function processThoughtQueue(dt) {
  if (thoughtTimer > 0) {
    thoughtTimer -= dt;
    return;
  }
  if (thoughtQueue.length > 0) {
    const next = thoughtQueue.shift();
    showThought(next.text, next.duration);
  }
}

let thoughtEl = null, thoughtTextEl = null;
function buildThoughtBubble() {
  thoughtEl = document.createElement('div');
  thoughtEl.id = 'thought-bubble';
  thoughtEl.style.cssText = `
    position:absolute; pointer-events:none; z-index:15;
    background:rgba(240,248,255,0.96); color:#0b0c10;
    font-family:'Nunito',sans-serif; font-weight:800; font-size:13px;
    padding:7px 14px; border-radius:18px;
    border:2px solid rgba(0,229,255,0.5);
    box-shadow:0 4px 20px rgba(0,0,0,0.5), 0 0 15px rgba(0,229,255,0.2);
    white-space:nowrap; transform:translateX(-50%);
    transition:opacity 0.3s ease; opacity:0;
    max-width:280px; white-space:normal; text-align:center;
  `;
  thoughtTextEl = document.createElement('span');
  thoughtEl.appendChild(thoughtTextEl);
  document.getElementById('canvas-wrap').appendChild(thoughtEl);
}

function showThought(text, duration=3500) {
  if (!thoughtEl) buildThoughtBubble();
  currentThought = text;
  thoughtTextEl.textContent = text;
  thoughtTimer = duration;

  const scaleX = canvas.offsetWidth / CW;
  const scaleY = canvas.offsetHeight / CH;
  thoughtEl.style.left = `${stickman.x * scaleX}px`;
  thoughtEl.style.top  = `${(stickman.y - 72) * scaleY}px`;
  thoughtEl.style.opacity = '1';
}

function updateThoughtPosition() {
  if (!thoughtEl || thoughtTimer <= 0) { if(thoughtEl) thoughtEl.style.opacity='0'; return; }
  const scaleX = canvas.offsetWidth / CW;
  const scaleY = canvas.offsetHeight / CH;
  thoughtEl.style.left = `${stickman.x * scaleX}px`;
  thoughtEl.style.top  = `${(stickman.y - 72) * scaleY}px`;
}

// ─── STICKMAN ─────────────────────────────────────────────────────
function createStickman() {
  return {
    x: 80, y: GROUND, dir: 1,
    vx: 0,
    action: 'idle', actionTimer: 0,
    targetX: 200,
    // animation
    legPhase: 0, armSwing: 0,
    blinkTimer: rand(2000,5000), blinking: false, blinkDuration: 0,
    headTilt: 0, headBob: 0,
    expression: 'neutral', expressionTimer: 0,
    sitting: false, sleeping: false,
    eating: false, eatTimer: 0,
    observing: false, observeTimer: 0, observeTarget: null,
    cooking: false, cookTimer: 0,
    // internal
    sleepZs: [],
    particles: [],
    worldTransitioning: false,
  };
}

// ─── WORLDS ────────────────────────────────────────────────────────
function initWorlds() {
  worlds = WORLD_DEFS.map(d => ({
    ...d,
    objects: d.objects.map(o => ({...o})) // deep copy
  }));
}

function setWorld(idx, direction='right') {
  currentWorldIndex = clamp(idx, 0, worlds.length-1);
  activeObjects = worlds[currentWorldIndex].objects;
  stickman.x = direction === 'right' ? 30 : CW - 30;
  stickman.worldTransitioning = false;
  updateWorldUI();
  showWorldTitle();
  logEvent(`🌍 Entered: ${worlds[currentWorldIndex].name}`);
  recallWorldMemory();
}

function recallWorldMemory() {
  const worldMemories = memory.stm.filter(e => e.worldId === currentWorldIndex);
  if (worldMemories.length > 0) {
    queueThought(`I remember this world… ${worldMemories[0].text.toLowerCase()}`);
  }
}

function showWorldTitle() {
  const overlay = document.getElementById('world-title-overlay');
  overlay.textContent = worlds[currentWorldIndex].name;
  overlay.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('hidden'), 2600);
}

function flashTransition() {
  const el = document.getElementById('world-flash');
  el.classList.add('flashing');
  setTimeout(() => el.classList.remove('flashing'), 500);
}

function updateWorldUI() {
  document.getElementById('world-label').textContent = `WORLD ${currentWorldIndex+1}`;
  document.querySelectorAll('.wdot').forEach((d,i) => {
    d.classList.toggle('active', i === currentWorldIndex);
  });
}

// ─── DECISION ENGINE ──────────────────────────────────────────────
const ACTIONS = [
  'sleep','eat','explore','observe','cook',
  'idle','sit','angrypace','experiment','return'
];

function computeActionScore(action) {
  const p = psy;
  // α*(internal_states) + β*(STM/LTM memory) + γ*(experience) + δ*(psychology)
  const base_weights = {
    sleep:      10, eat:       10, explore:    10, observe:    10,
    cook:       10, idle:      10, sit:        10, angrypace:  10,
    experiment: 10, return:    10
  };
  let score = base_weights[action] || 10;

  switch(action) {
    case 'sleep':
      score += 0.6 * (100-p.energy) + 0.2 * p.sadness;
      score -= 0.3 * p.curiosity;
      break;
    case 'eat': {
      score += 0.7 * p.hunger + 0.2 * p.anger;
      // LTM: if we know rawmeat causes ache, prefer to cook
      if (p.stomachAche) score -= 20;
      const cookedKnown = memory.ltm.find(e => e.rule.includes('cookedmeat') && e.rule.includes('beneficial'));
      if (cookedKnown) score += cookedKnown.score * 3;
      break;
    }
    case 'explore':
      score += 0.5 * p.boredom + 0.4 * p.curiosity + 0.2 * p.happy;
      score -= 0.3 * p.fear;
      break;
    case 'observe':
      score += 0.6 * p.curiosity + 0.2 * p.happy - 0.3 * p.fear;
      break;
    case 'cook': {
      const fireKnown = lexicon['fire'];
      if (fireKnown && fireKnown.seen > 0) score += 30;
      score += 0.4 * p.hunger + 0.5 * p.confidence;
      if (p.stomachAche) score += 25;
      break;
    }
    case 'idle':
      score += 0.3 * p.sadness + 0.1 * (100-p.energy);
      break;
    case 'sit':
      score += 0.4 * p.sadness + 0.2 * (100-p.energy) - 0.2 * p.curiosity;
      break;
    case 'angrypace':
      score += 0.6 * p.anger - 0.2 * p.happy;
      break;
    case 'experiment':
      score += 0.7 * p.curiosity + 0.5 * p.confidence - 0.4 * p.fear;
      if (p.stomachAche) score -= 15; // learned caution
      break;
    case 'return':
      score += 0.3 * (100-p.curiosity) + 0.2 * p.sadness;
      // STM: if recently in another world
      if (memory.stm.some(e => e.worldId !== currentWorldIndex)) score += 10;
      break;
  }

  // Psychology modifiers
  score += 0.15 * p.confidence * (action==='experiment'?1:0.3);
  score -= 0.15 * p.fear       * (['experiment','explore','observe'].includes(action) ? 1 : 0);

  // Random free-will factor
  score += rand(-5, 5);
  return clamp(score, 0, 200);
}

function decideAction() {
  if (stickman.sleeping || stickman.eating || stickman.observing || stickman.cooking) return;

  // Only pick valid actions based on context
  const validActions = ACTIONS.filter(a => {
    if (a === 'eat') {
      const foodObj = activeObjects.find(o => ['rawmeat','cookedmeat'].includes(o.type));
      return !!foodObj;
    }
    if (a === 'cook') {
      return !!activeObjects.find(o=>o.type==='fire') && !!activeObjects.find(o=>o.type==='rawmeat');
    }
    if (a === 'observe') {
      return activeObjects.length > 0;
    }
    if (a === 'return') {
      return worlds.length > 1;
    }
    return true;
  });

  // Score all valid actions
  const scored = validActions.map(a => ({ a, s: computeActionScore(a) }));
  scored.sort((x,y) => y.s - x.s);

  // Weighted random among top actions
  const top = scored.slice(0, 4);
  const total = top.reduce((s,e) => s + e.s, 0);
  let r = Math.random() * total;
  for (const e of top) {
    r -= e.s;
    if (r <= 0) { beginAction(e.a); return; }
  }
  beginAction(top[0].a);
}

function beginAction(action) {
  stickman.action = action;
  stickman.actionTimer = rand(3000, 7000);
  stickman.sitting  = false;
  stickman.sleeping = false;

  switch(action) {
    case 'sleep':
      stickman.sleeping = true;
      stickman.sitting  = true;
      queueThought('Sleepy… zzzz…');
      logEvent('😴 Went to sleep');
      break;

    case 'eat': {
      const targets = activeObjects.filter(o => ['rawmeat','cookedmeat'].includes(o.type));
      if (!targets.length) { beginAction('idle'); return; }
      const target = targets[randInt(0,targets.length)];
      stickman.targetX = target.x;
      queueThought(psy.hunger > 70 ? 'SO HUNGRY. Need food NOW.' : 'Feeling hungry… find food.');
      break;
    }

    case 'explore':
      stickman.targetX = rand(60, CW-60);
      if (psy.boredom > 60) queueThought('So bored… let\'s explore!');
      else if (psy.curiosity > 70) queueThought('Curious… what\'s out there?');
      break;

    case 'observe': {
      const unknowns = activeObjects.filter(o => !lexicon[o.type] || lexicon[o.type].seen < 3);
      const known    = activeObjects;
      const pool = unknowns.length > 0 ? unknowns : known;
      const target = pool[randInt(0, pool.length)];
      stickman.targetX = target.x;
      stickman.observeTarget = target;
      break;
    }

    case 'cook': {
      const fire = activeObjects.find(o => o.type==='fire');
      if (fire) {
        stickman.targetX = fire.x;
        queueThought(psy.stomachAche ? 'Stomach hurts… cook first this time!' : 'Maybe I should cook the food…');
      }
      break;
    }

    case 'idle':
      stickman.sitting = Math.random() < 0.4;
      stickman.targetX = stickman.x + rand(-40,40);
      break;

    case 'sit':
      stickman.sitting = true;
      if (psy.sadness > 50) queueThought('Feeling sad today…');
      break;

    case 'angrypace':
      stickman.targetX = rand(60, CW-60);
      queueThought('GRRRR.');
      break;

    case 'experiment': {
      const obj = activeObjects[randInt(0, activeObjects.length)];
      if (obj) {
        stickman.targetX = obj.x;
        queueThought('I want to try something…');
      }
      break;
    }

    case 'return':
      const prevWorld = (currentWorldIndex - 1 + worlds.length) % worlds.length;
      queueThought(`Going back to World ${prevWorld+1}…`);
      setTimeout(() => triggerWorldTransition('left', prevWorld), 2000);
      stickman.targetX = 10;
      break;
  }
}

// ─── WORLD TRANSITIONS ────────────────────────────────────────────
function triggerWorldTransition(direction, targetWorld) {
  if (stickman.worldTransitioning) return;
  stickman.worldTransitioning = true;
  flashTransition();
  setTimeout(() => {
    setWorld(targetWorld !== undefined ? targetWorld : (currentWorldIndex+1) % worlds.length, direction);
    stickman.action = 'idle';
    stickman.actionTimer = 2000;
    setTimeout(() => { decideAction(); }, 2500);
  }, 250);
}

// ─── ARRIVAL HANDLERS ─────────────────────────────────────────────
function handleArrival() {
  const sm = stickman;
  const action = sm.action;

  if (action === 'observe' && sm.observeTarget) {
    const target = sm.observeTarget;
    if (dist(sm, { x: target.x, y: sm.y }) < 50) {
      startObserving(target);
    }
    return;
  }

  if (action === 'cook') {
    const fire = activeObjects.find(o => o.type==='fire' && dist(sm,{x:o.x,y:sm.y})<50);
    if (fire) { startCooking(); return; }
  }

  if (action === 'eat') {
    const food = activeObjects.find(o => ['rawmeat','cookedmeat'].includes(o.type) && dist(sm,{x:o.x,y:sm.y})<50);
    if (food) { startEating(food); return; }
  }

  if (action === 'experiment') {
    const obj = activeObjects.find(o => dist(sm,{x:o.x,y:sm.y}) < 60);
    if (obj) {
      observeObject(obj.type);
      // If it's fire, celebrate
      if (obj.type === 'fire' && (!lexicon['fire'] || lexicon['fire'].seen <= 1)) {
        queueThought('FIRE!! → assign "F"! I can use this!');
        logEvent('🔥 Discovered fire!');
        addLTM('fire → can cook food', 1.5);
        psy.curiosity = clamp(psy.curiosity+15,0,100);
        psy.happy     = clamp(psy.happy+20,0,100);
        psy.fear      = clamp(psy.fear-10,0,100);
      }
    }
  }

  // Default: wander
  if (!sm.sitting) {
    sm.actionTimer = 0;
  }
}

// ─── EAT ──────────────────────────────────────────────────────────
function startEating(foodObj) {
  const sm = stickman;
  sm.eating   = true;
  sm.eatTimer = 2000;
  sm.sitting  = true;
  observeObject(foodObj.type);
  logEvent(`🍖 Started eating ${foodObj.type}`);
}

function finishEating(foodObj) {
  const sm = stickman;
  sm.eating  = false;
  sm.sitting = false;
  const idx = activeObjects.indexOf(foodObj);
  if (idx !== -1) activeObjects.splice(idx, 1);

  if (foodObj.type === 'rawmeat') {
    // Stomach ache learning loop
    const ltmKnown = memory.ltm.find(e => e.rule.includes('rawmeat') && e.rule.includes('problem'));
    if (ltmKnown && ltmKnown.score > 1.5) {
      // Already learned it's bad, cautious path
      queueThought('Ugh… raw again… I knew this would hurt.');
    } else {
      queueThought('Ugh… stomach hurts! Rawmeat → bad!');
    }
    psy.stomachAche = true;
    psy.sadness  = clamp(psy.sadness+25,0,100);
    psy.happy    = clamp(psy.happy-20,0,100);
    psy.anger    = clamp(psy.anger+10,0,100);
    psy.hunger   = clamp(psy.hunger-20,0,100);
    reinforceObject('rawmeat', false, true);
    addSTM('Ate rawmeat → stomach ache');
    addLTM('rawmeat → caused problem', 0, 0.8);
    logEvent('🤢 Stomach ache from raw meat!');
  } else {
    // Cooked meat or bone
    queueThought('Delicious! Cooked food = good!');
    psy.hunger      = clamp(psy.hunger-55,0,100);
    psy.happy       = clamp(psy.happy+20,0,100);
    psy.energy      = clamp(psy.energy+15,0,100);
    psy.stomachAche = false;
    reinforceObject(foodObj.type, true);
    addSTM(`Ate ${foodObj.type} → felt great`);
    addLTM(`${foodObj.type} → beneficial action`, 1.0);
    logEvent(`✅ Ate cooked food — delicious!`);
  }
  sm.action = 'idle';
  sm.actionTimer = 0;
}

// ─── OBSERVE ─────────────────────────────────────────────────────
function startObserving(obj) {
  const sm = stickman;
  sm.observing = true;
  sm.observeTimer = rand(2500, 4000);
  sm.observeTarget = obj;
  sm.sitting = true;
  observeObject(obj.type);

  // Dog eating raw meat → learn association
  if (obj.type === 'dog') {
    const hasMeat = activeObjects.some(o => o.type==='rawmeat');
    if (hasMeat) {
      queueThought('Dog eats animal… should I try? → "D" eats "R"…');
      addSTM('Dog eating raw meat observed');
      addLTM('dog eats rawmeat → risky for me?', 0.3);
    }
  }
}

function finishObserving() {
  const sm = stickman;
  const obj = sm.observeTarget;
  if (obj) {
    const l = lexicon[obj.type];
    const freq = l ? l.seen : 1;
    const score = computeLearningScore(obj.type);
    if (score > LTM_THRESHOLD * 0.5) {
      queueThought(`Studied "${obj.type}" → "${l?.letter}". I understand this now.`);
      logEvent(`💡 Deepened knowledge: ${obj.type}`);
      psy.curiosity = clamp(psy.curiosity+8,0,100);
      psy.boredom   = clamp(psy.boredom-15,0,100);
    } else {
      queueThought(`Hmm, still curious about "${obj.type}"…`);
    }
    reinforceObject(obj.type, true);
    obj.knownCount++;
  }
  sm.observing = false;
  sm.sitting   = false;
  sm.observeTarget = null;
  sm.action = 'idle';
  sm.actionTimer = 0;
}

// ─── COOK ─────────────────────────────────────────────────────────
function startCooking() {
  const sm = stickman;
  const meat = activeObjects.find(o => o.type === 'rawmeat');
  if (!meat) { sm.action='idle'; sm.actionTimer=0; return; }

  sm.cooking   = true;
  sm.cookTimer = 3000;
  sm.sitting   = false;
  queueThought('Cooking the meat over fire! → "F"+"R" = "C"!');
  logEvent('🔥 Started cooking…');
  addSTM('Used fire to cook meat');

  setTimeout(() => {
    sm.cooking = false;
    const idx = activeObjects.indexOf(meat);
    if (idx !== -1) {
      activeObjects[idx] = { type:'cookedmeat', x:meat.x+rand(-20,20), y:GROUND-10, letter:null, knownCount:0 };
      observeObject('cookedmeat');
    }
    psy.confidence = clamp(psy.confidence+15,0,100);
    psy.happy      = clamp(psy.happy+10,0,100);
    reinforceObject('fire', true);
    addLTM('fire + rawmeat → cookedmeat → good food', 1.2);
    logEvent('✅ Successfully cooked meat!');
    queueThought('I cooked it! Triangle + Fire = Plate idea! "T"+"F"="P"!');
    // Reward: assign plate concept
    if (!lexicon['plate']) {
      lexicon['plate'] = { letter:'P', seen:1, interactions:0, successes:1, failures:0 };
      renderLexicon('plate');
    }
    sm.action = 'idle'; sm.actionTimer = 0;
  }, 3000);
}

// ─── STICKMAN UPDATE ──────────────────────────────────────────────
function updateStickman(dt) {
  const sm = stickman;

  // Sleep
  if (sm.sleeping) {
    if (psy.energy >= 95) {
      sm.sleeping = false; sm.sitting = false;
      psy.energy = 100;
      logEvent('🌅 Woke up!');
      queueThought('Good morning! Feeling fresh!');
      sm.action = 'idle'; sm.actionTimer = 0;
    }
    sm.sleepZs = sm.sleepZs.filter(z => z.life > 0);
    if (Math.random() < 0.02) sm.sleepZs.push({ x:sm.x+14, y:sm.y-32, life:1800, vy:-0.035 });
    sm.sleepZs.forEach(z => { z.y += z.vy*dt; z.life -= dt; });
    return;
  }

  // Observe timer
  if (sm.observing) {
    sm.observeTimer -= dt;
    if (sm.observeTimer <= 0) finishObserving();
    return;
  }

  // Eat timer
  if (sm.eating) {
    sm.eatTimer -= dt;
    if (sm.eatTimer <= 0) {
      const food = activeObjects.find(o => ['rawmeat','cookedmeat'].includes(o.type) && dist(sm,{x:o.x,y:sm.y})<60);
      if (food) finishEating(food);
      else { sm.eating = false; sm.sitting = false; sm.action='idle'; sm.actionTimer=0; }
    }
    return;
  }

  // Action timer
  sm.actionTimer -= dt;
  if (sm.actionTimer <= 0 && !sm.sitting) {
    decideAction();
  }

  // Movement
  const dx = sm.targetX - sm.x;
  const baseSpeed = psy.sadness > 60 ? 55 : psy.anger > 60 ? 130 : 85;
  const mood_mod  = 1 + (psy.happy/200) - (psy.sadness/300);
  const speed     = baseSpeed * mood_mod;

  if (Math.abs(dx) > 4 && !sm.sitting && !sm.observing) {
    sm.dir = dx > 0 ? 1 : -1;
    sm.x   = clamp(sm.x + sm.dir * speed * (dt/1000), 10, CW-10);
    sm.legPhase  += dt * 0.009;
    sm.armSwing   = Math.sin(sm.legPhase) * 0.45;
    sm.headBob    = Math.sin(sm.legPhase*2) * 2;

    // World edge transition
    if (sm.x >= CW-15 && !sm.worldTransitioning) {
      queueThought(`Heading to World ${(currentWorldIndex+1)%worlds.length+1}…`);
      triggerWorldTransition('right', (currentWorldIndex+1) % worlds.length);
    } else if (sm.x <= 15 && !sm.worldTransitioning && sm.action === 'return') {
      const prev = (currentWorldIndex-1+worlds.length) % worlds.length;
      triggerWorldTransition('left', prev);
    }
  } else {
    sm.legPhase = 0; sm.armSwing = 0; sm.headBob = 0;
    if (Math.abs(dx) < 10 && !sm.sitting) handleArrival();
  }

  // Blink
  sm.blinkTimer -= dt;
  if (sm.blinkTimer <= 0) {
    sm.blinking = true; sm.blinkDuration = 140;
    sm.blinkTimer = rand(2500,6000);
  }
  if (sm.blinking) { sm.blinkDuration -= dt; if (sm.blinkDuration<=0) sm.blinking=false; }

  // Head tilt
  const tiltTarget = sm.sitting ? -0.1 : psy.sadness>50 ? 0.15 : psy.anger>50 ? -0.1 : sm.observing ? 0.2 : 0;
  sm.headTilt = lerp(sm.headTilt, tiltTarget, 0.04);

  // Expression
  sm.expressionTimer -= dt;
  if (sm.expressionTimer <= 0) updateExpression();

  // Particles
  sm.particles = sm.particles.filter(p => p.life>0);
  sm.particles.forEach(p => { p.x+=p.vx*dt*0.06; p.y+=p.vy*dt*0.06; p.life-=dt; });
}

function updateExpression() {
  const p = psy;
  if (p.anger > 65)       stickman.expression = 'angry';
  else if (p.sadness > 60) stickman.expression = 'sad';
  else if (p.happy > 70)   stickman.expression = 'happy';
  else if (p.fear > 60)    stickman.expression = 'fearful';
  else                      stickman.expression = 'neutral';
  stickman.expressionTimer = 2000;
}

// ─── STATE DECAY ──────────────────────────────────────────────────
function updateStates(dt) {
  const p = psy;
  const spd = 1 / 60000;
  const sleeping = stickman.sleeping;

  p.hunger    = clamp(p.hunger    + dt*spd*4,   0, 100);
  p.energy    = clamp(p.energy    - dt*spd*(sleeping ? -10 : 3), 0, 100);
  p.boredom   = clamp(p.boredom   + dt*spd*(sleeping ? 0 : 2.5), 0, 100);
  p.anger     = clamp(p.anger     - dt*spd*2,   0, 100);
  p.sadness   = clamp(p.sadness   - dt*spd*1,   0, 100);
  p.happy     = clamp(p.happy     - dt*spd*1.5, 0, 100);
  p.curiosity = clamp(p.curiosity + dt*spd*(p.boredom>50?1.5:-0.5), 0, 100);
  p.fear      = clamp(p.fear      - dt*spd*1,   0, 100);
  p.confidence= clamp(p.confidence+ dt*spd*0.5, 0, 100);

  // STM decay
  memory.stm.forEach(e => { e.strength = clamp(e.strength - STM_DECAY_RATE*dt, 0, 1); });
  memory.stm = memory.stm.filter(e => e.strength > 0.05);

  // Hunger hurts
  if (p.hunger > 85) { p.happy = clamp(p.happy-dt*spd*3,0,100); p.anger=clamp(p.anger+dt*spd*2,0,100); }
  if (p.stomachAche) { p.happy = clamp(p.happy-dt*spd*2,0,100); p.sadness=clamp(p.sadness+dt*spd*3,0,100); }
  // Energy crash
  if (p.energy < 15) { p.sadness=clamp(p.sadness+dt*spd*4,0,100); }
}

// ─── HUD ─────────────────────────────────────────────────────────
function updateHUD() {
  const keys = ['hunger','energy','boredom','anger','sadness','happy','curiosity','fear','confidence'];
  keys.forEach(k => {
    const v = Math.round(psy[k]);
    const bar = document.getElementById(`sb-${k}`);
    const val = document.getElementById(`sv-${k}`);
    if (bar) bar.style.width = `${v}%`;
    if (val) val.textContent = v;
  });
}

// ─── MEMORY UI ───────────────────────────────────────────────────
function renderMemoryUI() {
  document.getElementById('mem-stm').innerHTML =
    memory.stm.map(e => `<div class="mem-entry stm ${e.strength<0.3?'decay':''}">
      <span class="ts">[STM]</span>${e.text} <span style="color:var(--muted);font-size:9px">(${(e.strength*100).toFixed(0)}%)</span>
    </div>`).join('') || '<div class="mem-entry" style="color:var(--muted)">No short-term memories.</div>';

  document.getElementById('mem-ltm').innerHTML =
    memory.ltm.map(e => `<div class="mem-entry ltm">
      <span class="ts">[LTM]</span>${e.rule} <span style="color:var(--accent3);font-size:9px">×${e.evidence} (${e.score.toFixed(1)})</span>
    </div>`).join('') || '<div class="mem-entry" style="color:var(--muted)">No long-term memories.</div>';

  document.getElementById('mem-log').innerHTML =
    memory.log.map(e => `<div class="mem-entry log">
      <span class="ts">${e.ts}</span>${e.text}
    </div>`).join('') || '<div class="mem-entry" style="color:var(--muted)">No events yet.</div>';
}

// ─── LEXICON UI ───────────────────────────────────────────────────
function renderLexicon(highlightType=null) {
  const grid = document.getElementById('lexicon-grid');
  grid.innerHTML = '';
  Object.entries(lexicon).forEach(([type, data]) => {
    const card = document.createElement('div');
    card.className = 'lex-card' + (type === highlightType ? ' new-card' : '');
    card.title = `${type}: seen ${data.seen}×, success ${data.successes}, fail ${data.failures}`;
    card.innerHTML = `<span class="lex-letter">${data.letter}</span><span class="lex-word">${type}</span>`;
    grid.appendChild(card);
  });
}

// ─── DRAW WORLD ───────────────────────────────────────────────────
function drawWorld(ts) {
  const w = worlds[currentWorldIndex];
  ctx.clearRect(0,0,CW,CH);

  // Sky
  const sky = ctx.createLinearGradient(0,0,0,GROUND);
  sky.addColorStop(0, w.skyTop);
  sky.addColorStop(1, w.skyBot);
  ctx.fillStyle = sky;
  ctx.fillRect(0,0,CW,GROUND);

  // Stars
  if (w.stars) drawStars(ts);

  // Moon
  if (w.moon) drawMoon();

  // Fog
  if (w.fog) drawFog(ts);

  // Ground
  ctx.fillStyle = w.groundCol;
  ctx.fillRect(0, GROUND, CW, CH-GROUND);
  ctx.fillStyle = w.grassCol;
  ctx.fillRect(0, GROUND, CW, 8);

  // Ground details
  for (let x=0; x<CW; x+=22) {
    ctx.fillStyle = `rgba(0,0,0,0.15)`;
    ctx.beginPath(); ctx.ellipse(x, GROUND+3, 4, 2, 0, 0, Math.PI); ctx.fill();
  }

  // Objects
  activeObjects.forEach(o => drawObject(o, ts));
}

const _stars = Array.from({length:80}, () => ({ x:rand(0,900), y:rand(0,300), r:rand(0.3,1.8), t:rand(0,Math.PI*2) }));
function drawStars(ts) {
  _stars.forEach(s => {
    const alpha = 0.4 + 0.5*Math.sin(ts*0.001+s.t);
    ctx.save(); ctx.globalAlpha=alpha; ctx.fillStyle='rgba(200,220,255,0.9)';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill(); ctx.restore();
  });
}

function drawMoon() {
  ctx.save();
  ctx.fillStyle = '#f8f0d0'; ctx.shadowColor='#f8f0d0'; ctx.shadowBlur=25;
  ctx.beginPath(); ctx.arc(820, 55, 26, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = worlds[currentWorldIndex].skyTop;
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(832, 48, 20, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawFog(ts) {
  for (let i=0; i<3; i++) {
    const grad = ctx.createLinearGradient(0,GROUND-80,0,GROUND);
    grad.addColorStop(0,'transparent');
    grad.addColorStop(1,`rgba(10,20,40,${0.25+0.1*Math.sin(ts*0.0005+i)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, GROUND-80, CW, 80);
  }
}

function drawObject(obj, ts) {
  ctx.save();
  ctx.translate(obj.x, obj.y);

  const known   = lexicon[obj.type];
  const glowing = known && known.seen >= 3;

  switch(obj.type) {
    case 'box':
      ctx.strokeStyle = glowing ? '#00e5ff' : '#5a7a9a';
      ctx.lineWidth   = glowing ? 2 : 1.5;
      if (glowing) ctx.shadowColor='#00e5ff', ctx.shadowBlur=10;
      ctx.fillStyle = '#1a2a3a';
      ctx.fillRect(-obj.w/2, -obj.h, obj.w, obj.h);
      ctx.strokeRect(-obj.w/2, -obj.h, obj.w, obj.h);
      if (known) {
        ctx.fillStyle=glowing?'#00e5ff':'#4a6a8a'; ctx.font='bold 13px VT323';
        ctx.textAlign='center'; ctx.fillText(known.letter, 0, -obj.h/2+5);
      }
      break;

    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(0, -obj.size);
      ctx.lineTo(obj.size*0.9, 0);
      ctx.lineTo(-obj.size*0.9, 0);
      ctx.closePath();
      ctx.fillStyle = '#1a3a2a';
      ctx.fill();
      ctx.strokeStyle = glowing ? '#b8ff57' : '#3a7a5a';
      ctx.lineWidth = glowing ? 2 : 1.5;
      if (glowing) ctx.shadowColor='#b8ff57', ctx.shadowBlur=10;
      ctx.stroke();
      if (known) {
        ctx.fillStyle=glowing?'#b8ff57':'#5a9a7a'; ctx.font='bold 13px VT323';
        ctx.textAlign='center'; ctx.fillText(known.letter, 0, -obj.size*0.35);
      }
      break;

    case 'rawmeat':
      ctx.fillStyle = '#c03030'; ctx.shadowColor='#c03030'; ctx.shadowBlur=glowing?8:3;
      ctx.beginPath(); ctx.ellipse(0,-8,14,9,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#802020';
      ctx.beginPath(); ctx.ellipse(-4,-9,5,3,-.3,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5,-8,4,3,.2,0,Math.PI*2); ctx.fill();
      if (known) {
        ctx.fillStyle='#ff6060'; ctx.font='bold 12px VT323'; ctx.textAlign='center';
        ctx.fillText(known.letter, 0, -22);
      }
      break;

    case 'cookedmeat':
      ctx.fillStyle = '#8b4513'; ctx.shadowColor='#ff9500'; ctx.shadowBlur=glowing?10:4;
      ctx.beginPath(); ctx.ellipse(0,-8,14,9,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#c06020';
      ctx.beginPath(); ctx.ellipse(-4,-9,5,3,-.3,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5,-8,4,3,.2,0,Math.PI*2); ctx.fill();
      // Steam
      for (let i=0;i<2;i++){
        ctx.strokeStyle=`rgba(200,200,200,0.4)`; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(-4+i*8,-18); ctx.bezierCurveTo(-4+i*8,-26,-4+i*8+4,-30,-4+i*8,-34); ctx.stroke();
      }
      if (known) {
        ctx.fillStyle='#ffa060'; ctx.font='bold 12px VT323'; ctx.textAlign='center';
        ctx.fillText(known.letter, 0, -22);
      }
      break;

    case 'bone':
      ctx.fillStyle='#d4c8a0'; ctx.shadowBlur=glowing?6:0; ctx.shadowColor='#d4c8a0';
      ctx.fillRect(-3,-14,6,14);
      [[-6,-2],[0,-2]].forEach(([ox])=>{
        ctx.beginPath(); ctx.arc(ox,-14,4,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(ox,0,4,0,Math.PI*2); ctx.fill();
      });
      if (known){ ctx.fillStyle='#d4c8a0'; ctx.font='bold 12px VT323'; ctx.textAlign='center'; ctx.fillText(known.letter,0,-22); }
      break;

    case 'dog':
      drawDog(ctx, ts, obj);
      if (known){ ctx.fillStyle='#ff9500'; ctx.font='bold 12px VT323'; ctx.textAlign='center'; ctx.fillText(known.letter,0,-36); }
      break;

    case 'fire':
      drawFire(ctx, ts, obj);
      if (known){ ctx.fillStyle='#ff6b00'; ctx.font='bold 13px VT323'; ctx.textAlign='center'; ctx.fillText(known.letter,0,-46); }
      break;
  }

  ctx.restore();
}

function drawDog(ctx, ts, obj) {
  const bob = Math.sin(ts*0.003)*2;
  // Body
  ctx.fillStyle='#a07040';
  ctx.fillRect(-18, -24+bob, 36, 18);
  // Head
  ctx.fillRect(-20, -32+bob, 14, 12);
  // Ear
  ctx.fillRect(-24,-28+bob,6,8);
  // Tail
  ctx.save(); ctx.translate(18,-20+bob);
  ctx.rotate(0.4+Math.sin(ts*0.005)*0.3);
  ctx.fillRect(0,-2,14,4); ctx.restore();
  // Legs
  for (let i=0;i<4;i++){
    const lx=-12+i*8, lphase=Math.sin(ts*0.004+(i%2)*Math.PI)*3;
    ctx.fillRect(lx,-6+bob+lphase,4,12);
  }
  // Eye
  ctx.fillStyle='#1a1a1a';
  ctx.beginPath(); ctx.arc(-18,-27+bob,2,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(-17,-28+bob,0.8,0,Math.PI*2); ctx.fill();
}

function drawFire(ctx, ts, obj) {
  // Logs
  ctx.fillStyle='#5a3020';
  ctx.fillRect(-20,-6,40,6); ctx.fillRect(-14,-4,10,8); ctx.fillRect(4,-4,10,8);

  // Flame tiers
  const flicker = Math.sin(ts*0.005+obj.frame)*4;
  const tiers=[
    {c:'rgba(255,240,140,0.9)', sx:0.55, dy:flicker*0.3},
    {c:'rgba(255,200,60,0.85)', sx:0.75, dy:flicker*0.6},
    {c:'rgba(255,130,30,0.9)',  sx:0.9,  dy:flicker},
    {c:'rgba(220,60,10,0.85)', sx:1.0,  dy:flicker*1.2},
  ];
  tiers.forEach(t=>{
    ctx.fillStyle=t.c; ctx.shadowColor=t.c; ctx.shadowBlur=16;
    ctx.beginPath();
    ctx.moveTo(-13*t.sx,-4);
    ctx.bezierCurveTo(-10*t.sx,-20*t.sx+t.dy,0,-32*t.sx,0,-34*t.sx);
    ctx.bezierCurveTo(0,-32*t.sx,10*t.sx,-20*t.sx+t.dy,13*t.sx,-4);
    ctx.closePath(); ctx.fill();
  });
  // Embers
  ctx.shadowBlur=0;
  for(let i=0;i<5;i++){
    const ex=Math.sin(ts*0.003+i*1.3)*16;
    const ey=-Math.abs(Math.sin(ts*0.005+i))*28-6;
    ctx.fillStyle=['#ff9500','#ffcc00','#ff6b00'][i%3];
    ctx.beginPath(); ctx.arc(ex,ey,1.3,0,Math.PI*2); ctx.fill();
  }
}

// ─── DRAW STICKMAN ────────────────────────────────────────────────
function drawStickman(ts) {
  const sm = stickman;
  ctx.save();
  ctx.translate(sm.x, GROUND);
  ctx.scale(sm.dir, 1);

  let bodyY = 0;
  if (sm.sleeping) bodyY = 8;
  else if (sm.sitting) bodyY = 4;
  ctx.translate(0, bodyY);

  // Shadow
  ctx.save(); ctx.globalAlpha=0.25; ctx.fillStyle='#000';
  ctx.beginPath(); ctx.ellipse(0, 2, 14, 4, 0, 0, Math.PI*2); ctx.fill(); ctx.restore();

  const walking = !sm.sitting && !sm.sleeping && !sm.observing && Math.abs(sm.vx||0)>0.1 || Math.abs(sm.x - sm.targetX)>8;

  // ── Legs ──
  ctx.strokeStyle='#f0ddb8'; ctx.lineWidth=2.8; ctx.lineCap='round';
  if (sm.sleeping || sm.sitting) {
    ctx.beginPath(); ctx.moveTo(-2,0); ctx.lineTo(-12,10); ctx.lineTo(-5,18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2,0);  ctx.lineTo(12,10);  ctx.lineTo(5,18);  ctx.stroke();
  } else {
    const lswing = walking ? Math.sin(sm.legPhase)*20 : 0;
    ctx.save(); ctx.rotate(lswing*Math.PI/180);
    ctx.beginPath(); ctx.moveTo(-3,0); ctx.lineTo(-6,18); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.rotate(-lswing*Math.PI/180);
    ctx.beginPath(); ctx.moveTo(3,0); ctx.lineTo(6,18); ctx.stroke(); ctx.restore();
  }

  // ── Torso ──
  ctx.strokeStyle='#f0ddb8'; ctx.lineWidth=2.8;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-26); ctx.stroke();

  // ── Arms ──
  const armBase = sm.sleeping ? 45 : sm.eating||sm.cooking ? 35 : -15;
  const armWave = sm.eating||sm.cooking ? Math.sin(ts*0.008)*18 : walking ? sm.armSwing*28 : 0;
  ctx.save(); ctx.translate(0,-18);
  ctx.save(); ctx.rotate((armBase+armWave)*Math.PI/180);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-16,12); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.rotate((-armBase-armWave)*Math.PI/180);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(16,12); ctx.stroke(); ctx.restore();
  ctx.restore();

  // ── Head ──
  const headY = sm.sleeping ? -20 : -38 + sm.headBob*0.4;
  ctx.save();
  ctx.translate(0, headY);
  ctx.rotate(sm.headTilt);

  // Neck
  ctx.strokeStyle='#f0ddb8'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(0,10); ctx.lineTo(0,14); ctx.stroke();

  // Head circle
  ctx.fillStyle='#f0ddb8'; ctx.strokeStyle='#c4a870'; ctx.lineWidth=1.5;
  ctx.shadowColor='rgba(240,221,184,0.2)'; ctx.shadowBlur=6;
  ctx.beginPath(); ctx.arc(0,0,11,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.shadowBlur=0;

  // Observation headband
  if (sm.observing) {
    ctx.strokeStyle='#00e5ff'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(0,0,13,-.8*Math.PI,.8*Math.PI,false); ctx.stroke();
  }

  drawEyes(ctx, sm);
  drawMouth(ctx, sm);

  ctx.restore();

  // ── Sleep Zs ──
  if (sm.sleeping) {
    ctx.restore();
    sm.sleepZs.forEach(z=>{
      ctx.save(); ctx.globalAlpha=z.life/1800;
      ctx.fillStyle='#c0d8ff'; ctx.font='bold 14px VT323'; ctx.textAlign='center';
      ctx.fillText('z', z.x-sm.x, z.y-GROUND-bodyY); ctx.restore();
    });
    return;
  }

  // ── Particles (cooking/happiness) ──
  ctx.restore();
  sm.particles.forEach(p=>{
    ctx.save(); ctx.globalAlpha=p.life/600;
    ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); ctx.restore();
  });

  ctx.restore();
}

function drawEyes(ctx, sm) {
  const eyes=[-4,4];
  eyes.forEach(ox=>{
    if (sm.blinking) {
      ctx.strokeStyle='#1a1208'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(ox-2,-0.5); ctx.lineTo(ox+2,-0.5); ctx.stroke();
    } else {
      ctx.fillStyle='#1a1208';
      const ey = sm.expression==='surprised' ? 3.5 : sm.expression==='angry' ? 1.5 : 2;
      ctx.beginPath(); ctx.ellipse(ox,-1,2,ey,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.65)';
      ctx.beginPath(); ctx.arc(ox+0.8,-1.6,0.7,0,Math.PI*2); ctx.fill();
    }
  });
  // Eyebrows
  if (sm.expression==='angry'){
    ctx.strokeStyle='#1a1208'; ctx.lineWidth=1.6;
    ctx.beginPath(); ctx.moveTo(-6,-5.5); ctx.lineTo(-2,-4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6,-5.5); ctx.lineTo(2,-4); ctx.stroke();
  } else if (sm.expression==='sad'){
    ctx.strokeStyle='#1a1208'; ctx.lineWidth=1.6;
    ctx.beginPath(); ctx.moveTo(-6,-4); ctx.lineTo(-2,-5.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6,-4); ctx.lineTo(2,-5.5); ctx.stroke();
  } else if (sm.expression==='fearful'){
    ctx.strokeStyle='#1a1208'; ctx.lineWidth=1.6;
    ctx.beginPath(); ctx.moveTo(-6,-3); ctx.lineTo(-2,-5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6,-3); ctx.lineTo(2,-5); ctx.stroke();
  }
}

function drawMouth(ctx, sm) {
  ctx.strokeStyle='#1a1208'; ctx.lineWidth=1.6; ctx.lineCap='round';
  ctx.beginPath();
  switch(sm.expression){
    case 'happy':    ctx.arc(0,3,4,0.15*Math.PI,0.85*Math.PI); break;
    case 'sad':      ctx.arc(0,8,4,1.2*Math.PI,1.8*Math.PI); break;
    case 'angry':    ctx.moveTo(-4,6); ctx.lineTo(4,4); break;
    case 'fearful':  ctx.arc(0,5,3,0,Math.PI*2); break;
    case 'surprised': ctx.ellipse(0,5,3,4,0,0,Math.PI*2); break;
    default:         ctx.moveTo(-3,5); ctx.lineTo(3,5);
  }
  ctx.stroke();
}

// ─── INTERACTION ─────────────────────────────────────────────────
canvas.addEventListener('click', e=>{
  const rect=canvas.getBoundingClientRect();
  const cx=(e.clientX-rect.left)*(CW/rect.width);
  const cy=(e.clientY-rect.top)*(CH/rect.height);
  const d=dist({x:cx,y:cy},{x:stickman.x,y:GROUND});
  if (d<45){
    logEvent('👆 User interacted');
    if (Math.random()<0.45){
      psy.anger=clamp(psy.anger+12,0,100);
      stickman.expression='angry'; stickman.expressionTimer=2500;
      queueThought('Hey! Stop that!');
    } else {
      psy.happy=clamp(psy.happy+15,0,100); psy.sadness=clamp(psy.sadness-10,0,100);
      stickman.expression='happy'; stickman.expressionTimer=2500;
      queueThought(':)');
    }
    // Burst particles
    for(let i=0;i<8;i++){
      stickman.particles.push({
        x:stickman.x, y:GROUND-20,
        vx:rand(-1,1), vy:rand(-1,0),
        r:rand(1.5,3.5), life:500+rand(0,300),
        color:['#ffdd44','#00e5ff','#ff6b35','#b8ff57'][randInt(0,4)]
      });
    }
  } else {
    stickman.targetX=clamp(cx,20,CW-20);
    stickman.action='explore'; stickman.actionTimer=rand(3000,6000);
    stickman.sitting=false;
  }
});

document.getElementById('btn-cheer').addEventListener('click',()=>{
  psy.happy=clamp(psy.happy+20,0,100); psy.sadness=clamp(psy.sadness-15,0,100);
  psy.anger=clamp(psy.anger-10,0,100);
  stickman.expression='happy'; stickman.expressionTimer=3000;
  queueThought('Yay! I feel great!');
  logEvent('😊 Cheered up by user');
});

document.getElementById('btn-annoy').addEventListener('click',()=>{
  psy.anger=clamp(psy.anger+25,0,100);
  stickman.expression='angry'; stickman.expressionTimer=3000;
  queueThought('LEAVE ME ALONE!');
  logEvent('😤 Annoyed by user');
});

document.getElementById('btn-feed').addEventListener('click',()=>{
  // Spawn a cooked meat near stickman
  activeObjects.push({ type:'cookedmeat', x:stickman.x+rand(30,70)*stickman.dir, y:GROUND-10, letter:null, knownCount:0 });
  queueThought('Food! Awesome!');
  logEvent('🍖 User dropped food');
});

document.getElementById('btn-reset').addEventListener('click',()=>{
  if (confirm('Reset everything? All memories and progress will be lost.')) {
    ['sm_psy','sm_memory','sm_lexicon','sm_world'].forEach(k=>localStorage.removeItem(k));
    location.reload();
  }
});

// Memory tabs
document.querySelectorAll('.mem-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.mem-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const id = tab.dataset.tab;
    document.querySelectorAll('.mem-content').forEach(c=>c.classList.toggle('hidden', !c.id.endsWith(id)));
  });
});

// ─── PASSIVE THOUGHTS ─────────────────────────────────────────────
let passiveThoughtTimer = rand(5000,12000);
function triggerPassiveThought(dt) {
  passiveThoughtTimer -= dt;
  if (passiveThoughtTimer > 0) return;
  passiveThoughtTimer = rand(6000, 14000);

  const p = psy;
  if (p.stomachAche) { queueThought('Ow… my stomach… I should cook next time.'); return; }
  if (p.hunger > 78)  { queueThought('SO HUNGRY. Need to find food.'); return; }
  if (p.hunger > 55)  { queueThought('A bit hungry…'); return; }
  if (p.energy < 18)  { queueThought('So tired… need to sleep.'); return; }
  if (p.boredom > 70) { queueThought('Nothing to do… maybe explore?'); return; }
  if (p.anger > 65)   { queueThought('GRRR! SO ANGRY.'); return; }
  if (p.sadness > 60) { queueThought('Feeling sad today…'); return; }
  if (p.happy > 75)   { queueThought('Life is good! :D'); return; }
  if (p.curiosity > 70) { queueThought('There\'s so much to explore!'); return; }
  // Object recall
  const ltmEntry = memory.ltm[randInt(0, Math.min(memory.ltm.length, 5))];
  if (ltmEntry) { queueThought(`I remember: "${ltmEntry.rule}"`); return; }
  // Random philosophical
  const randThoughts = [
    'What am I?', 'This world is strange…', 'I learned something today.',
    'What\'s over there?', 'I wonder…', 'I feel like exploring.'
  ];
  queueThought(randThoughts[randInt(0,randThoughts.length)]);
}

// ─── MAIN LOOP ────────────────────────────────────────────────────
let uiUpdateTimer = 0;

function loop(ts) {
  const dt = Math.min(ts - lastTime, 80);
  lastTime = ts;

  saveTimer    += dt;
  uiUpdateTimer += dt;

  if (saveTimer > 6000) { save(); saveTimer=0; }

  updateStates(dt);
  updateStickman(dt);
  processThoughtQueue(dt);
  triggerPassiveThought(dt);
  updateThoughtPosition();

  // Draw
  drawWorld(ts);
  drawStickman(ts);

  // Update UI every 500ms for perf
  if (uiUpdateTimer > 500) {
    updateHUD();
    renderMemoryUI();
    uiUpdateTimer = 0;
  }

  requestAnimationFrame(loop);
}

// ─── INIT ────────────────────────────────────────────────────────
function init() {
  load();
  initWorlds();
  stickman = createStickman();
  activeObjects = worlds[currentWorldIndex].objects;
  updateWorldUI();
  renderLexicon();
  renderMemoryUI();
  updateHUD();

  // Welcome thought
  const hasMemory = memory.ltm.length > 0;
  setTimeout(()=>{
    if (hasMemory) queueThought(`I remember things… ${memory.ltm[0]?.rule?.slice(0,30)}`);
    else queueThought('I am… alive. Where am I?');
  }, 600);

  setTimeout(()=>decideAction(), 1200);

  requestAnimationFrame(ts=>{
    lastTime = ts;
    loop(ts);
  });
}

window.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') save(); });
window.addEventListener('beforeunload', save);

init();
