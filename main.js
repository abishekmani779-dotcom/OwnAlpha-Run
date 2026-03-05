import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { generateTextures } from './src/texture_generator.js';

// --- GAME LOGIC STATE ---
let gameState = 'MENU'; // 'MENU', 'STARTING', 'PLAYING', 'GAMEOVER'
let distance = 0;
let coins = 0;
let mistakes = 0;
let isGameOver = false; // Legacy fallback check
let isPaused = false;
let gameSpeed = 20; // current units per second
let baseGameSpeed = 20; // base difficulty speed
let speedLevel = 0;
let hasShield = false;
let boostTimeLeft = 0; // seconds remaining for boost
let magnetTimeLeft = 0; // seconds remaining for magnet
const BOOST_TOTAL = 8.0;
const MAGNET_TOTAL = 10.0;
const LANE_WIDTH = 2.5;

// Settings & Progress (Persistent)
let highScore = parseFloat(localStorage.getItem('high_score')) || 0;
let sfxEnabled = localStorage.getItem('sfx_on') !== 'false';
let musicEnabled = localStorage.getItem('music_on') !== 'false';

// DOM Elements
const distanceEl = document.getElementById('distance');
const coinsEl = document.getElementById('coins');
const gameOverEl = document.getElementById('game-over');
const restartBtn = document.getElementById('restart-btn');
const pauseBtn = document.getElementById('pause-btn');
const speedAlertEl = document.getElementById('speed-level-alert');

// New UI DOM Elements
const startScreen = document.getElementById('start-screen');
const gameplayUI = document.getElementById('gameplay-ui');
const playBtn = document.getElementById('play-btn');
const howToBtn = document.getElementById('how-to-btn');
const closeHowToBtn = document.getElementById('close-how-to-btn');
const howToOverlay = document.getElementById('how-to-overlay');
const toggleMusicBtn = document.getElementById('toggle-music-btn');
const toggleSfxBtn = document.getElementById('toggle-sfx-btn');
const homeBtn = document.getElementById('home-btn');
const finalDistanceEl = document.getElementById('final-distance');
const finalCoinsEl = document.getElementById('final-coins');
const highScoreEl = document.getElementById('high-score');

// --- AUDIO ENGINE (SFX) ---
const AudioEngine = {
    actx: null, lastAmbienceStep: 0, lastKillerStep: 0,
    init() {
        if (!this.actx) {
            try { this.actx = new (window.AudioContext || window.webkitAudioContext)(); }
            catch (e) { console.warn('AudioContext failed'); }
        }
    },
    playTone(freqStart, freqEnd, type, duration, vol = 0.1) {
        if (!this.actx || !sfxEnabled) return;
        try {
            const osc = this.actx.createOscillator();
            const gain = this.actx.createGain();
            osc.type = type; osc.connect(gain); gain.connect(this.actx.destination);
            osc.frequency.setValueAtTime(freqStart, this.actx.currentTime);
            if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, this.actx.currentTime + duration);
            gain.gain.setValueAtTime(vol, this.actx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.actx.currentTime + duration);
            osc.start(); osc.stop(this.actx.currentTime + duration);
        } catch (e) { }
    },
    playJump() { this.playTone(300, 600, 'sine', 0.2); },
    playSlide() { this.playTone(150, 50, 'square', 0.2, 0.05); },
    playShift() { this.playTone(500, 200, 'triangle', 0.1, 0.05); },
    playMilestone() { this.playTone(400, 800, 'sine', 0.5, 0.2); setTimeout(() => this.playTone(800, 1200, 'sine', 0.5, 0.2), 300); },
    tick(dt, speedLevel, isKillerVisible, killerSpeedParams) {
        if (!this.actx) return;
        this.lastAmbienceStep -= dt;
        if (this.lastAmbienceStep <= 0) {
            this.playTone(80, 50, 'sine', 0.3, 0.03);
            this.lastAmbienceStep = Math.max(0.3, 1.0 - (speedLevel * 0.2));
        }
        if (isKillerVisible) {
            this.lastKillerStep -= dt;
            if (this.lastKillerStep <= 0) {
                let vol = Math.min(0.2, 0.05 + (speedLevel * 0.03));
                this.playTone(100, 100, 'sawtooth', 0.1, vol);
                this.lastKillerStep = Math.max(0.2, 0.6 / killerSpeedParams);
            }
        }
    },
    tickTimer: 0, tickPitch: 400,
    playTickExpiring(dt) {
        if (!this.actx) return;
        this.tickTimer -= dt;
        if (this.tickTimer <= 0) {
            this.playTone(this.tickPitch, this.tickPitch + 100, 'square', 0.05, 0.1);
            this.tickPitch = Math.min(1200, this.tickPitch + 150);
            this.tickTimer = 0.15;
        }
    },
    resetTickExpiring() {
        this.tickTimer = 0;
        this.tickPitch = 400;
    },
    boostActive: false,
    boostSrc: null,
    playSpeedBoost() {
        if (!this.actx || this.boostActive) return;
        this.boostActive = true;
        try {
            const bufferSize = this.actx.sampleRate * 2;
            const buffer = this.actx.createBuffer(1, bufferSize, this.actx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

            this.boostSrc = this.actx.createBufferSource();
            this.boostSrc.buffer = buffer;
            this.boostSrc.loop = true;

            const filter = this.actx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(400, this.actx.currentTime);
            filter.frequency.linearRampToValueAtTime(2000, this.actx.currentTime + 1.0);

            const gain = this.actx.createGain();
            gain.gain.setValueAtTime(0, this.actx.currentTime);
            gain.gain.linearRampToValueAtTime(0.3, this.actx.currentTime + 0.5);

            this.boostSrc.connect(filter);
            filter.connect(gain);
            gain.connect(this.actx.destination);

            this.boostSrc.gainNode = gain;
            this.boostSrc.start();
        } catch (e) { }
    },
    stopSpeedBoost() {
        if (!this.boostActive) return;
        this.boostActive = false;
        try {
            if (this.boostSrc && this.boostSrc.gainNode) {
                this.boostSrc.gainNode.gain.linearRampToValueAtTime(0, this.actx.currentTime + 1.0);
                setTimeout(() => { if (this.boostSrc) this.boostSrc.stop(); }, 1000);
            }
        } catch (e) { }
    }
};

const bgmAudio = document.getElementById('bgmAudio');
if (bgmAudio) bgmAudio.volume = 0.08; // Default menu volume

function updateSettingsUI() {
    // Start Menu Toggles
    if (toggleMusicBtn) {
        const stateEl = document.getElementById('music-state');
        if (stateEl) {
            stateEl.innerHTML = musicEnabled ? 'ON <span class="audio-check">✔</span>' : 'OFF';
            stateEl.className = musicEnabled ? 'audio-toggle-state' : 'audio-toggle-state off';
        }
    }
    if (toggleSfxBtn) {
        const stateEl = document.getElementById('sfx-state');
        if (stateEl) {
            stateEl.innerHTML = sfxEnabled ? 'ON <span class="audio-check">✔</span>' : 'OFF';
            stateEl.className = sfxEnabled ? 'audio-toggle-state' : 'audio-toggle-state off';
        }
    }

    // Pause Menu Toggles
    const pauseMusicState = document.getElementById('pause-music-state');
    if (pauseMusicState) {
        pauseMusicState.innerHTML = musicEnabled ? 'ON <span class="popup-audio-check">✔</span>' : 'OFF';
        pauseMusicState.className = musicEnabled ? 'popup-audio-state' : 'popup-audio-state off';
    }
    const pauseSfxState = document.getElementById('pause-sfx-state');
    if (pauseSfxState) {
        pauseSfxState.innerHTML = sfxEnabled ? 'ON <span class="popup-audio-check">✔</span>' : 'OFF';
        pauseSfxState.className = sfxEnabled ? 'popup-audio-state' : 'popup-audio-state off';
    }

    if (bgmAudio) {
        if (musicEnabled) { if (bgmAudio.paused) bgmAudio.play().catch(e => { }); }
        else { bgmAudio.pause(); }
    }
}

// UI Triggers for Audio
const toggleMusicLogic = () => {
    musicEnabled = !musicEnabled;
    localStorage.setItem('music_on', musicEnabled);
    updateSettingsUI();
};
if (toggleMusicBtn) toggleMusicBtn.addEventListener('click', toggleMusicLogic);
const pauseMusicBtn = document.getElementById('pause-music-btn');
if (pauseMusicBtn) pauseMusicBtn.addEventListener('click', toggleMusicLogic);

const toggleSfxLogic = () => {
    sfxEnabled = !sfxEnabled;
    localStorage.setItem('sfx_on', sfxEnabled);
    updateSettingsUI();
};
if (toggleSfxBtn) toggleSfxBtn.addEventListener('click', toggleSfxLogic);
const pauseSfxBtn = document.getElementById('pause-sfx-btn');
if (pauseSfxBtn) pauseSfxBtn.addEventListener('click', toggleSfxLogic);

const initAudio = () => {
    AudioEngine.init();
    updateSettingsUI();
};

window.addEventListener('keydown', initAudio, { once: true });
window.addEventListener('click', initAudio, { once: true });
window.addEventListener('touchstart', initAudio, { once: true });

// Play Button logic (START GAME TRIGGER)
if (playBtn) playBtn.addEventListener('click', () => {
    startScreen.style.display = 'none';
    gameplayUI.style.display = 'block';
    gameState = 'STARTING'; // Handled in animate loop for zoom-in transition
    if (bgmAudio && musicEnabled) bgmAudio.volume = 0.15; // Slightly louder in game
});

// How to Play Triggers
if (howToBtn) howToBtn.addEventListener('click', () => howToOverlay.style.display = 'flex');
if (closeHowToBtn) closeHowToBtn.addEventListener('click', () => howToOverlay.style.display = 'none');

// --- THEMES & TRANSITIONS ---
const THEMES = [
    { sky: 0x87CEEB, fog: 0xA0D8EF, path: 0x112211, border: 0x051a05, lightIntensity: 3.0, isDay: true }, // Level 1 (Sky Blue)
    { sky: 0x4B0082, fog: 0x1A0033, path: 0x111622, border: 0x05051a, lightIntensity: 1.0, isDay: false }, // Level 2 (Indigo/Night)
    { sky: 0xFF4500, fog: 0x4D1A00, path: 0x241105, border: 0x331005, lightIntensity: 2.2, isDay: false }, // Level 3 (Industrial Orange)
    { sky: 0x000000, fog: 0x111111, path: 0x332a1a, border: 0x4a2c11, lightIntensity: 0.5, isDay: false }  // Level 4 (Deep Space)
];
let targetTheme = THEMES[0];
let currentSkyColor = new THREE.Color(THEMES[0].sky);
let currentFogColor = new THREE.Color(THEMES[0].fog);
let currentLightIntensity = THEMES[0].lightIntensity;
let isTransitioning = false;
let transitionTimer = 0;
const TRANSITION_DURATION = 4.0; // 4 seconds

function triggerLevelTransition(newLevel) {
    let tIndex = Math.min(newLevel, THEMES.length - 1);
    targetTheme = THEMES[tIndex];
    isTransitioning = true;
    transitionTimer = 0;
}

function getTheme(lvl) {
    return THEMES[Math.min(lvl, THEMES.length - 1)];
}

function updatePowerupsUI(dt) {
    const container = document.getElementById('powerups-container');
    if (!container) return;

    let html = '';

    const buildRing = (icon, timeLeft, timeTotal, colorStr) => {
        let percent = Math.max(0, timeLeft / timeTotal);
        // Circle circumference is approx 138 (r=22)
        let dashOffset = 138 - (138 * percent);
        let isExpiring = timeLeft > 0 && timeLeft <= 2.0;
        let blinkClass = isExpiring ? 'powerup-blink' : '';
        let strokeColor = isExpiring ? '#ff3333' : colorStr;

        return `
            <div class="powerup-item ${blinkClass}">
                <svg class="powerup-ring-svg" viewBox="0 0 48 48">
                    <circle class="powerup-ring-circle" cx="24" cy="24" r="22" stroke="${strokeColor}" style="stroke-dashoffset: ${dashOffset}"></circle>
                </svg>
                <div class="powerup-icon">${icon}</div>
            </div>
        `;
    };

    if (boostTimeLeft > 0) {
        html += buildRing('⚡️', boostTimeLeft, BOOST_TOTAL, '#00ffff');
    }
    if (magnetTimeLeft > 0) {
        html += buildRing('🧲', magnetTimeLeft, MAGNET_TOTAL, '#ff00ff');
    }
    if (hasShield) {
        html += `
            <div class="powerup-item">
                <svg class="powerup-ring-svg" viewBox="0 0 48 48">
                    <circle class="powerup-ring-circle" cx="24" cy="24" r="22" stroke="#ffcc00" style="stroke-dashoffset: 0;"></circle>
                </svg>
                <div class="powerup-icon">🛡️</div>
            </div>
        `;
    }

    container.innerHTML = html;

    let anyExpiring = (boostTimeLeft > 0 && boostTimeLeft <= 2.0) || (magnetTimeLeft > 0 && magnetTimeLeft <= 2.0);
    if (anyExpiring) {
        AudioEngine.playTickExpiring(dt);
    } else {
        AudioEngine.resetTickExpiring();
    }
}

// --- SCENE SETUP ---
const scene = new THREE.Scene();
scene.background = currentSkyColor.clone();
scene.fog = new THREE.FogExp2(currentFogColor.clone(), 0.008);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(1.5, 3.5, 6);
camera.lookAt(0, 1, -10);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const renderPass = new RenderPass(scene, camera);
const bokehPass = new BokehPass(scene, camera, {
    focus: 6.0,
    aperture: 0.0001,
    maxblur: 0.012,
    width: window.innerWidth,
    height: window.innerHeight
});

const composer = new EffectComposer(renderer);
composer.addPass(renderPass);
composer.addPass(bokehPass);

// Lights
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, currentLightIntensity); // Sunlight/Moonlight
dirLight.position.set(15, 30, -20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
dirLight.shadow.camera.left = -20;
dirLight.shadow.camera.right = 20;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = -30;
dirLight.shadow.camera.far = 80;
dirLight.shadow.bias = -0.001;
scene.add(dirLight);

// --- SKYBOX (STARS & DAY/NIGHT CYCLE & VOLUMETRICS) ---
const starsGeo = new THREE.BufferGeometry();
const starsCount = 5000;
const starsPos = new Float32Array(starsCount * 3);
for (let i = 0; i < starsCount; i++) {
    starsPos[i * 3] = (Math.random() - 0.5) * 800;
    starsPos[i * 3 + 1] = Math.random() * 300 + 40; // Above horizon
    starsPos[i * 3 + 2] = (Math.random() - 0.5) * 800;
}
starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos, 3));
const starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, transparent: true, opacity: 0.0 });
const starsMesh = new THREE.Points(starsGeo, starsMat);
scene.add(starsMesh);

// Twinkling Stars (Shader)
const twinkleGeo = new THREE.BufferGeometry();
const twinkleCount = 1000;
const twinklePos = new Float32Array(twinkleCount * 3);
const twinkleOffsets = new Float32Array(twinkleCount);
for (let i = 0; i < twinkleCount; i++) {
    twinklePos[i * 3] = (Math.random() - 0.5) * 600;
    twinklePos[i * 3 + 1] = Math.random() * 250 + 50;
    twinklePos[i * 3 + 2] = (Math.random() - 0.5) * 600;
    twinkleOffsets[i] = Math.random() * Math.PI * 2;
}
twinkleGeo.setAttribute('position', new THREE.BufferAttribute(twinklePos, 3));
twinkleGeo.setAttribute('offset', new THREE.BufferAttribute(twinkleOffsets, 1));
const twinkleShader = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, baseOpacity: { value: 1.0 } },
    vertexShader: `
        attribute float offset;
        varying float vAlpha;
        uniform float time;
        void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            gl_PointSize = (100.0 / -mvPosition.z) * 1.5;
            vAlpha = 0.5 + 0.5 * sin(time * 3.0 + offset);
        }
    `,
    fragmentShader: `
        varying float vAlpha;
        uniform float baseOpacity;
        void main() {
            float r = distance(gl_PointCoord, vec2(0.5));
            if(r > 0.5) discard;
            gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * baseOpacity * (1.0 - r*2.0));
        }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
});
const twinkleMesh = new THREE.Points(twinkleGeo, twinkleShader);
scene.add(twinkleMesh);

// Procedural Clouds
const clouds = [];
const cloudGeo = new THREE.IcosahedronGeometry(1.5, 0);
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, flatShading: true, transparent: true, opacity: 0.95 });
for (let i = 0; i < 60; i++) {
    const cg = new THREE.Group();
    const parts = 5 + Math.floor(Math.random() * 5); // More parts per cloud
    for (let j = 0; j < parts; j++) {
        const p = new THREE.Mesh(cloudGeo, cloudMat);
        p.position.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6);
        p.scale.setScalar(1.5 + Math.random() * 4.0); // Bigger fluffier parts
        p.rotation.set(Math.random(), Math.random(), Math.random());
        cg.add(p);
    }
    const baseY = 20 + Math.random() * 80;
    cg.position.set((Math.random() - 0.5) * 600, baseY, (Math.random() - 0.5) * 800 - 200);
    cg.userData.speed = Math.random() * 3.0 + 1.0;
    cg.userData.baseY = baseY;
    scene.add(cg);
    clouds.push(cg);
}

// Floating Balloons
const balloons = [];
const balloonGeo = new THREE.SphereGeometry(2, 16, 16);
const stringGeo = new THREE.CylinderGeometry(0.05, 0.05, 3, 4);

const balloonColors = [0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff];

for (let i = 0; i < 25; i++) {
    const bg = new THREE.Group();

    // Balloon body
    const color = balloonColors[Math.floor(Math.random() * balloonColors.length)];
    const bm = new THREE.MeshStandardMaterial({ color: color, roughness: 0.2, metalness: 0.1 });
    const bMesh = new THREE.Mesh(balloonGeo, bm);
    bMesh.position.y = 1.5;
    bg.add(bMesh);

    // Balloon string
    const stringMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    const sMesh = new THREE.Mesh(stringGeo, stringMat);
    sMesh.position.y = -0.5;
    bg.add(sMesh);

    // Initial positioning
    const baseY = 15 + Math.random() * 50;
    bg.position.set((Math.random() - 0.5) * 200, baseY, (Math.random() - 0.5) * 600 - 100);

    // Scale randomization
    const scale = 0.5 + Math.random() * 1.5;
    bg.scale.set(scale, scale, scale);

    bg.userData.speedX = (Math.random() - 0.5) * 2.0;
    bg.userData.speedZ = Math.random() * 5.0 + 2.0; // They fly towards the camera like clouds
    bg.userData.baseY = baseY;
    bg.userData.bobSpeed = 1.0 + Math.random() * 2.0;

    scene.add(bg);
    balloons.push(bg);
}

// Nebula Haze texture using canvas gradient
const canvas2 = document.createElement('canvas');
canvas2.width = 128; canvas2.height = 128;
const ctx2 = canvas2.getContext('2d');
const grad2 = ctx2.createRadialGradient(64, 64, 0, 64, 64, 64);
grad2.addColorStop(0, 'rgba(100,50,200,0.5)'); // Deep purple-blue nebula
grad2.addColorStop(1, 'rgba(100,50,200,0)');
ctx2.fillStyle = grad2; ctx2.fillRect(0, 0, 128, 128);
const nebulaGroup = new THREE.Group();
const nebMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas2), transparent: true, blending: THREE.AdditiveBlending, opacity: 0.0 });
for (let i = 0; i < 8; i++) {
    const s = new THREE.Sprite(nebMat);
    s.scale.set(300 + Math.random() * 200, 150 + Math.random() * 100, 1);
    s.position.set((Math.random() - 0.5) * 600, 60 + Math.random() * 80, -200 - Math.random() * 200);
    nebulaGroup.add(s);
}
scene.add(nebulaGroup);

// Helper for Sun & Moon Glow
const ceCanvas = document.createElement('canvas');
ceCanvas.width = 128; ceCanvas.height = 128;
const ceCtx = ceCanvas.getContext('2d');
const ceGrad = ceCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
ceGrad.addColorStop(0, 'rgba(255,255,255,1)');
ceGrad.addColorStop(1, 'rgba(255,255,255,0)');
ceCtx.fillStyle = ceGrad; ceCtx.fillRect(0, 0, 128, 128);
const glowTex = new THREE.CanvasTexture(ceCanvas);

const sunGeo = new THREE.SphereGeometry(12, 16, 16);
const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
const sunMesh = new THREE.Mesh(sunGeo, sunMat);
sunMesh.position.set(-50, 100, -250);
const sunGlowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffffaa, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.95 });
const sunGlow = new THREE.Sprite(sunGlowMat);
sunGlow.scale.set(150, 150, 1);
sunMesh.add(sunGlow);

// God Ray Cross
const sunRayMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffddaa, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.4 });
const sunRay = new THREE.Sprite(sunRayMat);
sunRay.scale.set(400, 40, 1);
sunRay.material.rotation = Math.PI / 4;
sunMesh.add(sunRay);
const sunRay2 = new THREE.Sprite(sunRayMat);
sunRay2.scale.set(40, 400, 1);
sunRay2.material.rotation = Math.PI / 4;
sunMesh.add(sunRay2);
scene.add(sunMesh);

const moonMat = new THREE.MeshStandardMaterial({ color: 0xaaabcc, roughness: 0.8 });
const moonMesh = new THREE.Mesh(sunGeo, moonMat);
moonMesh.position.set(50, -100, -250); // Start hidden below map
const moonGlowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x88bbff, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.7 });
const moonGlow = new THREE.Sprite(moonGlowMat);
moonGlow.scale.set(100, 100, 1);
moonMesh.add(moonGlow);
scene.add(moonMesh);

const playerLight = new THREE.PointLight(0xffaa55, 0.0, 30); // Warm torch (turned off for day mode)
playerLight.position.set(0, 2.5, 2); // Placed slightly above and ahead

// --- PHYSICS INITIALIZATION ---
// "Initialize 3D Physics first" - Simple custom kinematics & AABB engine
const GRAVITY = -45;
class PhysicsEntity {
    constructor(mesh, isTrigger = false) {
        this.mesh = mesh;
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.isGrounded = true;
        this.isTrigger = isTrigger; // Dress/Money objects won't cause physical crash
        this.box = new THREE.Box3();
    }
    update(dt) {
        if (!this.isGrounded) {
            this.velocity.y += GRAVITY * dt;
            this.mesh.position.y += this.velocity.y * dt;
            // Floor collision check
            if (this.mesh.position.y <= 0) {
                this.mesh.position.y = 0;
                this.velocity.y = 0;
                this.isGrounded = true;
                this.mesh.scale.set(1, 1, 1); // Reset scale on landing
            }
        }
        this.box.setFromObject(this.mesh);
    }
    jump() {
        if (this.isGrounded) {
            this.velocity.y = 15;
            this.isGrounded = false;
        }
    }
}

// --- PLAYER SETUP ---
const playerGroup = new THREE.Group();
playerGroup.add(playerLight);
scene.add(playerGroup);

// --- PLAYER MODEL VIA GLTF LOADER ---
let playerMixer;
let killerMixer; // Add global mixer for killer constraint
let playerRunAction; // Store global reference to animation clip
let killerRunAction, killerIdleAction, killerLungeAction;
const loader = new GLTFLoader();

loader.load(
    'models/girl_gameready_anim.glb', // User downloaded model
    function (gltf) {
        const model = gltf.scene;

        // --- PRO GAME DESIGNER AUTO-SCALING ---
        // Scale the model down to a reasonable 1.6 units
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());

        // Prevent division by zero if empty mesh
        if (size.y > 0) {
            const scaleFactor = 1.6 / size.y;
            model.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }
        model.rotation.y = Math.PI; // Face moving direction (-Z)

        // Reset origin down so she doesn't float "on top"
        model.position.y = 0;

        // --- BONE BINDING FOR PROCEDURAL RIGGING ---
        let bones = {};
        model.traverse(function (child) {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
            // Map common Humanoid Armature names (Mixamo/Blender standard)
            const n = child.name.toLowerCase();
            if (child.isBone || child.type === 'Bone' || child.type === 'Object3D') {
                if (n.includes('left') && (n.includes('upleg') || n.includes('thigh') || n === 'leftleg')) bones.lLeg = child;
                if (n.includes('right') && (n.includes('upleg') || n.includes('thigh') || n === 'rightleg')) bones.rLeg = child;
                if (n.includes('left') && (n.includes('leg') || n.includes('calf') || n.includes('shin')) && !bones.lCalf) bones.lCalf = child;
                if (n.includes('right') && (n.includes('leg') || n.includes('calf') || n.includes('shin')) && !bones.rCalf) bones.rCalf = child;

                if (n.includes('left') && (n.includes('arm') || n.includes('shoulder')) && !n.includes('fore')) bones.lArm = child;
                if (n.includes('right') && (n.includes('arm') || n.includes('shoulder')) && !n.includes('fore')) bones.rArm = child;
                if (n.includes('left') && n.includes('forearm')) bones.lForeArm = child;
                if (n.includes('right') && n.includes('forearm')) bones.rForeArm = child;

                if (n.includes('spine') || n.includes('torso')) bones.spine = child;
                if (n.includes('head') || n.includes('neck')) bones.head = child;
            }
        });
        playerGroup.userData.bones = bones;
        playerGroup.userData.model = model;

        playerGroup.add(model);

        // --- ANIMATIONS ---
        if (gltf.animations && gltf.animations.length > 0) {
            playerMixer = new THREE.AnimationMixer(model);
            playerRunAction = playerMixer.clipAction(gltf.animations[0]);
            playerRunAction.time = 3.0; // Fast-forward directly to the "Run" track segment
            playerRunAction.play();
        }
    },
    undefined,
    function (error) {
        console.error('Error loading 3D model. Make sure model.glb is in the models/ folder!', error);
    }
);

// Outfit Mesh (Initially hidden)
const outfitGroup = new THREE.Group();
const jacketMat = new THREE.MeshStandardMaterial({ color: 0x5c4033 }); // Brown leather
const outfitJacket = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.3), jacketMat);
outfitJacket.position.y = 1.2;
outfitGroup.add(outfitJacket);

const capMat = new THREE.MeshStandardMaterial({ color: 0x3b3a6d });
const outfitCap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.46), capMat);
outfitCap.position.y = 1.85;
outfitGroup.add(outfitCap);
const capBill = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.25), capMat);
capBill.position.set(0, 1.85, 0.25);
outfitGroup.add(capBill);

outfitGroup.visible = false;
playerGroup.add(outfitGroup);

const playerPhys = new PhysicsEntity(playerGroup, false);

let currentLane = 0; // -1 (Left), 0 (Center), 1 (Right)
let targetX = 0;

// --- KILLER SETUP ---
const killerGroup = new THREE.Group();
scene.add(killerGroup);

const killerLight = new THREE.PointLight(0xff0000, 3.0, 15);
killerLight.position.set(0, 1.5, 0);
killerGroup.add(killerLight);

const killerRimLight = new THREE.DirectionalLight(0xaabbff, 3.0);
killerRimLight.position.set(0, 5, 5); // Behind and above
killerGroup.add(killerRimLight);

loader.load(
    'models/Killer.glb',
    function (gltf) {
        const kModel = gltf.scene;

        // Wrap the killer to fix "sleep" angle safely
        const wrapper = new THREE.Group();

        // Fix sleep angle (rotate 90 degrees up)
        // Math.PI / 2 (positive stands him up correctly, negative made him upside down)
        kModel.rotation.x = Math.PI / 2;
        wrapper.add(kModel);

        // Update matrices so bounding box knows about the rotation
        wrapper.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(wrapper);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        if (size.y > 0) {
            // Auto-scale to roughly 1.92 units tall (1.2x bigger than 1.6)
            const scaleFactor = 1.92 / size.y;
            wrapper.scale.set(scaleFactor, scaleFactor, scaleFactor);

            // Fix his position offset! Because we rotated him, his center might be deep underground
            // the wrapper needs to be adjusted so his feet are at y=0
            wrapper.position.y -= (center.y - size.y / 2) * scaleFactor;
        }

        // Face moving direction (-Z)
        wrapper.rotation.y = Math.PI;

        let bones = {};
        wrapper.traverse(function (child) {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
            const n = child.name.toLowerCase();
            if (child.isBone || child.type === 'Bone' || child.type === 'Object3D') {
                if (n.includes('left') && (n.includes('upleg') || n.includes('thigh') || n === 'leftleg')) bones.lLeg = child;
                if (n.includes('right') && (n.includes('upleg') || n.includes('thigh') || n === 'rightleg')) bones.rLeg = child;
                if (n.includes('left') && (n.includes('leg') || n.includes('calf') || n.includes('shin')) && !bones.lCalf) bones.lCalf = child;
                if (n.includes('right') && (n.includes('leg') || n.includes('calf') || n.includes('shin')) && !bones.rCalf) bones.rCalf = child;
                if (n.includes('left') && (n.includes('arm') || n.includes('shoulder')) && !n.includes('fore')) bones.lArm = child;
                if (n.includes('right') && (n.includes('arm') || n.includes('shoulder')) && !n.includes('fore')) bones.rArm = child;
                if (n.includes('spine') || n.includes('torso')) bones.spine = child;
                if (n.includes('head') || n.includes('neck')) bones.head = child;
            }
        });

        killerGroup.userData.bones = bones;
        killerGroup.userData.model = wrapper;

        killerGroup.add(wrapper);

        if (gltf.animations && gltf.animations.length > 0) {
            killerMixer = new THREE.AnimationMixer(wrapper);
            const findAnim = (names) => {
                for (let n of names) { let c = THREE.AnimationClip.findByName(gltf.animations, n); if (c) return c; }
                for (let c of gltf.animations) { for (let n of names) { if (c.name.toLowerCase().includes(n.toLowerCase())) return c; } }
                return gltf.animations[0];
            };
            killerIdleAction = killerMixer.clipAction(findAnim(['Idle', 'Breathing']));
            killerRunAction = killerMixer.clipAction(findAnim(['Run', 'Heavy', 'Monster']));
            killerLungeAction = killerMixer.clipAction(findAnim(['Lunge', 'Attack', 'Jump']));

            if (killerRunAction) killerRunAction.play(); // default
        }
    }
);

// --- ASSET LOADER (ENVIRONMENT) ---
let gameAssets = { jumpRock: null, slideLog: null, wallPlank: null, tree: null, tree2: null };

loader.load('models/Objects.glb', function (gltf) {
    gltf.scene.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;

        // Rock for jumping (Object_46 is a medium boulder)
        if (child.name === 'Object_46') {
            gameAssets.jumpRock = child.clone();
            const box = new THREE.Box3().setFromObject(gameAssets.jumpRock);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            // Scale dynamically to fill mostly the 2.5 lane width
            const scale = 2.0 / Math.max(0.1, size.x);
            gameAssets.jumpRock.scale.set(scale, scale, scale);
            // Re-center mesh local origin
            gameAssets.jumpRock.position.sub(center).multiplyScalar(scale);
            gameAssets.jumpRock.position.y += (size.y * scale) / 2; // Floor pin

            // Wrap in group so it plays identically to primitive positioning
            const g = new THREE.Group(); g.add(gameAssets.jumpRock);
            gameAssets.jumpRock = g;
        }

        // Long wooden pole for sliding under (Object_74)
        if (child.name === 'Object_74') {
            gameAssets.slideLog = child.clone();
            const box = new THREE.Box3().setFromObject(gameAssets.slideLog);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            // The pole's Y is its length. Scale to fit lane
            const scale = 2.5 / Math.max(0.1, size.y);
            gameAssets.slideLog.scale.set(scale, scale, scale);
            gameAssets.slideLog.position.sub(center).multiplyScalar(scale);
            gameAssets.slideLog.rotation.z = Math.PI / 2; // Rotate horizontal!
            const g = new THREE.Group(); g.add(gameAssets.slideLog);
            gameAssets.slideLog = g;
        }

        // Vertical Wall Block (Object_72)
        if (child.name === 'Object_72') {
            gameAssets.wallPlank = child.clone();
            const box = new THREE.Box3().setFromObject(gameAssets.wallPlank);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const scale = 3.0 / Math.max(0.1, size.y); // Tall enough to block lane
            gameAssets.wallPlank.scale.set(scale, scale, scale);
            gameAssets.wallPlank.position.sub(center).multiplyScalar(scale);
            gameAssets.wallPlank.position.y += (size.y * scale) / 2;
            const g = new THREE.Group(); g.add(gameAssets.wallPlank);
            gameAssets.wallPlank = g;
        }

        // Environment Trees (Extract random trees like Object_10 and Object_14)
        if (child.name === 'Object_10') {
            gameAssets.tree = child.clone();
            const box = new THREE.Box3().setFromObject(gameAssets.tree);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            // Make them large background trees (5-8 units tall)
            const scale = 8.0 / Math.max(0.1, size.y);
            gameAssets.tree.scale.set(scale, scale, scale);
            gameAssets.tree.position.sub(center).multiplyScalar(scale);
            gameAssets.tree.position.y += (size.y * scale) / 2; // Floor pin
            const g = new THREE.Group(); g.add(gameAssets.tree);
            gameAssets.tree = g;
        }

        if (child.name === 'Object_14') {
            gameAssets.tree2 = child.clone();
            const box = new THREE.Box3().setFromObject(gameAssets.tree2);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const scale = 6.0 / Math.max(0.1, size.y);
            gameAssets.tree2.scale.set(scale, scale, scale);
            gameAssets.tree2.position.sub(center).multiplyScalar(scale);
            gameAssets.tree2.position.y += (size.y * scale) / 2; // Floor pin
            const g = new THREE.Group(); g.add(gameAssets.tree2);
            gameAssets.tree2 = g;
        }
    });
});


// --- LEVEL GENERATION ---
const activeTiles = [];
const objects = [];
const tileLength = 30;

// --- WIND PARTICLES SETUP ---
const windParticles = new THREE.Group();
scene.add(windParticles);
for (let i = 0; i < 80; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 5 + Math.random() * 5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }));
    mesh.position.set((Math.random() - 0.5) * 15, Math.random() * 10, (Math.random() - 0.5) * 40);
    windParticles.add(mesh);
}
windParticles.visible = false;

// --- ENVIRONMENT ASSETS ---
function getLogoDataURL() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1D5DDF'; ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(512, 512, 380, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1D5DDF'; ctx.beginPath(); ctx.ellipse(512, 512, 190, 240, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1D5DDF'; ctx.beginPath(); ctx.moveTo(132, 892); ctx.lineTo(892, 892); ctx.lineTo(512, 600); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.moveTo(512, 660); ctx.lineTo(400, 780); ctx.lineTo(624, 780); ctx.fill();
    return canvas.toDataURL();
}
const billboardTexture = new THREE.TextureLoader().load(getLogoDataURL());
billboardTexture.wrapS = THREE.RepeatWrapping;
billboardTexture.wrapT = THREE.RepeatWrapping;
billboardTexture.colorSpace = THREE.SRGBColorSpace;

const dynTex = generateTextures();

const floorMaterials = dynTex.floors.map(tex => new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.9, bumpMap: tex, bumpScale: 0.05
}));
const wallMaterials = dynTex.walls.map(w => new THREE.MeshStandardMaterial({
    map: w.map, emissiveMap: w.emissiveMap, emissive: w.emissiveColor, roughness: w.roughness,
    bumpMap: w.map, bumpScale: 0.1 // Parallax depth
}));
const tunnelWallMaterial = new THREE.MeshStandardMaterial({
    map: dynTex.tunnelMap, emissiveMap: dynTex.tunnelMap, emissive: 0xffffff, roughness: 0.5
});

// Prop Generators
function createStreetLamp() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 }));
    pole.position.y = 4; g.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffee }));
    bulb.position.y = 8; g.add(bulb);
    return g;
}

function createFloatingTorch() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 4), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    base.rotation.x = Math.PI; base.position.y = 3; g.add(base);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.4), new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff4400 }));
    flame.position.y = 3.5; g.add(flame);
    g.userData.isFloating = true;
    return g;
}

function createExhaustFan() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1.0 }));
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.2, 0.1), new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000 }));
    const bGroup = new THREE.Group(); bGroup.add(blade);
    bGroup.position.z = 0.3; bGroup.userData.isSpinning = true;
    g.add(base); g.add(bGroup);
    g.position.y = 2;
    return g;
}

function createBillboardAssembly() {
    const group = new THREE.Group();
    group.name = 'BillboardAssembly';

    const frameGeo = new THREE.BoxGeometry(10, 10, 0.4);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.6 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = 8;

    // PlaneGeometry faces +Z by default so we move it to the front face (z=0.21)
    const screenGeo = new THREE.PlaneGeometry(9.5, 9.5);
    const screenMat = new THREE.MeshStandardMaterial({
        map: billboardTexture,
        side: THREE.DoubleSide,
        emissiveMap: billboardTexture,
        emissive: new THREE.Color(0x00aaff),
        emissiveIntensity: 0.6 // Backlit glowing effect
    });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.y = 8;
    screen.position.z = 0.21;

    group.add(frame);
    group.add(screen);

    return group;
}

function createTile(zPos, tileLevel = speedLevel) {
    const tile = new THREE.Group();
    tile.position.z = zPos;

    let lvlIndex = tileLevel % 3;
    let pathMat = floorMaterials[lvlIndex];
    let wallMat = wallMaterials[lvlIndex];

    // Path
    const pathGeo = new THREE.PlaneGeometry(30, 30);
    const path = new THREE.Mesh(pathGeo, pathMat);
    path.rotation.x = -Math.PI / 2;
    path.receiveShadow = true;
    tile.add(path);

    // --- SIDE DECORATIONS (Compound Walls & Dynamic Theme Props) ---
    const wallGeo = new THREE.BoxGeometry(1, 4, tileLength);
    const leftWall = new THREE.Mesh(wallGeo, wallMat);
    leftWall.position.set(-12, 2, 0);
    leftWall.receiveShadow = true; leftWall.castShadow = true;
    tile.add(leftWall);

    const rightWall = new THREE.Mesh(wallGeo, wallMat);
    rightWall.position.set(12, 2, 0);
    rightWall.receiveShadow = true; rightWall.castShadow = true;
    tile.add(rightWall);

    // Store references to manipulate in render loop
    tile.userData.leftWall = leftWall;
    tile.userData.rightWall = rightWall;
    tile.userData.lvlIndex = lvlIndex;

    // Themed Props density (Lamps/Torches/Fans)
    for (let i = 0; i < 4; i++) {
        const sideMult = Math.random() > 0.5 ? 1 : -1;
        const zOff = (Math.random() - 0.5) * tileLength;
        const xOff = sideMult * (10.5 + Math.random() * 0.5); // Against the wall

        let prop;
        if (lvlIndex === 0) prop = createStreetLamp();
        else if (lvlIndex === 1) prop = createFloatingTorch();
        else prop = createExhaustFan();

        prop.position.set(xOff, 0, zOff);

        // Orient Exhaust Fans so they face the actual track inwards
        if (lvlIndex === 2) {
            prop.rotation.y = sideMult > 0 ? -Math.PI / 2 : Math.PI / 2;
            prop.position.y = 1 + Math.random() * 2; // Attach to random heights
        }

        tile.add(prop);
    }

    scene.add(tile);
    activeTiles.push(tile);
}

// Initial Tiles
for (let i = 0; i < 4; i++) {
    createTile(-i * tileLength, 0);
}

// Helper to keep track of lanes that are "blocked" by obstacles to enforce Rule of Two
let lastSpawnZ = 0;
let lastArchLevel = 0;

// Spawning Objects
function spawnObject() {
    let spawnLvl = Math.floor((distance + 80) / 2000);
    let t = getTheme(spawnLvl);

    // Level-up Arch check
    if (spawnLvl > lastArchLevel && spawnLvl > 0) {
        lastArchLevel = spawnLvl;

        let archGroup = new THREE.Group();

        // Main arch pipe (radius: 10 spans width of 20, tall enough to clear everything)
        let archGeo = new THREE.TorusGeometry(10, 0.8, 16, 50, Math.PI);
        let archMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.8, roughness: 0.2, emissive: 0xaa5500 });
        let archMesh = new THREE.Mesh(archGeo, archMat);

        // Outer glow/flare effect
        let flareGeo = new THREE.TorusGeometry(10, 1.2, 16, 50, Math.PI);
        let flareMat = new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending });
        let flareMesh = new THREE.Mesh(flareGeo, flareMat);

        archGroup.add(archMesh);
        archGroup.add(flareMesh);

        // Position correctly spanning over the entire road
        archGroup.position.set(0, 0, -80);
        scene.add(archGroup);

        // Add to objects array so it scrolls, but isArch will bypass collisions
        objects.push({ mesh: archGroup, box: new THREE.Box3(), isTrigger: false, isArch: true, active: true });

        // Bypass normal obstacle spawning to let the arch stand out cleanly
        return;
    }

    // Dynamic thresholds based on level
    let gapScale = spawnLvl === 0 ? 20 : (spawnLvl === 1 ? 12 : 8);
    let coinEnd = 0.6; // 60% coins
    let obstEnd = 0.9; // 30% obstacles
    let powerEnd = 1.0; // 10% powers (shield/boost/magnet)

    // Pick lane and enforce safe path
    let lane = [-1, 0, 1][Math.floor(Math.random() * 3)];
    let xPos = lane * LANE_WIDTH;
    let zPos = -80;

    let rand = Math.random();
    let isObstacle = (rand >= coinEnd && rand < obstEnd);

    // Check if we need to force a coin path to signify a blocked lane (Telegraphing)
    if (isObstacle && distance - lastSpawnZ < gapScale) {
        // Find safe lane to drop coins
        let safeLane = [-1, 0, 1].find(l => l !== lane);
        if (safeLane !== undefined) {
            let cX = safeLane * LANE_WIDTH;
            let cZ = zPos + 5; // Spawn slightly ahead of the block
            // Drop 3-coin string
            for (let i = 0; i < 3; i++) {
                let cMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0xffdd00, emissive: 0x221100 }));
                cMesh.rotation.x = Math.PI / 2; cMesh.position.set(cX, 0.5, cZ + (i * 2));
                scene.add(cMesh);
                objects.push({ mesh: cMesh, box: new THREE.Box3(), isTrigger: true, isCoin: true, active: true });
            }
        }
    }

    if (isObstacle) lastSpawnZ = distance;

    let mesh, isTrigger = false, isCoin = false, isOutfit = false, isBooster = false, isMagnet = false;

    if (rand < coinEnd) { // 60%
        // Coin String
        for (let i = 0; i < 5; i++) {
            let cMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0xffdd00, emissive: 0x221100 }));
            cMesh.rotation.x = Math.PI / 2; cMesh.position.set(xPos, 0.5, zPos + (i * 1.5));
            scene.add(cMesh);
            objects.push({ mesh: cMesh, box: new THREE.Box3(), isTrigger: true, isCoin: true, active: true });
        }
        return; // Already spawned the string

    } else if (rand < obstEnd) { // 30% mapped by chance
        let oRand = Math.random();
        if (oRand < 0.5) { // 15% (Low - Jump)
            if (gameAssets.jumpRock) {
                mesh = gameAssets.jumpRock.clone();
                mesh.position.set(xPos, 0, zPos);
            } else {
                mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, LANE_WIDTH, 8), new THREE.MeshStandardMaterial({ color: 0x4a3219 }));
                mesh.rotation.z = Math.PI / 2; mesh.position.set(xPos, 0.4, zPos);
            }
        } else if (oRand < 0.83) { // ~10% (High - Slide)
            if (gameAssets.slideLog) {
                mesh = gameAssets.slideLog.clone();
                mesh.position.set(xPos, 1.8, zPos);
            } else {
                mesh = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH, 0.4, 1), new THREE.MeshStandardMaterial({ color: 0x243314 }));
                mesh.position.set(xPos, 1.8, zPos);
            }
        } else { // 5% (Blocker - Shift)
            if (gameAssets.wallPlank) {
                mesh = gameAssets.wallPlank.clone();
                mesh.position.set(xPos, 0, zPos);
            } else {
                mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3, 1.2), new THREE.MeshStandardMaterial({ color: 0x555566 }));
                mesh.position.set(xPos, 1.5, zPos);
            }
        }
        if (mesh && mesh.isMesh) mesh.castShadow = true;
    } else { // 10% Power Ups
        let pRand = Math.random();
        if (pRand < 0.33) {
            // Outfit Synergy Pick-up
            mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: t.outfit, emissive: 0x110000, wireframe: true }));
            mesh.position.set(xPos, 1.0, zPos);
            isTrigger = true; isOutfit = true;
        } else if (pRand < 0.66) {
            // Booster Powerup: Neon Blue Bolt
            mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff }));
            mesh.rotation.x = Math.PI / 4; mesh.position.set(xPos, 1.0, zPos);
            isTrigger = true; isBooster = true;
        } else {
            // Magnet Powerup: Pink Torus
            mesh = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 16, 16), new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0xaa00aa }));
            mesh.position.set(xPos, 1.0, zPos);
            isTrigger = true; isMagnet = true;
        }
    }

    if (mesh) {
        scene.add(mesh);
        objects.push({ mesh: mesh, box: new THREE.Box3(), isTrigger, isCoin, isOutfit, isBooster, isMagnet, active: true });
    }
}

// --- CONTROLS ---
function switchLane(dir) {
    if (gameState !== 'PLAYING' || isGameOver) return;
    currentLane = Math.max(-1, Math.min(1, currentLane + dir));
    targetX = currentLane * LANE_WIDTH;
    AudioEngine.playShift();
    // Quick twist visual feedback on shift
    playerGroup.rotation.z = -dir * 0.2;
    setTimeout(() => { playerGroup.rotation.z = 0; }, 200);
}
function jump() {
    if (gameState !== 'PLAYING' || isGameOver) return;
    if (playerPhys.isGrounded) {
        playerPhys.jump();
        AudioEngine.playJump();
        // Pause run anim in air natively
        if (playerMixer) playerMixer.timeScale = 0;
        // Check ground hit periodically to resume
        let checkInt = setInterval(() => {
            if (playerPhys.isGrounded) {
                if (playerMixer) playerMixer.timeScale = 1;
                clearInterval(checkInt);
            }
        }, 50);
    }
}
function slide() {
    if (gameState !== 'PLAYING' || isGameOver) return;
    if (playerPhys.isGrounded) {
        playerGroup.scale.y = 0.5; // simple slide by squash
        if (playerMixer) playerMixer.timeScale = 0; // Freeze run anim while sliding
        AudioEngine.playSlide();
        setTimeout(() => {
            if (playerPhys.isGrounded) playerGroup.scale.y = 1;
            if (playerMixer) playerMixer.timeScale = 1;
        }, 800);
    }
}

window.addEventListener('keydown', (e) => {
    if (gameState !== 'PLAYING') return;
    if (e.key === 'ArrowLeft' || e.key === 'a') switchLane(-1);
    if (e.key === 'ArrowRight' || e.key === 'd') switchLane(1);
    if (e.key === 'ArrowUp' || e.key === 'w') jump();
    if (e.key === 'ArrowDown' || e.key === 's') slide();
    if (e.key === 'p' || e.key === 'Escape') togglePause();
});

function togglePause() {
    if (gameState !== 'PLAYING') return;
    isPaused = !isPaused;

    const pauseScreen = document.getElementById('pause-screen');
    if (isPaused) {
        pauseScreen.style.display = 'flex';
        // Populate stats
        const pDist = document.getElementById('pause-distance');
        const pCoins = document.getElementById('pause-coins');
        if (pDist) pDist.innerText = Math.floor(distance);
        if (pCoins) pCoins.innerText = coins;
    } else {
        pauseScreen.style.display = 'none';
    }
}

// Simple swipe detection
let touchStartX = 0; let touchStartY = 0;
window.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
});
window.addEventListener('touchend', e => {
    let touchEndX = e.changedTouches[0].screenX;
    let touchEndY = e.changedTouches[0].screenY;
    handleSwipe(touchStartX, touchStartY, touchEndX, touchEndY);
});
function handleSwipe(sx, sy, ex, ey) {
    if (gameState !== 'PLAYING') return;
    const dx = ex - sx; const dy = ey - sy;
    if (Math.abs(dx) > Math.abs(dy)) {
        if (Math.abs(dx) > 30) switchLane(dx > 0 ? 1 : -1);
    } else {
        if (Math.abs(dy) > 30) { dy < 0 ? jump() : slide(); }
    }
}

if (pauseBtn) { pauseBtn.addEventListener('click', togglePause); }

function resetGameParams() {
    isGameOver = false; distance = 0; coins = 0; mistakes = 0;
    speedLevel = 0; baseGameSpeed = 20; gameSpeed = 20;
    lastBillboardDist = 50;
    hasShield = false; boostTimeLeft = 0; magnetTimeLeft = 0;
    outfitGroup.visible = false;
    isPaused = false;
    const pauseScreen = document.getElementById('pause-screen');
    if (pauseScreen) pauseScreen.style.display = 'none';
    currentLane = 0; targetX = 0; playerGroup.position.set(0, 0, 0);
    playerPhys.isGrounded = true; playerPhys.velocity.y = 0; playerGroup.scale.y = 1;
    objects.forEach(obj => scene.remove(obj.mesh));
    objects.length = 0;
    AudioEngine.stopSpeedBoost();
    windParticles.visible = false;
    playerGroup.visible = true; // Make sure player is visible
    killerGroup.position.set(0, 0, 50); // reset Killer distance!
}

if (restartBtn) restartBtn.addEventListener('click', () => {
    resetGameParams();
    gameOverEl.style.display = 'none';
    gameState = 'PLAYING';
    if (bgmAudio && musicEnabled) bgmAudio.volume = 0.15;
});

if (homeBtn) homeBtn.addEventListener('click', () => {
    resetGameParams();
    gameOverEl.style.display = 'none';
    gameplayUI.style.display = 'none';
    startScreen.style.display = 'flex';
    gameState = 'MENU';
    camera.position.set(-15, 8, 20); // Push camera far back again
    camera.lookAt(0, 2, 0);
    if (bgmAudio && musicEnabled) bgmAudio.volume = 0.08;
});

const resumeBtn = document.getElementById('resume-btn');
if (resumeBtn) resumeBtn.addEventListener('click', togglePause);

const pauseHomeBtn = document.getElementById('pause-home-btn');
if (pauseHomeBtn) pauseHomeBtn.addEventListener('click', () => {
    resetGameParams();
    gameOverEl.style.display = 'none';
    gameplayUI.style.display = 'none';
    const pauseScreen = document.getElementById('pause-screen');
    if (pauseScreen) pauseScreen.style.display = 'none';
    startScreen.style.display = 'flex';
    gameState = 'MENU';
    camera.position.set(-15, 8, 20);
    camera.lookAt(0, 2, 0);
    if (bgmAudio && musicEnabled) bgmAudio.volume = 0.08;
});

// --- MAIN LOOP ---
const clock = new THREE.Clock();
let spawnTimer = 0;
const hitCooldownTime = 1.0;
let hitCooldown = 0;
let lastBillboardDist = 50;

function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    if (isGameOver || isPaused || gameState === 'GAMEOVER') {
        composer.render();
        return;
    }

    if (gameState === 'MENU') {
        // Init camera explicitly to side/back far position to act as "drone watching"
        if (camera.position.z < 10) {
            camera.position.set(-15, 8, 20);
        }
        camera.lookAt(0, 2, 0);

        // Keep running character physics visually but do not advance world
        if (playerMixer) { playerMixer.update(dt * 0.2); } // Slow idle idle running
        if (killerMixer) { killerMixer.update(dt * 0.2); } // Slow idle running
        if (killerIdleAction && killerRunAction && !killerIdleAction.isRunning()) {
            killerIdleAction.reset().play();
            if (killerRunAction) killerRunAction.stop();
            if (killerLungeAction) killerLungeAction.stop();
        }
        composer.render();
        return;
    }

    if (gameState === 'STARTING') {
        if (killerRunAction && killerIdleAction && hitCooldown <= 0) {
            if (!killerRunAction.isRunning()) {
                killerRunAction.reset().play();
                killerIdleAction.stop();
            }
        }
        // Transition Camera towards the character's back smoothly
        camera.position.lerp(new THREE.Vector3(1.5, 3.5, 6), 5 * dt);
        camera.lookAt(playerGroup.position);

        // Wait till camera is close enough to unlock the game movement logic!
        if (camera.position.distanceTo(new THREE.Vector3(1.5, 3.5, 6)) < 0.5) {
            gameState = 'PLAYING';
            camera.position.set(1.5, 3.5, 6);
        }
    }

    // Move player laterally (Smooth)
    playerGroup.position.x += (targetX - playerGroup.position.x) * 10 * dt;

    // Physics
    playerPhys.update(dt);

    // Animate 3D Model
    if (playerMixer) {
        // Built-in .glb animation
        playerMixer.update(dt * (gameSpeed / 20));

        // Isolate the running animation (which sits between 3 and 6.3 seconds)
        // If she hits the jump/slide/idle frames, loop back to the start of the run!
        if (playerRunAction && playerRunAction.time > 6.3) {
            playerRunAction.time = 3.0;
        }
    } else {
        // Procedural Retro-Rig Physics Engine (Runs if no baked-in animation exists)
        const t = clock.getElapsedTime() * gameSpeed * 0.6; // Run cycle pace maps to move speed
        const bones = playerGroup.userData.bones;
        const model = playerGroup.userData.model;

        if (model) {
            // Core body bobbing
            model.position.y = Math.abs(Math.sin(t * 2)) * 0.15;
            // Always lean slightly forward when running wildly
            model.rotation.x = Math.sin(t * 2) * 0.05 + 0.15;

            // If we grabbed the skeletal bone framework via Auto-Rig
            if (bones && Object.keys(bones).length > 0) {
                // Legs (Scissor swing)
                if (bones.lLeg) bones.lLeg.rotation.x = Math.sin(t) * 0.8;
                if (bones.rLeg) bones.rLeg.rotation.x = -Math.sin(t) * 0.8;
                // Knees - prevent forward bending. Use abs to only bend backward.
                if (bones.lCalf) bones.lCalf.rotation.x = Math.abs(Math.sin(t)) * 1.0;
                if (bones.rCalf) bones.rCalf.rotation.x = Math.abs(Math.sin(t + Math.PI)) * 1.0;

                // Arms (Opposite of legs)
                if (bones.lArm) bones.lArm.rotation.x = -Math.sin(t) * 0.8;
                if (bones.rArm) bones.rArm.rotation.x = Math.sin(t) * 0.8;

                // Spine Twist
                if (bones.spine) bones.spine.rotation.y = Math.sin(t) * 0.1;
                if (bones.head) bones.head.rotation.y = -Math.sin(t) * 0.1; // Head counter-counter twist
            } else {
                // Failsafe: It's a completely hard rigid mesh (no bones). Just rock the entire body!
                model.rotation.z = Math.sin(t) * 0.1;
            }
        }
    }

    // Speed Level Logic (2000m milestones)
    let newLevel = Math.floor(distance / 2000);

    if (newLevel > speedLevel) {
        speedLevel = newLevel;
        triggerLevelTransition(speedLevel); // Trigger smooth color change

        if (speedAlertEl) {
            speedAlertEl.textContent = 'LEVEL UP!';
            speedAlertEl.style.display = 'block';
            setTimeout(() => { if (speedAlertEl) speedAlertEl.style.display = 'none'; }, 2000);
        }
        AudioEngine.playMilestone();
        bgmAudio.playbackRate = 1.0 + (speedLevel * 0.1); // Dynamic Track speed
    }

    // Base Speed (1x, 1.5x, 2.0x, 2.5x...)
    const customMultipliers = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
    let spdMult = customMultipliers[speedLevel] || (1.0 + speedLevel * 0.5);
    baseGameSpeed = 20 * spdMult;

    // Killer Logic: Closer visually if no shield, hidden if shield is active
    const killerConstant = 3;
    let targetKillerZ;

    if (hasShield) {
        killerGroup.visible = false;
        targetKillerZ = playerGroup.position.z + 50; // Push far behind
    } else {
        killerGroup.visible = true;
        const killerDist = killerConstant + (mistakes * -3); // Stumbles map 50% distance
        targetKillerZ = playerGroup.position.z + killerDist;
    }

    // Animate Killer closer (Dynamically sync with current speed)
    let killerCatchupSpeed = 4 * spdMult;
    if (mistakes >= 2) killerCatchupSpeed = 15;
    killerGroup.position.z += (targetKillerZ - killerGroup.position.z) * killerCatchupSpeed * dt;
    killerGroup.position.x += (playerGroup.position.x - killerGroup.position.x) * 5 * dt;

    // Add custom running bobbing animation!
    if (killerMixer) {
        // Built-in .glb animation matching current level speed
        killerMixer.update(dt * (gameSpeed / 20));
    } else if (killerGroup.visible) {
        // Procedural fall back
        const t = clock.getElapsedTime() * gameSpeed * 0.6;
        const kBones = killerGroup.userData.bones;
        const kModel = killerGroup.userData.model;

        if (kModel) {
            // Core body bobbing
            let yBob = Math.abs(Math.sin(t * 2)) * 0.15;
            // Dynamic check since we had offset calculations for grounding him smoothly
            if (kModel.userData.baseY === undefined) {
                kModel.userData.baseY = kModel.position.y; // store his foot offset 
            }
            kModel.position.y = kModel.userData.baseY + yBob;

            // Lean forward slightly while running
            kModel.rotation.x = Math.sin(t * 2) * 0.05 + 0.15;

            if (kBones && Object.keys(kBones).length > 0) {
                if (kBones.lLeg) kBones.lLeg.rotation.x = Math.sin(t) * 0.8;
                if (kBones.rLeg) kBones.rLeg.rotation.x = -Math.sin(t) * 0.8;
                // Knees - prevent forward bending. Use abs to only bend backward.
                if (kBones.lCalf) kBones.lCalf.rotation.x = Math.abs(Math.sin(t)) * 1.0;
                if (kBones.rCalf) kBones.rCalf.rotation.x = Math.abs(Math.sin(t + Math.PI)) * 1.0;

                if (kBones.lArm) kBones.lArm.rotation.x = -Math.sin(t) * 0.8;
                if (kBones.rArm) kBones.rArm.rotation.x = Math.sin(t) * 0.8;
                if (kBones.spine) kBones.spine.rotation.y = Math.sin(t) * 0.1;
                if (kBones.head) kBones.head.rotation.y = -Math.sin(t) * 0.1;
            } else {
                kModel.rotation.z = Math.sin(t) * 0.1;
            }
        }
    }

    // Booster Logic & FOV mapping
    let targetFov = 70; // Static unless boosted
    if (boostTimeLeft > 0) {
        boostTimeLeft -= dt;
        gameSpeed = baseGameSpeed * 2.0; // Level scaling + 2.0x boost directly stacked
        targetFov = 85;
        windParticles.visible = true;
        windParticles.position.x = playerGroup.position.x;
        windParticles.children.forEach(c => {
            c.material.color.setHex(0xffffff);
            c.position.z += gameSpeed * 1.5 * dt;
            if (c.position.z > 20) c.position.z -= 40;
        });
        if (boostTimeLeft <= 0) {
            windParticles.visible = false;
            AudioEngine.stopSpeedBoost();
        }
    } else {
        gameSpeed = baseGameSpeed;
        windParticles.visible = false;
    }

    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 5 * dt);
    camera.updateProjectionMatrix();

    AudioEngine.tick(dt, speedLevel, killerGroup.visible, spdMult);

    // Movement Simulation
    distance += gameSpeed * dt;
    spawnTimer += dt;
    // Density increases slowly
    const spawnRateMultiplier = Math.min(2.5, 1.0 + (speedLevel * 0.2));
    if (spawnTimer > (1.0 / spawnRateMultiplier)) {
        spawnObject();
        spawnTimer = 0;
    }

    if (hitCooldown > 0) hitCooldown -= dt;

    // --- BILLBOARD PROCEDURAL PLACEMENT ---
    if (speedLevel === 0 && distance >= lastBillboardDist + 250) {
        lastBillboardDist += 250;

        // Spawn Right Billboard 
        let bbR = createBillboardAssembly();
        bbR.position.set(12.5, 0, -80);
        bbR.rotation.y = -Math.PI / 12; // Angle perfectly towards the player view
        scene.add(bbR);
        objects.push({ mesh: bbR, box: new THREE.Box3(), isBillboard: true, active: false });

        // Spawn Left Billboard
        let bbL = createBillboardAssembly();
        bbL.position.set(-12.5, 0, -80);
        bbL.rotation.y = Math.PI / 12; // Angle perfectly towards the player view
        scene.add(bbL);
        objects.push({ mesh: bbL, box: new THREE.Box3(), isBillboard: true, active: false });
    }

    // --- SMOOTH MILSETSTONE COLOR TRANSITION ---
    if (isTransitioning) {
        transitionTimer += dt;
        let t = Math.min(transitionTimer / TRANSITION_DURATION, 1.0); // Normalize 0 to 1

        // Smoothstep for softer ease-in ease-out
        t = t * t * (3.0 - 2.0 * t);

        // Lerp Colors
        scene.background.copy(currentSkyColor).lerp(new THREE.Color(targetTheme.sky), t);
        scene.fog.color.copy(currentFogColor).lerp(new THREE.Color(targetTheme.fog), t);

        // Lerp Light Intensity
        dirLight.intensity = THREE.MathUtils.lerp(currentLightIntensity, targetTheme.lightIntensity, t);

        if (t >= 1.0) {
            isTransitioning = false;
            currentSkyColor.setHex(targetTheme.sky);
            currentFogColor.setHex(targetTheme.fog);
            currentLightIntensity = targetTheme.lightIntensity;
        }
    }

    // Day/Night Skybox Elements interpolation (Uses the targetTheme.isDay naturally over dt)
    let isDayTarget = targetTheme.isDay;
    sunMesh.position.y = THREE.MathUtils.lerp(sunMesh.position.y, isDayTarget ? 100 : -100, 2 * dt);
    moonMesh.position.y = THREE.MathUtils.lerp(moonMesh.position.y, isDayTarget ? -100 : 100, 2 * dt);
    starsMat.opacity = THREE.MathUtils.lerp(starsMat.opacity, isDayTarget ? 0.0 : 0.8, 2 * dt);
    twinkleShader.uniforms.baseOpacity.value = THREE.MathUtils.lerp(twinkleShader.uniforms.baseOpacity.value, isDayTarget ? 0.0 : 1.0, 2 * dt);
    nebulaGroup.children.forEach(s => s.material.opacity = THREE.MathUtils.lerp(s.material.opacity, isDayTarget ? 0.0 : 0.7, 2 * dt));

    // Cloud drift and Twinkle time update
    twinkleShader.uniforms.time.value += dt;
    clouds.forEach((c, i) => {
        c.position.z += dt * c.userData.speed * 4.0;
        c.position.x -= dt * c.userData.speed * 1.5;
        // Floaty animation
        c.position.y = c.userData.baseY + Math.sin(twinkleShader.uniforms.time.value * 0.5 + i) * 3.0;

        // Loop back clouds when they go behind camera
        if (c.position.z > 150) {
            c.position.z -= 800; // Push far back
            c.position.x = (Math.random() - 0.5) * 600;
        }
    });

    // Update balloons
    balloons.forEach((b, i) => {
        b.position.z += dt * b.userData.speedZ;
        b.position.x += dt * b.userData.speedX;
        b.position.y = b.userData.baseY + Math.sin(twinkleShader.uniforms.time.value * b.userData.bobSpeed + i) * 2.0;

        // Add gentle swaying rotation using sine wave
        b.rotation.z = Math.sin(twinkleShader.uniforms.time.value * 2.0 + i) * 0.1;
        b.rotation.x = Math.sin(twinkleShader.uniforms.time.value * 1.5 + i) * 0.1;

        if (b.position.z > 150) {
            b.position.z -= 600;
            b.position.x = (Math.random() - 0.5) * 200;
            b.position.y = b.userData.baseY;
        }
    });

    if (magnetTimeLeft > 0) {
        magnetTimeLeft -= dt;
    }

    // Move Tiles & Wall Parallax
    activeTiles.forEach(tile => {
        tile.position.z += gameSpeed * dt;

        // Prop animations
        tile.children.forEach(c => {
            if (c.userData.isFloating) c.position.y += Math.sin(twinkleShader.uniforms.time.value * 3.0) * 0.05 * dt;
            if (c.userData.isSpinning) c.rotation.z += 10.0 * dt;
        });

        if (tile.position.z > 20) {
            tile.position.z -= tileLength * 4;
            // Update tile appearance based on future distance mapping
            let tileFutureLvl = Math.floor((distance + 80) / 2000);
            let lvlIndex = tileFutureLvl % 3;

            // Tunnel Texture Swap Window Check Boundary (50 meters of transition tunnel)
            if ((distance + 80) % 2000 < 50 && tileFutureLvl > 0) {
                tile.children[0].material = floorMaterials[lvlIndex]; // Base floor updates instantly to new
                tile.userData.leftWall.material = tunnelWallMaterial;
                tile.userData.rightWall.material = tunnelWallMaterial;
            } else {
                tile.children[0].material = floorMaterials[lvlIndex];
                tile.userData.leftWall.material = wallMaterials[lvlIndex];
                tile.userData.rightWall.material = wallMaterials[lvlIndex];
            }
        }
    });

    // Animate the Wall Texture offsets for Parallax depth against the floor movement
    wallMaterials.forEach(m => {
        if (m.map) m.map.offset.y -= (gameSpeed * dt * 0.005); // Walls slide visually against the move
    });
    tunnelWallMaterial.map.offset.y += (gameSpeed * dt * 0.05); // Warp tunnel effect moves incredibly fast to warp!

    // Move & Check Objects
    for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        obj.mesh.position.z += gameSpeed * dt;

        if (obj.isCoin) {
            obj.mesh.rotation.z += 5 * dt;
            // Magnet physics
            if (magnetTimeLeft > 0 && obj.mesh.position.distanceTo(playerGroup.position) < 15) {
                // Fly to player
                obj.mesh.position.lerp(playerGroup.position, 10 * dt);
            }
        }
        if (obj.isMagnet) { obj.mesh.rotation.y += 4 * dt; }
        if (obj.isOutfit) { obj.mesh.rotation.x += 2 * dt; obj.mesh.rotation.y += 2 * dt; }
        if (obj.isBooster) { obj.mesh.rotation.x += 4 * dt; obj.mesh.rotation.y += 4 * dt; }

        obj.box.setFromObject(obj.mesh);

        // Collision Detection
        if (obj.active && !obj.isArch && obj.box.intersectsBox(playerPhys.box)) {
            obj.active = false;

            if (obj.isTrigger) {
                scene.remove(obj.mesh);
                if (obj.isCoin) {
                    coins++;
                    AudioEngine.playTone(800, 1000, 'sine', 0.1, 0.05);
                } else if (obj.isOutfit) {
                    hasShield = true;
                    outfitGroup.visible = true; // Transform applied!
                } else if (obj.isMagnet) {
                    magnetTimeLeft = MAGNET_TOTAL;
                } else if (obj.isBooster) {
                    boostTimeLeft = BOOST_TOTAL;
                    if (musicEnabled) { AudioEngine.playSpeedBoost(); }
                }
            } else {
                // Obstacle Hit
                if (boostTimeLeft > 0) {
                    // Invincible Ghost bypass
                    obj.active = true; // Keep object alive and don't take damage
                } else if (hasShield) {
                    // Consume Shield
                    hasShield = false;
                    outfitGroup.visible = false;

                    // Flash player (I-frame flicker)
                    playerGroup.visible = false;
                    setTimeout(() => { playerGroup.visible = true; }, 100);
                    setTimeout(() => { playerGroup.visible = false; }, 200);
                    setTimeout(() => { playerGroup.visible = true; }, 300);
                    hitCooldown = hitCooldownTime;

                } else if (hitCooldown <= 0) {
                    mistakes++;
                    hitCooldown = hitCooldownTime;

                    if (killerLungeAction && killerRunAction) {
                        killerLungeAction.reset().setLoop(THREE.LoopOnce).play();
                        killerRunAction.crossFadeTo(killerLungeAction, 0.1, true);
                        setTimeout(() => {
                            if (!isGameOver && killerRunAction && killerLungeAction) {
                                killerRunAction.reset().play();
                                killerLungeAction.crossFadeTo(killerRunAction, 0.2, true);
                            }
                        }, hitCooldownTime * 1000);
                    }

                    // "A second hit results in a 'Caught' Game Over."
                    if (mistakes >= 2) {
                        isGameOver = true;
                        gameState = 'GAMEOVER';

                        // Set High Score
                        let bestDist = Math.max(highScore, Math.floor(distance));
                        if (bestDist > highScore) {
                            highScore = bestDist;
                            localStorage.setItem('high_score', highScore);
                        }

                        // Update UI Texts
                        if (finalDistanceEl) finalDistanceEl.innerText = Math.floor(distance);
                        if (finalCoinsEl) finalCoinsEl.innerText = coins;
                        if (highScoreEl) highScoreEl.innerText = highScore;

                        AudioEngine.stopSpeedBoost();
                        gameOverEl.style.display = 'flex';
                        if (bgmAudio) bgmAudio.volume = 0.05; // Drop volume a bit during game over screen

                        killerGroup.position.z = playerGroup.position.z + 1; // Killer caught up
                    } else {
                        // Stumble effect
                        gameSpeed *= 0.7; // Slow down temporarily
                    }
                }
            }
        }

        // Remove passed objects
        if (obj.mesh.position.z > 20) {
            scene.remove(obj.mesh);
            objects.splice(i, 1);
        }
    }

    // Update UI
    distanceEl.innerText = Math.floor(distance);
    coinsEl.innerText = coins;

    updatePowerupsUI(dt);

    updatePowerupsUI(dt);

    composer.render();
}

// Handle resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
