/* Accessory Editor — tweak, assign and create NPC accessories in 3D. */
import * as THREE from './three.module.js';
import { GLTFLoader } from './GLTFLoader.js';
import { ACCESSORY_DEFS, DEFAULT_LOADOUT, SLOT_LABEL, getDef, buildAccessory } from './accessory-library.js';
import { attachLivingFace } from './living-faces.js';

const MANIFEST_URL = 'https://raw.githubusercontent.com/Kmberry1989/selsocsoc/main/assets/npc/manifest.json';
const SKIN = {
  'mayor-mayor':13209446,'gideon':11567710,'lyla-lens':12155224,'chip-chance':10119242,
  'barnaby-bargain':13671024,'pip-parade':13142373,'agnes-alley':11171419,'dottie-daly':14724482,
  'peggy-plank':12024663,'mr-buck-coinsworth':14197369,'fern-bramble':9658950,
  'stanley-stamp':12946278,'bobby-gill':12092257,
};
// Roster unification 2026-10-27: offline fallback now uses the current
// v2 files and the canonical manifest names (previously base face PNGs
// and id-derived names like "Mr-Buck-Coinsworth", and a wrong outfit name).
const FALLBACK_NAMES = {
  'mayor-mayor':'Mayor Mayor','gideon':'Gideon','lyla-lens':'Lyla Lens','chip-chance':'Chip Chance',
  'barnaby-bargain':'Barnaby Bargain','pip-parade':'Pip Parade','agnes-alley':'Agnes Alley','dottie-daly':'Dottie Daly',
  'peggy-plank':'Peggy Plank','mr-buck-coinsworth':'Mr. Buck Coinsworth','fern-bramble':'Fern Bramble',
  'stanley-stamp':'Stanley Stamp','bobby-gill':'Bobby Gill',
};
const FALLBACK_NPCS = Object.keys(SKIN).map(id => ({
  id, name: FALLBACK_NAMES[id] || id,
  faceUrl: `assets/npc-faces/npc-${id}-face-v2.png`,
  outfitUrl: `assets/npc-outfits/npc-${id}-outfit-v2.png`,
}));
const ASSET_BASE = 'https://raw.githubusercontent.com/Kmberry1989/selsocsoc/main/';

/* ---------- real game GLBs ---------- */
// The shipped accessories are real game GLBs (assets/accessories/,
// byte-identical copies of selsocsoc assets/npc-accessories/*.glb),
// loaded with the game's own vendored GLTFLoader (root GLTFLoader.js
// + utils/, import paths adapted to this repo's flat layout).
// A def counts as "shipped" only if it is byte-for-byte the starter
// def (JSON-equal to ACCESSORY_DEFS): user edits and custom copies
// are drafts, and their procedural build is still shown so editing
// feedback is not lost. A shipped def is never shown procedurally.
const glbLoader = new GLTFLoader();
const glbCache = new Map(); // id -> Promise<Group>
function isShipped(def) {
  const orig = ACCESSORY_DEFS.find(d => d.id === def.id);
  return !!orig && JSON.stringify(orig) === JSON.stringify(def);
}
function loadAccessoryGLB(def) {
  if (!glbCache.has(def.id)) {
    const local = 'assets/accessories/' + def.id + '.glb';
    const remote = ASSET_BASE + 'assets/npc-accessories/' + def.id + '.glb';
    glbCache.set(def.id, new Promise((resolve, reject) => {
      glbLoader.load(local, (gltf) => resolve(gltf.scene),
        undefined,
        () => glbLoader.load(remote, (gltf) => resolve(gltf.scene), undefined, reject));
    }));
  }
  return glbCache.get(def.id);
}
let accToken = 0; // incremented per rebuild; stale async GLB loads are discarded

const $ = id => document.getElementById(id);
let npcs = [], npcId = 'mayor-mayor', assetBase = ASSET_BASE;
let living = null; // living-face handle for the previewed NPC (mouth + blinking)
let library = structuredClone(ACCESSORY_DEFS);
let loadout = structuredClone(DEFAULT_LOADOUT);
let activeSlot = 'hand', editingId = null, editingPart = -1;
let charPreview = false; // the accessory itself is the subject; the character is only a fit check
let viewCenter = new THREE.Vector3(0, 0.4, 0);

// saved work
try {
  const s = JSON.parse(localStorage.getItem('accEditor') || '{}');
  if (Array.isArray(s.library)) library = s.library;
  if (s.loadout) loadout = s.loadout;
} catch {}
function save() {
  localStorage.setItem('accEditor', JSON.stringify({ library, loadout }));
}

/* ---------- 3D ---------- */
const canvas = $('preview');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
camera.position.set(0, 1.7, 5.2);
camera.lookAt(0, 1.0, 0);
scene.add(new THREE.HemisphereLight(0xdfeaf2, 0x2a3430, 0.95));
const key = new THREE.DirectionalLight(0xffffff, 1.7);
key.position.set(3, 6, 4); key.castShadow = true; scene.add(key);
const rimL = new THREE.DirectionalLight(0x9fc3ff, 0.6);
rimL.position.set(-4, 3, -3); scene.add(rimL);
const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 40),
  new THREE.MeshStandardMaterial({ color: 0x232b36, roughness: 0.95 }));
ground.rotation.x = -Math.PI/2; ground.receiveShadow = true; scene.add(ground);
const rig = new THREE.Group(); scene.add(rig);

let dragging = false, lastX = 0, lastY = 0, dist = 5.2, spin = true;
canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; spin = false; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  rig.rotation.y += (e.clientX - lastX) * 0.012;
  camera.position.y = Math.max(0.4, Math.min(4, camera.position.y - (e.clientY - lastY) * 0.01));
  camera.lookAt(viewCenter);
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointerup', () => dragging = false);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  dist = Math.max(2.5, Math.min(9, dist + e.deltaY * 0.005));
  const d = camera.position.clone().sub(viewCenter).normalize().multiplyScalar(dist);
  camera.position.copy(viewCenter.clone().add(d));
}, { passive: false });

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');
const texCache = {};
function tex(url) {
  if (!texCache[url]) {
    const t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    texCache[url] = t;
  }
  return texCache[url];
}

// Game anchors, ported from selsocsoc assets/npc-roster.js (roster
// builder tQ): HeldItemSlot is a child of the right HandSlot
// (0.46, 0.68, 0) at local (0, -0.04, 0.14), i.e. (0.46, 0.64, 0.14)
// in NPC-root coords; the game attaches props with slot.add(prop), so
// the prop group origin sits exactly on the slot. HeadAccessorySlot is
// a child of the Head group (y 1.66) at local (0, 0.27, 0), i.e.
// (0, 1.93, 0). Previous positions (0.50, 0.72, 0.12) and y 2.00 were
// editor-invented.
// GAP (real assets only): the game roster has no left HeldItemSlot and
// no back slot, and no code attaching cane.glb or cape.glb was found in
// readable game code — so handL/back are left out of this table (the
// fit-check loop below iterates these keys, so those items are not
// rendered on the character) and the caption labels them unavailable,
// rather than placing them at an invented anchor. The standalone
// accessory view (rebuildAccessory) is unaffected: it shows the
// accessory itself, centred, with no anchor involved.
const SLOT_ANCHOR = {
  hand:  [0.46, 0.64, 0.14],
  head:  [0, 1.93, 0],
};

function npcById(id) { return npcs.find(n => n.id === id) || FALLBACK_NPCS.find(n => n.id === id); }

function rebuild() {
  if (charPreview) rebuildCharacter();
  else rebuildAccessory();
  resize();
}

// The accessory itself, big and centered: auto-framed on the ground,
// the part being edited highlighted. No character in the way.
function rebuildAccessory() {
  while (rig.children.length) rig.children.pop();
  living = null;
  const def = library.find(d => d.id === editingId) || library.find(d => d.slot === activeSlot) || library[0];
  if (!def) { $('previewCaption').innerHTML = 'No accessory'; return; }
  // Shipped accessory: show the real game GLB, centred, auto-framed.
  // (No procedural stand-in: a failed GLB load leaves the view empty
  // with a warning, it does not fall back to a fake.)
  if (isShipped(def)) {
    const token = ++accToken;
    $('previewCaption').innerHTML = def.name + ' <span>· ' + (SLOT_LABEL[def.slot] || def.slot) + ' · game GLB</span>';
    loadAccessoryGLB(def).then((sceneRoot) => {
      if (token !== accToken) return;
      while (rig.children.length) rig.children.pop();
      const acc = sceneRoot.clone(true);
      acc.traverse(o => { if (o.isMesh) o.castShadow = true; });
      frameAccessory(acc);
    }).catch((err) => {
      if (token !== accToken) return;
      console.warn('Accessory Editor: could not load GLB', def.id, err);
      $('previewCaption').innerHTML = def.name + ' <span>· game GLB failed to load</span>';
    });
    return;
  }
  const acc = buildAccessory(def, THREE);
  // Highlight the part under edit (meshes are added in parts order).
  if (editingPart >= 0 && !def.cape) {
    const meshes = [];
    acc.traverse(o => { if (o.isMesh) meshes.push(o); });
    const m = meshes[editingPart];
    if (m && m.material && m.material.emissive) m.material.emissive.setHex(0x664411);
  }
  frameAccessory(acc, def);
}

// Centre + auto-frame a standalone accessory group (shared by the
// procedural draft path and the async real-GLB path).
function frameAccessory(acc, def) {
  rig.add(acc);
  acc.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(acc);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  acc.position.x -= center.x;
  acc.position.z -= center.z;
  acc.position.y -= box.min.y;
  const h = Math.max(size.y, 0.2);
  const span = Math.max(size.x, size.y, size.z, 0.2);
  viewCenter.set(0, h / 2, 0);
  dist = Math.min(7, Math.max(1.2, span * 1.9));
  camera.position.set(0, h / 2 + 0.3, dist);
  camera.lookAt(viewCenter);
  if (def) {
    $('previewCaption').innerHTML = def.name + ' <span>· ' + (SLOT_LABEL[def.slot] || def.slot) + ' · ' + ((def.parts || []).length + (def.cape ? 1 : 0)) + ' parts · draft preview</span>';
  }
}

// The old character view, kept only as a fit check behind the toggle.
function rebuildCharacter() {
  while (rig.children.length) rig.children.pop();
  const npc = npcById(npcId);
  const g = new THREE.Group();
  const ot = tex(assetBase + npc.outfitUrl);
  ot.wrapS = THREE.RepeatWrapping; ot.offset.x = 0.25;
  const bodyMat = new THREE.MeshStandardMaterial({ map: ot, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.29, 0.54, 8, 20), bodyMat);
  body.position.y = 0.66; body.castShadow = true; g.add(body);
  // Roster unification 2026-10-27: full roster figure in the fit check
  // (previously torso + head only): shoulder disc, hands, box feet.
  const shoulders = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.045, 22), bodyMat);
  shoulders.rotation.x = Math.PI / 2; shoulders.position.y = 0.97; g.add(shoulders);
  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN[npcId] ?? 0xc99a56, roughness: 0.7 });
  for (const side of [-1, 1]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), skinMat);
    hand.position.set(0.46 * side, 0.68, 0); hand.castShadow = true; g.add(hand);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.14, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 }));
    shoe.position.set(0.19 * side, 0.15, 0.045); g.add(shoe);
  }
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.15, 32),
    new THREE.MeshStandardMaterial({ color: SKIN[npcId] ?? 0xc99a56, roughness: 0.7 }));
  head.rotation.x = Math.PI/2; head.position.y = 1.66; head.castShadow = true; g.add(head); // floats above the body, matching the game (was 1.42)
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.30, 40),
    new THREE.MeshBasicMaterial({ map: tex(assetBase + npc.faceUrl), transparent: true }));
  face.position.set(0, 1.66, 0.079); g.add(face);
  living = attachLivingFace(g, npcId); // mouth + blinking, matching the game
  const lo = loadout[npcId] || {};
  const fitToken = ++accToken;
  for (const slot of Object.keys(SLOT_ANCHOR)) {
    const defId = lo[slot];
    if (!defId) continue;
    const def = library.find(d => d.id === defId);
    if (!def) continue;
    // Shipped def: real GLB at the real anchor. Edited draft: the
    // procedural build at the same anchor (it is the user's draft,
    // not presented as the game asset).
    if (isShipped(def)) {
      loadAccessoryGLB(def).then((sceneRoot) => {
        if (fitToken !== accToken) return;
        const acc = sceneRoot.clone(true);
        acc.position.set(...SLOT_ANCHOR[slot]);
        acc.traverse(o => { if (o.isMesh) o.castShadow = true; });
        g.add(acc);
      }).catch((err) => console.warn('Accessory Editor: could not load GLB', def.id, err));
    } else {
      const acc = buildAccessory(def, THREE);
      acc.position.set(...SLOT_ANCHOR[slot]);
      g.add(acc);
    }
  }
  rig.add(g);
  viewCenter.set(0, 1.0, 0);
  dist = 5.2;
  camera.position.set(0, 1.7, 5.2);
  camera.lookAt(viewCenter);
  const missingAnchors = [];
  if (lo.handL) missingAnchors.push('left-hand');
  if (lo.back) missingAnchors.push('back');
  $('previewCaption').innerHTML = (npc ? npc.name : npcId) + ' <span>· wearing the equipped accessories</span>' + (missingAnchors.length ? ' <span>· ' + missingAnchors.join('/') + ' anchor unavailable in the game roster — not shown</span>' : '');
}

(function tick() {
  if (spin) rig.rotation.y += 0.008;
  if (living) living.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
})();

/* ---------- library UI ---------- */
function renderLib() {
  const grid = $('libGrid');
  grid.innerHTML = '';
  library.filter(d => d.slot === activeSlot || activeSlot === 'all').forEach(d => {
    const b = document.createElement('button');
    b.className = 'lib-card' + (d.id === editingId ? ' active' : '');
    b.innerHTML = `<b>${d.name}</b><span>${SLOT_LABEL[d.slot] || d.slot} · ${d.parts.length + (d.cape ? 1 : 0)} parts</span>`;
    b.onclick = () => { editAccessory(d.id); };
    if (charPreview) {
      const eq = document.createElement('span');
      eq.className = 'equip';
      eq.textContent = 'Equip';
      eq.onclick = (e) => { e.stopPropagation(); equip(d.id); };
      b.appendChild(eq);
    }
    grid.appendChild(b);
  });
}

function equip(defId) {
  const def = library.find(d => d.id === defId);
  if (!def) return;
  loadout[npcId] = loadout[npcId] || {};
  loadout[npcId][def.slot] = defId;
  save(); rebuild();
}

function editAccessory(id) {
  editingId = id; editingPart = -1;
  const d = library.find(x => x.id === id);
  $('editSection').hidden = false;
  $('editTitle').textContent = 'Edit: ' + d.name;
  $('accName').value = d.name;
  renderParts(); renderPartEditor(); renderLib();
}

function renderParts() {
  const d = library.find(x => x.id === editingId);
  const list = $('partsList');
  list.innerHTML = '';
  (d.parts || []).forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'part-row' + (i === editingPart ? ' active' : '');
    b.textContent = `${i+1}. ${p.kind}`;
    b.onclick = () => { editingPart = i; renderParts(); renderPartEditor(); };
    list.appendChild(b);
  });
}

const AXES = [['pos',0,'x'],['pos',1,'y'],['pos',2,'z'],['rot',0,'rx'],['rot',1,'ry'],['rot',2,'rz'],['scale',0,'sx'],['scale',1,'sy'],['scale',2,'sz']];
function renderPartEditor() {
  const d = library.find(x => x.id === editingId);
  const p = d && d.parts[editingPart];
  $('partEditor').hidden = !p;
  if (!p) return;
  $('partTitle').textContent = `Part ${editingPart+1} — ${p.kind}`;
  const wrap = $('sliders');
  wrap.innerHTML = '';
  AXES.forEach(([grp, ai, label]) => {
    const row = document.createElement('label');
    row.className = 'slider-row';
    const cur = (p[grp] && p[grp][ai] !== undefined) ? p[grp][ai]
      : (grp === 'scale' ? 1 : 0);
    row.innerHTML = `<span>${label}</span>`;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = grp === 'scale' ? 0.1 : (grp === 'rot' ? -3.14 : -1.5);
    inp.max = grp === 'scale' ? 3 : (grp === 'rot' ? 3.14 : 1.5);
    inp.step = 0.01; inp.value = cur;
    const val = document.createElement('em');
    val.textContent = Number(cur).toFixed(2);
    inp.oninput = () => {
      p[grp] = p[grp] || (grp === 'scale' ? [1,1,1] : [0,0,0]);
      p[grp][ai] = parseFloat(inp.value);
      val.textContent = parseFloat(inp.value).toFixed(2);
      save(); rebuild();
    };
    row.append(inp, val);
    wrap.appendChild(row);
  });
  $('partColor').value = '#' + (p.color ?? 0xffffff).toString(16).padStart(6, '0');
  $('partRough').value = p.roughness ?? 0.6;
}

$('partColor').oninput = e => {
  const d = library.find(x => x.id === editingId);
  const p = d && d.parts[editingPart];
  if (p) { p.color = parseInt(e.target.value.slice(1), 16); save(); rebuild(); }
};
$('partRough').oninput = e => {
  const d = library.find(x => x.id === editingId);
  const p = d && d.parts[editingPart];
  if (p) { p.roughness = parseFloat(e.target.value); save(); rebuild(); }
};
$('delPartBtn').onclick = () => {
  const d = library.find(x => x.id === editingId);
  if (d && editingPart >= 0) { d.parts.splice(editingPart, 1); editingPart = -1; save(); renderParts(); renderPartEditor(); rebuild(); }
};
$('addPartBtn').onclick = () => {
  const d = library.find(x => x.id === editingId);
  if (!d || d.cape) return;
  const kind = $('partKind').value;
  const p = { kind, args: defaultArgs(kind), color: 0xffffff, roughness: 0.6 };
  d.parts.push(p); editingPart = d.parts.length - 1;
  save(); renderParts(); renderPartEditor(); rebuild();
};
function defaultArgs(kind) {
  return { sphere:[0.1,16,12], box:[0.15,0.15,0.15], cylinder:[0.05,0.05,0.2,12],
    cone:[0.06,0.12,12], torus:[0.08,0.015,10,20], circle:[0.1,24] }[kind];
}
$('accName').oninput = e => {
  const d = library.find(x => x.id === editingId);
  if (d) { d.name = e.target.value; save(); renderLib(); }
};
$('dupBtn').onclick = () => {
  const d = library.find(x => x.id === editingId);
  if (!d) return;
  const copy = structuredClone(d);
  copy.id = d.id + '-copy-' + Date.now().toString(36);
  copy.name = d.name + ' copy';
  delete copy.npc;
  library.push(copy); save(); renderLib(); editAccessory(copy.id);
};
$('newAccBtn').onclick = () => {
  const id = 'custom-' + Date.now().toString(36);
  library.push({ id, name: 'New accessory', slot: activeSlot, parts: [] });
  save(); renderLib(); editAccessory(id);
};

$('slotTabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  activeSlot = b.dataset.slot;
  [...$('slotTabs').children].forEach(x => x.classList.toggle('active', x === b));
  renderLib();
});

$('npcSelect').onchange = e => { npcId = e.target.value; spin = true; rebuild(); };
$('charToggle').onchange = e => {
  charPreview = e.target.checked;
  $('npcSelect').hidden = !charPreview;
  spin = true;
  renderLib();
  rebuild();
};
$('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ defs: library, loadout }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'accessory-assets.json';
  a.click();
};

/* ---------- GLB export ---------- */
// Minimal GLB 2.0 writer for a built accessory group: baked world
// transforms, sequential triangles (no indices), one material per
// color/roughness/side. No textures — accessories are flat colors.
function accessoryToGLB(group) {
  group.updateMatrixWorld(true);
  const meshes = [];
  group.traverse(o => { if (o.isMesh) meshes.push(o); });
  if (!meshes.length) return null;
  const binParts = [];
  let byteOffset = 0;
  const bufferViews = [];
  const accessors = [];
  const materials = [];
  const matIndex = new Map();
  const glbMeshes = [];
  const nodes = [];
  const pushView = (bytes) => {
    const view = { buffer: 0, byteOffset, byteLength: bytes.byteLength };
    bufferViews.push(view);
    binParts.push(bytes);
    byteOffset += bytes.byteLength;
    return bufferViews.length - 1;
  };
  for (const mesh of meshes) {
    let geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (geo.index) geo = geo.toNonIndexed();
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    if (!pos || !nor) continue;
    const posView = pushView(new Float32Array(pos.array));
    const norView = pushView(new Float32Array(nor.array));
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.count; i++) {
      for (let a = 0; a < 3; a++) {
        const v = pos.getComponent(i, a);
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
    const posAcc = accessors.length;
    accessors.push({ bufferView: posView, componentType: 5126, count: pos.count, type: 'VEC3', min, max });
    const norAcc = accessors.length;
    accessors.push({ bufferView: norView, componentType: 5126, count: nor.count, type: 'VEC3' });
    const mat = mesh.material;
    const col = mat.color ? [mat.color.r, mat.color.g, mat.color.b, 1] : [1, 1, 1, 1];
    const key = col.join(',') + '|' + (mat.roughness ?? 0.6) + '|' + (mat.metalness ?? 0.05) + '|' + (mat.side ?? 0);
    let mi = matIndex.get(key);
    if (mi === undefined) {
      mi = materials.length;
      matIndex.set(key, mi);
      const m = {
        pbrMetallicRoughness: {
          baseColorFactor: col,
          metallicFactor: mat.metalness ?? 0.05,
          roughnessFactor: mat.roughness ?? 0.6
        }
      };
      if (mat.side === THREE.DoubleSide) m.doubleSided = true;
      materials.push(m);
    }
    const meshIndex = glbMeshes.length;
    glbMeshes.push({ primitives: [{ attributes: { POSITION: posAcc, NORMAL: norAcc }, material: mi }] });
    nodes.push({ mesh: meshIndex, name: mesh.name || 'part' });
  }
  if (!nodes.length) return null;
  const binLength = byteOffset;
  const bin = new Uint8Array(binLength);
  let at = 0;
  for (const part of binParts) { bin.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), at); at += part.byteLength; }
  const json = JSON.stringify({
    asset: { version: '2.0', generator: 'selsocsoc-accessory-editor' },
    scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes: glbMeshes, materials,
    accessors, bufferViews, buffers: [{ byteLength: binLength }]
  });
  const jsonBytes = new TextEncoder().encode(json);
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (binLength % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + binLength + binPad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length + jsonPad, true);
  dv.setUint32(16, 0x4E4F534A, true); // 'JSON'
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
  const binStart = 20 + jsonBytes.length + jsonPad;
  dv.setUint32(binStart, binLength + binPad, true);
  dv.setUint32(binStart + 4, 0x004E4942, true); // 'BIN'
  out.set(bin, binStart + 8);
  return out;
}

$('glbBtn').onclick = async () => {
  const def = library.find(d => d.id === editingId) ||
    library.find(d => d.slot === activeSlot);
  if (!def) { alert('Pick or equip an accessory first.'); return; }
  // Shipped accessory: hand back the real game GLB, not a procedural
  // re-export of it.
  if (isShipped(def)) {
    try {
      const res = await fetch('assets/accessories/' + def.id + '.glb');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = def.id + '.glb';
      a.click();
      return;
    } catch (err) { console.warn('Falling back to procedural GLB export', err); }
  }
  const group = buildAccessory(def, THREE);
  const glb = accessoryToGLB(group);
  if (!glb) { alert('Nothing to export in this accessory.'); return; }
  const blob = new Blob([glb], { type: 'model/gltf-binary' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = def.id + '.glb';
  a.click();
  alert('GLB exported. Drop it in the game under assets/npc-accessories/ and point that NPC\'s accessoryGlb at it in assets/npc/manifest.json.');
};
$('resetBtn').onclick = () => {
  if (!confirm('Reset all edits to the starter assets?')) return;
  library = structuredClone(ACCESSORY_DEFS);
  loadout = structuredClone(DEFAULT_LOADOUT);
  localStorage.removeItem('accEditor');
  editingId = null; editingPart = -1;
  $('editSection').hidden = true;
  renderLib(); rebuild();
};

/* ---------- npcs ---------- */
async function loadNPCs() {
  try {
    const res = await fetch(MANIFEST_URL + '?t=' + Date.now(), { cache: 'no-store' });
    const data = await res.json();
    if (Array.isArray(data.characters) && data.characters.length) {
      npcs = data.characters;
      assetBase = data.assetBase || ASSET_BASE;
    } else throw 0;
  } catch { npcs = FALLBACK_NPCS; }
  const sel = $('npcSelect');
  sel.innerHTML = '';
  npcs.forEach(n => {
    const o = document.createElement('option');
    o.value = n.id; o.textContent = n.name || n.id;
    sel.appendChild(o);
  });
  if (!npcs.find(n => n.id === npcId)) npcId = npcs[0].id;
  sel.value = npcId;
  rebuild();
}

renderLib();
// Open on the accessory itself, not a character: the first accessory is
// selected for editing, so the preview and the edit panel show it at once.
if (library.length && !editingId) editAccessory(library[0].id);
loadNPCs();
