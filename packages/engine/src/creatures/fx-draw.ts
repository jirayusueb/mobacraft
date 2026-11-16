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

export const createFxDraw = () => {
  // --- gem: faceted orb, bright facets toward the camera ------------------------
  const gems = makeBatch(
    new IcosahedronGeometry(1, 0),
    glowMaterial((c) => c.mul(float(0.45).add(abs(normalView.z).mul(0.75)))),
    CAP.gem,
    false,
  )

  // --- streak: hex prism y 0..1, wide head at y=1; fxParam = tail fade (0 flat, 1 strong) ---
  const streakGeo = new CylinderGeometry(1, 0.3, 1, 6, 1, true).translate(0, 0.5, 0)
  const streaks = makeBatch(
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
  const decals = makeBatch(
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
  const crescents = makeBatch(
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
  const domes = makeBatch(
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
  const smokes = makeBatch(new IcosahedronGeometry(1, 0), smokeMat, CAP.smoke, false)
  smokes.mesh.castShadow = false
  smokes.mesh.receiveShadow = false

  const batches = [gems, streaks, decals, crescents, domes, smokes] as const

  // Camera basis (world), captured during render; used for billboard-ish placement.
  const camRight = new Vector3(1, 0, 0)
  const camBack = new Vector3(0, 0, 1)
  const track = (_r: unknown, _s: unknown, camera: Camera) => {
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
    camBack.set(0, 0, 1).applyQuaternion(camera.quaternion)
  }
  for (const b of batches) b.mesh.onBeforeRender = track

  const m = new Matrix4()
  const q = new Quaternion()
  const e = new Euler()
  const p = new Vector3()
  const s = new Vector3()
  const d = new Vector3()
  const UP = new Vector3(0, 1, 0)

  const put = (b: Batch, r: number, g: number, bl: number, k: number, param: number) => {
    const i = b.n++
    b.mesh.setMatrixAt(i, m.compose(p, q, s))
    const o = i * 3
    b.color[o] = r * k
    b.color[o + 1] = g * k
    b.color[o + 2] = bl * k
    if (b.param) b.param.array[i] = param
  }

  return {
    meshes: batches.map((b) => b.mesh),
    camRight,
    camBack,
    begin: () => {
      for (const b of batches) b.n = 0
    },
    end: () => {
      for (const b of batches) {
        b.mesh.count = b.n
        if (b.n === 0) continue
        b.mesh.instanceMatrix.needsUpdate = true
        b.mesh.instanceColor!.needsUpdate = true
        if (b.param) b.param.needsUpdate = true
      }
    },
    /** Faceted gem; `squash` scales y; `spin` is a tumble angle. */
    gem: (
      x: number,
      y: number,
      z: number,
      size: number,
      spin: number,
      c: Color,
      k: number,
      squash = 1,
    ) => {
      if (gems.n >= gems.cap || size <= 0.001 || k <= 0.002) return
      p.set(x, y, z)
      q.setFromEuler(e.set(spin * 0.7, spin, spin * 0.3))
      s.set(size, size * squash, size)
      put(gems, c.r, c.g, c.b, k, 0)
    },
    /** Prism from tail (a) to head (b); `fade` 0 = uniform, 1 = bright head / dark tail. */
    streak: (
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
    ) => {
      if (streaks.n >= streaks.cap || width <= 0.001 || k <= 0.002) return
      d.set(bx - ax, by - ay, bz - az)
      const len = d.length()
      if (len < 1e-4) return
      q.setFromUnitVectors(UP, d.divideScalar(len))
      p.set(ax, ay, az)
      s.set(width, len, width)
      put(streaks, c.r, c.g, c.b, k, fade)
    },
    /** Ground disc / ring; `ring` = band width as a fraction of radius (1 = filled). */
    decal: (x: number, y: number, z: number, radius: number, ring: number, c: Color, k: number) => {
      if (decals.n >= decals.cap || radius <= 0.001 || k <= 0.002) return
      p.set(x, y, z)
      q.identity()
      s.set(radius, 1, radius)
      put(decals, c.r, c.g, c.b, k, ring)
    },
    /** Crescent arc; yaw faces its centre, roll tilts it; `sweep` 0..1.6 reveals it. */
    crescent: (
      x: number,
      y: number,
      z: number,
      radius: number,
      yaw: number,
      roll: number,
      sweep: number,
      c: Color,
      k: number,
    ) => {
      if (crescents.n >= crescents.cap || k <= 0.002) return
      p.set(x, y, z)
      q.setFromEuler(e.set(0, yaw, roll, "YXZ"))
      e.order = "XYZ"
      s.set(radius, 1, radius)
      put(crescents, c.r, c.g, c.b, k, sweep)
    },
    /** Hemisphere shield; `band` = scan-band height 0..1. */
    dome: (x: number, y: number, z: number, radius: number, band: number, c: Color, k: number) => {
      if (domes.n >= domes.cap || radius <= 0.001 || k <= 0.002) return
      p.set(x, y, z)
      q.identity()
      s.set(radius, radius * 0.92, radius)
      put(domes, c.r, c.g, c.b, k, band)
    },
    /** Opaque smoke puff (shrinks to vanish). */
    smoke: (x: number, y: number, z: number, size: number, spin: number, c: Color) => {
      if (smokes.n >= smokes.cap || size <= 0.005) return
      p.set(x, y, z)
      q.setFromEuler(e.set(spin, spin * 1.3, 0))
      s.set(size, size * 0.85, size)
      put(smokes, c.r, c.g, c.b, 1, 0)
    },
    dispose: () => {
      for (const b of batches) {
        b.mesh.geometry.dispose()
        ;(b.mesh.material as Material).dispose()
        b.mesh.dispose()
      }
    },
  }
}

export type FxDraw = ReturnType<typeof createFxDraw>
