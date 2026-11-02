import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const canvas = $('gameCanvas');
const mapCanvas = $('minimap');
const mapCtx = mapCanvas.getContext('2d');
const screens = Object.fromEntries(['start', 'pause', 'upgrade', 'inventory', 'gameOver'].map((key) => [key, $(`${key}Screen`)]));
const weapons = {
  pistol: { label: 'ПИСТОЛЕТ', damage: 34, rate: 0.32, mag: 12, reload: 1.05, pellets: 1, spread: 0.018, speed: 58 },
  shotgun: { label: 'ДРОБОВИК', damage: 15, rate: 0.78, mag: 6, reload: 1.4, pellets: 8, spread: 0.13, speed: 42 },
  rifle: { label: 'АВТОМАТ', damage: 21, rate: 0.105, mag: 30, reload: 1.3, pellets: 1, spread: 0.035, speed: 62 },
  knife: { label: 'НОЖ', damage: 75, rate: 0.55, mag: Infinity, reload: 0, pellets: 1, spread: 0, speed: 0 },
};
const weaponOrder = ['pistol', 'shotgun', 'rifle', 'knife'];
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const rand = (min, max) => min + Math.random() * (max - min);
let audioContext = null;
let masterGain = null;
let ambienceTimer = 8;
let shotNoise = null;
function initAudio() {
  if (audioContext) { audioContext.resume().catch(() => {}); return; }
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain(); masterGain.gain.value = 0.32; masterGain.connect(audioContext.destination);
    const drone = audioContext.createOscillator(), droneGain = audioContext.createGain();
    drone.type = 'triangle'; drone.frequency.value = 48; droneGain.gain.value = 0.055; drone.connect(droneGain); droneGain.connect(masterGain); drone.start();
    const noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * 0.35;
    const rain = audioContext.createBufferSource(), filter = audioContext.createBiquadFilter(), rainGain = audioContext.createGain();
    rain.buffer = noiseBuffer; rain.loop = true; filter.type = 'lowpass'; filter.frequency.value = 850; rainGain.gain.value = 0.08;
    rain.connect(filter); filter.connect(rainGain); rainGain.connect(masterGain); rain.start();
    shotNoise = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * 0.22), audioContext.sampleRate);
    const shotSamples = shotNoise.getChannelData(0);
    for (let i = 0; i < shotSamples.length; i++) shotSamples[i] = (Math.random() * 2 - 1) * (1 - i / shotSamples.length);
  } catch { audioContext = null; masterGain = null; }
}
function setAudioActive(active) {
  if (!audioContext) return;
  if (active) audioContext.resume().catch(() => {}); else audioContext.suspend().catch(() => {});
}
function playSound(type) {
  if (!audioContext || !masterGain || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  if (type === 'shot') {
    const source = audioContext.createBufferSource(), filter = audioContext.createBiquadFilter(), gain = audioContext.createGain();
    source.buffer = shotNoise; filter.type = 'lowpass'; filter.frequency.value = 1700; gain.gain.setValueAtTime(0.24, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    source.connect(filter); filter.connect(gain); gain.connect(masterGain); source.start(now); source.stop(now + 0.2);
    const tone = audioContext.createOscillator(), toneGain = audioContext.createGain();
    tone.type = 'sine'; tone.frequency.setValueAtTime(105, now); tone.frequency.exponentialRampToValueAtTime(42, now + 0.12);
    toneGain.gain.setValueAtTime(0.12, now); toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    tone.connect(toneGain); toneGain.connect(masterGain); tone.start(now); tone.stop(now + 0.14);
  } else if (type === 'groan') {
    const oscillator = audioContext.createOscillator(), filter = audioContext.createBiquadFilter(), gain = audioContext.createGain();
    oscillator.type = 'sawtooth'; oscillator.frequency.setValueAtTime(rand(72, 108), now); oscillator.frequency.linearRampToValueAtTime(rand(48, 68), now + 1.1);
    filter.type = 'lowpass'; filter.frequency.value = 360; gain.gain.setValueAtTime(0.001, now); gain.gain.linearRampToValueAtTime(0.07, now + 0.18); gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    oscillator.connect(filter); filter.connect(gain); gain.connect(masterGain); oscillator.start(now); oscillator.stop(now + 1.25);
  } else if (type === 'pickup') {
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(520, now); oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    gain.gain.setValueAtTime(0.08, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    oscillator.connect(gain); gain.connect(masterGain); oscillator.start(now); oscillator.stop(now + 0.2);
  }
}
const S = {
  running: false, paused: false, gameOver: false, time: 0, score: 0, wave: 1, waveDelay: 0, messageTimer: 0,
  damageBonus: 1, keys: new Set(), touch: { x: 0, y: 0, firing: false, crouching: false }, lookPointer: null, joyPointer: null,
  pointerLocked: false, player: { health: 100, stamina: 100, x: 0, y: 1.65, z: 0, yaw: 0, pitch: 0, vy: 0, grounded: true,
    crouching: false, cooldown: 0, reloadTimer: 0, hitFlash: 0, muzzleFlash: 0, weapon: 'pistol',
    ammo: { pistol: 12, shotgun: 6, rifle: 30, knife: Infinity }, reserve: { pistol: 72, shotgun: 30, rifle: 120, knife: Infinity } },
  enemies: [], bullets: [], pickups: [], particles: [],
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x172326);
scene.fog = new THREE.FogExp2(0x172326, 0.009);
const camera = new THREE.PerspectiveCamera(76, 1, 0.1, 150);
const mobile = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.35 : 1.75));
renderer.shadowMap.enabled = !mobile;
renderer.shadowMap.type = THREE.PCFShadowMap;
const clock = new THREE.Timer();
clock.connect(document);
const world = new THREE.Group(); scene.add(world);

function makeNoiseTexture(base, accent, repeat = 2) {
  const size = mobile ? 256 : 512;
  const canvasTexture = document.createElement('canvas');
  canvasTexture.width = size; canvasTexture.height = size;
  const ctx = canvasTexture.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, base); gradient.addColorStop(1, accent);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < (mobile ? 2200 : 4200); i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const radius = Math.random() * 5 + .5;
    const moss = Math.random() > .78;
    ctx.fillStyle = moss ? `rgba(67,82,48,${Math.random() * .22})` : `rgba(210,205,185,${Math.random() * .11})`;
    ctx.beginPath(); ctx.ellipse(x, y, radius * (moss ? 2 : 1), radius, rand(0, 6), 0, Math.PI * 2); ctx.fill();
  }
  // Branching hairline cracks and old oil/blood stains break up the repeating surface.
  for (let i = 0; i < 28; i++) {
    let x = rand(0, size), y = rand(0, size), angle = rand(0, Math.PI * 2);
    ctx.strokeStyle = `rgba(5,9,9,${rand(.12,.34)})`; ctx.lineWidth = rand(.7, 2.4); ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 0; j < 8; j++) { angle += rand(-.65, .65); x += Math.cos(angle) * rand(5, 15); y += Math.sin(angle) * rand(5, 15); ctx.lineTo(x, y); }
    ctx.stroke();
    if (i % 3 === 0) { const g = ctx.createRadialGradient(x, y, 1, x, y, rand(10, 28)); g.addColorStop(0, 'rgba(77,30,24,.34)'); g.addColorStop(1, 'rgba(77,30,24,0)'); ctx.fillStyle = g; ctx.fillRect(x - 30, y - 30, 60, 60); }
  }
  for (let y = 0; y < size; y += Math.max(6, size / 32)) {
    ctx.strokeStyle = `rgba(0,0,0,${Math.random() * 0.1})`; ctx.beginPath();
    for (let x = 0; x <= size; x += Math.max(4, size / 64)) { const py = y + Math.sin(x * .035 + y * .08) * (size * .012); if (!x) ctx.moveTo(x, py); else ctx.lineTo(x, py); }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvasTexture);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeat, repeat);
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), mobile ? 4 : 8);
  return texture;
}

const groundTexture = makeNoiseTexture('#1e2a2d', '#10191d');
const rubbleTexture = makeNoiseTexture('#555d5d', '#343b3c');
const floorShader = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uTexture: { value: groundTexture },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main() {
      vUv = uv;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorldPos = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform sampler2D uTexture;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main() {
      vec2 uv = vUv * 10.0 + vec2(0.0, uTime * 0.04);
      vec4 tex = texture2D(uTexture, uv);
      float ripple = sin((vUv.x + vUv.y) * 20.0 + uTime * 0.8) * 0.06;
      float grain = clamp(tex.r * 2.0 + ripple + 0.25, 0.0, 1.0);
      float puddle = smoothstep(0.58, 0.82, grain + ripple);
      vec3 color = mix(vec3(0.075, 0.095, 0.095), vec3(0.28, 0.34, 0.32), grain);
      color = mix(color, vec3(0.105, 0.16, 0.17), puddle * 0.55);
      float fog = 1.0 - smoothstep(40.0, 110.0, length(vWorldPos.xz));
      color = mix(vec3(0.025, 0.04, 0.045), color, fog);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240, 64, 64), floorShader);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor);
scene.add(new THREE.HemisphereLight(0xc4dedb, 0x303a35, 1.8));
const moon = new THREE.DirectionalLight(0xd4e1dc, 1.7); moon.position.set(-12, 24, 6); moon.castShadow = !mobile; moon.shadow.mapSize.set(512, 512); scene.add(moon);
const bounds = 90;

// Ruined blocks and road debris give the arena a readable post-apocalyptic silhouette.
const concrete = new THREE.MeshStandardMaterial({ map: rubbleTexture, bumpMap: rubbleTexture, bumpScale: .07, color: 0x89938c, roughness: .96 });
const rust = new THREE.MeshStandardMaterial({ map: rubbleTexture, bumpMap: rubbleTexture, bumpScale: .09, color: 0xa18468, roughness: .88, metalness: .12 });
for (let i = 0; i < 36; i++) {
  const a = i * Math.PI * 2 / 36, r = rand(28, 62), x = Math.cos(a) * r, z = Math.sin(a) * r;
  const h = rand(2.5, 9), w = rand(3, 8);
  const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * rand(.7, 1.4)), i % 4 ? concrete : rust);
  block.position.set(x, h / 2, z); block.rotation.y = rand(-.3, .3); block.castShadow = !mobile; block.receiveShadow = true; world.add(block);
}

// A narrow player flashlight and a few flickering hazard lamps add depth without a post-processing pass.
const flashlightTarget = new THREE.Object3D(); scene.add(flashlightTarget);
const flashlight = new THREE.SpotLight(0xc9e1d7, mobile ? 34 : 52, 34, .48, .62, 1.35);
flashlight.castShadow = !mobile; flashlight.shadow.mapSize.set(512, 512); scene.add(flashlight); flashlight.target = flashlightTarget;
const hazardLights = [];
for (let i = 0; i < (mobile ? 3 : 5); i++) {
  const a = i * Math.PI * 2 / (mobile ? 3 : 5) + .4, r = rand(15, 29), x = Math.cos(a) * r, z = Math.sin(a) * r;
  const lamp = new THREE.PointLight(i % 2 ? 0xff8a43 : 0xb9d8bd, 2.2, 13, 2); lamp.position.set(x, 2.5, z); scene.add(lamp);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.12, 6, 5), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffa354 : 0xc3e6cf })); bulb.position.set(x, 2.5, z); world.add(bulb);
  hazardLights.push({ lamp, base: lamp.intensity, phase: rand(0, 8) });
}

// Simple low-poly first-person weapon silhouettes use shared geometry/materials and stay attached to the camera.
const weaponModels = {};
const metalMat = new THREE.MeshStandardMaterial({ color: 0x343b3b, metalness: .78, roughness: .38, map: rubbleTexture, bumpMap: rubbleTexture, bumpScale: .025 });
const gripMat = new THREE.MeshStandardMaterial({ color: 0x352b25, roughness: .94, map: groundTexture, bumpMap: groundTexture, bumpScale: .04 });
const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xffd18a, transparent: true, opacity: .9 });
function weaponPart(group, geometry, material, position, scale) {
  const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); if (scale) mesh.scale.set(...scale); group.add(mesh); return mesh;
}
function buildWeaponModel(kind) {
  const group = new THREE.Group();
  if (kind === 'knife') {
    weaponPart(group, new THREE.BoxGeometry(.075, .12, .3), gripMat, [0, -.12, 0]);
    const blade = weaponPart(group, new THREE.ConeGeometry(.065, .42, 4), metalMat, [0, .13, -.03]); blade.rotation.x = -Math.PI / 2;
  } else {
    const long = kind === 'rifle' ? .82 : kind === 'shotgun' ? .78 : .53;
    weaponPart(group, new THREE.BoxGeometry(.19, .18, long), metalMat, [0, 0, -.14]);
    weaponPart(group, new THREE.CylinderGeometry(.035, .035, kind === 'shotgun' ? .53 : .42, 8), metalMat, [0, .045, -long * .75], [.85, 1, 1]);
    weaponPart(group, new THREE.BoxGeometry(.13, .24, .16), gripMat, [0, -.18, .04], [1, 1, 1]);
    weaponPart(group, new THREE.BoxGeometry(.1, .12, .12), gripMat, [0, -.15, -.23]);
    if (kind === 'rifle') weaponPart(group, new THREE.BoxGeometry(.14, .25, .12), metalMat, [0, -.2, -.24]);
  }
  const flash = weaponPart(group, new THREE.SphereGeometry(.12, 7, 5), muzzleMat, [0, .04, kind === 'knife' ? -.3 : -.65]); flash.visible = false;
  group.position.set(.38, -.34, -.72); group.rotation.set(-.08, -.04, -.04); camera.add(group);
  return { group, flash, recoil: 0 };
}
for (const kind of weaponOrder) weaponModels[kind] = buildWeaponModel(kind);
function syncWeaponModel() { for (const [kind, model] of Object.entries(weaponModels)) model.group.visible = kind === S.player.weapon; }
syncWeaponModel();

// Rain is a single low-cost point cloud.
const rainCount = mobile ? 240 : 420;
const rainGeometry = new THREE.BufferGeometry();
const rainPositions = new Float32Array(rainCount * 3);
for (let i = 0; i < rainCount; i++) { rainPositions[i * 3] = rand(-38, 38); rainPositions[i * 3 + 1] = rand(0, 24); rainPositions[i * 3 + 2] = rand(-38, 38); }
rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
const rain = new THREE.Points(rainGeometry, new THREE.PointsMaterial({ color: 0x9ebbc2, size: 0.075, transparent: true, opacity: 0.5 })); scene.add(rain);

function showMessage(text, duration = 1.2) { $('messageBox').textContent = text; $('messageBox').classList.add('visible'); S.messageTimer = duration; }
function setScreen(name, visible) { screens[name].classList.toggle('hidden', !visible); screens[name].classList.toggle('visible', visible); }
function updateHud() {
  const p = S.player, weapon = weapons[p.weapon];
  document.body.classList.toggle('low-health', p.health <= 28 && S.running);
  $('damageFlash').style.opacity = String(clamp(p.hitFlash * 1.8, 0, .42));
  $('healthBar').style.width = `${clamp(p.health, 0, 100)}%`; $('healthValue').textContent = Math.ceil(p.health);
  $('staminaBar').style.width = `${clamp(p.stamina, 0, 100)}%`; $('staminaValue').textContent = Math.ceil(p.stamina);
  $('waveText').textContent = `ВОЛНА ${S.wave}`; $('scoreText').textContent = `СЧЁТ ${Math.floor(S.score)}`;
  $('timerText').textContent = `${String(Math.floor(S.time / 60)).padStart(2, '0')}:${String(Math.floor(S.time % 60)).padStart(2, '0')}`;
  $('weaponText').textContent = weapon.label;
  $('ammoText').textContent = p.weapon === 'knife' ? '∞' : `${p.ammo[p.weapon]} / ${p.reserve[p.weapon]}`;
  $('crouchButton').classList.toggle('active', p.crouching);
}
function removeAll(list) { for (const item of list) world.remove(item.mesh); list.length = 0; }
const zombieCloth = new THREE.MeshStandardMaterial({ color: 0x74836e, bumpMap: rubbleTexture, bumpScale: .025, emissive: 0x1a241a, emissiveIntensity: .45, roughness: .98 });
const zombieRunnerCloth = new THREE.MeshStandardMaterial({ color: 0x9b805f, bumpMap: rubbleTexture, bumpScale: .025, emissive: 0x291e12, emissiveIntensity: .4, roughness: .98 });
const zombieWound = new THREE.MeshStandardMaterial({ color: 0x672c25, roughness: 1 });
const zombieEye = new THREE.MeshBasicMaterial({ color: 0xff7959 });
function createEnemy() {
  const roll = Math.random(), type = S.wave >= 3 && roll > .78 ? 'tank' : S.wave >= 2 && roll > .48 ? 'runner' : 'walker';
  const palette = { walker: 0x9bbd9a, runner: 0xc3a16f, tank: 0x9eafb2 };
  const size = type === 'tank' ? 1.45 : type === 'runner' ? .78 : 1;
  const hide = new THREE.MeshStandardMaterial({ color: palette[type], bumpMap: groundTexture, bumpScale: .035, emissive: type === 'runner' ? 0x332416 : 0x263628, emissiveIntensity: .45, roughness: 1 });
  const cloth = type === 'runner' ? zombieRunnerCloth : zombieCloth;
  const wound = zombieWound;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.42 * size, .95 * size, 3, 7), hide);
  const a = Math.random() * Math.PI * 2, d = rand(18, 30);
  body.position.set(S.player.x + Math.cos(a) * d, .72 * size, S.player.z + Math.sin(a) * d); body.castShadow = !mobile; world.add(body);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(.11 * size, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7959 })); eye.position.set(0, .38 * size, -.36 * size); body.add(eye);
  const shirt = new THREE.Mesh(new THREE.BoxGeometry(.52 * size, .42 * size, .27 * size), cloth); shirt.position.set(0, -.12 * size, -.27 * size); shirt.rotation.x = -.08; body.add(shirt);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.095 * size, .46 * size, 2, 5), hide);
    arm.position.set(side * .48 * size, -.08 * size, -.08 * size); arm.rotation.z = side * -.28; body.add(arm);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.19 * size, .48 * size, .2 * size), cloth);
    leg.position.set(side * .2 * size, -.62 * size, 0); body.add(leg);
  }
  const tornPatch = new THREE.Mesh(new THREE.SphereGeometry(.12 * size, 6, 4), wound); tornPatch.scale.set(1.4, .45, .35); tornPatch.position.set(.13 * size, .15 * size, -.42 * size); body.add(tornPatch);
  const hp = (type === 'tank' ? 150 : type === 'runner' ? 24 : 48) + S.wave * (type === 'tank' ? 18 : 6);
  return { mesh: body, x: body.position.x, z: body.position.z, hp, maxHp: hp, type,
    speed: (type === 'tank' ? 1.45 : type === 'runner' ? 4.2 : 2.15) + S.wave * .08,
    damage: (type === 'tank' ? 19 : type === 'runner' ? 8 : 11) + S.wave * .5, radius: .72 * size, hit: 0 };
}
function spawnWave() {
  const count = Math.min(5 + S.wave * 2, mobile ? 28 : 40);
  for (let i = 0; i < count; i++) S.enemies.push(createEnemy());
  showMessage(`ВОЛНА ${S.wave} · ${count} ЗАРАЖЁННЫХ`, 2);
}
function spawnPickup(x, z, type = 'medkit') {
  const colors = { medkit: 0x69ed9f, ammo: 0xe9c85d, weapon: 0x73caff };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.48, .48, .48), new THREE.MeshStandardMaterial({ color: colors[type], emissive: colors[type], emissiveIntensity: .12 }));
  mesh.position.set(x, .55, z); world.add(mesh); S.pickups.push({ mesh, x, z, type, life: 22 });
}
const particleGeometry = new THREE.BoxGeometry(.085, .085, .085);
const particleMaterials = new Map();
function createParticle(x, y, z, color, kind = 'blood') {
  if (S.particles.length >= (mobile ? 42 : 90)) return;
  if (!particleMaterials.has(color)) particleMaterials.set(color, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .92 }));
  const mesh = new THREE.Mesh(particleGeometry, particleMaterials.get(color)); mesh.position.set(x, y, z); mesh.scale.setScalar(kind === 'dust' ? rand(.7, 1.8) : rand(.65, 1.3)); world.add(mesh);
  S.particles.push({ mesh, vx: rand(-2, 2), vy: kind === 'dust' ? rand(.15, .8) : rand(.4, 2.7), vz: rand(-2, 2), life: kind === 'dust' ? rand(.25, .48) : rand(.3, .7), kind });
}
function setWeapon(name) {
  if (!weapons[name]) return;
  S.player.weapon = name; S.player.reloadTimer = 0; syncWeaponModel(); updateHud();
}
function cycleWeapon(direction) { const i = weaponOrder.indexOf(S.player.weapon); setWeapon(weaponOrder[(i + direction + weaponOrder.length) % weaponOrder.length]); }
function reload() {
  const p = S.player, w = weapons[p.weapon];
  if (p.weapon === 'knife' || p.reloadTimer > 0 || p.ammo[p.weapon] >= w.mag || p.reserve[p.weapon] <= 0) return;
  p.reloadTimer = w.reload; showMessage('ПЕРЕЗАРЯДКА', .8);
}
function finishReload() {
  const p = S.player, w = weapons[p.weapon], key = p.weapon, amount = Math.min(w.mag - p.ammo[key], p.reserve[key]);
  p.ammo[key] += amount; p.reserve[key] -= amount; p.reloadTimer = 0; updateHud();
}
function fire() {
  const p = S.player, w = weapons[p.weapon];
  if (!S.running || S.paused || p.cooldown > 0 || p.reloadTimer > 0) return;
  if (p.weapon !== 'knife' && p.ammo[p.weapon] <= 0) { reload(); return; }
  p.cooldown = w.rate;
  if (p.weapon !== 'knife') {
    p.ammo[p.weapon]--; p.muzzleFlash = .075;
    weaponModels[p.weapon].recoil = Math.min(.13, weaponModels[p.weapon].recoil + .075);
    playSound('shot');
  } else weaponModels.knife.recoil = .22;
  const direction = new THREE.Vector3(); camera.getWorldDirection(direction);
  if (p.weapon === 'knife') {
    const target = S.enemies.map((e) => ({ e, d: Math.hypot(e.x - p.x, e.z - p.z) })).filter(({ e, d }) => d < 2.8 && ((e.x - p.x) * direction.x + (e.z - p.z) * direction.z) / Math.max(d, .01) > .25).sort((a, b) => a.d - b.d)[0];
    if (target) hitEnemy(target.e, w.damage * S.damageBonus);
    else showMessage('МИМО', .35);
    updateHud(); return;
  }
  const origin = new THREE.Vector3(p.x, p.y, p.z);
  for (let i = 0; i < w.pellets; i++) {
    const dir = direction.clone().add(new THREE.Vector3(rand(-w.spread, w.spread), rand(-w.spread, w.spread), rand(-w.spread, w.spread))).normalize();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(.075, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffdc83 })); mesh.position.copy(origin); world.add(mesh);
    S.bullets.push({ mesh, pos: origin.clone(), vel: dir.multiplyScalar(w.speed), life: 1.1, damage: w.damage * S.damageBonus });
  }
  if (p.ammo[p.weapon] === 0 && p.reserve[p.weapon] > 0) reload(); updateHud();
}
function hitEnemy(enemy, damage, point = null) {
  enemy.hp -= damage; enemy.hit = .12; enemy.mesh.material.emissive.setHex(0x6a1914);
  const impact = point || new THREE.Vector3(enemy.x, .8, enemy.z);
  for (let i = 0; i < (mobile ? 2 : 3); i++) createParticle(impact.x, impact.y, impact.z, enemy.type === 'tank' ? 0xb88b4d : 0x9d443e, 'blood');
  if (enemy.hp > 0) return;
  const idx = S.enemies.indexOf(enemy); if (idx < 0) return;
  world.remove(enemy.mesh); S.enemies.splice(idx, 1); S.score += enemy.type === 'tank' ? 60 : enemy.type === 'runner' ? 35 : 25;
  for (let i = 0; i < (mobile ? 5 : 9); i++) createParticle(enemy.x, .6, enemy.z, 0x9d443e);
  const drop = Math.random(); if (drop < .13) spawnPickup(enemy.x, enemy.z, 'medkit'); else if (drop < .27) spawnPickup(enemy.x, enemy.z, 'ammo'); else if (drop < .3) spawnPickup(enemy.x, enemy.z, 'weapon');
}

function startGame() {
  initAudio(); setAudioActive(true); ambienceTimer = rand(7, 13);
  S.running = true; S.paused = false; S.gameOver = false; S.time = 0; S.score = 0; S.wave = 1; S.waveDelay = 0; S.damageBonus = 1;
  Object.assign(S.player, { health: 100, stamina: 100, x: 0, y: 1.65, z: 0, yaw: 0, pitch: 0, vy: 0, grounded: true,
    crouching: false, cooldown: 0, reloadTimer: 0, hitFlash: 0, muzzleFlash: 0, weapon: 'pistol',
    ammo: { pistol: 12, shotgun: 6, rifle: 30, knife: Infinity }, reserve: { pistol: 72, shotgun: 30, rifle: 120, knife: Infinity } });
  for (const model of Object.values(weaponModels)) model.recoil = 0;
  syncWeaponModel();
  removeAll(S.enemies); removeAll(S.bullets); removeAll(S.pickups); removeAll(S.particles);
  for (const key of Object.keys(screens)) setScreen(key, false);
  $('messageBox').classList.remove('visible'); S.keys.clear(); S.touch.firing = false;
  spawnWave(); updateHud();
}
function pauseGame() {
  if (!S.running || S.gameOver) return;
  S.paused = true; setAudioActive(false); $('pauseStats').textContent = `Волна ${S.wave} · счёт ${Math.floor(S.score)}`; setScreen('pause', true);
}
function resumeGame() { S.paused = false; setAudioActive(true); setScreen('pause', false); }
function endGame() {
  if (S.gameOver) return;
  S.running = false; S.gameOver = true; S.paused = false; setAudioActive(false);
  $('finalStats').textContent = `Вы продержались ${Math.floor(S.time)} сек. · волна ${S.wave} · счёт ${Math.floor(S.score)}.`;
  setScreen('gameOver', true);
}
function updatePlayer(dt) {
  const p = S.player;
  p.muzzleFlash = Math.max(0, p.muzzleFlash - dt);
  let forward = (S.keys.has('w') ? 1 : 0) - (S.keys.has('s') ? 1 : 0) - S.touch.y;
  let side = (S.keys.has('d') ? 1 : 0) - (S.keys.has('a') ? 1 : 0) + S.touch.x;
  const length = Math.hypot(forward, side); if (length > 1) { forward /= length; side /= length; }
  const moving = Math.hypot(forward, side) > .05;
  const sprint = (S.keys.has('shift') || (mobile && S.touch.sprinting)) && p.stamina > 1 && moving && !p.crouching;
  const speed = p.crouching ? 2.2 : sprint ? 8.5 : 5.2;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  p.x += (fx * forward + rx * side) * speed * dt; p.z += (fz * forward + rz * side) * speed * dt;
  p.x = clamp(p.x, -bounds, bounds); p.z = clamp(p.z, -bounds, bounds);
  p.stamina = clamp(p.stamina + (sprint ? -28 : moving ? 8 : 18) * dt, 0, 100);
  const wantsJump = S.keys.has(' ') || S.touch.jumping;
  if (wantsJump && p.grounded) { p.vy = 5.7; p.grounded = false; S.touch.jumping = false; }
  p.vy -= 14 * dt; p.y += p.vy * dt;
  const groundHeight = p.crouching ? 1.02 : 1.65;
  if (p.y <= groundHeight) { p.y = groundHeight; p.vy = 0; p.grounded = true; }
  p.cooldown = Math.max(0, p.cooldown - dt); p.hitFlash = Math.max(0, p.hitFlash - dt);
  if (p.reloadTimer > 0) { p.reloadTimer -= dt; if (p.reloadTimer <= 0) finishReload(); }
  camera.position.set(p.x, p.y, p.z); camera.rotation.order = 'YXZ'; camera.rotation.y = p.yaw; camera.rotation.x = p.pitch;
}
function updateBullets(dt) {
  for (let i = S.bullets.length - 1; i >= 0; i--) {
    const b = S.bullets[i]; b.pos.addScaledVector(b.vel, dt); b.life -= dt; b.mesh.position.copy(b.pos);
    let hit = false;
    for (const enemy of [...S.enemies]) {
      if (b.pos.distanceTo(new THREE.Vector3(enemy.x, .7, enemy.z)) < enemy.radius + .12) { hitEnemy(enemy, b.damage, b.pos); hit = true; break; }
    }
    if (hit || b.life <= 0) { world.remove(b.mesh); S.bullets.splice(i, 1); }
  }
}
function updateEnemies(dt) {
  const p = S.player;
  for (const e of S.enemies) {
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
    if (d > 1.15) { e.x += dx / d * e.speed * dt; e.z += dz / d * e.speed * dt; }
    e.mesh.position.set(e.x, e.type === 'tank' ? 1.04 : e.type === 'runner' ? .56 : .72, e.z);
    e.mesh.rotation.y = Math.atan2(-dx, -dz); e.hit = Math.max(0, e.hit - dt);
    if (!e.hit) e.mesh.material.emissive.setHex(0x000000);
    if (d < 1.35) { p.health -= e.damage * dt; p.hitFlash = .2; if (p.health <= 0) { p.health = 0; endGame(); return; } }
  }
}
function updatePickups(dt) {
  for (let i = S.pickups.length - 1; i >= 0; i--) {
    const item = S.pickups[i]; item.life -= dt; item.mesh.rotation.y += dt * 1.8; item.mesh.position.y = .55 + Math.sin(S.time * 4 + i) * .14;
    if (item.life <= 0) { world.remove(item.mesh); S.pickups.splice(i, 1); continue; }
    if (Math.hypot(item.x - S.player.x, item.z - S.player.z) > 1.5) continue;
    const p = S.player;
    if (item.type === 'medkit') { p.health = clamp(p.health + 35, 0, 100); showMessage('АПТЕЧКА ПОДОБРАНА'); }
    if (item.type === 'ammo') { for (const key of ['pistol', 'shotgun', 'rifle']) p.reserve[key] += key === 'shotgun' ? 8 : key === 'rifle' ? 30 : 18; showMessage('БОЕПРИПАСЫ ПОДОБРАНЫ'); }
    if (item.type === 'weapon') { p.reserve.rifle += 30; p.reserve.shotgun += 6; showMessage('ЯЩИК С ОРУЖИЕМ'); }
    playSound('pickup'); world.remove(item.mesh); S.pickups.splice(i, 1); updateHud();
  }
}
function updateParticles(dt) {
  for (let i = S.particles.length - 1; i >= 0; i--) {
    const p = S.particles[i]; p.vy -= 4 * dt; p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt; p.life -= dt;
    if (p.life <= 0) { world.remove(p.mesh); S.particles.splice(i, 1); }
  }
}
function updateWave(dt) {
  if (S.enemies.length === 0 && S.waveDelay === 0) {
    S.waveDelay = 3.2; S.paused = true; setAudioActive(false); setScreen('upgrade', true);
  }
  if (S.waveDelay > 0 && S.paused === false) {
    S.waveDelay -= dt;
    if (S.waveDelay <= 0) { S.wave++; spawnWave(); }
  }
}
function updateRain(dt) {
  const pos = rainGeometry.attributes.position.array;
  for (let i = 0; i < rainCount; i++) {
    pos[i * 3 + 1] -= 18 * dt;
    if (pos[i * 3 + 1] < 0) { pos[i * 3] = S.player.x + rand(-30, 30); pos[i * 3 + 1] = rand(15, 26); pos[i * 3 + 2] = S.player.z + rand(-30, 30); }
  }
  rainGeometry.attributes.position.needsUpdate = true; rain.position.set(S.player.x, 0, S.player.z);
}
function drawMap() {
  const ctx = mapCtx, size = mapCanvas.width, scale = size / 48, p = S.player;
  ctx.clearRect(0, 0, size, size); ctx.fillStyle = 'rgba(5,12,14,.82)'; ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(181,205,192,.18)'; ctx.strokeRect(1, 1, size - 2, size - 2);
  for (const e of S.enemies) { const x = size / 2 + (e.x - p.x) * scale, y = size / 2 + (e.z - p.z) * scale; if (x > 3 && x < size - 3 && y > 3 && y < size - 3) { ctx.fillStyle = e.type === 'tank' ? '#e5a159' : '#f06060'; ctx.beginPath(); ctx.arc(x, y, e.type === 'tank' ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill(); } }
  ctx.save(); ctx.translate(size / 2, size / 2); ctx.rotate(-p.yaw); ctx.fillStyle = '#d9efce'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(-4, 4); ctx.lineTo(0, 2); ctx.lineTo(4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
}
function update(dt) {
  updateRain(dt);
  if (!S.running || S.paused) { drawMap(); return; }
  S.time += dt;
  if (S.messageTimer > 0 && (S.messageTimer -= dt) <= 0) $('messageBox').classList.remove('visible');
  ambienceTimer -= dt;
  if (ambienceTimer <= 0 && S.enemies.length) { playSound('groan'); ambienceTimer = rand(8, 15); }
  updatePlayer(dt); if (S.touch.firing || S.keys.has('mouse')) fire();
  updateBullets(dt); updateEnemies(dt); updatePickups(dt); updateParticles(dt); updateWave(dt); updateHud(); drawMap();
}
function updateVisuals(dt) {
  const direction = new THREE.Vector3(); camera.getWorldDirection(direction);
  flashlight.position.copy(camera.position).addScaledVector(direction, .12);
  flashlightTarget.position.copy(camera.position).addScaledVector(direction, 22);
  const t = clock.getElapsed();
  for (const { lamp, base, phase } of hazardLights) {
    const pulse = .76 + .2 * Math.sin(t * 3.4 + phase) + .08 * Math.sin(t * 11 + phase * 2.1);
    lamp.intensity = base * Math.max(.18, pulse);
  }
  for (const [kind, model] of Object.entries(weaponModels)) {
    model.recoil = Math.max(0, model.recoil - dt * (kind === 'knife' ? 1.8 : 1.1));
    model.group.position.z = -.72 + model.recoil;
    model.group.rotation.x = -.08 + (kind === 'knife' ? model.recoil * 1.8 : -model.recoil * .7);
    model.flash.visible = kind === S.player.weapon && S.player.muzzleFlash > 0;
    model.flash.scale.setScalar(.6 + Math.random() * .8);
  }
}
function resize() { const w = innerWidth, h = innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); }
function animate() {
  clock.update();
  const dt = clamp(clock.getDelta(), .001, .04);
  floorShader.uniforms.uTime.value += dt;
  update(dt);
  updateVisuals(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function beginNextWave(upgrade) {
  const p = S.player;
  if (upgrade === 'damage') { S.damageBonus *= 1.2; showMessage('УРОН УВЕЛИЧЕН'); }
  if (upgrade === 'health') { p.health = clamp(p.health + 40, 0, 100); showMessage('ЗДОРОВЬЕ ВОССТАНОВЛЕНО'); }
  if (upgrade === 'ammo') { p.reserve.pistol += 36; p.reserve.shotgun += 16; p.reserve.rifle += 60; showMessage('БОЕЗАПАС ПОПОЛНЕН'); }
  setScreen('upgrade', false); S.paused = false; setAudioActive(true); S.waveDelay = 2.4; updateHud();
}
function onLookStart(event) {
  if (!S.running || S.paused || event.target.closest('button') || event.target.closest('#joystick')) return;
  if (event.pointerType === 'mouse') { if (event.button !== 0) return; S.keys.add('mouse'); return; }
  if (event.clientX > innerWidth * .32) { S.lookPointer = event.pointerId; canvas.setPointerCapture?.(event.pointerId); }
}
function onLookMove(event) {
  if (event.pointerType === 'mouse' && S.pointerLocked) {
    S.player.yaw -= event.movementX * .0024; S.player.pitch = clamp(S.player.pitch - event.movementY * .002, -1.25, 1.25); return;
  }
  if (event.pointerId !== S.lookPointer) return;
  S.player.yaw -= event.movementX * .006; S.player.pitch = clamp(S.player.pitch - event.movementY * .0045, -1.2, 1.2);
}
function onLookEnd(event) { if (event.pointerId === S.lookPointer) S.lookPointer = null; if (event.pointerType === 'mouse') S.keys.delete('mouse'); }
const joystick = $('joystick'), thumb = $('stickThumb');
function joystickUpdate(event) {
  const rect = joystick.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx, dy = event.clientY - cy, max = rect.width * .34, length = Math.min(max, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx), x = Math.cos(angle) * length, y = Math.sin(angle) * length;
  thumb.style.transform = `translate(${x}px, ${y}px)`; S.touch.x = x / max; S.touch.y = y / max;
}
joystick.addEventListener('pointerdown', (event) => { if (!S.running || S.paused) return; S.joyPointer = event.pointerId; joystick.setPointerCapture(event.pointerId); joystickUpdate(event); event.preventDefault(); });
joystick.addEventListener('pointermove', (event) => { if (event.pointerId === S.joyPointer) joystickUpdate(event); });
function releaseJoystick(event) { if (event.pointerId !== S.joyPointer) return; S.joyPointer = null; S.touch.x = S.touch.y = 0; thumb.style.transform = 'translate(0, 0)'; }
joystick.addEventListener('pointerup', releaseJoystick); joystick.addEventListener('pointercancel', releaseJoystick);
canvas.addEventListener('pointerdown', onLookStart); canvas.addEventListener('pointermove', onLookMove); canvas.addEventListener('pointerup', onLookEnd); canvas.addEventListener('pointercancel', onLookEnd);
canvas.addEventListener('click', () => { if (!mobile && S.running && !S.pointerLocked) canvas.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => { S.pointerLocked = document.pointerLockElement === canvas; });
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase(); S.keys.add(key); if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault();
  if (key === 'r') reload(); if (key === '1') setWeapon('pistol'); if (key === '2') setWeapon('shotgun'); if (key === '3') setWeapon('rifle'); if (key === '4') setWeapon('knife');
  if (key === 'escape' && S.running) S.paused ? resumeGame() : pauseGame();
});
window.addEventListener('keyup', (event) => S.keys.delete(event.key.toLowerCase()));
$('fireButton').addEventListener('pointerdown', (event) => { event.stopPropagation(); event.preventDefault(); S.touch.firing = true; fire(); });
for (const name of ['pointerup', 'pointercancel', 'pointerleave']) $('fireButton').addEventListener(name, () => { S.touch.firing = false; });
$('reloadButton').addEventListener('click', reload);
$('jumpButton').addEventListener('click', () => { S.touch.jumping = true; });
$('crouchButton').addEventListener('click', () => { S.player.crouching = !S.player.crouching; updateHud(); });
$('weaponPrev').addEventListener('click', () => cycleWeapon(-1)); $('weaponNext').addEventListener('click', () => cycleWeapon(1));
$('inventoryButton').addEventListener('click', () => { if (!S.running) return; S.paused = true; setAudioActive(false); setScreen('inventory', true); });
$('closeInventory').addEventListener('click', () => { setScreen('inventory', false); S.paused = false; setAudioActive(true); });
document.querySelectorAll('[data-weapon]').forEach((button) => button.addEventListener('click', () => { setWeapon(button.dataset.weapon); setScreen('inventory', false); S.paused = false; setAudioActive(true); }));
document.querySelectorAll('[data-upgrade]').forEach((button) => button.addEventListener('click', () => beginNextWave(button.dataset.upgrade)));
$('skipUpgrade').addEventListener('click', () => beginNextWave(null)); $('startButton').addEventListener('click', startGame); $('restartButton').addEventListener('click', startGame);
$('pauseButton').addEventListener('click', () => S.paused ? resumeGame() : pauseGame()); $('resumeButton').addEventListener('click', resumeGame);
window.addEventListener('resize', resize); window.addEventListener('contextmenu', (event) => event.preventDefault());
resize(); updateHud(); requestAnimationFrame(animate);
