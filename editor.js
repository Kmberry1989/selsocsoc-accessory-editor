/* Accessory Editor — tweak, assign and create NPC accessories in 3D. */
import * as THREE from './three.module.js';
import { ACCESSORY_DEFS, DEFAULT_LOADOUT, SLOT_LABEL, getDef, buildAccessory } from './accessory-library.js';

const MANIFEST_URL = 'https://raw.githubusercontent.com/Kmberry1989/selsocsoc/main/assets/npc/manifest.json';
const SKIN = {
  'mayor-mayor':13209446,'gideon':11567710,'lyla-lens':12155224,'chip-chance':10119242,
  'barnaby-bargain':13671024,'pip-parade':13142373,'agnes-alley':11171419,'dottie-daly':14724482,
  'peggy-plank':12024663,'mr-buck-coinsworth':14197369,'fern-bramble':9658950,
  'stanley-stamp':12946278,'bobby-gill':12092257,
};
const FALLBACK_NPCS = Object.keys(SKIN).map(id => ({
  id, name: id.split('-').map(w => w[0].toUpperCase()+w.slice(1)).join(' '),
  faceUrl: `assets/npc-faces/npc-${id}-face.png`,
  outfitUrl: `assets/npc-outfits/npc-${id}-v2.png`,
}));
const ASSET_BASE = 'https://raw.githubusercontent.com/Kmberry1989/selsocsoc/main/';

const $ = id => document.getElementById(id);
let npcs = [], npcId = 'mayor-mayor', assetBase = ASSET_BASE;
let library = structuredClone(ACCESSORY_DEFS);
let loadout = structuredClone(DEFAULT_LOADOUT);
let activeSlot = 'hand', editingId = null, editingPart = -1;

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
  camera.lookAt(0, 1.0, 0);
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointerup', () => dragging = false);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  dist = Math.max(2.5, Math.min(9, dist + e.deltaY * 0.005));
  const d = camera.position.clone().sub(new THREE.Vector3(0,1,0)).normalize().multiplyScalar(dist);
  camera.position.copy(new THREE.Vector3(0,1,0).add(d));
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

const SLOT_ANCHOR = {
  hand:  [0.50, 0.72, 0.12],
  handL: [-0.50, 0.72, 0.12],
  head:  [0, 1.76, 0],
  back:  [0, 0, 0],
};

function npcById(id) { return npcs.find(n => n.id === id) || FALLBACK_NPCS.find(n => n.id === id); }

function rebuild() {
  while (rig.children.length) rig.children.pop();
  const npc = npcById(npcId);
  const g = new THREE.Group();
  const ot = tex(assetBase + npc.outfitUrl);
  ot.wrapS = THREE.RepeatWrapping; ot.offset.x = 0.25;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.29, 0.54, 8, 20),
    new THREE.MeshStandardMaterial({ map: ot, roughness: 0.85 }));
  body.position.y = 0.66; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.15, 32),
    new THREE.MeshStandardMaterial({ color: SKIN[npcId] ?? 0xc99a56, roughness: 0.7 }));
  head.rotation.x = Math.PI/2; head.position.y = 1.42; head.castShadow = true; g.add(head);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.30, 40),
    new THREE.MeshBasicMaterial({ map: tex(assetBase + npc.faceUrl), transparent: true }));
  face.position.set(0, 1.42, 0.079); g.add(face);
  const lo = loadout[npcId] || {};
  for (const slot of Object.keys(SLOT_ANCHOR)) {
    const defId = lo[slot];
    if (!defId) continue;
    const def = library.find(d => d.id === defId);
    if (!def) continue;
    const acc = buildAccessory(def, THREE);
    if (slot !== 'back') acc.position.set(...SLOT_ANCHOR[slot]);
    if (slot === 'handL') acc.rotation.z = 0.06;
    g.add(acc);
  }
  rig.add(g);
  renderEquipped();
  resize();
}

function renderEquipped() {
  const lo = loadout[npcId] || {};
  $('equippedBar').innerHTML = Object.keys(SLOT_ANCHOR).map(s => {
    const def = library.find(d => d.id === lo[s]);
    return `<span class="chip">${SLOT_LABEL[s]}: <b>${def ? def.name : '—'}</b></span>`;
  }).join('');
}

(function tick() {
  if (spin) rig.rotation.y += 0.008;
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
    const eq = document.createElement('span');
    eq.className = 'equip';
    eq.textContent = 'Equip';
    eq.onclick = (e) => { e.stopPropagation(); equip(d.id); };
    b.appendChild(eq);
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
$('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ defs: library, loadout }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'accessory-assets.json';
  a.click();
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
loadNPCs();
