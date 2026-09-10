// Kan Davası — SALON: tam ekran 3B masa tenisi salonu. Üç masa, asılı tabelalar, duvar panosu, kamera ile gezinme.
// Dış API: window.SALON = { ready, setData, setWall(drawFn), goto, view, rally, bubble, on, sound, ok }
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
const L = 2.74, W = 1.525, H = 0.76, NET_H = 0.1525, BALL_R = 0.02;
const ARALIK = 4.6;                       // masalar arası mesafe (m)

const dinleyici = {};
const SALON = {
  ready: null, ok: false, view: null,
  setData, setWall, goto, rally, bubble, sound,
  on(ev, fn) { (dinleyici[ev] = dinleyici[ev] || []).push(fn); },
};
function emit(ev, d) { (dinleyici[ev] || []).forEach((f) => { try { f(d); } catch (e) { console.warn(e); } }); }
window.SALON = SALON;

const st = {
  renderer: null, scene: null, camera: null, composer: null, ao: null, canvas: null,
  tables: new Map(), order: [], glb: null, w: 0, h: 0,
  cam: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fromPos: null, fromLook: null, toPos: null, toLook: null, t0: 0, dur: 0, fov: 40 },
  wall: null, wallCanvas: null, wallTex: null, ses: null, sesAcik: true, sonAmbiyans: 0, err: null, frames: 0,
};
SALON._s = st;

/* ================= yardımcılar ================= */
const sm = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
function purtuk(boy = 256, siddet = 22) {
  const c = document.createElement("canvas"); c.width = c.height = boy;
  const g = c.getContext("2d"), img = g.createImageData(boy, boy);
  for (let i = 0; i < img.data.length; i += 4) { const v = 150 + (Math.random() - 0.5) * siddet; img.data[i] = img.data[i+1] = img.data[i+2] = v; img.data[i+3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function kaucukRengi(hex) {
  const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 0.95), Math.max(0.16, Math.min(0.34, hsl.l * 0.62)));
  return c;
}
function fileDokusu() {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 96;
  const g = c.getContext("2d"); g.strokeStyle = "#fff"; g.lineWidth = 1.6;
  for (let x = 0; x <= 1024; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 96); g.stroke(); }
  for (let y = 0; y <= 96; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
let _fileTex = null;
function fileDuzlemi() {
  _fileTex = _fileTex || fileDokusu();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.83, NET_H),
    new THREE.MeshStandardMaterial({ map: _fileTex, alphaMap: _fileTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.85, color: 0xe8ece9, envMapIntensity: 0.4 }));
  m.position.set(0, H + NET_H / 2, 0); m.rotation.y = Math.PI / 2; m.castShadow = true; m.receiveShadow = true;
  return m;
}
let _golgeTex = null;
function temasGolgesi() {
  if (!_golgeTex) {
    const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, "rgba(0,0,0,.55)"); grd.addColorStop(.5, "rgba(0,0,0,.22)"); grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128); _golgeTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), new THREE.MeshBasicMaterial({ map: _golgeTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 2; return m;
}

/* ================= raket pozu ================= */
const HAZIR = { A: new THREE.Vector3(-(L / 2 + 0.24), H + 0.21, 0.20), B: new THREE.Vector3((L / 2 + 0.24), H + 0.21, -0.20) };
function raketTemelQuat(sol) {
  const m = new THREE.Matrix4();
  if (sol) m.makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0));
  else     m.makeBasis(new THREE.Vector3(0, 0, 1),  new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), sol ? 0.24 : -0.24));
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sol ? -0.35 : 0.35));
  return q;
}
function raketHazir(p, sol) { p.position.copy(sol ? HAZIR.A : HAZIR.B); p.quaternion.copy(raketTemelQuat(sol)); }

/* ================= kurulum ================= */
function kur() {
  const canvas = document.getElementById("salon") || document.createElement("canvas");
  canvas.id = "salon";
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBIL, powerPreference: "high-performance" }); }
  catch (e) { return Promise.resolve(false); }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBIL ? 1.5 : 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 2, 0.05, 120);
  Object.assign(st, { renderer, scene, camera, canvas });

  const key = new THREE.DirectionalLight(0xfff1df, 2.3);
  key.position.set(3, 8, 5); key.castShadow = true;
  key.shadow.mapSize.set(MOBIL ? 1024 : 2048, MOBIL ? 1024 : 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 30;
  key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 4;
  scene.add(key, key.target); key.target.position.set(0, H, 0);
  const rim = new THREE.DirectionalLight(0x9fd3ff, 0.55); rim.position.set(-6, 4, -6); scene.add(rim);

  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.4 }));
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.002; catcher.receiveShadow = true; scene.add(catcher);

  const hedef = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: MOBIL ? 0 : 4 });
  const composer = new EffectComposer(renderer, hedef);
  composer.addPass(new RenderPass(scene, camera));
  if (!MOBIL) {
    const ao = new GTAOPass(scene, camera, 2, 2);
    ao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 1.2, thickness: 1.0, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 12 });
    ao.blendIntensity = 0.8; composer.addPass(ao); st.ao = ao;
  }
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(2, 2), 0.28, 0.5, 0.9));
  const vig = new ShaderPass(VignetteShader); vig.uniforms.offset.value = 1.0; vig.uniforms.darkness.value = 1.25; composer.addPass(vig);
  if (!MOBIL) composer.addPass(new SMAAPass());
  composer.addPass(new OutputPass());
  st.composer = composer;

  const pHdr = new Promise((res) => {
    new HDRLoader().load(ASSET(MOBIL ? "hdri_empty_warehouse_01_1k.hdr" : "hdri_empty_warehouse_01_2k.hdr"), (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = hdr; scene.environmentIntensity = 0.9;
      const sky = new GroundedSkybox(hdr, 1.55, 26); sky.position.y = 1.55 - 0.02; scene.add(sky); res(true);
    }, undefined, () => { scene.background = new THREE.Color(0x0a0f13); res(false); });
  });
  const pGlb = new Promise((res) => new GLTFLoader().load(ASSET("table.glb"), (g) => res(g.scene), undefined, () => res(null)));

  return Promise.all([pHdr, pGlb]).then(([_, glb]) => {
    st.glb = glb;
    duvarPanosu();
    st.ok = true; SALON.ok = true;
    kameraSabitle("wide");
    document.body.classList.add("has-salon");
    etkilesim();
    requestAnimationFrame(dongu);
    window.dispatchEvent(new Event("salon-ready"));
    return true;
  });
}

/* ================= masa ================= */
function masaKur(key, idx, toplam) {
  const g = new THREE.Group(); g.name = "Masa_" + key;
  const x = (idx - (toplam - 1) / 2) * ARALIK;
  g.position.set(x, 0, 0); g.rotation.y = Math.PI / 2;      // uzun kenar Z boyunca; A ucu kameraya yakın (+Z)
  st.scene.add(g);
  const T = { key, g, idx, anim: null, sesEv: [], data: null };

  if (st.glb) {
    const root = st.glb.clone(true);
    root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material = o.material.clone(); if (o.material.isMeshStandardMaterial) o.material.envMapIntensity = 0.75; }
      if (o.isLight || o.isCamera) o.visible = false;
    });
    const top = root.getObjectByName("Table_Top");
    if (top) { const rm = purtuk(); rm.repeat.set(28, 15); top.material.color.setHex(0x0d4566); top.material.roughnessMap = rm; top.material.roughness = 0.58; top.material.envMapIntensity = 0.7; top.material.needsUpdate = true; }
    const orta = root.getObjectByName("Table_Line_Center"); if (orta) orta.scale.z = 2.4;
    const wire = root.getObjectByName("Net_Mesh"); if (wire) wire.visible = false;
    const paddle = root.getObjectByName("Paddle"); if (paddle) paddle.parent.remove(paddle);
    const ball = root.getObjectByName("Ball"); if (ball) ball.parent.remove(ball);
    g.add(root); g.add(fileDuzlemi());
    T.pA = raketKopya(paddle, true, T); T.pB = raketKopya(paddle, false, T); g.add(T.pA, T.pB);
    ball.material = ball.material.clone(); ball.material.roughness = 0.4; ball.material.transparent = true; ball.scale.setScalar(1.5);
    T.ball = ball; g.add(ball);
  } else {
    proseduralMasa(T, g);
  }
  T.golge = temasGolgesi(); g.add(T.golge);
  // tıklama kutusu (görünmez)
  const hit = new THREE.Mesh(new THREE.BoxGeometry(L + 1.2, 1.4, W + 1.2), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.7; hit.userData.key = key; hit.userData.hit = "masa"; g.add(hit); T.hit = hit;
  // tabela (sprite: hep kameraya bakar)
  T.boardCanvas = document.createElement("canvas"); T.boardCanvas.width = 1024; T.boardCanvas.height = 384;
  T.boardTex = new THREE.CanvasTexture(T.boardCanvas); T.boardTex.colorSpace = THREE.SRGBColorSpace; T.boardTex.anisotropy = 8;
  T.board = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.boardTex, transparent: true, depthTest: true }));
  T.board.scale.set(1.5, 0.5625, 1); T.board.position.set(0, 2.05, 0); T.board.userData.key = key; T.board.userData.hit = "tabela"; g.add(T.board);
  // konuşma balonu
  T.bubCanvas = document.createElement("canvas"); T.bubCanvas.width = 768; T.bubCanvas.height = 192;
  T.bubTex = new THREE.CanvasTexture(T.bubCanvas); T.bubTex.colorSpace = THREE.SRGBColorSpace;
  T.bub = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.bubTex, transparent: true, depthTest: false, opacity: 0 }));
  T.bub.scale.set(1.2, 0.3, 1); T.bub.renderOrder = 10; g.add(T.bub); T.bubT = 0;
  topDinlen(T, true);
  st.tables.set(key, T);
  return T;
}
function raketKopya(src, sol, T) {
  const p = src.clone(true);
  p.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); if (o.name.startsWith("Paddle_Rubber_Front")) (sol ? (T.rubA = o) : (T.rubB = o)); if (o.name.startsWith("Paddle_Rubber_Back")) (sol ? (T.rubA2 = o) : (T.rubB2 = o)); o.userData.hit = "raket"; o.userData.key = T.key; o.userData.side = sol ? "a" : "b"; } });
  raketHazir(p, sol); return p;
}
function proseduralMasa(T, g) {
  const blue = new THREE.MeshStandardMaterial({ color: 0x14536f, roughness: 0.7, roughnessMap: purtuk() }); blue.roughnessMap.repeat.set(28, 15);
  const top = new THREE.Mesh(new RoundedBoxGeometry(L, 0.022, W, 3, 0.005), blue); top.position.y = H - 0.011; top.castShadow = top.receiveShadow = true; g.add(top);
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.55 });
  const cz = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.0008, d), white); m.position.set(x, H + 0.0004, z); g.add(m); };
  cz(L, 0.02, 0, W/2 - 0.01); cz(L, 0.02, 0, -W/2 + 0.01); cz(0.02, W, L/2 - 0.01, 0); cz(0.02, W, -L/2 + 0.01, 0); cz(L, 0.007, 0, 0);
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b2329, roughness: 0.42, metalness: 0.75 });
  [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([sx, sz]) => { const leg = new THREE.Mesh(new RoundedBoxGeometry(0.045, H - 0.1, 0.045, 2, 0.004), metal); leg.position.set(sx*(L/2-0.42), (H-0.1)/2+0.06, sz*(W/2-0.16)); leg.castShadow = true; g.add(leg); });
  g.add(fileDuzlemi());
  const raket = (sol) => {
    const p = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.0065, 64), new THREE.MeshStandardMaterial({ color: 0xa8794a, roughness: 0.62 })); blade.castShadow = true; p.add(blade);
    const rub = new THREE.Mesh(new THREE.CylinderGeometry(0.0755, 0.0755, 0.0018, 64), new THREE.MeshStandardMaterial({ color: 0x7d1a14, roughness: 0.9 })); rub.position.y = 0.0042; p.add(rub); (sol ? (T.rubA = rub) : (T.rubB = rub));
    const handle = new THREE.Mesh(new RoundedBoxGeometry(0.027, 0.023, 0.105, 3, 0.006), new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.62 })); handle.position.z = 0.128; handle.castShadow = true; p.add(handle);
    p.traverse((o) => { if (o.isMesh) { o.userData.hit = "raket"; o.userData.key = T.key; o.userData.side = sol ? "a" : "b"; } });
    raketHazir(p, sol); return p;
  };
  T.pA = raket(true); T.pB = raket(false); g.add(T.pA, T.pB);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 48, 32), new THREE.MeshStandardMaterial({ color: 0xfbfbf6, roughness: 0.4, transparent: true }));
  ball.scale.setScalar(1.5); ball.castShadow = true; T.ball = ball; g.add(ball);
}
function topDinlen(T, hemen) {
  const d = T.data, sol = !d || d.aw >= d.bw;
  T.ball.position.set(sol ? -1.0 : 1.0, H + BALL_R * 1.5, sol ? 0.16 : -0.16);
  golgeGuncelle(T);
}
function golgeGuncelle(T) {
  const g = T.golge, b = T.ball; if (!g || !b) return;
  const yuk = Math.max(0, b.position.y - (H + BALL_R * 1.5));
  const ust = Math.abs(b.position.x) < L / 2 + 0.02 && Math.abs(b.position.z) < W / 2 + 0.02;
  g.visible = ust && yuk < 0.6; g.position.set(b.position.x, H + 0.0012, b.position.z);
  const k = 1 + yuk * 2.2; g.scale.set(k, k, 1); g.material.opacity = Math.max(0, 1 - yuk * 1.7);
}

/* ================= tabela çizimi ================= */
function tabelaCiz(T) {
  const d = T.data; if (!d) return;
  const c = T.boardCanvas, g = c.getContext("2d"), Wc = c.width, Hc = c.height;
  g.clearRect(0, 0, Wc, Hc);
  // gövde
  g.fillStyle = "#07090c"; rr(g, 8, 8, Wc - 16, Hc - 16, 22); g.fill();
  g.strokeStyle = "rgba(255,255,255,.14)"; g.lineWidth = 4; rr(g, 8, 8, Wc - 16, Hc - 16, 22); g.stroke();
  // askı çubuğu
  g.fillStyle = "#222a30"; g.fillRect(Wc/2 - 6, 0, 12, 14);
  // isimler
  g.font = "600 40px 'DM Mono', monospace"; g.textBaseline = "top";
  g.fillStyle = d.ac; g.textAlign = "left"; g.fillText(d.an.toLocaleUpperCase("tr"), 54, 40);
  g.fillStyle = d.bc; g.textAlign = "right"; g.fillText(d.bn.toLocaleUpperCase("tr"), Wc - 54, 40);
  const m = T.mac;
  if (m) {
    // MAÇ MODU: büyük rakamlar maç içi sayı, üstte küçük 100'lük sayaç
    g.fillStyle = "rgba(255,255,255,.35)"; g.font = "500 26px 'DM Mono', monospace"; g.textAlign = "center";
    g.fillText(d.aw + "  ·  100'E İLK GİDEN  ·  " + d.bw, Wc / 2, 52);
    g.font = "800 190px 'Big Shoulders Display', 'Arial Narrow', sans-serif";
    const bit = !!m.bitti;
    g.fillStyle = bit ? "#ffd83d" : "#f4f7f8"; g.shadowColor = bit ? "rgba(255,216,61,.7)" : "rgba(255,255,255,.35)"; g.shadowBlur = bit ? 34 : 18;
    g.textAlign = "left"; g.fillText(String(m.a), 54, 100);
    g.textAlign = "right"; g.fillText(String(m.b), Wc - 54, 100);
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(Wc/2 - 2, 100, 4, 210);
    // etiket
    g.font = "800 " + (bit ? 96 : 40) + "px 'Big Shoulders Display', sans-serif"; g.textAlign = "center";
    g.fillStyle = bit ? "#ffd83d" : "#ff6a1f"; g.shadowColor = g.fillStyle; g.shadowBlur = bit ? 30 : 10;
    g.fillText(m.etiket, Wc / 2, bit ? 250 : 320); g.shadowBlur = 0;
  } else {
    g.font = "800 190px 'Big Shoulders Display', 'Arial Narrow', sans-serif";
    g.fillStyle = "#f4f7f8"; g.shadowColor = "rgba(255,255,255,.35)"; g.shadowBlur = 18;
    g.textAlign = "left"; g.fillText(String(d.aw), 54, 100);
    g.textAlign = "right"; g.fillText(String(d.bw), Wc - 54, 100);
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255,255,255,.25)"; g.font = "500 26px 'DM Mono', monospace"; g.textAlign = "center";
    g.fillText("100'E İLK GİDEN · MAÇLAR", Wc / 2, 52);
    g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(Wc/2 - 2, 100, 4, 210);
    const pips = d.last5 || [];
    for (let i = 0; i < 5; i++) { const p = pips[i]; g.beginPath(); g.arc(Wc/2 - 60 + i*30, 340, 9, 0, Math.PI*2); g.fillStyle = p ? p : "rgba(255,255,255,.12)"; g.fill(); }
  }
  T.boardTex.needsUpdate = true;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x+r, y); g.arcTo(x+w, y, x+w, y+h, r); g.arcTo(x+w, y+h, x, y+h, r); g.arcTo(x, y+h, x, y, r); g.arcTo(x, y, x+w, y, r); g.closePath(); }

/* ================= duvar panosu ================= */
function duvarPanosu() {
  const c = document.createElement("canvas"); c.width = 2048; c.height = 1024;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 4.0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
  m.position.set(0, 2.55, -5.6); m.receiveShadow = true; st.scene.add(m);
  const post = new THREE.MeshStandardMaterial({ color: 0x1b2329, roughness: 0.5, metalness: 0.7 });
  [-3.8, 3.8].forEach((x) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4.6, 0.06), post); p.position.set(x, 2.3, -5.62); p.castShadow = true; st.scene.add(p); });
  st.wall = m; st.wallCanvas = c; st.wallTex = tex;
  const g = c.getContext("2d"); g.fillStyle = "#0b1015"; g.fillRect(0, 0, c.width, c.height);
}
function setWall(drawFn) { if (!st.wallCanvas) return; drawFn(st.wallCanvas); st.wallTex.needsUpdate = true; }

/* ================= veri ================= */
function setData(list) {
  // list: [{key, an, bn, ac, bc, aw, bw, last5:[colorHex...]}]
  const keys = list.map((d) => d.key);
  // yeni masalar
  list.forEach((d, i) => { if (!st.tables.has(d.key)) masaKur(d.key, i, list.length); });
  // silinenler
  [...st.tables.keys()].forEach((k) => { if (!keys.includes(k)) { const T = st.tables.get(k); st.scene.remove(T.g); st.tables.delete(k); } });
  // konumlar (sıra değişmiş olabilir)
  list.forEach((d, i) => { const T = st.tables.get(d.key); T.idx = i; T.g.position.x = (i - (list.length - 1) / 2) * ARALIK; });
  st.order = keys;
  list.forEach((d) => {
    const T = st.tables.get(d.key);
    const degisti = !T.data || T.data.aw !== d.aw || T.data.bw !== d.bw;
    T.data = d;
    if (T.rubA) T.rubA.material.color.copy(kaucukRengi(d.ac));
    if (T.rubB) T.rubB.material.color.copy(kaucukRengi(d.bc));
    if (T.rubA2) T.rubA2.material.color.copy(kaucukRengi(d.ac).multiplyScalar(0.55));
    if (T.rubB2) T.rubB2.material.color.copy(kaucukRengi(d.bc).multiplyScalar(0.55));
    if (!T.mac) tabelaCiz(T);
    if (!T.anim && degisti) topDinlen(T);
  });
  if (st.view && !st.tables.has(st.view)) goto(null);
}

/* ================= kamera ================= */
function kameraHedef(view) {
  const cam = st.camera, aspect = st.w / Math.max(1, st.h), portre = aspect < 0.9;
  let pos, look, fov;
  if (!view || !st.tables.has(view)) {
    fov = portre ? 50 : 42;
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect);
    const genis = portre ? ARALIK * 1.25 + W : (st.order.length - 1) * ARALIK + L * 0.9 + 3.0;
    let dist = (genis / 2) / Math.tan(hfov / 2); dist = Math.max(dist, portre ? 6.0 : 7.5);
    pos = new THREE.Vector3(0.0, 0.75 + dist * (portre ? 0.55 : 0.42), dist * 0.95);
    look = new THREE.Vector3(0, portre ? 1.35 : 1.05, portre ? -2.2 : -1.2);
  } else {
    const T = st.tables.get(view);
    fov = portre ? 44 : 32;
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect);
    const genis = portre ? L * 0.9 + 0.4 : L * 0.95 + W * 0.6 + 0.6;
    let dist = (genis / 2) / Math.tan(hfov / 2); dist = Math.max(dist, 2.4);
    const yaw = -0.62, pitch = 0.36;                       // ön-sol köşe, yüksekten
    pos = T.g.localToWorld(new THREE.Vector3(Math.sin(yaw) * dist, H + Math.sin(pitch) * dist, Math.cos(yaw) * dist));
    look = T.g.localToWorld(new THREE.Vector3(0.05, portre ? H - 0.42 : H + 0.02, 0));
  }
  return { pos, look, fov };
}
function kameraSabitle(view) {
  const h = kameraHedef(view === "wide" ? null : view);
  st.cam.pos.copy(h.pos); st.cam.look.copy(h.look); st.cam.fov = h.fov;
  st.cam.toPos = null; st.cam.fromPos = null;
  st.camera.fov = h.fov; st.camera.updateProjectionMatrix();
}
function goto(view) {
  if (!st.ok) return;
  view = view && st.tables.has(view) ? view : null;
  if (view === st.view && st.cam.toPos === null) return;
  const h = kameraHedef(view);
  st.cam.fromPos = st.cam.pos.clone(); st.cam.fromLook = st.cam.look.clone(); st.cam.fromFov = st.cam.fov;
  st.cam.toPos = h.pos; st.cam.toLook = h.look; st.cam.toFov = h.fov;
  st.cam.t0 = performance.now(); st.cam.dur = AZ_HAREKET ? 1 : 1150;
  st.view = view; SALON.view = view;
  emit("view", view);
}
const _cp = new THREE.Vector3(), _cl = new THREE.Vector3();
function kameraGuncelle(now) {
  const c = st.cam, cam = st.camera;
  if (c.toPos) {
    const u = sm((now - c.t0) / c.dur);
    // yay: geçişte hafif yükselip in
    c.pos.lerpVectors(c.fromPos, c.toPos, u); c.pos.y += Math.sin(u * Math.PI) * 0.6;
    c.look.lerpVectors(c.fromLook, c.toLook, u);
    c.fov = THREE.MathUtils.lerp(c.fromFov, c.toFov, u); cam.fov = c.fov; cam.updateProjectionMatrix();
    if (u >= 1) { c.pos.copy(c.toPos); c.look.copy(c.toLook); c.toPos = null; }
  }
  _cp.copy(c.pos); _cl.copy(c.look);
  if (!AZ_HAREKET) {
    _cp.y += Math.sin(now * 0.00031) * 0.012; _cl.x += Math.sin(now * 0.00022) * 0.03;
    const T = st.view && st.tables.get(st.view);
    if (T && T.anim) { const bx = THREE.MathUtils.clamp(T.ball.position.x, -1.6, 1.6); st.takip = THREE.MathUtils.lerp(st.takip || 0, bx, 0.08); }
    else st.takip = THREE.MathUtils.lerp(st.takip || 0, 0, 0.05);
    if (T) { const off = T.g.localToWorld(new THREE.Vector3(st.takip * 0.14, 0, 0)).sub(T.g.position); _cl.add(off); }
  }
  cam.position.copy(_cp); cam.lookAt(_cl);
}

/* ================= ralli / maç ================= */
function segNokta(seg, u, out) { out.lerpVectors(seg.p0, seg.p1, u); out.y += seg.apex * 4 * u * (1 - u); return out; }

// Tek ralli adımı: {dur, run(tt), end()}; kisa=true -> servis + smaç (2 vuruş), değilse 3 vuruşluk tam ralli
function ralliKur(T, winIsA, kisa, onPass, sessiz) {
  const dir = winIsA ? 1 : -1;
  const xW = -dir * (L / 2), xL = dir * (L / 2), zW = winIsA ? 0.20 : -0.20, zL = -zW;
  const cW = new THREE.Vector3(xW - dir * 0.10, H + 0.21, zW), cL = new THREE.Vector3(xL + dir * 0.10, H + 0.21, zL);
  const y0 = H + BALL_R * 1.5, V = (x, y, z) => new THREE.Vector3(x, y, z);
  const PRE = 0.24, segs = [], sesler = []; let t = PRE;
  const seg = (p0, p1, apex, dur, ses) => { if (ses) sesler.push({ t, tur: ses }); segs.push({ t0: t, t1: t + dur, p0, p1, apex }); t += dur; };
  seg(cW, V(xW + dir * 0.55, y0, zW * 0.6), 0.15, 0.28, "raket");
  seg(V(xW + dir * 0.55, y0, zW * 0.6), V(xL - dir * 0.60, y0, zL * 0.5), 0.31, 0.42, "masa");
  seg(V(xL - dir * 0.60, y0, zL * 0.5), cL, 0.13, 0.26, "masa");
  const tVurusL = t;
  const vuruslar = [{ p: winIsA ? T.pA : T.pB, tc: PRE, hedef: cW.clone(), sol: winIsA }];
  let tVurusW = null;
  if (!kisa) {
    seg(cL, V(xW + dir * 0.72, y0, zW * 0.35), 0.30, 0.44, "raket");
    seg(V(xW + dir * 0.72, y0, zW * 0.35), cW, 0.14, 0.26, "masa");
    tVurusW = t;
    vuruslar.push({ p: winIsA ? T.pB : T.pA, tc: tVurusL, hedef: cL.clone(), sol: !winIsA });
    seg(cW, V(xL - dir * 0.30, y0, -zL * 0.55), 0.20, 0.32, "raket");
    seg(V(xL - dir * 0.30, y0, -zL * 0.55), V(xL + dir * 0.85, H - 0.28, -zL * 1.3), 0.05, 0.34, "masa");
    vuruslar.push({ p: winIsA ? T.pA : T.pB, tc: tVurusW, hedef: cW.clone(), sol: winIsA });
  } else {
    // kısa: rakip karşılamaya kalkar, top yanından geçer
    segs.pop(); t = tVurusL - 0.26; sesler.pop();
    seg(V(xL - dir * 0.60, y0, zL * 0.5), V(xL + dir * 0.85, H - 0.25, zL * 1.1), 0.09, 0.40, "masa");
  }
  const tGecis = t - 0.24, tSon = t;
  vuruslar.push({ p: winIsA ? T.pB : T.pA, tc: tGecis + 0.10, hedef: V(xL + dir * 0.05, H + 0.30, zL * 0.2), sol: !winIsA });
  const ball = T.ball; let passed = false, sesIdx = 0, bitti = false;
  ball.material.opacity = 1;
  return {
    dur: tSon + 0.45,
    run(tt) {
      while (sesIdx < sesler.length && tt >= sesler[sesIdx].t) { sesCal(sesler[sesIdx].tur, sessiz ? 0.35 : 1); sesIdx++; }
      let sg = null; for (const x of segs) if (tt >= x.t0 && tt < x.t1) { sg = x; break; }
      if (tt < PRE) ball.position.copy(cW);
      else if (sg) { const u = (tt - sg.t0) / (sg.t1 - sg.t0); segNokta(sg, u, ball.position); const hiz = sg.p0.distanceTo(sg.p1) / (sg.t1 - sg.t0); ball.rotation.z -= 0.09 * hiz * dir; ball.rotation.x += 0.03 * hiz; }
      else if (tt >= tSon) {
        const k = Math.min(1, (tt - tSon) / 0.45);
        if (k < 0.5) ball.material.opacity = 1 - k * 2; else { if (!bitti) { bitti = true; topDinlen(T); } ball.material.opacity = (k - 0.5) * 2; }
      }
      golgeGuncelle(T);
      for (const v of vuruslar) {
        if (!v.p) continue;
        const lt = tt - v.tc, hazir = v.sol ? HAZIR.A : HAZIR.B, q0 = raketTemelQuat(v.sol), d = v.sol ? 1 : -1;
        if (lt < -0.30 || lt > 0.75) continue;
        let pos, yaw, roll;
        const ileri = v.hedef.clone().add(new THREE.Vector3(d * 0.22, 0.12, (v.sol ? -1 : 1) * 0.12));
        if (lt < 0) { const u = sm((lt + 0.30) / 0.30); pos = hazir.clone().add(new THREE.Vector3(-d * 0.16, -0.05, (v.sol ? 1 : -1) * 0.10)).lerp(v.hedef, u); yaw = THREE.MathUtils.lerp(d * 0.55, -d * 0.15, u); roll = THREE.MathUtils.lerp(d * 0.10, -d * 0.12, u); }
        else if (lt < 0.22) { const u = sm(lt / 0.22); pos = v.hedef.clone().lerp(ileri, u); yaw = THREE.MathUtils.lerp(-d * 0.15, -d * 0.75, u); roll = THREE.MathUtils.lerp(-d * 0.12, -d * 0.35, u); }
        else { const u = sm((lt - 0.22) / 0.53); pos = ileri.lerp(hazir, u); yaw = THREE.MathUtils.lerp(-d * 0.75, 0, u); roll = THREE.MathUtils.lerp(-d * 0.35, 0, u); }
        v.p.position.copy(pos);
        v.p.quaternion.copy(q0).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
      }
      if (!passed && tt >= tGecis) { passed = true; onPass && onPass(); }
    },
    end() { ball.material.opacity = 1; vuruslar.forEach((v) => raketHazir(v.p, v.sol)); topDinlen(T); },
  };
}

// Adım listesini sırayla oynatan makine
function makine(T, adimlar, onEnd) {
  let i = 0, t0 = null;
  T.anim = (now) => {
    if (t0 === null) t0 = now;
    let a = adimlar[i]; if (!a) { T.anim = null; onEnd && onEnd(); return; }
    let tt = (now - t0) / 1000;
    while (a && tt >= a.dur) { a.end && a.end(); t0 += a.dur * 1000; i++; a = adimlar[i]; tt = (now - t0) / 1000; }
    if (!a) { T.anim = null; onEnd && onEnd(); return; }
    a.run(tt);
  };
}

// Bir MAÇ (21'lik set): montaj -> kısa ralli (rakip alır) -> kısa ralli (maç sayısı) -> tam ralli (maç) -> kutlama
function macOynat(T, winIsA, onDone, hizli) {
  const r = Math.random();
  const lFinal = r < 0.08 ? 20 : Math.max(5, Math.min(19, Math.round(9 + Math.random() * 10 + (Math.random() - 0.5) * 6)));
  const wFinal = lFinal === 20 ? 22 : 21;
  const W = () => winIsA ? "a" : "b", Lo = () => winIsA ? "b" : "a";
  const sk = { a: 0, b: 0, etiket: "MAÇ" };
  const set = (w, l) => { sk[W()] = w; sk[Lo()] = l; };
  const wBas = Math.max(0, wFinal - 3 - Math.floor(Math.random() * 6)), lBas = Math.max(0, lFinal - 1 - Math.floor(Math.random() * 5));
  set(wBas, lBas); T.mac = sk; tabelaCiz(T);
  const adimlar = [];
  // 1) montaj: sayılar hızla akar
  const mDur = hizli ? 0.7 : 1.1; let sonTik = -1;
  adimlar.push({ dur: mDur, run(tt) {
    const u = sm(tt / mDur);
    const w = Math.round(THREE.MathUtils.lerp(wBas, wFinal - 2, u)), l = Math.round(THREE.MathUtils.lerp(lBas, lFinal - 1, u));
    const tik = w + l; if (tik !== sonTik) { sonTik = tik; sesCal("masa", 0.5); set(w, l); sk.etiket = "MAÇ SÜRÜYOR"; tabelaCiz(T); }
  }, end() { set(wFinal - 2, lFinal - 1); tabelaCiz(T); } });
  if (!hizli) {
    // 2) rakip bir sayı alır
    const r1 = ralliKur(T, !winIsA, true, () => { set(wFinal - 2, lFinal); sk.etiket = "MAÇ SÜRÜYOR"; tabelaCiz(T); });
    adimlar.push(r1);
    // 3) kazanan maç sayısına gelir
    const r2 = ralliKur(T, winIsA, true, () => { set(wFinal - 1, lFinal); sk.etiket = "MAÇ SAYISI"; tabelaCiz(T); });
    adimlar.push(r2);
  } else { set(wFinal - 1, lFinal); sk.etiket = "MAÇ SAYISI"; tabelaCiz(T); }
  // 4) maç sayısı: tam ralli
  const r3 = ralliKur(T, winIsA, false, () => {
    set(wFinal, lFinal); sk.etiket = "MAÇ"; sk.bitti = true; tabelaCiz(T); dudukCal();
    onDone && onDone({ w: wFinal, l: lFinal });
  });
  adimlar.push(r3);
  // 5) kutlama: kazanan raketi kaldırır, kaybeden düşürür
  const pW = winIsA ? T.pA : T.pB, pL = winIsA ? T.pB : T.pA;
  adimlar.push({ dur: 1.1, run(tt) {
    const u = Math.min(1, tt / 1.1), yukari = Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.28;
    raketHazir(pW, winIsA); pW.position.y += yukari + Math.sin(tt * 26) * 0.02 * (1 - u);
    raketHazir(pL, !winIsA); pL.position.y -= 0.16 * sm(u * 2); pL.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), (winIsA ? -1 : 1) * 0.9 * sm(u * 2));
  }, end() { raketHazir(pW, winIsA); raketHazir(pL, !winIsA); T.mac = null; tabelaCiz(T); } });
  makine(T, adimlar, () => { const q = T.kuyruk && T.kuyruk.shift(); if (q) macOynat(T, q.winIsA, q.onDone, true); });
}

// Dış API: her çağrı bir maç. Tablo meşgulse kuyruğa girer (kuyruktakiler hızlı modda oynar).
function rally(key, winIsA, onDone, sessiz) {
  const T = st.tables.get(key); if (!st.ok || !T || !T.ball) return false;
  if (AZ_HAREKET) { onDone && onDone({ w: 21, l: 15 }); return true; }
  if (sessiz) { if (T.anim) return false; makine(T, [ralliKur(T, winIsA, Math.random() < 0.5, null, true)]); return true; }
  if (T.anim) { (T.kuyruk = T.kuyruk || []).push({ winIsA, onDone }); return true; }
  macOynat(T, winIsA, onDone, false);
  return true;
}

/* ================= konuşma balonu ================= */
function bubble(key, loserIsA, text) {
  const T = st.tables.get(key); if (!T) return;
  const c = T.bubCanvas, g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height);
  g.font = "500 44px 'DM Mono', monospace"; const tw = Math.min(c.width - 60, g.measureText(text).width + 60);
  const x0 = (c.width - tw) / 2;
  g.fillStyle = "rgba(6,9,12,.93)"; rr(g, x0, 22, tw, 110, 26); g.fill();
  g.strokeStyle = "rgba(255,255,255,.25)"; g.lineWidth = 3; rr(g, x0, 22, tw, 110, 26); g.stroke();
  g.beginPath(); g.moveTo(c.width/2 - 18, 130); g.lineTo(c.width/2 + 18, 130); g.lineTo(c.width/2, 162); g.closePath(); g.fillStyle = "rgba(6,9,12,.93)"; g.fill();
  g.fillStyle = "#f4f7f8"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, c.width / 2, 78, tw - 40);
  T.bubTex.needsUpdate = true;
  const p = loserIsA ? T.pA : T.pB;
  T.bub.position.set(p.position.x, H + 0.62, p.position.z); T.bub.scale.set(1.2 * (tw / c.width) * 1.6 + 0.3, 0.32, 1);
  T.bubT = performance.now();
}

/* ================= ses ================= */
function sesHazirla() {
  if (st.ses || !window.AudioContext) return;
  try { st.ses = new AudioContext(); } catch (e) {}
}
function sesCal(tur, kazanc) {
  if (!st.sesAcik || !st.ses) return;
  const a = st.ses, t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain();
  if (tur === "raket") { o.frequency.setValueAtTime(760, t); o.frequency.exponentialRampToValueAtTime(240, t + 0.06); g.gain.setValueAtTime(0.22 * kazanc, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09); }
  else { o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.03); g.gain.setValueAtTime(0.12 * kazanc, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); }
  o.type = "sine"; o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.1);
}
function dudukCal() {
  if (!st.sesAcik || !st.ses) return;
  const a = st.ses, t = a.currentTime;
  [[880, 0], [1320, 0.13]].forEach(([f, d]) => {
    const o = a.createOscillator(), g = a.createGain(); o.type = "triangle"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.16, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.16);
    o.connect(g); g.connect(a.destination); o.start(t + d); o.stop(t + d + 0.18);
  });
}
function sound(on) { st.sesAcik = !!on; if (on) sesHazirla(); }

/* ================= etkileşim ================= */
function etkilesim() {
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  st.canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; sesHazirla(); });
  st.canvas.addEventListener("pointerup", (e) => {
    if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = performance.now() - down.t; down = null;
    if (Math.hypot(dx, dy) > 12 || dt > 600) return;
    const r = st.canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, st.camera);
    const hits = ray.intersectObjects([...st.tables.values()].flatMap((T) => [T.hit, T.board, T.pA, T.pB]), true);
    if (!hits.length) return;
    const o = hits[0].object, ud = o.userData;
    if (!st.view) { const k = ud.key; if (k) emit("pick", k); return; }
    if (ud.hit === "raket" && ud.key === st.view) emit("paddle", { key: ud.key, side: ud.side });
    else if ((ud.hit === "masa" || ud.hit === "tabela") && ud.key !== st.view) emit("pick", ud.key);
  });
  addEventListener("resize", () => { st.needsFit = true; });
}

/* ================= döngü ================= */
function dongu(now) {
  requestAnimationFrame(dongu); st.frames++;
  try { adim(now); } catch (e) { if (!st.err) { st.err = String(e && e.stack || e); console.error("salon:", e); } }
}
function adim(now, zorla) {
  if (!zorla && document.hidden) return;
  const w = Math.max(1, st.sanal ? st.sanal.w : innerWidth), h = Math.max(1, st.sanal ? st.sanal.h : innerHeight);
  if (w !== st.w || h !== st.h || st.needsFit) {
    st.w = w; st.h = h; st.needsFit = false;
    st.renderer.setSize(w, h, false); st.composer.setSize(w, h); if (st.ao) st.ao.setSize(w, h);
    st.camera.aspect = w / h; st.camera.updateProjectionMatrix();
    kameraSabitle(st.view || "wide");
  }
  st.tables.forEach((T) => {
    const tabelaHedef = (!st.view || (st.view === T.key && T.mac)) ? 1 : 0;
    T.board.material.opacity += (tabelaHedef - T.board.material.opacity) * 0.08;
    T.board.visible = T.board.material.opacity > 0.02;
    if (T.anim) T.anim(now);
    if (T.bubT) { const k = (now - T.bubT) / 2800; T.bub.material.opacity = k < 0.1 ? k * 10 : k > 0.8 ? Math.max(0, 1 - (k - 0.8) * 5) : 1; T.bub.position.y = H + 0.62 + Math.min(1, k) * 0.05; if (k >= 1) { T.bubT = 0; T.bub.material.opacity = 0; } }
  });
  // ambiyans: geniş görünümde ara sıra boş masalarda antrenman rallisi
  if (!AZ_HAREKET && !st.view && now - st.sonAmbiyans > 6500 + Math.random() * 4000) {
    st.sonAmbiyans = now;
    const bos = [...st.tables.values()].filter((T) => !T.anim);
    if (bos.length) { const T = bos[Math.floor(Math.random() * bos.length)]; rally(T.key, Math.random() < 0.5, null, true); }
  }
  kameraGuncelle(now);
  st.composer.render();
}
SALON._step = (t) => adim(t || performance.now(), true);
// teşhis: sanal viewport (portre testi için) — null geçilirse gerçek pencereye döner
SALON._fit = (w, h) => { st.sanal = (w && h) ? { w, h } : null; st.needsFit = true; };
SALON.ready = kur().catch((e) => { console.warn("salon kurulamadı:", e); return false; });
