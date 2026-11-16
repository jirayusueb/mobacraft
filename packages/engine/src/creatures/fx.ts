/**
 * Combat FX — pooled, instanced, GPU-faded. Driven by Population FxEvents.
 *  - projectiles: glowing octahedra flying from → to (CPU lerp per frame, ~100 max)
 *  - bursts: expanding emissive rings for aoe / heal / shield / stun / level-up / death / hit
 * Everything is additive emissive so night bloom picks it up.
 */
import type { FxEvent } from "@mobacraft/sim"
import {
  AdditiveBlending,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
} from "three/webgpu"

const PROJ_MAX = 160
const BURST_MAX = 96

const TEAM_TINT: Record<string, number> = { radiant: 0x8affb0, dire: 0xff7a3a, neutral: 0xc8a0ff }
const STYLE_TINT: Record<string, number> = {
  heal: 0x9aff9a,
  shield: 0x9ad8ff,
  stun: 0xfff07a,
  levelup: 0xffd24a,
  death: 0x2a1a2a,
  hit: 0xffffff,
  storm: 0xb8a0ff,
  nova: 0xffa04a,
  beam: 0x9ae0ff,
}

interface Flight {
  from: Vector3
  to: Vector3
  t0: number
  dur: number
  color: Color
  scale: number
}
interface Burst {
  at: Vector3
  t0: number
  dur: number
  radius: number
  color: Color
}

const additive = () =>
  new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexColors: false,
  })

export const createFxLayer = (heightAt: (x: number, z: number) => number) => {
  const group = new Group()
  group.name = "fx"

  const projMesh = new InstancedMesh(new OctahedronGeometry(0.14, 0), additive(), PROJ_MAX)
  projMesh.frustumCulled = false
  projMesh.count = 0
  const burstMesh = new InstancedMesh(
    new RingGeometry(0.75, 1, 28).rotateX(-Math.PI / 2),
    additive(),
    BURST_MAX,
  )
  burstMesh.frustumCulled = false
  burstMesh.count = 0
  group.add(projMesh, burstMesh)

  const flights: Flight[] = []
  const bursts: Burst[] = []
  const m = new Matrix4()
  const q = new Quaternion()
  const p = new Vector3()
  const s = new Vector3()
  const c = new Color()

  const ground = (x: number, z: number) => heightAt(x, z)

  const push = (events: readonly FxEvent[], now: number) => {
    for (const e of events) {
      if (e.kind === "projectile") {
        if (flights.length >= PROJ_MAX) flights.shift()
        const tint =
          e.style === "arrow" || e.style === "siege"
            ? TEAM_TINT[e.team]!
            : (STYLE_TINT[e.style] ?? TEAM_TINT[e.team]!)
        flights.push({
          from: new Vector3(e.from.x, ground(e.from.x, e.from.z) + 0.7, e.from.z),
          to: new Vector3(e.to.x, ground(e.to.x, e.to.z) + 0.55, e.to.z),
          t0: now,
          dur: Math.max(0.08, e.duration),
          color: new Color(tint).multiplyScalar(e.style === "arrow" ? 1.2 : 2.2),
          scale: e.style === "siege" ? 1.8 : e.style === "arrow" ? 0.7 : 1.3,
        })
      } else {
        if (bursts.length >= BURST_MAX) bursts.shift()
        const radius =
          e.kind === "aoe"
            ? e.radius
            : e.kind === "death"
              ? 1.2
              : e.kind === "levelup"
                ? 0.9
                : e.kind === "hit"
                  ? 0.35
                  : 0.8
        const style = e.kind === "aoe" ? e.style : e.kind
        const tint = STYLE_TINT[style] ?? TEAM_TINT[e.team]!
        bursts.push({
          at: new Vector3(e.at.x, ground(e.at.x, e.at.z) + 0.12, e.at.z),
          t0: now,
          dur: e.kind === "aoe" ? 0.55 : e.kind === "hit" ? 0.2 : 0.7,
          radius,
          color: new Color(tint).multiplyScalar(e.kind === "death" ? 0.6 : 2),
        })
      }
    }
  }

  /** `now` is real seconds; fx are visual only and play in real time. */
  const update = (now: number) => {
    let n = 0
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]!
      const k = (now - f.t0) / f.dur
      if (k >= 1) {
        flights.splice(i, 1)
        continue
      }
      p.lerpVectors(f.from, f.to, k)
      p.y += Math.sin(k * Math.PI) * 0.6
      s.setScalar(f.scale)
      m.compose(p, q.identity(), s)
      projMesh.setMatrixAt(n, m)
      projMesh.setColorAt(n, f.color)
      n++
    }
    projMesh.count = n
    if (n) {
      projMesh.instanceMatrix.needsUpdate = true
      if (projMesh.instanceColor) projMesh.instanceColor.needsUpdate = true
    }

    n = 0
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i]!
      const k = (now - b.t0) / b.dur
      if (k >= 1) {
        bursts.splice(i, 1)
        continue
      }
      const r = b.radius * (0.35 + 0.65 * Math.sqrt(k))
      s.set(r, 1, r)
      m.compose(b.at, q.identity(), s)
      burstMesh.setMatrixAt(n, m)
      // Fade by darkening (additive blend → black = invisible).
      c.copy(b.color).multiplyScalar((1 - k) * (1 - k))
      burstMesh.setColorAt(n, c)
      n++
    }
    burstMesh.count = n
    if (n) {
      burstMesh.instanceMatrix.needsUpdate = true
      if (burstMesh.instanceColor) burstMesh.instanceColor.needsUpdate = true
    }
  }

  // Prime instanceColor buffers so the materials compile with colour support.
  projMesh.setColorAt(0, c.setHex(0))
  burstMesh.setColorAt(0, c.setHex(0))

  return {
    group,
    push,
    update,
    dispose: () => {
      projMesh.dispose()
      burstMesh.dispose()
    },
  }
}

export type FxLayer = ReturnType<typeof createFxLayer>
