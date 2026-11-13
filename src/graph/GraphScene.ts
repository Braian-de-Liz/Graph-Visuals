// Cena Three.js do grafo. Sem React: GraphCanvas apenas a monta.
//
// Desempenho:
// - Nós em um único THREE.Points com shader de brilho (1 draw call).
// - Arestas em um único LineSegments (1 draw call).
// - Seleção por projeção em tela na CPU (sem raycast por instância).
// - Renderização sob demanda: só há quadros enquanto câmera, dados, voo ou
//   pulsação mudam. O movimento ambiente é opcional.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GraphData } from "./types";
import { PALETTE, assignCommunities, familyColor, setLastAssignment } from "./palette";
import { ACTIVITY_TTL } from "../state/activity";

const GOLD = new THREE.Color(PALETTE.visionGold);
const ARC = new THREE.Color(PALETTE.arcLight);
const RED = new THREE.Color(PALETTE.visionRed);
const TITANIUM = new THREE.Color(PALETTE.titanium);
const STARK = new THREE.Color(PALETTE.starkBlue);
// Vermelho clareado para o brilho da atividade secundária sobre o Obsidian.
const RED_GLOW = new THREE.Color("#D2465A");

// Nós: disco suave com borda nítida (sem núcleo branco nem mistura aditiva,
// para o grafo não "estourar" em regiões densas).
// Atividade: aActiveAt = última gravação do arquivo pelo agente (dourado,
// primária); aActive2At = vizinho de um arquivo gravado (vermelho, secundária).
// Profundidade: nós distantes se tingem de Stark Blue e perdem intensidade.
const NODE_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aActiveAt;
attribute float aActive2At;
uniform float uScale;
uniform float uTime;
uniform float uTtl;
uniform vec3 uGold;
uniform vec3 uRed;
uniform vec3 uStark;
uniform vec2 uDepth;
varying vec3 vColor;
varying float vAlpha;
varying float vActive;
float decay(float at) {
  float age = uTime - at;
  return (age >= 0.0 && age < uTtl) ? exp(-age / (uTtl * 0.35)) : 0.0;
}
void main() {
  float act = decay(aActiveAt);
  float act2 = decay(aActive2At) * (1.0 - act);
  float pulse = 0.82 + 0.18 * sin(uTime * 4.0 + aActiveAt);
  vActive = act * pulse + act2 * 0.5;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = aSize * (1.0 + act * 0.9 * pulse + act2 * 0.3);
  gl_PointSize = clamp(size * uScale / max(-mv.z, 0.001), 2.0, 96.0);
  float fog = smoothstep(uDepth.x, uDepth.y, -mv.z) * (1.0 - max(act, act2));
  vec3 base = mix(aColor, uStark * 1.6, fog * 0.6);
  base = mix(base, uRed, min(act2 * 1.2, 1.0));
  vColor = mix(base, uGold, min(act * 1.4, 1.0));
  vAlpha = max(aAlpha * (1.0 - fog * 0.45), max(act, act2));
}`;

const NODE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vActive;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = length(c);
  if (d > 1.0) discard;
  // Nó comum: disco de raio ~0.45 com leve halo.
  float disc = smoothstep(0.62, 0.5, d);
  float halo = exp(-d * d * 6.0) * 0.18;
  // Nó em atividade: brilho amplo.
  float glow = exp(-d * d * 3.0) * vActive * 0.5;
  float a = (disc * 0.9 + halo + glow * 0.9) * vAlpha;
  vec3 col = vColor * (0.8 + disc * 0.3) + vColor * glow * 0.6;
  gl_FragColor = vec4(col, a);
}`;

// Camada luminosa (aditiva) só para nós em atividade: o resto do grafo
// permanece fosco e o arquivo que o agente está gravando realmente brilha.
const GLOW_VERT = /* glsl */ `
attribute float aSize;
attribute float aActiveAt;
attribute float aActive2At;
uniform float uScale;
uniform float uTime;
uniform float uTtl;
varying float vAct;
varying float vAct2;
float decay(float at) {
  float age = uTime - at;
  return (age >= 0.0 && age < uTtl) ? exp(-age / (uTtl * 0.35)) : 0.0;
}
void main() {
  float act = decay(aActiveAt);
  float act2 = decay(aActive2At) * (1.0 - act);
  vAct = act * (0.75 + 0.25 * sin(uTime * 4.0 + aActiveAt));
  vAct2 = act2 * 0.55;
  float any = max(act, act2);
  float scale = act > act2 ? 4.5 : 3.0;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = any > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = any > 0.002 ? clamp(aSize * scale * uScale / max(-mv.z, 0.001), 8.0, 140.0) : 0.0;
}`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uGold;
uniform vec3 uRedGlow;
varying float vAct;
varying float vAct2;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  float glow = exp(-d2 * 6.0) * 0.32 + exp(-d2 * 45.0) * 0.45;
  gl_FragColor = vec4((uGold * vAct + uRedGlow * vAct2) * glow, 1.0);
}`;

const HALO_VERT = /* glsl */ `
uniform float uScale;
uniform float uSize;
uniform float uTime;
uniform float uPulse;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = uSize * (1.0 + uPulse * 0.18 * sin(uTime * 3.2));
  gl_PointSize = clamp(s * uScale / max(-mv.z, 0.001), 10.0, 160.0);
}`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = length(c);
  if (d > 1.0) discard;
  float ring = smoothstep(0.06, 0.0, abs(d - 0.74));
  float glow = exp(-d * d * 4.0) * 0.22;
  gl_FragColor = vec4(uColor, ring * 0.85 + glow);
}`;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const unitHash = (i: number) => (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;

interface Flight {
  start: number;
  duration: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromDist: number;
  toDist: number;
  dir: THREE.Vector3;
  toDir?: THREE.Vector3;
  lift: number;
}

export interface SceneCallbacks {
  onSelect(index: number | null): void;
  onHover(index: number | null, x: number, y: number): void;
  onFocus?(index: number): void;
}

export class GraphScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private frame = 0;
  private resizeObserver: ResizeObserver;

  private nodes?: THREE.Points;
  private nodeMat?: THREE.ShaderMaterial;
  private glow?: THREE.Points;
  private glowMat?: THREE.ShaderMaterial;
  private edges?: THREE.LineSegments;
  private dust?: THREE.Points;
  private core?: THREE.Points;
  private halo: THREE.Points;
  private haloMat: THREE.ShaderMaterial;

  private data?: GraphData;
  private positions: Float32Array = new Float32Array(0);
  private sizes = new Float32Array(0);
  private adjacency: number[][] = [];
  private baseColors = new Float32Array(0);
  private selected: number | null = null;
  private radius = 50;
  private center = new THREE.Vector3();

  private flight: Flight | null = null;
  private pulseUntil = 0;
  private lastActivity = -Infinity;
  private ambient = false;
  private pointerDown = { x: 0, y: 0, t: 0 };
  private hoverPending: { x: number; y: number } | null = null;
  private lastClick = { t: 0, index: -1 };

  constructor(
    private container: HTMLElement,
    private cb: SceneCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Canvas opaco em Obsidian: evita artefatos de composição com camadas aditivas.
    this.renderer.setClearColor(new THREE.Color(PALETTE.obsidian), 1);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20000);
    this.camera.position.set(0, 0, 200);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.9;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener("change", this.requestRender);
    this.controls.addEventListener("start", () => (this.flight = null));

    this.haloMat = new THREE.ShaderMaterial({
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: {
        uScale: { value: 1 },
        uSize: { value: 6 },
        uTime: { value: 0 },
        uPulse: { value: 1 },
        uColor: { value: ARC.clone() },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    const haloGeom = new THREE.BufferGeometry();
    haloGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    this.halo = new THREE.Points(haloGeom, this.haloMat);
    this.halo.visible = false;
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 10;
    this.scene.add(this.halo);

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerleave", () => this.cb.onHover(null, 0, 0));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ---------- ciclo de renderização ----------

  private requestRender = () => {
    if (!this.frame) this.frame = requestAnimationFrame(this.render);
  };

  private render = (now: number) => {
    this.frame = 0;
    let keep = false;
    if (this.flight) keep = this.stepFlight(now) || keep;
    const moving = this.controls.update();
    this.haloMat.uniforms.uTime.value = now / 1000;
    if (this.nodeMat) {
      this.nodeMat.uniforms.uTime.value = now / 1000;
      // Faixa de profundidade do grafo vista da câmera (para o tingimento azul).
      const dist = this.camera.position.distanceTo(this.center);
      (this.nodeMat.uniforms.uDepth.value as THREE.Vector2).set(Math.max(dist - this.radius * 0.2, 0.1), dist + this.radius);
    }
    if (this.halo.visible && now < this.pulseUntil) keep = true;
    else this.haloMat.uniforms.uPulse.value = 0;
    // Enquanto houver arquivos em atividade, o brilho pulsa e se apaga.
    if (now / 1000 - this.lastActivity < ACTIVITY_TTL) keep = true;
    if (this.hoverPending) this.flushHover();
    this.renderer.render(this.scene, this.camera);
    if (moving || keep || this.ambient) this.requestRender();
  };

  private pixelScale(): number {
    const h = this.renderer.domElement.height; // pixels do dispositivo
    return h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const s = this.pixelScale();
    if (this.nodeMat) this.nodeMat.uniforms.uScale.value = s;
    this.haloMat.uniforms.uScale.value = s;
    this.requestRender();
  }

  setAmbient(on: boolean) {
    this.ambient = on;
    this.controls.autoRotate = on;
    this.requestRender();
  }

  // ---------- dados ----------

  setGraph(data: GraphData, positions: Float32Array, keepCamera: boolean, stars?: Float32Array) {
    this.clearGraph();
    this.data = data;
    this.positions = positions;
    const n = data.nodes.length;

    this.adjacency = Array.from({ length: n }, () => []);
    for (const e of data.edges) {
      this.adjacency[e.source].push(e.target);
      this.adjacency[e.target].push(e.source);
    }

    // --- nós ---
    // Comunidades distribuídas entre Gold / Red / Blue na proporção 30:20:20.
    // Hubs (nós principais) em Vision Gold pleno; conceitos (nós especiais)
    // em Vision Red pleno; folhas (grau ≤ 1) mais escuras, dando estrutura.
    this.sizes = new Float32Array(n);
    this.baseColors = new Float32Array(n * 3);
    const color = new THREE.Color();
    const degrees = this.adjacency.map((a) => a.length);
    const sorted = [...degrees].sort((a, b) => b - a);
    const hubCut = Math.max(8, sorted[Math.floor(n * 0.012)] ?? Infinity);
    const commSizes = new Map<number, number>();
    for (const node of data.nodes) {
      const c = node.community ?? -1;
      commSizes.set(c, (commSizes.get(c) ?? 0) + 1);
    }
    const styles = assignCommunities(commSizes);
    setLastAssignment(styles);
    for (let i = 0; i < n; i++) {
      const node = data.nodes[i];
      this.sizes[i] = 2.6 + Math.log2(1 + degrees[i]) * 0.8;
      if (degrees[i] >= hubCut) {
        color.copy(GOLD);
        this.sizes[i] *= 1.2;
      } else if (node.fileType && node.fileType !== "code") {
        color.copy(RED).multiplyScalar(1.25);
      } else {
        familyColor(styles.get(node.community ?? -1)!, color);
        if (degrees[i] <= 1) color.multiplyScalar(0.72);
      }
      color.toArray(this.baseColors, i * 3);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geom.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(this.sizes), 1));
    geom.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n), 1));
    geom.setAttribute("aActiveAt", new THREE.BufferAttribute(new Float32Array(n).fill(-1e6), 1));
    geom.setAttribute("aActive2At", new THREE.BufferAttribute(new Float32Array(n).fill(-1e6), 1));
    geom.computeBoundingSphere();
    this.nodeMat = new THREE.ShaderMaterial({
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      uniforms: {
        uScale: { value: this.pixelScale() },
        uTime: { value: performance.now() / 1000 },
        uTtl: { value: ACTIVITY_TTL },
        uGold: { value: GOLD.clone() },
        uRed: { value: RED_GLOW.clone() },
        uStark: { value: STARK.clone() },
        uDepth: { value: new THREE.Vector2(0, 1) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.nodes = new THREE.Points(geom, this.nodeMat);
    this.nodes.renderOrder = 2;
    this.scene.add(this.nodes);

    this.glowMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: {
        uScale: this.nodeMat.uniforms.uScale,
        uTime: this.nodeMat.uniforms.uTime,
        uTtl: this.nodeMat.uniforms.uTtl,
        uGold: this.nodeMat.uniforms.uGold,
        uRedGlow: this.nodeMat.uniforms.uRed,
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Points(geom, this.glowMat);
    this.glow.renderOrder = 3;
    this.glow.frustumCulled = false;
    this.scene.add(this.glow);

    // --- arestas (cor + alfa por vértice) ---
    const m = data.edges.length;
    const linePos = new Float32Array(m * 6);
    data.edges.forEach((e, k) => {
      linePos.set(positions.subarray(e.source * 3, e.source * 3 + 3), k * 6);
      linePos.set(positions.subarray(e.target * 3, e.target * 3 + 3), k * 6 + 3);
    });
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    lineGeom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(m * 8), 4));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.edges = new THREE.LineSegments(lineGeom, lineMat);
    this.edges.renderOrder = 1;
    this.scene.add(this.edges);

    const sphere = geom.boundingSphere!;
    if (stars) {
      // Visto de cima: enquadra pela maior distância horizontal ao centro.
      this.center.copy(sphere.center);
      let maxR = 10;
      for (let i = 0; i < n; i++)
        maxR = Math.max(maxR, Math.hypot(positions[i * 3] - this.center.x, positions[i * 3 + 2] - this.center.z));
      this.radius = maxR;
    } else {
      this.center.copy(sphere.center);
      this.radius = Math.max(sphere.radius, 10);
    }
    this.buildDust(stars);

    this.selected = null; // GraphCanvas reaplica a seleção pelo id
    this.applyColors();
    if (!keepCamera) this.resetView(false);
    this.requestRender();
  }

  /**
   * Estrelas decorativas (custo fixo, sem animação). Com `stars` do layout,
   * acompanham as comunidades; ficam em Titanium/Stark Blue tênues.
   */
  private buildDust(stars?: Float32Array) {
    let pos = stars;
    if (!pos) {
      const count = 1400;
      pos = new Float32Array(count * 3);
      let seed = 1234567;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < count; i++) {
        const u = rnd() * 2 - 1;
        const t = rnd() * Math.PI * 2;
        const r = this.radius * (2.2 + rnd() * 4);
        const s = Math.sqrt(1 - u * u);
        pos[i * 3] = this.center.x + r * s * Math.cos(t);
        pos[i * 3 + 1] = this.center.y + r * u;
        pos[i * 3 + 2] = this.center.z + r * s * Math.sin(t);
      }
    }
    const count = pos.length / 3;
    const cols = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // variação sutil entre Titanium e Stark Blue (sem dourado: não compete com os nós)
      const t = unitHash(i);
      c.copy(TITANIUM).lerp(STARK, 0.25 + t * 0.5).multiplyScalar(0.75);
      c.toArray(cols, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.5,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    this.dust = new THREE.Points(g, mat);
    this.scene.add(this.dust);
    this.camera.far = this.radius * 30;
    this.camera.updateProjectionMatrix();
  }

  private clearGraph() {
    if (this.glow) {
      this.scene.remove(this.glow); // geometria compartilhada com os nós
      this.glowMat?.dispose();
      this.glow = undefined;
      this.glowMat = undefined;
    }
    for (const obj of [this.nodes, this.edges, this.dust, this.core]) {
      if (!obj) continue;
      this.scene.remove(obj);
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
    this.nodes = this.edges = this.dust = this.core = undefined;
    this.nodeMat = undefined;
  }

  clear() {
    this.clearGraph();
    this.data = undefined;
    this.selected = null;
    this.halo.visible = false;
    this.requestRender();
  }

  // ---------- seleção ----------

  setSelection(index: number | null) {
    if (index === this.selected) return;
    this.selected = index;
    this.applyColors();
  }

  /** Recalcula cores e intensidades de nós e arestas conforme a seleção. */
  private applyColors() {
    if (!this.nodes || !this.edges || !this.data) return;
    const n = this.data.nodes.length;
    const sel = this.selected;
    const near = new Uint8Array(n);
    if (sel !== null) {
      near[sel] = 2;
      for (const j of this.adjacency[sel]) near[j] = Math.max(near[j], 1);
    }
    const colAttr = this.nodes.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const alphaAttr = this.nodes.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const sizeAttr = this.nodes.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const cols = colAttr.array as Float32Array;
    const alphas = alphaAttr.array as Float32Array;
    const sizes = sizeAttr.array as Float32Array;
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.fromArray(this.baseColors, i * 3);
      let a = 0.9;
      let s = this.sizes[i];
      if (sel !== null) {
        if (near[i] === 2) {
          c.copy(ARC);
          a = 1;
          s *= 1.5;
        } else if (near[i] === 1) {
          c.lerp(ARC, 0.45);
          a = 1;
          s *= 1.1;
        } else {
          a = 0.14;
        }
      }
      c.toArray(cols, i * 3);
      alphas[i] = a;
      sizes[i] = s;
    }
    colAttr.needsUpdate = alphaAttr.needsUpdate = sizeAttr.needsUpdate = true;

    // Conexões secundárias em Titanium; conexões em foco em Arc Light.
    const edgeAttr = this.edges.geometry.getAttribute("color") as THREE.BufferAttribute;
    const arr = edgeAttr.array as Float32Array;
    this.data.edges.forEach((e, k) => {
      const incident = sel !== null && (e.source === sel || e.target === sel);
      const src = incident ? ARC : TITANIUM;
      const alpha = incident ? 0.85 : sel !== null ? 0.015 : 0.035;
      for (let end = 0; end < 2; end++) {
        const o = k * 8 + end * 4;
        arr[o] = src.r;
        arr[o + 1] = src.g;
        arr[o + 2] = src.b;
        arr[o + 3] = alpha;
      }
    });
    edgeAttr.needsUpdate = true;

    if (sel !== null) {
      const hp = this.halo.geometry.getAttribute("position") as THREE.BufferAttribute;
      (hp.array as Float32Array).set(this.positions.subarray(sel * 3, sel * 3 + 3));
      hp.needsUpdate = true;
      this.haloMat.uniforms.uSize.value = this.sizes[sel] * 3.2;
      this.haloMat.uniforms.uPulse.value = 1;
      this.halo.visible = true;
      this.pulseUntil = performance.now() + 2600;
    } else {
      this.halo.visible = false;
    }
    this.requestRender();
  }

  /**
   * Marca nós como em atividade no instante `at` (segundos, performance.now()/1000).
   * Os nós gravados recebem a atividade primária (dourado); seus vizinhos
   * diretos, a secundária (vermelho).
   */
  setActivity(indices: number[], at: number) {
    if (!this.nodes || !indices.length) return;
    const attr = this.nodes.geometry.getAttribute("aActiveAt") as THREE.BufferAttribute;
    const attr2 = this.nodes.geometry.getAttribute("aActive2At") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const arr2 = attr2.array as Float32Array;
    const n = arr.length;
    for (const i of indices) {
      if (i >= n) continue;
      arr[i] = Math.max(arr[i], at);
      for (const j of this.adjacency[i] ?? []) arr2[j] = Math.max(arr2[j], at);
    }
    attr.needsUpdate = attr2.needsUpdate = true;
    this.lastActivity = Math.max(this.lastActivity, at);
    this.requestRender();
  }

  // ---------- navegação espacial ----------

  /** Aproxima a câmera de um conjunto de nós, preservando a orientação atual. */
  focusNodes(indices: number[]) {
    if (!this.data || !indices.length) return;
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const i of indices) box.expandByPoint(p.fromArray(this.positions, i * 3));
    const center = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    const fit = Math.max(r, 4) / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    this.flyTo(center, Math.max(fit * 1.15, indices.length === 1 ? 26 : 30));
  }

  resetView(animate = true) {
    // O grafo é um disco visto de cima em ângulo: enquadra pela largura
    // (FOV horizontal), sem deixar a altura projetada sair da tela.
    // Visto de cima: enquadra o grafo pelo menor campo de visão.
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = (this.radius / Math.tan(Math.min(hfov, vfov) / 2)) * 1.0;
    // Quase perpendicular ao disco; a leve inclinação mantém a órbita estável.
    const viewDir = new THREE.Vector3(0, 1, 0.14).normalize();
    if (!animate) {
      this.controls.target.copy(this.center);
      this.camera.position.copy(this.center).addScaledVector(viewDir, dist);
      this.requestRender();
      return;
    }
    this.flyTo(this.center.clone(), dist, viewDir);
  }

  private flyTo(target: THREE.Vector3, distance: number, toDir?: THREE.Vector3) {
    const fromTarget = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(fromTarget);
    const fromDist = offset.length();
    const travel = fromTarget.distanceTo(target);
    this.flight = {
      start: performance.now(),
      duration: THREE.MathUtils.clamp(700 + travel * 4, 900, 1600),
      fromTarget,
      toTarget: target,
      fromDist,
      toDist: distance,
      dir: offset.normalize(),
      toDir: toDir?.clone(),
      // Afastamento no meio do trajeto: sensação de deslocamento pelo espaço.
      lift: Math.min(travel * 0.45, this.radius * 0.8),
    };
    this.requestRender();
  }

  private stepFlight(now: number): boolean {
    const f = this.flight!;
    const t = Math.min((now - f.start) / f.duration, 1);
    const e = easeInOut(t);
    const target = f.fromTarget.clone().lerp(f.toTarget, e);
    const dist = THREE.MathUtils.lerp(f.fromDist, f.toDist, e) + Math.sin(Math.PI * e) * f.lift;
    const dir = f.toDir ? f.dir.clone().lerp(f.toDir, e).normalize() : f.dir;
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    if (t >= 1) this.flight = null;
    return t < 1;
  }

  // ---------- interação ----------

  /** Nó mais próximo do ponteiro em coordenadas de tela, ou null. */
  private pick(clientX: number, clientY: number): number | null {
    if (!this.data) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    this.camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const e = m.elements;
    const scaleCss = rect.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    const pos = this.positions;
    const sizeAttr = this.nodes!.geometry.getAttribute("aSize").array as Float32Array;
    let best: number | null = null;
    let bestD = Infinity;
    const n = this.data.nodes.length;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0.1) continue;
      const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 + 0.5;
      const sy = 0.5 - ((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * 0.5;
      const dx = sx * rect.width - mx;
      const dy = sy * rect.height - my;
      const d2 = dx * dx + dy * dy;
      const rad = Math.max(7, (sizeAttr[i] * scaleCss) / w / 2.4);
      if (d2 > rad * rad) continue;
      const score = d2 + w * 0.01; // empate: o mais próximo da câmera
      if (score < bestD) {
        bestD = score;
        best = i;
      }
    }
    return best;
  }

  private handlePointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private handlePointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Arrastar para orbitar não conta como clique.
    if (Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y) > 4) return;
    const hit = this.pick(e.clientX, e.clientY);
    const now = performance.now();
    if (hit !== null && hit === this.lastClick.index && now - this.lastClick.t < 380) {
      this.focusNodes([hit]);
      this.cb.onFocus?.(hit);
    }
    this.lastClick = { t: now, index: hit ?? -1 };
    this.cb.onSelect(hit);
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (e.buttons !== 0) {
      this.cb.onHover(null, 0, 0);
      return;
    }
    this.hoverPending = { x: e.clientX, y: e.clientY };
    this.requestRender();
  };

  private flushHover() {
    const { x, y } = this.hoverPending!;
    this.hoverPending = null;
    const rect = this.container.getBoundingClientRect();
    this.cb.onHover(this.pick(x, y), x - rect.left, y - rect.top);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearGraph();
    this.halo.geometry.dispose();
    this.haloMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
