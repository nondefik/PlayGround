import * as THREE from 'three';

const canvas = document.getElementById('gameCanvas');
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
  width: 0,
  height: 0,
  pointerLocked: false,
  keys: new Set(),
  score: 0,
  wave: 1,
  time: 0,
  messageTimer: 0,
  spawnTimer: 0,
  waveDelay: 0,
  player: {
    health: 100,
    stamina: 100,
    yaw: 0,
    pitch: 0,
    x: 0,
    y: 1.6,
    z: 0,
    velocityX: 0,
    velocityZ: 0,
    dodgeCooldown: 0,
    weapon: 'rifle',
    ammo: { rifle: 30, shotgun: 8 },
    reserve: { rifle: 90, shotgun: 32 },
    cooldown: 0,
    reloadTimer: 0,
    hitFlash: 0,
  },
  bullets: [],
  enemies: [],
  pickups: [],
  particles: [],
};

const config = {
  moveSpeed: 8,
  sprintSpeed: 11,
  dodgeSpeed: 18,
  weaponStats: {
    rifle: { damage: 22, fireRate: 0.13, magSize: 30, reloadTime: 1.2, pellets: 1, spread: 0.04, ammoPerShot: 1 },
    shotgun: { damage: 12, fireRate: 0.75, magSize: 8, reloadTime: 1.5, pellets: 7, spread: 0.22, ammoPerShot: 1 },
  },
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x081922);
scene.fog = new THREE.Fog(0x081922, 12, 80);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200);
camera.position.set(0, 1.6, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const clock = new THREE.Clock();

const world = new THREE.Group();
scene.add(world);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(250, 250),
  new THREE.MeshStandardMaterial({ color: 0x0f1f2a, roughness: 1, metalness: 0.1 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
world.add(floor);

const ambient = new THREE.HemisphereLight(0xbfe3ff, 0x101820, 1.1);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(10, 20, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const worldBounds = 110;
const playerRadius = 0.8;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function showMessage(text, duration = 1.1) {
  messageBox.textContent = text;
  messageBox.classList.add('visible');
  STATE.messageTimer = duration;
}

function updateHud() {
  const p = STATE.player;
  healthBar.style.width = `${clamp((p.health / 100) * 100, 0, 100)}%`;
  waveText.textContent = `Wave ${STATE.wave}`;
  scoreText.textContent = `Score ${Math.floor(STATE.score)}`;
  weaponText.textContent = p.weapon === 'rifle' ? 'Rifle' : 'Shotgun';
  ammoText.textContent = `${p.ammo[p.weapon]} / ${p.reserve[p.weapon]}`;
}

function setWeapon(name) {
  if (STATE.player.weapon === name) return;
  STATE.player.weapon = name;
  STATE.player.reloadTimer = 0;
  STATE.player.cooldown = 0;
  updateHud();
}

function createEnemy(position) {
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 1, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x7edb7a, roughness: 1, metalness: 0 })
  );
  body.castShadow = true;
  body.position.copy(position);
  body.userData.baseY = position.y;
  world.add(body);

  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xfff5d6, emissive: 0x2b1c00 })
  );
  eye.position.set(0, 0.8, 0.28);
  body.add(eye);

  return {
    mesh: body,
    x: position.x,
    y: position.y,
    z: position.z,
    hp: 30 + STATE.wave * 6,
    speed: 2.4 + STATE.wave * 0.35,
    damage: 10 + STATE.wave,
    hitFlash: 0,
  };
}

function spawnEnemy() {
  const angle = Math.random() * Math.PI * 2;
  const distance = randomRange(18, 32);
  const x = Math.cos(angle) * distance;
  const z = Math.sin(angle) * distance;
  STATE.enemies.push(createEnemy(new THREE.Vector3(x, 0.7, z)));
}

function spawnWave() {
  const count = 5 + STATE.wave * 2;
  for (let i = 0; i < count; i++) spawnEnemy();
  showMessage(`Wave ${STATE.wave}`, 1.1);
}

function spawnPickup(x, z, type = 'medkit') {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: type === 'medkit' ? 0x5ef3a0 : 0x7bc0ff, emissive: 0x112f22 })
  );
  mesh.position.set(x, 0.7, z);
  mesh.castShadow = true;
  world.add(mesh);
  STATE.pickups.push({ mesh, x, z, y: 0.7, type, timer: 12 });
}

function createParticle(x, y, z, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.12),
    new THREE.MeshStandardMaterial({ color, emissive: color })
  );
  mesh.position.set(x, y, z);
  world.add(mesh);
  STATE.particles.push({
    mesh,
    velocity: new THREE.Vector3(randomRange(-2, 2), randomRange(0.5, 2.5), randomRange(-2, 2)),
    life: 0.5 + Math.random() * 0.5,
  });
}

function reloadWeapon() {
  const p = STATE.player;
  const weapon = config.weaponStats[p.weapon];
  if (p.reloadTimer > 0 || p.ammo[p.weapon] >= weapon.magSize || p.reserve[p.weapon] <= 0) return;
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

function fireBullet() {
  const p = STATE.player;
  const weapon = config.weaponStats[p.weapon];
  if (p.reloadTimer > 0 || p.cooldown > 0 || p.ammo[p.weapon] <= 0) {
    if (p.ammo[p.weapon] <= 0 && p.reserve[p.weapon] > 0) reloadWeapon();
    return;
  }

  p.ammo[p.weapon] -= weapon.ammoPerShot;
  p.cooldown = weapon.fireRate;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const origin = new THREE.Vector3(p.x, p.y, p.z);
  const spreadX = randomRange(-weapon.spread, weapon.spread);
  const spreadY = randomRange(-weapon.spread, weapon.spread);
  direction.x += spreadX;
  direction.y += spreadY;
  direction.normalize();

  for (let i = 0; i < weapon.pellets; i++) {
    const bulletDirection = direction.clone();
    bulletDirection.x += randomRange(-weapon.spread, weapon.spread) * 0.5;
    bulletDirection.y += randomRange(-weapon.spread, weapon.spread) * 0.5;
    bulletDirection.z += randomRange(-weapon.spread, weapon.spread) * 0.5;
    bulletDirection.normalize();
    STATE.bullets.push({
      position: origin.clone(),
      velocity: bulletDirection.multiplyScalar(42),
      life: 1.1,
      damage: weapon.damage,
      mesh: new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffeb8a, emissive: 0x6b5c00 })
      ),
    });
    STATE.bullets[STATE.bullets.length - 1].mesh.position.copy(origin);
    world.add(STATE.bullets[STATE.bullets.length - 1].mesh);
  }

  if (p.ammo[p.weapon] <= 0 && p.reserve[p.weapon] > 0) reloadWeapon();
  updateHud();
}

function startGame() {
  STATE.running = true;
  STATE.gameOver = false;
  STATE.score = 0;
  STATE.wave = 1;
  STATE.time = 0;
  STATE.spawnTimer = 0;
  STATE.waveDelay = 0;
  STATE.player.health = 100;
  STATE.player.stamina = 100;
  STATE.player.weapon = 'rifle';
  STATE.player.ammo = { rifle: 30, shotgun: 8 };
  STATE.player.reserve = { rifle: 90, shotgun: 32 };
  STATE.player.x = 0;
  STATE.player.y = 1.6;
  STATE.player.z = 0;
  STATE.player.yaw = 0;
  STATE.player.pitch = 0;
  STATE.player.reloadTimer = 0;
  STATE.player.cooldown = 0;
  STATE.player.hitFlash = 0;
  STATE.player.dodgeCooldown = 0;

  while (STATE.enemies.length) {
    const enemy = STATE.enemies.pop();
    world.remove(enemy.mesh);
  }
  while (STATE.bullets.length) {
    const bullet = STATE.bullets.pop();
    world.remove(bullet.mesh);
  }
  while (STATE.pickups.length) {
    const pickup = STATE.pickups.pop();
    world.remove(pickup.mesh);
  }
  while (STATE.particles.length) {
    const particle = STATE.particles.pop();
    world.remove(particle.mesh);
  }

  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  messageBox.classList.remove('visible');
  updateHud();
  spawnWave();
}

function endGame() {
  STATE.running = false;
  STATE.gameOver = true;
  finalStats.textContent = `You survived ${STATE.wave} wave${STATE.wave === 1 ? '' : 's'} and scored ${Math.floor(STATE.score)}.`;
  gameOverScreen.classList.remove('hidden');
  gameOverScreen.classList.add('visible');
}

function updatePlayer(dt) {
  const p = STATE.player;
  const moveX = (STATE.keys.has('d') ? 1 : 0) - (STATE.keys.has('a') ? 1 : 0);
  const moveZ = (STATE.keys.has('s') ? 1 : 0) - (STATE.keys.has('w') ? 1 : 0);

  let desiredX = 0;
  let desiredZ = 0;
  if (moveX || moveZ) {
    const length = Math.hypot(moveX, moveZ) || 1;
    desiredX = moveX / length;
    desiredZ = moveZ / length;
  }

  const sprinting = STATE.keys.has('shift') && p.stamina > 0.5;
  const speed = sprinting ? config.sprintSpeed : config.moveSpeed;
  const forward = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)).multiplyScalar(desiredZ);
  const side = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw)).multiplyScalar(desiredX);
  const moveVector = forward.add(side).normalize();

  if (desiredX || desiredZ) {
    p.x += moveVector.x * speed * dt;
    p.z += moveVector.z * speed * dt;
    p.x = clamp(p.x, -worldBounds, worldBounds);
    p.z = clamp(p.z, -worldBounds, worldBounds);

    if (sprinting) p.stamina = Math.max(0, p.stamina - 22 * dt);
    else p.stamina = Math.min(100, p.stamina + 18 * dt);
  } else {
    p.stamina = Math.min(100, p.stamina + 20 * dt);
  }

  if (STATE.keys.has(' ') && p.dodgeCooldown <= 0) {
    const dodgeDir = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    p.x += dodgeDir.x * config.dodgeSpeed * 0.6;
    p.z += dodgeDir.z * config.dodgeSpeed * 0.6;
    p.x = clamp(p.x, -worldBounds, worldBounds);
    p.z = clamp(p.z, -worldBounds, worldBounds);
    p.dodgeCooldown = 0.9;
    showMessage('Dodge', 0.3);
  }

  p.dodgeCooldown = Math.max(0, p.dodgeCooldown - dt);
  p.cooldown = Math.max(0, p.cooldown - dt);
  p.reloadTimer = Math.max(0, p.reloadTimer - dt);
  if (p.reloadTimer === 0 && p.ammo[p.weapon] <= 0 && p.reserve[p.weapon] > 0) finishReload();
  if (p.reloadTimer > 0 && p.reloadTimer <= 0.05) finishReload();

  if (STATE.keys.has('1')) setWeapon('rifle');
  if (STATE.keys.has('2')) setWeapon('shotgun');
  if (STATE.keys.has('r')) reloadWeapon();

  camera.position.set(p.x, p.y, p.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch;

  if (STATE.pointerLocked && document.pointerLockElement === canvas) {
    const ray = new THREE.Vector2();
    ray.x = 0;
    ray.y = 0;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
  }
}

function updateBullets(dt) {
  for (let i = STATE.bullets.length - 1; i >= 0; i--) {
    const bullet = STATE.bullets[i];
    bullet.position.addScaledVector(bullet.velocity, dt);
    bullet.life -= dt;
    bullet.mesh.position.copy(bullet.position);

    if (bullet.life <= 0) {
      world.remove(bullet.mesh);
      STATE.bullets.splice(i, 1);
      continue;
    }

    for (let j = STATE.enemies.length - 1; j >= 0; j--) {
      const enemy = STATE.enemies[j];
      const dist = bullet.position.distanceTo(new THREE.Vector3(enemy.x, enemy.y, enemy.z));
      if (dist < 0.8) {
        enemy.hp -= bullet.damage;
        enemy.hitFlash = 0.15;
        world.remove(bullet.mesh);
        STATE.bullets.splice(i, 1);
        if (enemy.hp <= 0) {
          STATE.score += 25;
          world.remove(enemy.mesh);
          STATE.enemies.splice(j, 1);
          for (let k = 0; k < 10; k++) createParticle(enemy.x, 0.6, enemy.z, 0xff7a7a);
          if (Math.random() < 0.25) spawnPickup(enemy.x, enemy.z, 'medkit');
        }
        break;
      }
    }
  }
}

function updateEnemies(dt) {
  for (let i = STATE.enemies.length - 1; i >= 0; i--) {
    const enemy = STATE.enemies[i];
    const dx = STATE.player.x - enemy.x;
    const dy = STATE.player.z - enemy.z;
    const dist = Math.hypot(dx, dy) || 1;
    enemy.x += (dx / dist) * enemy.speed * dt;
    enemy.z += (dy / dist) * enemy.speed * dt;
    enemy.mesh.position.set(enemy.x, 0.7, enemy.z);
    enemy.mesh.rotation.y = Math.atan2(dx, dy);
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    enemy.mesh.material.emissive = new THREE.Color(enemy.hitFlash > 0 ? 0x5c1d1d : 0x000000);

    if (dist < 1.2) {
      STATE.player.health -= enemy.damage * dt;
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
    pickup.mesh.rotation.y += dt * 2.0;
    pickup.mesh.position.y = 0.7 + Math.sin(STATE.time * 5 + i) * 0.2;

    if (pickup.timer <= 0) {
      world.remove(pickup.mesh);
      STATE.pickups.splice(i, 1);
      continue;
    }

    const dist = Math.hypot(pickup.x - STATE.player.x, pickup.z - STATE.player.z);
    if (dist < 1.5) {
      STATE.player.health = clamp(STATE.player.health + 25, 0, 100);
      world.remove(pickup.mesh);
      STATE.pickups.splice(i, 1);
      showMessage('Medkit collected', 0.8);
    }
  }
}

function updateParticles(dt) {
  for (let i = STATE.particles.length - 1; i >= 0; i--) {
    const particle = STATE.particles[i];
    particle.velocity.y -= 5 * dt;
    particle.mesh.position.addScaledVector(particle.velocity, dt);
    particle.life -= dt;
    if (particle.life <= 0) {
      world.remove(particle.mesh);
      STATE.particles.splice(i, 1);
    }
  }
}

function updateWave(dt) {
  if (STATE.enemies.length === 0 && STATE.waveDelay <= 0 && STATE.time > 1.2) {
    STATE.waveDelay = 2.1;
    STATE.wave += 1;
    showMessage(`Wave ${STATE.wave}`, 1.1);
  }

  if (STATE.waveDelay > 0) {
    STATE.waveDelay -= dt;
    if (STATE.waveDelay <= 0) spawnWave();
  }
}

function update(dt) {
  if (!STATE.running) return;
  STATE.time += dt;

  if (STATE.messageTimer > 0) {
    STATE.messageTimer = Math.max(0, STATE.messageTimer - dt);
    if (STATE.messageTimer === 0) messageBox.classList.remove('visible');
  }

  if (STATE.player.health <= 0) {
    endGame();
    return;
  }

  updatePlayer(dt);
  updateBullets(dt);
  updateEnemies(dt);
  updatePickups(dt);
  updateParticles(dt);
  updateWave(dt);

  if (STATE.time > 0 && Math.floor(STATE.time) % 18 === 0 && Math.random() < 0.04) {
    spawnPickup(randomRange(-20, 20), randomRange(-20, 20), 'medkit');
  }

  updateHud();
}

function render() {
  renderer.render(scene, camera);
}

function resize() {
  STATE.width = window.innerWidth;
  STATE.height = window.innerHeight;
  camera.aspect = STATE.width / STATE.height;
  camera.updateProjectionMatrix();
  renderer.setSize(STATE.width, STATE.height, false);
}

function animate() {
  const dt = clamp(clock.getDelta(), 0.016, 0.05);
  update(dt);
  render();
  requestAnimationFrame(animate);
}

function onPointerMove(event) {
  if (!STATE.pointerLocked || document.pointerLockElement !== canvas) return;
  STATE.player.yaw -= event.movementX * 0.0023;
  STATE.player.pitch = clamp(STATE.player.pitch - event.movementY * 0.0018, -1.35, 1.35);
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
    return;
  }
  if (!STATE.running) return;
  fireBullet();
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

function onPointerLockChange() {
  STATE.pointerLocked = document.pointerLockElement === canvas;
}

startButton.addEventListener('click', () => {
  startGame();
  canvas.requestPointerLock();
});
restartButton.addEventListener('click', () => {
  startGame();
  canvas.requestPointerLock();
});

window.addEventListener('resize', resize);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
document.addEventListener('pointerlockchange', onPointerLockChange);
window.addEventListener('contextmenu', (event) => event.preventDefault());

resize();
updateHud();
requestAnimationFrame(animate);
