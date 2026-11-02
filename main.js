const arena = document.querySelector('#arena');
const playerEl = document.querySelector('#player');
const messageBox = document.querySelector('#messageBox');
const inventoryEl = document.querySelector('#inventory');
const eventLogEl = document.querySelector('#eventLog');
const objectiveList = document.querySelector('#objectiveList');
const statEls = {
  day: document.querySelector('#dayValue'),
  food: document.querySelector('#foodValue'),
  water: document.querySelector('#waterValue'),
  health: document.querySelector('#healthValue'),
  energy: document.querySelector('#energyValue'),
};

const initialEnemies = [
  { id: 'zombie1', x: 65, y: 25, hp: 40, maxHp: 40, cooldown: 0 },
  { id: 'zombie2', x: 83, y: 68, hp: 46, maxHp: 46, cooldown: 1 },
  { id: 'zombie3', x: 40, y: 80, hp: 52, maxHp: 52, cooldown: 2 },
];
const initialNodes = {
  tree: { x: 19, y: 69, kind: 'wood', amount: 4, max: 4 },
  rock: { x: 78, y: 83, kind: 'stone', amount: 3, max: 3 },
  water: { x: 54, y: 91, kind: 'water', amount: 4, max: 4 },
  foodNode: { x: 26, y: 30, kind: 'food', amount: 3, max: 3 },
};
const state = {};

function resetState() {
  Object.assign(state, {
    day: 1, food: 30, water: 28, health: 100, energy: 100,
    wood: 0, stone: 0, meds: 1, shelter: false, night: false,
    over: false, won: false, player: { x: 15, y: 48 },
    enemies: initialEnemies.map((enemy) => ({ ...enemy })),
    nodes: Object.fromEntries(Object.entries(initialNodes).map(([key, node]) => [key, { ...node }])),
    log: [],
  });
  render();
  addLog('You wake beside a cold campfire. Find supplies and make it to day five.');
  setMessage('Scavenge, survive, and defend your camp.');
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function position(el, point) {
  el.style.left = `${point.x}%`;
  el.style.top = `${point.y}%`;
}
function distance(a, b) {
  const dx = (a.x - b.x) * arena.clientWidth / 100;
  const dy = (a.y - b.y) * arena.clientHeight / 100;
  return Math.hypot(dx, dy);
}
function addLog(text) {
  state.log.unshift(text);
  state.log = state.log.slice(0, 7);
  eventLogEl.replaceChildren(...state.log.map((line) => {
    const item = document.createElement('div');
    item.textContent = line;
    return item;
  }));
}
function setMessage(text) { messageBox.textContent = text; }
function updateHud() {
  for (const [key, el] of Object.entries(statEls)) el.textContent = String(state[key]);
  inventoryEl.replaceChildren();
  [['Wood', state.wood], ['Stone', state.stone], ['Medkits', state.meds], ['Shelter', state.shelter ? 'Built' : 'None']].forEach(([name, value]) => {
    const slot = document.createElement('div');
    slot.className = `slot${value !== 0 && value !== 'None' ? ' filled' : ''}`;
    slot.textContent = `${name}: ${value}`;
    inventoryEl.append(slot);
  });
  document.querySelector('.topbar').classList.toggle('is-night', state.night);
}
function updateObjectives() {
  const tasks = [
    [state.food >= 10 && state.water >= 10, 'Keep food and water above 10'],
    [state.shelter, 'Build a shelter (4 wood, 2 stone)'],
    [state.day >= 5 && state.shelter && state.food > 0 && state.water > 0, 'Survive through day five'],
  ];
  objectiveList.replaceChildren(...tasks.map(([complete, label]) => {
    const item = document.createElement('li');
    item.textContent = label;
    if (complete) item.classList.add('complete');
    return item;
  }));
}
function syncWorld() {
  position(playerEl, state.player);
  Object.entries(state.nodes).forEach(([id, node]) => {
    const el = document.getElementById(id);
    position(el, node);
    el.classList.toggle('depleted', node.amount <= 0);
    el.setAttribute('aria-label', `${node.kind}, ${node.amount} uses left`);
  });
  position(document.querySelector('#campfire'), { x: 67, y: 43 });
  position(document.querySelector('#shelter'), { x: 30, y: 36 });
  document.querySelector('#shelter').classList.toggle('built', state.shelter);
  state.enemies.forEach((enemy) => {
    const el = document.getElementById(enemy.id);
    position(el, enemy);
    el.classList.toggle('defeated', enemy.hp <= 0);
    el.style.setProperty('--health', `${Math.max(0, enemy.hp) / enemy.maxHp * 100}%`);
  });
}
function render() {
  syncWorld();
  updateHud();
  updateObjectives();
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.disabled = state.over && button.dataset.action !== 'reset';
  });
}
function spendEnergy(amount = 1) {
  state.energy = clamp(state.energy - amount, 0, 100);
  if (state.energy === 0) setMessage('You are exhausted. Rest or use a medkit to recover.');
}
function movePlayer(dx, dy, distanceStep = 5) {
  if (state.over) return;
  const length = Math.hypot(dx, dy) || 1;
  state.player.x = clamp(state.player.x + dx / length * distanceStep, 3, 97);
  state.player.y = clamp(state.player.y + dy / length * distanceStep, 5, 95);
  spendEnergy();
  syncWorld();
  updateHud();
  checkNearbyThreats();
}
function nearestAvailable(list) {
  return list.filter((item) => item.hp === undefined ? item.amount > 0 : item.hp > 0)
    .map((item) => ({ item, distance: distance(state.player, item) }))
    .sort((a, b) => a.distance - b.distance)[0];
}
function gather() {
  if (state.over) return;
  const nearest = nearestAvailable(Object.values(state.nodes));
  if (!nearest || nearest.distance > 66) {
    setMessage('Move closer to a visible resource before gathering.');
    addLog('No supplies within reach.');
    return;
  }
  const node = nearest.item;
  node.amount -= 1;
  if (node.kind === 'wood') { state.wood += 1; addLog('Gathered 1 wood.'); setMessage('Wood added to your pack.'); }
  if (node.kind === 'stone') { state.stone += 1; addLog('Gathered 1 stone.'); setMessage('Stone added to your pack.'); }
  if (node.kind === 'water') { state.water = clamp(state.water + 12, 0, 100); addLog('Collected clean water (+12).'); setMessage('Water replenished.'); }
  if (node.kind === 'food') { state.food = clamp(state.food + 12, 0, 100); addLog('Found preserved food (+12).'); setMessage('Food replenished.'); }
  spendEnergy(2);
  render();
}
function attack() {
  if (state.over) return;
  const nearest = nearestAvailable(state.enemies);
  if (!nearest || nearest.distance > 92) {
    setMessage('No infected in range. Move closer to attack.');
    return;
  }
  nearest.item.hp = Math.max(0, nearest.item.hp - 24);
  spendEnergy(3);
  if (nearest.item.hp === 0) {
    state.food = clamp(state.food + 5, 0, 100);
    addLog('Infected defeated. Salvaged 5 food.');
    setMessage('Infected down. You salvaged supplies.');
  } else {
    addLog(`Hit an infected (${nearest.item.hp} health remaining).`);
    setMessage('Solid hit! Keep your distance.');
  }
  syncWorld();
  updateHud();
  updateObjectives();
  checkEnd();
}
function checkNearbyThreats() {
  if (!state.night || state.over) return;
  state.enemies.forEach((enemy) => {
    if (enemy.hp > 0 && distance(state.player, enemy) < 52) hurt(state.shelter ? 4 : 8, 'An infected struck you while you moved.');
  });
}
function hurt(amount, text) {
  if (state.over) return;
  state.health = clamp(state.health - amount, 0, 100);
  addLog(text);
  updateHud();
  checkEnd();
}
function rest() {
  if (state.over) return;
  if (state.meds <= 0) { setMessage('No medkits left. Defeat an infected or fortify your camp for supplies.'); return; }
  state.meds -= 1;
  state.health = clamp(state.health + 35, 0, 100);
  state.energy = clamp(state.energy + 30, 0, 100);
  addLog('Used a medkit. Health and energy restored.');
  setMessage('You patched yourself up.');
  render();
}
function buildShelter() {
  if (state.over) return;
  if (state.shelter) { setMessage('Your shelter is already built. Fortify the camp for extra protection.'); return; }
  if (state.wood < 4 || state.stone < 2) {
    setMessage(`Need ${Math.max(0, 4 - state.wood)} more wood and ${Math.max(0, 2 - state.stone)} more stone.`);
    addLog('Shelter requires 4 wood and 2 stone.');
    return;
  }
  state.wood -= 4; state.stone -= 2; state.shelter = true;
  addLog('Shelter built! It will reduce damage during the night.');
  setMessage('Shelter complete. You are safer after dark.');
  render();
}
function upgradeCamp() {
  if (state.over) return;
  if (state.wood < 2 || state.stone < 2) {
    setMessage('Fortifying camp costs 2 wood and 2 stone.');
    return;
  }
  state.wood -= 2; state.stone -= 2;
  state.meds += 1;
  state.health = clamp(state.health + 12, 0, 100);
  addLog('Fortified the camp and found a medkit.');
  setMessage('Camp fortified. Health restored and a medkit found.');
  render();
}
function endDay() {
  if (state.over) return;
  state.night = true;
  setMessage('Night falls. The infected are closing in!');
  addLog(`Night ${state.day}: hunger and thirst take their toll.`);
  state.food = clamp(state.food - 5, 0, 100);
  state.water = clamp(state.water - 6, 0, 100);
  state.energy = clamp(state.energy + 12, 0, 100);
  const nearby = state.enemies.filter((enemy) => enemy.hp > 0 && distance(state.player, enemy) < 190).length;
  if (nearby) hurt(nearby * (state.shelter ? 5 : 12), `${nearby} infected attacked during the night${state.shelter ? ', but your shelter helped' : ''}.`);
  if (state.food === 0 || state.water === 0) hurt(10, 'Hunger and dehydration weakened you.');
  if (state.over) return;
  state.day += 1;
  state.night = false;
  Object.values(state.nodes).forEach((node) => { node.amount = node.max; });
  if (state.shelter) state.health = clamp(state.health + 8, 0, 100);
  state.enemies.forEach((enemy) => {
    if (enemy.hp <= 0) {
      enemy.hp = enemy.maxHp;
      enemy.x = clamp(enemy.x + (Math.random() * 20 - 10), 8, 92);
      enemy.y = clamp(enemy.y + (Math.random() * 20 - 10), 8, 92);
    }
  });
  addLog(`Day ${state.day} begins. Scavenge before nightfall.`);
  setMessage(`Day ${state.day}: gather supplies and prepare for night.`);
  render();
  checkEnd();
}
function checkEnd() {
  if (state.health <= 0) {
    state.over = true;
    state.won = false;
    setMessage('You did not survive this run. Choose “New run” to try again.');
    addLog('Run over. The wasteland claimed another survivor.');
  } else if (state.day >= 5 && state.shelter && state.food > 0 && state.water > 0) {
    state.over = true;
    state.won = true;
    setMessage('You survived five days! Your camp is safe—for now.');
    addLog('Victory! Your shelter and supplies carried you through.');
  }
  if (state.over) render();
}
function walkTo(point) {
  const dx = point.x - state.player.x;
  const dy = point.y - state.player.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(length / 5));
  for (let i = 0; i < steps; i += 1) {
    if (state.over) break;
    movePlayer(dx / steps, dy / steps, Math.min(5, length / steps));
  }
}
function keyHandler(event) {
  const keys = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
  const direction = keys[event.key];
  if (!direction) return;
  event.preventDefault();
  movePlayer(...direction);
}
function bindActions() {
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'move') movePlayer(Number(button.dataset.dx), Number(button.dataset.dy));
    if (action === 'collect') gather();
    if (action === 'attack') attack();
    if (action === 'rest') rest();
    if (action === 'build') buildShelter();
    if (action === 'upgrade') upgradeCamp();
    if (action === 'night') endDay();
    if (action === 'reset') resetState();
  }));
  arena.addEventListener('click', (event) => {
    if (event.target !== arena || state.over) return;
    const rect = arena.getBoundingClientRect();
    walkTo({ x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 });
  });
}
function tick() {
  if (state.over) return;
  state.enemies.forEach((enemy) => {
    if (enemy.hp <= 0) return;
    const d = distance(state.player, enemy);
    if (d > 70) {
      const dx = state.player.x - enemy.x;
      const dy = state.player.y - enemy.y;
      const length = Math.hypot(dx, dy) || 1;
      enemy.x = clamp(enemy.x + dx / length * 0.6, 5, 95);
      enemy.y = clamp(enemy.y + dy / length * 0.6, 5, 95);
    } else if (d < 48 && enemy.cooldown <= 0) {
      enemy.cooldown = 3;
      hurt(state.shelter ? 3 : 6, 'An infected caught you off guard.');
    }
    enemy.cooldown = Math.max(0, enemy.cooldown - 1);
  });
  syncWorld();
}
window.addEventListener('resize', syncWorld);
document.addEventListener('keydown', keyHandler);
bindActions();
resetState();
window.setInterval(tick, 1000);
