const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const startButton = document.getElementById('startButton');
const restartButton = document.getElementById('restartButton');
const messageBox = document.getElementById('messageBox');
const healthBar = document.getElementById('healthBar');
const waveText = document.getElementById('waveText');
const scoreText = document.getElementById('scoreText');
const weaponText = document.getElementById('weaponText');
const ammoText = document.getElementById('ammoText');
const finalStats = document.getElementById('finalStats');

const STATE = {
  running: false,
  gameOver: false,
  lastTime: 0,
  pointerX: 0,
  pointerY: 0,
  pointerDown: false,
  mouseLocked: false,
  width: 0,
  height: 0,
  camera: {
    x: 0,
    y: 0,
    angle: 0,
    bob: 0,
  },
  player: {
    x: 0,
    y: 0,
    health: 100,
    stamina: 100,
    reloadTimer: 0,
    dashTimer: 0,
    hitFlash: 0,
    weapon: 'rifle',
    ammo: { rifle: 30, shotgun: 8 },
    reserve: { rifle: 90, shotgun: 32 },
    cooldown: 0,
    spread: 0,
  },
  bullets: [],
  zombies: [],
  particles: [],
  pickups: [],
  keys: new Set(),
  score: 0,
  wave: 1,
  spawnTimer: 0,
  waveDelay: 0,
  time: 0,
  messageTimer: 0,
  randomSeed: 0,
};

const config = {
  playerSpeed: 180,
  sprintSpeed: 260,
  dashSpeed: 420,
  weaponStats: {
    rifle: { damage: 20, fireRate: 0.14, magSize: 30, reloadTime: 1.2, pelletCount: 1, spread: 0.06, ammoPerShot: 1 },
    shotgun: { damage: 12, fireRate: 0.65, magSize: 8, reloadTime: 1.4, pelletCount: 7, spread: 0.18, ammoPerShot: 1 },
  },
};

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  STATE.width = window.innerWidth;
  STATE.height = window.innerHeight;
  canvas.width = Math.round(STATE.width * dpr);
  canvas.height = Math.round(STATE.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function showMessage(text, duration = 1.4) {
  messageBox.textContent = text;
  messageBox.classList.add('visible');
  STATE.messageTimer = duration;
}

function setWeapon(newWeapon) {
  if (STATE.player.weapon === newWeapon) return;
  STATE.player.weapon = newWeapon;
  weaponText.textContent = newWeapon === 'rifle' ? 'Rifle' : 'Shotgun';
  STATE.player.cooldown = 0;
  STATE.player.reloadTimer = 0;
  updateHud();
}

function updateHud() {
  const p = STATE.player;
  const maxHealth = 100;
  healthBar.style.width = `${clamp((p.health / maxHealth) * 100, 0, 100)}%`;
  waveText.textContent = `Wave ${STATE.wave}`;
  scoreText.textContent = `Score ${Math.floor(STATE.score)}`;
  weaponText.textContent = p.weapon === 'rifle' ? 'Rifle' : 'Shotgun';
  const ammoInMag = p.ammo[p.weapon];
  const reserveAmmo = p.reserve[p.weapon];
  ammoText.textContent = `${ammoInMag} / ${reserveAmmo}`;
}

function spawnZombie() {
  const side = Math.floor(Math.random() * 4);
  const edgePadding = 80;
  let x, y;

  if (side === 0) {
    x = randomRange(-edgePadding, STATE.width + edgePadding);
    y = -edgePadding;
  } else if (side === 1) {
    x = STATE.width + edgePadding;
    y = randomRange(-edgePadding, STATE.height + edgePadding);
  } else if (side === 2) {
    x = randomRange(-edgePadding, STATE.width + edgePadding);
    y = STATE.height + edgePadding;
  } else {
    x = -edgePadding;
    y = randomRange(-edgePadding, STATE.height + edgePadding);
  }

  const angle = Math.atan2(STATE.height / 2 - y, STATE.width / 2 - x);
  const speed = 34 + STATE.wave * 5 + Math.random() * 25;
  const hp = 20 + STATE.wave * 6;
  STATE.zombies.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    hp,
    size: 18,
    damage: 12 + STATE.wave,
    type: 'walker',
    hitFlash: 0,
  });
}

function spawnPickup(x, y, type = 'medkit') {
  STATE.pickups.push({
    x,
    y,
    radius: 12,
    type,
    timer: 8,
  });
}

function fireBullet(fromX, fromY, aimX, aimY, damageOverride = null) {
  const p = STATE.player;
  const weapon = config.weaponStats[p.weapon];
  if (p.ammo[p.weapon] <= 0) {
    showMessage('Out of ammo');
    return;
  }
  if (p.reloadTimer > 0) return;
  if (p.cooldown > 0) return;

  p.ammo[p.weapon] -= weapon.ammoPerShot;
  p.cooldown = weapon.fireRate;
  const spread = weapon.spread;

  for (let i = 0; i < weapon.pelletCount; i++) {
    const angle = Math.atan2(aimY - fromY, aimX - fromX) + randomRange(-spread, spread);
    const speed = 720;
    STATE.bullets.push({
      x: fromX,
      y: fromY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.9,
      damage: damageOverride ?? weapon.damage,
      radius: 3,
    });
  }

  if (p.ammo[p.weapon] <= 0 && p.reserve[p.weapon] > 0) {
    reloadWeapon();
  }
  updateHud();
}

function reloadWeapon() {
  const p = STATE.player;
  const weapon = config.weaponStats[p.weapon];
  const mag = p.ammo[p.weapon];
  if (p.reloadTimer > 0 || mag >= weapon.magSize || p.reserve[p.weapon] <= 0) return;

  p.reloadTimer = weapon.reloadTime;
  showMessage(`${p.weapon === 'rifle' ? 'Rifle' : 'Shotgun'} reload`, 0.8);
}

function finishReload() {
  const p = STATE.player;
  const weapon = config.weaponStats[p.weapon];
  const needed = weapon.magSize - p.ammo[p.weapon];
  const loaded = Math.min(needed, p.reserve[p.weapon]);
  p.ammo[p.weapon] += loaded;
  p.reserve[p.weapon] -= loaded;
  p.reloadTimer = 0;
  updateHud();
}

function startGame() {
  STATE.running = true;
  STATE.gameOver = false;
  STATE.score = 0;
  STATE.wave = 1;
  STATE.spawnTimer = 0;
  STATE.waveDelay = 0;
  STATE.time = 0;
  STATE.player.health = 100;
  STATE.player.stamina = 100;
  STATE.player.ammo = { rifle: 30, shotgun: 8 };
  STATE.player.reserve = { rifle: 90, shotgun: 32 };
  STATE.player.weapon = 'rifle';
  STATE.player.x = STATE.width / 2;
  STATE.player.y = STATE.height / 2;
  STATE.camera.x = 0;
  STATE.camera.y = 0;
  STATE.zombies = [];
  STATE.bullets = [];
  STATE.pickups = [];
  STATE.particles = [];
  startScreen.classList.add('hidden');
  startScreen.classList.remove('visible');
  gameOverScreen.classList.add('hidden');
  gameOverScreen.classList.remove('visible');
  messageBox.classList.remove('visible');
  updateHud();
  spawnWave();
}

function endGame() {
  STATE.running = false;
  STATE.gameOver = true;
  finalStats.textContent = `You survived ${STATE.wave - 1} waves and scored ${Math.floor(STATE.score)}.`;
  gameOverScreen.classList.remove('hidden');
  gameOverScreen.classList.add('visible');
}

function handleInput(dt) {
  const p = STATE.player;
  const moveX = (STATE.keys.has('d') ? 1 : 0) - (STATE.keys.has('a') ? 1 : 0);
  const moveY = (STATE.keys.has('s') ? 1 : 0) - (STATE.keys.has('w') ? 1 : 0);

  let length = Math.hypot(moveX, moveY) || 1;
  if (moveX || moveY) {
    const vx = moveX / length;
    const vy = moveY / length;
    const sprinting = STATE.keys.has('shift') && p.stamina > 4;
    const moveSpeed = sprinting ? config.sprintSpeed : config.playerSpeed;
    const newX = p.x + vx * moveSpeed * dt;
    const newY = p.y + vy * moveSpeed * dt;
    p.x = clamp(newX, 50, STATE.width - 50);
    p.y = clamp(newY, 50, STATE.height - 50);
    if (sprinting) p.stamina = Math.max(0, p.stamina - 20 * dt);
    else p.stamina = Math.min(100, p.stamina + 16 * dt);
    STATE.camera.bob += dt * (sprinting ? 9 : 5);
  } else {
    p.stamina = Math.min(100, p.stamina + 18 * dt);
  }

  if (STATE.keys.has(' ') && p.dashTimer <= 0) {
    const dx = STATE.pointerX - STATE.width / 2;
    const dy = STATE.pointerY - STATE.height / 2;
    const ang = Math.atan2(dy, dx) || 0;
    p.x = clamp(p.x + Math.cos(ang) * 90, 20, STATE.width - 20);
    p.y = clamp(p.y + Math.sin(ang) * 90, 20, STATE.height - 20);
    p.dashTimer = 0.8;
    STATE.camera.bob = 0.5;
    showMessage('Dodge', 0.45);
  }

  p.dashTimer = Math.max(0, p.dashTimer - dt);
  p.cooldown = Math.max(0, p.cooldown - dt);
  if (p.reloadTimer > 0) {
    p.reloadTimer = Math.max(0, p.reloadTimer - dt);
    if (p.reloadTimer === 0) finishReload();
  }

  const aimX = STATE.pointerX;
  const aimY = STATE.pointerY;
  if (STATE.pointerDown && p.cooldown <= 0) {
    fireBullet(p.x, p.y, aimX, aimY);
  }

  if (STATE.keys.has('1')) setWeapon('rifle');
  if (STATE.keys.has('2')) setWeapon('shotgun');
  if (STATE.keys.has('r')) reloadWeapon();
}

function updateBullets(dt) {
  for (let i = STATE.bullets.length - 1; i >= 0; i--) {
    const bullet = STATE.bullets[i];
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    if (bullet.life <= 0 || bullet.x < -40 || bullet.x > STATE.width + 40 || bullet.y < -40 || bullet.y > STATE.height + 40) {
      STATE.bullets.splice(i, 1);
      continue;
    }

    for (let j = STATE.zombies.length - 1; j >= 0; j--) {
      const zombie = STATE.zombies[j];
      const dist = Math.hypot(bullet.x - zombie.x, bullet.y - zombie.y);
      if (dist < zombie.size + bullet.radius) {
        zombie.hp -= bullet.damage;
        zombie.hitFlash = 0.15;
        STATE.bullets.splice(i, 1);
        if (zombie.hp <= 0) {
          STATE.score += 25;
          if (Math.random() < 0.2) spawnPickup(zombie.x, zombie.y, 'medkit');
          STATE.zombies.splice(j, 1);
          for (let k = 0; k < 12; k++) {
            STATE.particles.push({
              x: zombie.x,
              y: zombie.y,
              vx: randomRange(-140, 140),
              vy: randomRange(-140, 140),
              life: 0.5 + Math.random() * 0.4,
              color: '#ff7f7f',
              size: 2 + Math.random() * 3,
            });
          }
        }
        break;
      }
    }
  }
}

function updateZombies(dt) {
  for (let i = STATE.zombies.length - 1; i >= 0; i--) {
    const zombie = STATE.zombies[i];
    const dx = STATE.player.x - zombie.x;
    const dy = STATE.player.y - zombie.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    const speed = 35 + STATE.wave * 3.5 + Math.random() * 8;
    zombie.x += nx * speed * dt;
    zombie.y += ny * speed * dt;
    zombie.hitFlash = Math.max(0, zombie.hitFlash - dt);

    if (dist < zombie.size + 12) {
      STATE.player.health -= zombie.damage * dt;
      STATE.player.hitFlash = 0.25;
      if (STATE.player.health <= 0) {
        STATE.player.health = 0;
        endGame();
        return;
      }
    }
  }
}

function updatePickups(dt) {
  for (let i = STATE.pickups.length - 1; i >= 0; i--) {
    const pickup = STATE.pickups[i];
    pickup.timer -= dt;
    if (pickup.timer <= 0) {
      STATE.pickups.splice(i, 1);
      continue;
    }
    const dist = Math.hypot(pickup.x - STATE.player.x, pickup.y - STATE.player.y);
    if (dist < 18) {
      STATE.player.health = clamp(STATE.player.health + 25, 0, 100);
      STATE.pickups.splice(i, 1);
      showMessage('Medkit collected', 0.8);
    }
  }
}

function updateParticles(dt) {
  for (let i = STATE.particles.length - 1; i >= 0; i--) {
    const p = STATE.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) STATE.particles.splice(i, 1);
  }
}

function spawnWave() {
  const count = 6 + STATE.wave * 2;
  for (let i = 0; i < count; i++) {
    spawnZombie();
  }
  showMessage(`Wave ${STATE.wave} incoming`, 1.1);
}

function update(dt) {
  if (!STATE.running) return;

  STATE.time += dt;
  if (STATE.messageTimer > 0) {
    STATE.messageTimer = Math.max(0, STATE.messageTimer - dt);
    if (STATE.messageTimer === 0) messageBox.classList.remove('visible');
  }

  if (STATE.waveDelay > 0) {
    STATE.waveDelay -= dt;
    if (STATE.waveDelay <= 0) {
      spawnWave();
    }
  }

  if (STATE.zombies.length === 0 && STATE.waveDelay <= 0 && STATE.time > 1.5) {
    STATE.waveDelay = 2.2;
    STATE.wave += 1;
    showMessage(`Wave ${STATE.wave}`, 1.1);
  }

  if (STATE.time > 0 && Math.floor(STATE.time) % 18 === 0 && Math.random() < 0.025) {
    spawnPickup(randomRange(100, STATE.width - 100), randomRange(80, STATE.height - 80));
  }

  handleInput(dt);
  updateBullets(dt);
  updateZombies(dt);
  updatePickups(dt);
  updateParticles(dt);

  if (STATE.zombies.length > 0 && Math.random() < 0.25) {
    const zombie = STATE.zombies[Math.floor(Math.random() * STATE.zombies.length)];
    zombie.x += randomRange(-10, 10);
    zombie.y += randomRange(-10, 10);
  }

  STATE.player.hitFlash = Math.max(0, STATE.player.hitFlash - dt);
  updateHud();
}

function drawBackground() {
  const gradient = ctx.createRadialGradient(
    STATE.width / 2,
    STATE.height / 2,
    50,
    STATE.width / 2,
    STATE.height / 2,
    Math.max(STATE.width, STATE.height) * 0.75,
  );
  gradient.addColorStop(0, '#202f3d');
  gradient.addColorStop(0.5, '#0a1117');
  gradient.addColorStop(1, '#04090d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, STATE.width, STATE.height);

  const offsetX = (STATE.player.x / STATE.width) * 40;
  const offsetY = (STATE.player.y / STATE.height) * 40;
  for (let x = -80; x < STATE.width + 80; x += 30) {
    for (let y = -80; y < STATE.height + 80; y += 30) {
      const light = ((x + offsetX) % 60) + ((y + offsetY) % 60);
      ctx.fillStyle = light < 25 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(x, y, 15, 15);
    }
  }
}

function drawPlayer() {
  const p = STATE.player;
  const bob = Math.sin(STATE.camera.bob) * 4;

  ctx.save();
  ctx.translate(p.x, p.y + bob);
  const body = ctx.createRadialGradient(0, 0, 8, 0, 0, 20);
  body.addColorStop(0, '#f6fbff');
  body.addColorStop(1, '#6c8dae');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fill();

  const angle = Math.atan2(STATE.pointerY - p.y, STATE.pointerX - p.x);
  ctx.rotate(angle);
  ctx.fillStyle = '#dfe7ef';
  ctx.fillRect(13, -2, 24, 4);
  ctx.fillStyle = '#a3d8ff';
  ctx.fillRect(30, -6, 12, 12);
  ctx.restore();
}

function drawBullets() {
  for (const bullet of STATE.bullets) {
    ctx.fillStyle = '#ffef8f';
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawZombies() {
  for (const zombie of STATE.zombies) {
    ctx.save();
    ctx.translate(zombie.x, zombie.y);
    const color = zombie.hitFlash > 0 ? '#ff8b8b' : '#8fe77a';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, zombie.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, zombie.size + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawPickups() {
  for (const pickup of STATE.pickups) {
    const pulse = 1 + Math.sin(STATE.time * 5 + pickup.x) * 0.2;
    ctx.save();
    ctx.translate(pickup.x, pickup.y);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = '#67f3a9';
    ctx.beginPath();
    ctx.rect(-7, -7, 14, 14);
    ctx.fill();
    ctx.restore();
  }
}

function drawParticles() {
  for (const particle of STATE.particles) {
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = clamp(particle.life * 2, 0, 1);
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    ctx.globalAlpha = 1;
  }
}

function draw() {
  ctx.clearRect(0, 0, STATE.width, STATE.height);
  drawBackground();
  drawPickups();
  drawBullets();
  drawZombies();
  drawParticles();
  drawPlayer();
}

function loop(timestamp) {
  const dt = clamp((timestamp - STATE.lastTime) / 1000, 0.016, 0.05);
  STATE.lastTime = timestamp;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function onPointerMove(event) {
  STATE.pointerX = event.clientX;
  STATE.pointerY = event.clientY;
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  STATE.pointerDown = true;
  STATE.mouseLocked = true;
  if (!STATE.running) return;
  const p = STATE.player;
  fireBullet(p.x, p.y, STATE.pointerX, STATE.pointerY);
}

function onPointerUp(event) {
  if (event.button === 0) STATE.pointerDown = false;
}

function onKeyDown(event) {
  const key = event.key.toLowerCase();
  STATE.keys.add(key);
  if (key === ' ') event.preventDefault();
  if (key === '1') setWeapon('rifle');
  if (key === '2') setWeapon('shotgun');
  if (key === 'r') reloadWeapon();
}

function onKeyUp(event) {
  STATE.keys.delete(event.key.toLowerCase());
}

startButton.addEventListener('click', () => {
  startGame();
});
restartButton.addEventListener('click', () => {
  startGame();
});

window.addEventListener('resize', resize);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('contextmenu', (event) => event.preventDefault());

resize();
STATE.pointerX = STATE.width / 2;
STATE.pointerY = STATE.height / 2;
STATE.player.x = STATE.width / 2;
STATE.player.y = STATE.height / 2;
requestAnimationFrame(loop);
