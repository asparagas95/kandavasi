// Kan Davası — gerçek 3B kort. Tek WebGL tuval, aktif kapışma panelinin kort kutusuna yerleşir.
// Dış API: window.KD3D = { ready, attach, setColors, setLeader, rally, setActive }
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { GroundedSkybox } from "three/addons/objects/GroundedSkybox.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const ASSET = (p) => new URL("assets/" + p, document.baseURI).href;
const MOBIL = matchMedia("(max-width:720px), (pointer:coarse)").matches;
const AZ_HAREKET = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ITTF ölçüleri (metre)
const L = 2.74, W = 1.525, H = 0.76, NET_H = 0.1525, BALL_R = 0.02;

const KD3D = { ready: null, attach, setColors, setLeader, rally, setActive, get ok(){ return state.ok; } };
window.KD3D = KD3D;
KD3D._s = null; // teşhis

const state = {
  ok: false, renderer: null, scene: null, camera: null, composer: null,
  canvas: null, courts: new Map(), active: null, needs: true, anim: null,
  ball: null, paddleA: null, paddleB: null, tableTop: null, rubberA: null, rubberB: null,
  leaderLeft: true, w: 0, h: 0, ao: null, frames: 0, err: null, golge: null,
};
KD3D._s = state;
KD3D._step = (t) => adim(t || performance.now(), true); // teşhis: kareyi elle çiz (görünürlük kontrolü atlanır)

/* ================= kurulum ================= */
function kur() {
  const canvas = document.createElement("canvas");
  canvas.id = "kd3d";
  canvas.setAttribute("aria-hidden", "true");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBIL, powerPreference: "high-performance" });
  } catch (e) { return Promise.resolve(false); }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBIL ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 2, 0.05, 80);
  state.renderer = renderer; state.scene = scene; state.camera = camera; state.canvas = canvas;

  // --- ışık: HDRI ortam + sert anahtar ışık (gölge) ---
  const key = new THREE.DirectionalLight(0xfff1df, 2.4);
  key.position.set(1.4, 4.6, 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(MOBIL ? 1024 : 2048, MOBIL ? 1024 : 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 12;
  key.shadow.camera.left = -2.4; key.shadow.camera.right = 2.4;
  key.shadow.camera.top = 2.0; key.shadow.camera.bottom = -2.0;
  key.shadow.bias = -0.00035; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
  scene.add(key, key.target);
  key.target.position.set(0, H, 0);
  const rim = new THREE.DirectionalLight(0x9fd3ff, 0.6);
  rim.position.set(-3, 2.2, -2.5);
  scene.add(rim);

  // gölge yakalayıcı: HDRI zemininin üstüne yumuşak gölge
  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.ShadowMaterial({ opacity: 0.42, color: 0x000000 })
  );
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.002; catcher.receiveShadow = true;
  scene.add(catcher);

  // --- post-process ---
  const hedef = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: MOBIL ? 0 : 4 });
  const composer = new EffectComposer(renderer, hedef);
  composer.addPass(new RenderPass(scene, camera));
  if (!MOBIL) {
    const ao = new GTAOPass(scene, camera, 2, 2);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.updateGtaoMaterial({ radius: 0.22, distanceExponent: 1.2, thickness: 1.0, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 12 });
    ao.blendIntensity = 0.85;
    composer.addPass(ao); state.ao = ao;
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.22, 0.45, 0.92);
  composer.addPass(bloom);
  const vig = new ShaderPass(VignetteShader);
  vig.uniforms.offset.value = 1.05; vig.uniforms.darkness.value = 1.15;
  composer.addPass(vig);
  if (!MOBIL) composer.addPass(new SMAAPass());
  composer.addPass(new OutputPass());
  state.composer = composer;

  // --- yüklemeler paralel ---
  const pHdr = new Promise((res) => {
    new HDRLoader().load(ASSET(MOBIL ? "hdri_empty_warehouse_01_1k.hdr" : "hdri_empty_warehouse_01_2k.hdr"), (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = hdr;
      scene.environmentIntensity = 0.9;
      const sky = new GroundedSkybox(hdr, 1.55, 24);
      sky.position.y = 1.55 - 0.02;
      scene.add(sky);
      res(true);
    }, undefined, () => { scene.background = new THREE.Color(0x0a0f13); res(false); });
  });
  const pGlb = new Promise((res) => {
    new GLTFLoader().load(ASSET("table.glb"), (g) => res(g.scene), undefined, () => res(null));
  });

  return Promise.all([pHdr, pGlb]).then(([hdrOk, model]) => {
    if (model) { yerlestirModel(model); } else { proseduralMasa(); }
    state.ok = true;
    document.body.classList.add("has-3d");
    window.dispatchEvent(new Event("kd3d-ready"));
    addEventListener("resize", () => { state.needs = true; });
    requestAnimationFrame(dongu);
    return true;
  });
}

/* ================= model ================= */
function purtuk(boy = 256, siddet = 22) {
  const c = document.createElement("canvas"); c.width = c.height = boy;
  const g = c.getContext("2d"), img = g.createImageData(boy, boy);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 150 + (Math.random() - 0.5) * siddet;
    img.data[i] = img.data[i+1] = img.data[i+2] = v; img.data[i+3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

function yerlestirModel(root) {
  const scene = state.scene;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      if (o.material && o.material.isMeshStandardMaterial) o.material.envMapIntensity = 0.75;
    }
    if (o.isLight || o.isCamera) o.visible = false;
  });
  const top = root.getObjectByName("Table_Top");
  if (top && top.material) {
    const rm = purtuk(); rm.repeat.set(28, 15);
    top.material.color.setHex(0x0d4566);
    top.material.roughnessMap = rm; top.material.roughness = 0.58; top.material.envMapIntensity = 0.7;
    top.material.needsUpdate = true;
  }
  state.tableTop = top;
  const orta = root.getObjectByName("Table_Line_Center");
  if (orta) orta.scale.z = 2.4;
  const wireNet = root.getObjectByName("Net_Mesh");
  if (wireNet) wireNet.visible = false;
  state.scene.add(fileDuzlemi());

  const paddle = root.getObjectByName("Paddle");
  const ball = root.getObjectByName("Ball");
  // raket ve topu kökten ayır (kendi konumlarını biz yönetiyoruz)
  if (paddle) paddle.parent.remove(paddle);
  if (ball) ball.parent.remove(ball);
  scene.add(root);

  if (paddle) {
    state.paddleA = raketKopya(paddle, true);
    state.paddleB = raketKopya(paddle, false);
    scene.add(state.paddleA, state.paddleB);
  }
  if (ball) {
    ball.material = ball.material.clone();
    ball.material.roughness = 0.4;
    state.ball = ball; scene.add(ball);
  } else { proseduralTop(); }
  temasGolgesi();
  topDinlen();
}

function raketKopya(src, sol) {
  const p = src.clone(true);
  p.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
      if (o.name.startsWith("Paddle_Rubber_Front")) (sol ? (state.rubberA = o) : (state.rubberB = o));
    }
  });
  // masanın kendi ucunda, yüzeye yatık; sap dışarı bakıyor
  p.position.set(sol ? -1.18 : 1.18, H + 0.0048, sol ? 0.38 : -0.38);
  p.rotation.set(0, sol ? Math.PI / 2 + 0.28 : -Math.PI / 2 - 0.28, 0);
  return p;
}

function fileDokusu() {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 96;
  const g = c.getContext("2d"); g.clearRect(0, 0, 1024, 96);
  g.strokeStyle = "rgba(255,255,255,1)"; g.lineWidth = 1.6;
  for (let x = 0; x <= 1024; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 96); g.stroke(); }
  for (let y = 0; y <= 96; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  return t;
}
function fileDuzlemi() {
  const t = fileDokusu();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.83, NET_H),
    new THREE.MeshStandardMaterial({ map: t, alphaMap: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide,
      roughness: 0.85, color: 0xe8ece9, envMapIntensity: 0.4 }));
  m.position.set(0, H + NET_H / 2, 0); m.rotation.y = Math.PI / 2;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function proseduralMasa() {
  const s = state.scene;
  const blue = new THREE.MeshStandardMaterial({ color: 0x14536f, roughness: 0.7, roughnessMap: purtuk() });
  blue.roughnessMap.repeat.set(28, 15);
  const top = new THREE.Mesh(new RoundedBoxGeometry(L, 0.022, W, 3, 0.005), blue);
  top.position.y = H - 0.011; top.castShadow = top.receiveShadow = true; s.add(top);
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.55 });
  const cz = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.0008, d), white); m.position.set(x, H + 0.0004, z); s.add(m); };
  cz(L, 0.02, 0, W/2 - 0.01); cz(L, 0.02, 0, -W/2 + 0.01); cz(0.02, W, L/2 - 0.01, 0); cz(0.02, W, -L/2 + 0.01, 0); cz(L, 0.003, 0, 0);
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b2329, roughness: 0.42, metalness: 0.75 });
  [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([sx, sz]) => {
    const leg = new THREE.Mesh(new RoundedBoxGeometry(0.045, H - 0.1, 0.045, 2, 0.004), metal);
    leg.position.set(sx * (L/2 - 0.42), (H - 0.1)/2 + 0.06, sz * (W/2 - 0.16)); leg.castShadow = true; s.add(leg);
  });
  s.add(fileDuzlemi());
  state.tableTop = top;
  const raket = (sol) => {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.0065, 64), new THREE.MeshStandardMaterial({ color: 0xa8794a, roughness: 0.62 }));
    blade.castShadow = true; g.add(blade);
    const rub = new THREE.Mesh(new THREE.CylinderGeometry(0.0755, 0.0755, 0.0018, 64), new THREE.MeshStandardMaterial({ color: 0x7d1a14, roughness: 0.9 }));
    rub.position.y = 0.0042; g.add(rub); (sol ? (state.rubberA = rub) : (state.rubberB = rub));
    const handle = new THREE.Mesh(new RoundedBoxGeometry(0.027, 0.023, 0.105, 3, 0.006), new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.62 }));
    handle.position.z = 0.128; handle.castShadow = true; g.add(handle);
    g.position.set(sol ? -1.18 : 1.18, H + 0.0048, sol ? 0.38 : -0.38);
    g.rotation.y = sol ? Math.PI/2 + 0.28 : -Math.PI/2 - 0.28;
    return g;
  };
  state.paddleA = raket(true); state.paddleB = raket(false); s.add(state.paddleA, state.paddleB);
  proseduralTop();
  temasGolgesi();
  topDinlen();
}
function temasGolgesi() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, "rgba(0,0,0,0.55)"); grd.addColorStop(0.5, "rgba(0,0,0,0.22)"); grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 2;
  state.scene.add(m); state.golge = m;
  return m;
}
function golgeGuncelle() {
  const g = state.golge, b = state.ball; if (!g || !b) return;
  const yuk = Math.max(0, b.position.y - (H + BALL_R));          // masadan yükseklik
  const ust = Math.abs(b.position.x) < L / 2 + 0.02 && Math.abs(b.position.z) < W / 2 + 0.02;
  g.visible = ust && yuk < 0.6;
  g.position.set(b.position.x, H + 0.0012, b.position.z);
  const k = 1 + yuk * 2.2;
  g.scale.set(k, k, 1);
  g.material.opacity = Math.max(0, 1 - yuk * 1.7);
}
function proseduralTop() {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0xfbfbf6, roughness: 0.4 }));
  ball.castShadow = true; state.ball = ball; state.scene.add(ball);
}

/* ================= renk / durum ================= */
function kaucukRengi(hex) {
  // fosfor rengini kauçuk gibi görünen doygun ama koyu tona çek
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 0.95), Math.max(0.16, Math.min(0.34, hsl.l * 0.62)));
  return c;
}
function setColors(key, colA, colB) {
  const c = state.courts.get(key); if (!c) return;
  c.colA = colA; c.colB = colB;
  if (state.active === key) uygulaRenk(c);
}
function uygulaRenk(c) {
  if (state.rubberA && c.colA) { state.rubberA.material.color.copy(kaucukRengi(c.colA)); state.rubberA.material.needsUpdate = true; }
  if (state.rubberB && c.colB) { state.rubberB.material.color.copy(kaucukRengi(c.colB)); state.rubberB.material.needsUpdate = true; }
  state.needs = true;
}
function setLeader(key, leftLeads) {
  const c = state.courts.get(key); if (c) c.leaderLeft = leftLeads;
  if (state.active === key && !state.anim) { state.leaderLeft = leftLeads; topDinlen(); }
}
function topDinlen() {
  if (!state.ball) return;
  const sol = state.leaderLeft;
  state.ball.position.set(sol ? -1.0 : 1.0, H + BALL_R, sol ? 0.16 : -0.16);
  golgeGuncelle();
  state.needs = true;
}

/* ================= kort kaydı / aktif panel ================= */
function attach(key, courtEl, colA, colB) {
  let c = state.courts.get(key);
  if (!c) { c = { el: courtEl, colA, colB, leaderLeft: true }; state.courts.set(key, c); }
  else { c.el = courtEl; c.colA = colA; c.colB = colB; }
  if (!state.active) setActive(key);
  if (state.active === key) uygulaRenk(c);
}
function setActive(key) {
  const c = state.courts.get(key); if (!c || !state.canvas) return;
  state.active = key;
  if (state.canvas.parentNode !== c.el) c.el.prepend(state.canvas);
  state.leaderLeft = c.leaderLeft;
  uygulaRenk(c);
  if (!state.anim) topDinlen();
  state.needs = true;
}
// deck kaydırılınca ekranın ortasındaki kortu aktif yap
function otomatikAktif() {
  let best = null, bestD = Infinity;
  const cx = innerWidth / 2;
  state.courts.forEach((c, key) => {
    const r = c.el.getBoundingClientRect();
    if (r.width === 0) return;
    const d = Math.abs((r.left + r.right) / 2 - cx);
    if (d < bestD) { bestD = d; best = key; }
  });
  if (best && best !== state.active && bestD < innerWidth * 0.5) setActive(best);
}
let deckT = 0;
document.addEventListener("scroll", (e) => {
  if (e.target && e.target.id === "deck") { clearTimeout(deckT); deckT = setTimeout(otomatikAktif, 160); }
}, true);
document.addEventListener("scrollend", (e) => { if (e.target && e.target.id === "deck") otomatikAktif(); }, true);

/* ================= kamera: kort kutusuna sığdır ================= */
function kameraYerlestir(w, h) {
  const cam = state.camera;
  cam.aspect = w / h;
  cam.fov = MOBIL ? 34 : 30;
  const gorunurGenislik = L + 1.25;                       // masa + kenar payı
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect);
  let dist = (gorunurGenislik / 2) / Math.tan(hfov / 2);
  dist = Math.max(dist, 2.2);
  // hafif 3/4 açı, yüksekten
  const yaw = 0.30, pitch = 0.33;
  cam.position.set(Math.sin(yaw) * dist, H + Math.sin(pitch) * dist, Math.cos(yaw) * dist);
  cam.lookAt(0, H - 0.02, 0);
  cam.updateProjectionMatrix();
}

/* ================= ralli ================= */
function rally(key, winIsA, onLand) {
  if (!state.ok || !state.ball) return false;
  if (state.active !== key) setActive(key);
  if (AZ_HAREKET) { onLand && onLand(); return true; }
  const c = state.courts.get(key);
  const dir = winIsA ? 1 : -1;                          // A soldan sağa vurur
  const x0 = -1.12 * dir, xB = 0.72 * dir, x1 = 1.78 * dir;
  const z0 = 0.16 * dir, z1 = -0.22 * dir;
  const t0 = performance.now(), sure = 820;
  let landed = false;
  state.anim = (now) => {
    const t = Math.min(1, (now - t0) / sure);
    const ball = state.ball;
    let x, y;
    if (t < 0.56) {                                     // vuruş -> file üstü -> sekme
      const u = t / 0.56;
      x = THREE.MathUtils.lerp(x0, xB, u);
      const peak = 0.30;
      y = H + BALL_R + 0.12 * (1 - u) + peak * 4 * u * (1 - u) * 1.15 - 0.12 * (1 - u) * (1 - u) * 0;
      if (u > 0.98) y = H + BALL_R;
    } else {                                            // sekme -> masayı terk
      const u = (t - 0.56) / 0.44;
      x = THREE.MathUtils.lerp(xB, x1, u);
      y = H + BALL_R + 0.17 * 4 * u * (1 - u) - 0.22 * u * u;
    }
    const z = THREE.MathUtils.lerp(z0, z1, t);
    ball.position.set(x, y, z);
    ball.rotation.x += 0.35 * dir; ball.rotation.z += 0.12;
    golgeGuncelle();
    // raket vuruşları
    const pw = winIsA ? state.paddleA : state.paddleB, pl = winIsA ? state.paddleB : state.paddleA;
    if (pw) pw.rotation.z = -0.9 * Math.sin(Math.min(1, t / 0.18) * Math.PI) * dir;
    if (pl) pl.rotation.z = 0.7 * Math.sin(Math.max(0, Math.min(1, (t - 0.74) / 0.26)) * Math.PI) * dir;   // geç kalan savunma
    if (!landed && t >= 0.7) { landed = true; onLand && onLand(); }
    if (t >= 1) {
      state.anim = null;
      if (pw) pw.rotation.z = 0; if (pl) pl.rotation.z = 0;
      state.leaderLeft = c ? c.leaderLeft : state.leaderLeft;
      topDinlen();
    }
    state.needs = true;
  };
  state.needs = true;
  return true;
}

/* ================= döngü ================= */
function dongu(now) {
  requestAnimationFrame(dongu);
  state.frames++;
  try { adim(now); } catch (e) { if (!state.err) { state.err = String(e && e.stack || e); console.error("3B döngü hatası:", e); } }
}
function adim(now, zorla) {
  const cv = state.canvas;
  if (!cv || !cv.parentNode) return;
  if (!zorla && document.hidden) return;
  const r = cv.parentNode.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (!zorla && (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)) return;
  if (zorla) state.needs = true;
  if (w !== state.w || h !== state.h) {
    state.w = w; state.h = h;
    state.renderer.setSize(w, h, false);
    state.composer.setSize(w, h);
    if (state.ao) state.ao.setSize(w, h);
    kameraYerlestir(w, h);
    state.needs = true;
  }
  if (state.anim) state.anim(now);
  if (!state.needs) return;
  state.needs = !!state.anim;
  state.composer.render();
}

KD3D.ready = kur().catch((e) => { console.warn("3B sahne kurulamadı:", e); return false; });
