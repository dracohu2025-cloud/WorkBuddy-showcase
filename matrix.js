import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ------------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------------
const CONFIG = {
  columns: 110,
  rows: 55,
  layers: 3,
  spread: 70,
  depth: 100,
  charSize: 0.55,
  fallSpeedMin: 2.5,
  fallSpeedMax: 8.0,
  trailMin: 8,
  trailMax: 48,
  atlasChars: 256,
  atlasSize: 16,
  bloomStrength: 1.15,
  bloomRadius: 0.5,
  bloomThreshold: 0.04,
  fogColor: 0x000300,
  baseColor: new THREE.Color('#00aa2a'),
  headColor: new THREE.Color('#ccffcc'),
  fogDensity: 0.015
};

const FONT_FACE = '"M PLUS 1 Code", monospace';

// ------------------------------------------------------------------
// MATRIX CHARACTERS
// ------------------------------------------------------------------
const CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
              '0123456789' +
              'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
              'abcdefghijklmnopqrstuvwxyz' +
              'ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ';

const randomChar = () => CHARS[Math.floor(Math.random() * CHARS.length)];

// ------------------------------------------------------------------
// BOOT SEQUENCE
// ------------------------------------------------------------------
const bootLines = [
  '> INITIALIZING NEURAL LINK...',
  '> BYPASSING FIREWALL...',
  '> DECRYPTING MATRIX PROTOCOL...',
  '> MOUNTING REALITY BUFFER...',
  '> RENDERING SIMULATION...',
  '> SYSTEM READY.'
];

const bootEl = document.querySelector('.boot-text');
let bootIndex = 0;

function typeBootLine() {
  if (bootIndex >= bootLines.length) {
    setTimeout(() => {
      document.getElementById('boot-overlay').classList.add('hidden');
    }, 600);
    return;
  }
  bootEl.textContent += bootLines[bootIndex] + '\n';
  bootIndex++;
  setTimeout(typeBootLine, 350 + Math.random() * 300);
}
typeBootLine();

// ------------------------------------------------------------------
// CHARACTER TEXTURE ATLAS
// ------------------------------------------------------------------
async function createCharAtlas() {
  await document.fonts.load(`bold 45px ${FONT_FACE}`);

  const charsPerRow = CONFIG.atlasSize;
  const cellSize = 64;
  const canvas = document.createElement('canvas');
  canvas.width = cellSize * charsPerRow;
  canvas.height = cellSize * charsPerRow;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${cellSize * 0.7}px ${FONT_FACE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < CONFIG.atlasChars; i++) {
    const cx = i % charsPerRow;
    const cy = Math.floor(i / charsPerRow);
    const x = cx * cellSize + cellSize / 2;
    const y = cy * cellSize + cellSize / 2 + 2;
    ctx.fillText(randomChar(), x, y);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ------------------------------------------------------------------
// RAIN SHADER
// ------------------------------------------------------------------
const rainVertexShader = /* glsl */`
  attribute float aColumn;
  attribute float aSpeed;
  attribute float aTrailLen;
  attribute float aOffset;
  attribute float aLayerZ;
  attribute float aBrightness;
  attribute float aCharSeed;

  uniform float uTime;
  uniform float uSpread;
  uniform float uDepth;
  uniform float uCharSize;
  uniform float uRows;
  uniform float uColumns;

  varying vec2 vUv;
  varying float vTrailPos;
  varying float vCharIndex;
  varying float vBrightness;

  void main() {
    vUv = uv;
    vBrightness = aBrightness;

    float row = mod(float(gl_InstanceID), uRows);

    float headY = -mod(uTime * aSpeed + aOffset, uDepth) + uDepth * 0.5;
    float x = (aColumn / uColumns - 0.5) * uSpread;
    float y = headY + row * uCharSize;
    float z = aLayerZ;

    vTrailPos = row / max(aTrailLen, 1.0);

    // Head: changes ~3x/sec. Trail: changes ~once every 5s, staggered per column.
    float headTime = floor(uTime * 3.0 + aCharSeed * 0.1);
    float trailTime = floor(uTime * 0.2 + aCharSeed);
    float charTime = vTrailPos < 0.12 ? headTime : trailTime;
    vCharIndex = mod(charTime + aCharSeed + row * 37.0, 256.0);

    vec3 pos = position * uCharSize;
    pos.x += x;
    pos.y += y;
    pos.z += z;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const rainFragmentShader = /* glsl */`
  uniform sampler2D uAtlas;
  uniform vec3 uBaseColor;
  uniform vec3 uHeadColor;
  uniform float uAtlasSize;

  varying vec2 vUv;
  varying float vTrailPos;
  varying float vCharIndex;
  varying float vBrightness;

  void main() {
    if (vTrailPos > 1.0) discard;

    float cx = mod(vCharIndex, uAtlasSize);
    float cy = floor(vCharIndex / uAtlasSize);
    vec2 atlasUv = (vec2(cx, cy) + vUv) / uAtlasSize;

    vec4 tex = texture2D(uAtlas, atlasUv);
    if (tex.r < 0.15) discard;

    float headFactor = 1.0 - vTrailPos;
    vec3 color = mix(uBaseColor, uHeadColor, pow(headFactor, 2.0));
    color *= (0.15 + 0.85 * headFactor) * vBrightness;

    gl_FragColor = vec4(color * tex.rgb, 1.0);
  }
`;

// ------------------------------------------------------------------
// MAIN INIT
// ------------------------------------------------------------------
async function init() {
  const atlas = await createCharAtlas();

  // SCENE SETUP
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.fogColor);
  scene.fog = new THREE.FogExp2(CONFIG.fogColor, CONFIG.fogDensity);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(0, 6, 32);
  camera.lookAt(0, -12, -25);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ReinhardToneMapping;
  document.body.appendChild(renderer.domElement);

  // POST PROCESSING
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    CONFIG.bloomStrength,
    CONFIG.bloomRadius,
    CONFIG.bloomThreshold
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // RAIN SYSTEM
  class MatrixRain {
    constructor(layerIndex) {
      this.layerIndex = layerIndex;
      this.columns = Math.floor(CONFIG.columns / (layerIndex * 0.6 + 1));
      this.maxRows = CONFIG.rows;
      this.instanceCount = this.columns * this.maxRows;

      const geometry = new THREE.PlaneGeometry(1, 1);

      const aColumn = new Float32Array(this.instanceCount);
      const aSpeed = new Float32Array(this.instanceCount);
      const aTrailLen = new Float32Array(this.instanceCount);
      const aOffset = new Float32Array(this.instanceCount);
      const aLayerZ = new Float32Array(this.instanceCount);
      const aBrightness = new Float32Array(this.instanceCount);
      const aCharSeed = new Float32Array(this.instanceCount);

      const layerZ = -layerIndex * 24;
      const brightness = 1.0 - layerIndex * 0.28;

      for (let c = 0; c < this.columns; c++) {
        const speed = CONFIG.fallSpeedMin + Math.random() * (CONFIG.fallSpeedMax - CONFIG.fallSpeedMin);
        const trailLen = CONFIG.trailMin + Math.floor(Math.random() * (CONFIG.trailMax - CONFIG.trailMin));
        const offset = Math.random() * CONFIG.depth;
        const columnX = c + 0.25;
        const columnZ = layerZ;  // fixed per layer, no per-instance Z jitter
        const charSeed = Math.floor(Math.random() * 256);

        for (let r = 0; r < this.maxRows; r++) {
          const i = c * this.maxRows + r;
          aColumn[i] = columnX;
          aSpeed[i] = speed;
          aTrailLen[i] = trailLen;
          aOffset[i] = offset;
          aLayerZ[i] = columnZ;
          aBrightness[i] = brightness;
          aCharSeed[i] = charSeed;
        }
      }

      geometry.setAttribute('aColumn', new THREE.InstancedBufferAttribute(aColumn, 1));
      geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(aSpeed, 1));
      geometry.setAttribute('aTrailLen', new THREE.InstancedBufferAttribute(aTrailLen, 1));
      geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 1));
      geometry.setAttribute('aLayerZ', new THREE.InstancedBufferAttribute(aLayerZ, 1));
      geometry.setAttribute('aBrightness', new THREE.InstancedBufferAttribute(aBrightness, 1));
      geometry.setAttribute('aCharSeed', new THREE.InstancedBufferAttribute(aCharSeed, 1));

      const material = new THREE.ShaderMaterial({
        vertexShader: rainVertexShader,
        fragmentShader: rainFragmentShader,
        uniforms: {
          uAtlas: { value: atlas },
          uTime: { value: 0 },
          uSpread: { value: CONFIG.spread },
          uDepth: { value: CONFIG.depth },
          uCharSize: { value: CONFIG.charSize },
          uRows: { value: this.maxRows },
          uColumns: { value: this.columns },
          uAtlasSize: { value: CONFIG.atlasSize },
          uBaseColor: { value: CONFIG.baseColor },
          uHeadColor: { value: CONFIG.headColor }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });

      this.mesh = new THREE.InstancedMesh(geometry, material, this.instanceCount);
      this.mesh.frustumCulled = false;
      scene.add(this.mesh);
    }

    update(time) {
      this.mesh.material.uniforms.uTime.value = time;
    }
  }

  const rains = [];
  for (let l = 0; l < CONFIG.layers; l++) {
    rains.push(new MatrixRain(l));
  }

  // GRID — static, no rotation
  const gridHelper = new THREE.GridHelper(140, 70, '#004d0f', '#001a05');
  gridHelper.position.y = -CONFIG.depth / 2 - 2;
  scene.add(gridHelper);

  const gridTop = new THREE.GridHelper(140, 70, '#004d0f', '#001a05');
  gridTop.position.y = CONFIG.depth / 2 + 2;
  scene.add(gridTop);

  // LIGHTS
  const ambient = new THREE.AmbientLight(0x003300, 0.5);
  scene.add(ambient);

  const pointLight = new THREE.PointLight(0x00ff41, 1.2, 120);
  pointLight.position.set(0, 0, 10);
  scene.add(pointLight);

  // INTERACTION — zoom only, no mouse-driven camera rotation
  let zoom = 32;

  window.addEventListener('wheel', (e) => {
    zoom += e.deltaY * 0.025;
    zoom = Math.max(15, Math.min(55, zoom));
  });

  window.addEventListener('dblclick', () => {
    zoom = 32;
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // UI
  const fpsEl = document.getElementById('fps');
  const nodesEl = document.getElementById('nodes');
  const depthEl = document.getElementById('depth');
  let frameCount = 0;
  let fpsTime = 0;

  const totalNodes = rains.reduce((sum, r) => sum + r.instanceCount, 0);
  nodesEl.textContent = totalNodes.toLocaleString();

  // ANIMATION LOOP
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    const dt = clock.getDelta();
    const time = clock.getElapsedTime();

    rains.forEach(rain => rain.update(time));

    // Camera: fixed position, only zoom changes. No yaw/pitch.
    camera.position.set(0, 6, zoom);
    camera.lookAt(0, -12, -25);

    pointLight.position.copy(camera.position);

    // Grids: completely static

    frameCount++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      fpsEl.textContent = Math.round(frameCount / fpsTime) + ' FPS';
      frameCount = 0;
      fpsTime = 0;
    }

    depthEl.textContent = Math.round(zoom * 10).toString();

    composer.render();
  }

  animate();
}

init().catch(err => console.error('Matrix init failed:', err));
