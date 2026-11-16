/**
 * FX draw layer — six instanced meshes, one draw call each, written every frame by
 * the effect simulation in fx.ts. Primitives:
 *  - gem      faceted icosahedron (orbs, boulders, sparks, motes, stars, skull)
 *  - streak   tapered hex prism from tail → head (trails, arrows, beams, rain, pillars, plus-bars)
 *  - decal    flat ground disc; per-instance `fxParam` = ring width (1 = filled disc)
 *  - crescent flat tapered arc; per-instance `fxParam` = sweep progress (slashes)
 *  - dome     faceted hemisphere with fresnel rim; `fxParam` = scan-band height (shields)
 *  - smoke    opaque lit faceted puffs (death smoke, siege dust)
 * Glow meshes are additive and write only `emissive` (so bloom picks them up);
 * fades are done by darkening the instance colour (black = invisible).
 * All writers are allocation-free.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three/webgpu"
import type { Camera, Material, Node } from "three/webgpu"
import {
  abs,
  attribute,
  float,
  instanceColor,
  length,
  mix,
  normalView,
  positionGeometry,
  pow,
  smoothstep,
  step,
  uv,
  vec4,
} from "three/tsl"

const CAP = { gem: 900, streak: 420, decal: 160, crescent: 48, dome: 32, smoke: 160 } as const

/** Additive, emissive-only material: colour comes from `shade(instanceColor)`. */
const glowMaterial = (shade: (c: typeof instanceColor) => Node, doubleSided = false): Material => {
  const m = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  if (doubleSided) m.side = DoubleSide
  // Diffuse stays black (instanceColor multiplies it); everything goes through
  // emissive so the selective bloom pass sees it.
  m.colorNode = vec4(0, 0, 0, 1)
  return Object.assign(m, { emissiveNode: shade(instanceColor) })
}

const fxParam = () => attribute("fxParam", "float")

/** Flat tapered crescent in the XZ plane, arc centred on +Z, radius 1. uv.x = along, uv.y = inner→outer. */
const crescentGeometry = (segments = 22, span = Math.PI * 0.95) => {
  const pos: number[] = []
  const uvs: number[] = []
  const nrm: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segments; i++) {
    const u = i / segments
    const a = -span / 2 + u * span
    const thick = 0.42 * Math.sin(Math.PI * u) ** 0.8
    const ri = 1 - thick
    pos.push(Math.sin(a) * ri, 0, Math.cos(a) * ri, Math.sin(a), 0, Math.cos(a))
    uvs.push(u, 0, u, 1)
    nrm.push(0, 1, 0, 0, 1, 0)
    if (i < segments) {
      const b = i * 2
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3))
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2))
  g.setIndex(idx)
  return g
}

interface Batch {
  readonly mesh: InstancedMesh
  readonly color: Float32Array
  readonly param: InstancedBufferAttribute | null
  readonly cap: number
  n: number
}

const black = new Color(0)

const makeBatch = (
  geometry: BufferGeometry,
  material: Material,
  cap: number,
  withParam: boolean,
): Batch => {
  let param: InstancedBufferAttribute | null = null
  if (withParam) {
    param = new InstancedBufferAttribute(new Float32Array(cap), 1)
    param.setUsage(DynamicDrawUsage)
    geometry.setAttribute("fxParam", param)
  }
  const mesh = new InstancedMesh(geometry, material, cap)
  mesh.frustumCulled = false
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  // Prime instanceColor so the material compiles with colour support.
  mesh.setColorAt(0, black)
  const ic = mesh.instanceColor!
  ic.setUsage(DynamicDrawUsage)
  mesh.count = 0
  return { mesh, color: ic.array as Float32Array, param, cap, n: 0 }
}

const UP = new Vector3(0, 1, 0)

const disposeBatch = (b: Batch) => {
  b.mesh.geometry.dispose()
  ;(b.mesh.material as Material).dispose()
  b.mesh.dispose()
}

/** Batched instanced primitives for spell FX; call `begin`, draw, then `end` each frame. */
export class FxDraw {
  readonly meshes: readonly InstancedMesh[]
  /** Camera basis (world), captured during render; used for billboard-ish placement. */
  readonly camRight = new Vector3(1, 0, 0)
  readonly camBack = new Vector3(0, 0, 1)

  readonly #gems: Batch
  readonly #streaks: Batch
  readonly #decals: Batch
  readonly #crescents: Batch
  readonly #domes: Batch
  readonly #smokes: Batch
  readonly #batches: readonly Batch[]

  // Scratch for instance transforms.
  readonly #m = new Matrix4()
  readonly #q = new Quaternion()
  readonly #e = new Euler()
  readonly #p = new Vector3()
  readonly #s = new Vector3()
  readonly #d = new Vector3()

  constructor() {
    // --- gem: faceted orb, bright facets toward the camera ------------------------
    this.#gems = makeBatch(
      new IcosahedronGeometry(1, 0),
      glowMaterial((c) => c.mul(float(0.45).add(abs(normalView.z).mul(0.75)))),
      CAP.gem,
      false,
    )

    // --- streak: hex prism y 0..1, wide head at y=1; fxParam = tail fade (0 flat, 1 strong) ---
    const streakGeo = new CylinderGeometry(1, 0.3, 1, 6, 1, true).translate(0, 0.5, 0)
    this.#streaks = makeBatch(
      streakGeo,
      glowMaterial((c) => {
        const y = positionGeometry.y
        const grad = mix(float(1), y.mul(y), fxParam())
        return c.mul(grad).mul(float(0.65).add(abs(normalView.z).mul(0.5)))
      }, true),
      CAP.streak,
      true,
    )

    // --- decal: ground disc; fxParam = ring width (1 = filled, brighter rim) --------
    this.#decals = makeBatch(
      new CircleGeometry(1, 28).rotateX(-Math.PI / 2),
      glowMaterial((c) => {
        const w = fxParam()
        const r = length(uv().sub(0.5)).mul(2)
        const outer = smoothstep(float(0.99), float(0.9), r)
        const inner = smoothstep(float(1).sub(w).sub(0.1), float(1).sub(w).add(0.04), r)
        const body = mix(float(0.3), float(1), r.mul(r))
        return c.mul(outer.mul(inner).mul(body))
      }, true),
      CAP.decal,
      true,
    )

    // --- crescent: sweep reveal with a bright leading head and outer edge ---------
    this.#crescents = makeBatch(
      crescentGeometry(),
      glowMaterial((c) => {
        const p = fxParam()
        const u = uv().x
        const v = uv().y
        const head = smoothstep(p.sub(0.6), p, u).mul(step(u, p))
        return c.mul(head).mul(mix(float(0.2), float(1.2), v.mul(v)))
      }, true),
      CAP.crescent,
      true,
    )

    // --- dome: flat-faceted hemisphere, fresnel rim + rising scan band -------------
    const domeGeo = new SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed()
    domeGeo.computeVertexNormals()
    this.#domes = makeBatch(
      domeGeo,
      glowMaterial((c) => {
        const rim = pow(float(1).sub(abs(normalView.z)), float(1.6))
        const band = smoothstep(float(0.16), float(0), abs(positionGeometry.y.sub(fxParam())))
        return c.mul(rim.mul(0.85).add(0.08).add(band.mul(0.6)))
      }),
      CAP.dome,
      true,
    )

    // --- smoke: opaque lit puffs, they shrink away instead of fading ---------------
    const smokeMat = new MeshLambertNodeMaterial({ flatShading: true })
    this.#smokes = makeBatch(new IcosahedronGeometry(1, 0), smokeMat, CAP.smoke, false)
    this.#smokes.mesh.castShadow = false
    this.#smokes.mesh.receiveShadow = false

    this.#batches = [
      this.#gems,
      this.#streaks,
      this.#decals,
      this.#crescents,
      this.#domes,
      this.#smokes,
    ]
    this.meshes = this.#batches.map((b) => b.mesh)

    const track = (_r: unknown, _s: unknown, camera: Camera) => {
      this.camRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
      this.camBack.set(0, 0, 1).applyQuaternion(camera.quaternion)
    }
    for (const b of this.#batches) b.mesh.onBeforeRender = track
  }

  begin(): void {
    for (const b of this.#batches) b.n = 0
  }

  end(): void {
    for (const b of this.#batches) {
      b.mesh.count = b.n
      if (b.n === 0) continue
      b.mesh.instanceMatrix.needsUpdate = true
      b.mesh.instanceColor!.needsUpdate = true
      if (b.param) b.param.needsUpdate = true
    }
  }

  /** Faceted gem; `squash` scales y; `spin` is a tumble angle. */
  gem(
    x: number,
    y: number,
    z: number,
    size: number,
    spin: number,
    c: Color,
    k: number,
    squash = 1,
  ): void {
    const b = this.#gems
    if (b.n >= b.cap || size <= 0.001 || k <= 0.002) return
    this.#p.set(x, y, z)
    this.#q.setFromEuler(this.#e.set(spin * 0.7, spin, spin * 0.3))
    this.#s.set(size, size * squash, size)
    this.#put(b, c, k, 0)
  }

  /** Prism from tail (a) to head (b); `fade` 0 = uniform, 1 = bright head / dark tail. */
  streak(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    width: number,
    c: Color,
    k: number,
    fade: number,
  ): void {
    const b = this.#streaks
    if (b.n >= b.cap || width <= 0.001 || k <= 0.002) return
    const d = this.#d.set(bx - ax, by - ay, bz - az)
    const len = d.length()
    if (len < 1e-4) return
    this.#q.setFromUnitVectors(UP, d.divideScalar(len))
    this.#p.set(ax, ay, az)
    this.#s.set(width, len, width)
    this.#put(b, c, k, fade)
  }

  /** Ground disc / ring; `ring` = band width as a fraction of radius (1 = filled). */
  decal(x: number, y: number, z: number, radius: number, ring: number, c: Color, k: number): void {
    const b = this.#decals
    if (b.n >= b.cap || radius <= 0.001 || k <= 0.002) return
    this.#p.set(x, y, z)
    this.#q.identity()
    this.#s.set(radius, 1, radius)
    this.#put(b, c, k, ring)
  }

  /** Crescent arc; yaw faces its centre, roll tilts it; `sweep` 0..1.6 reveals it. */
  crescent(
    x: number,
    y: number,
    z: number,
    radius: number,
    yaw: number,
    roll: number,
    sweep: number,
    c: Color,
    k: number,
  ): void {
    const b = this.#crescents
    if (b.n >= b.cap || k <= 0.002) return
    this.#p.set(x, y, z)
    this.#q.setFromEuler(this.#e.set(0, yaw, roll, "YXZ"))
    this.#e.order = "XYZ"
    this.#s.set(radius, 1, radius)
    this.#put(b, c, k, sweep)
  }

  /** Hemisphere shield; `band` = scan-band height 0..1. */
  dome(x: number, y: number, z: number, radius: number, band: number, c: Color, k: number): void {
    const b = this.#domes
    if (b.n >= b.cap || radius <= 0.001 || k <= 0.002) return
    this.#p.set(x, y, z)
    this.#q.identity()
    this.#s.set(radius, radius * 0.92, radius)
    this.#put(b, c, k, band)
  }

  /** Opaque smoke puff (shrinks to vanish). */
  smoke(x: number, y: number, z: number, size: number, spin: number, c: Color): void {
    const b = this.#smokes
    if (b.n >= b.cap || size <= 0.005) return
    this.#p.set(x, y, z)
    this.#q.setFromEuler(this.#e.set(spin, spin * 1.3, 0))
    this.#s.set(size, size * 0.85, size)
    this.#put(b, c, 1, 0)
  }

  dispose(): void {
    for (const b of this.#batches) disposeBatch(b)
  }

  /** Append one instance with the current scratch transform, colour × `k`, and param. */
  #put(b: Batch, c: Color, k: number, param: number): void {
    const i = b.n++
    b.mesh.setMatrixAt(i, this.#m.compose(this.#p, this.#q, this.#s))
    const o = i * 3
    b.color[o] = c.r * k
    b.color[o + 1] = c.g * k
    b.color[o + 2] = c.b * k
    if (b.param) b.param.array[i] = param
  }
}
