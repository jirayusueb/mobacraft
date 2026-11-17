/**
 * Crowd/combat debug overlay (spec/13 §4): attack rings, slots, velocities,
 * locked / yielding units, drawn as 1 px lines on top of the scene.
 *
 * `buildDebugSegments` is pure (testable without a GPU); `createDebugLayer`
 * wraps it in one LineSegments with a fixed-capacity buffer and draw range.
 * The world only rebuilds when the sim clock changed (≤ once per sim tick).
 */
import type { CrowdDebug } from "@mobacraft/sim"
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
} from "three/webgpu"

/** Segment cap; segments past it are truncated (review §9). */
export const MAX_SEGMENTS = 8192
const CIRCLE = 24
const LIFT = 0.12

type RGB = readonly [number, number, number]
export const DEBUG_COLORS = {
  ring1: [1, 0.78, 0.25],
  ring2: [0.55, 0.42, 0.18],
  slotFree: [0.45, 0.45, 0.45],
  slotHeld: [0.3, 1, 0.45],
  pref: [1, 1, 1],
  vel: [0.25, 0.95, 1],
  locked: [1, 0.25, 0.2],
  yield: [1, 0.95, 0.2],
} as const satisfies Record<string, RGB>

/** Writes segments into `pos`/`col` (6 floats per segment each). Returns segment count. */
export const buildDebugSegments = (
  d: CrowdDebug,
  heightAt: (x: number, z: number) => number,
  pos: Float32Array,
  col: Float32Array,
  max = MAX_SEGMENTS,
): number => {
  let n = 0
  const seg = (ax: number, az: number, bx: number, bz: number, c: RGB, y?: number) => {
    if (n >= max) return
    const ya = (y ?? heightAt(ax, az)) + LIFT
    const yb = (y ?? heightAt(bx, bz)) + LIFT
    const o = n * 6
    pos[o] = ax
    pos[o + 1] = ya
    pos[o + 2] = az
    pos[o + 3] = bx
    pos[o + 4] = yb
    pos[o + 5] = bz
    for (let k = 0; k < 2; k++) {
      col[o + k * 3] = c[0]
      col[o + k * 3 + 1] = c[1]
      col[o + k * 3 + 2] = c[2]
    }
    n++
  }
  const circle = (x: number, z: number, r: number, c: RGB) => {
    const y = heightAt(x, z)
    for (let i = 0; i < CIRCLE; i++) {
      const a0 = (i / CIRCLE) * Math.PI * 2
      const a1 = ((i + 1) / CIRCLE) * Math.PI * 2
      seg(
        x + Math.cos(a0) * r,
        z + Math.sin(a0) * r,
        x + Math.cos(a1) * r,
        z + Math.sin(a1) * r,
        c,
        y,
      )
    }
  }
  for (const ring of d.rings) {
    circle(ring.x, ring.z, ring.r1, DEBUG_COLORS.ring1)
    circle(ring.x, ring.z, ring.r2, DEBUG_COLORS.ring2)
    for (const s of ring.slots) {
      const c = s.holder ? DEBUG_COLORS.slotHeld : DEBUG_COLORS.slotFree
      const k = 0.12
      seg(s.x - k, s.z, s.x + k, s.z, c)
      seg(s.x, s.z - k, s.x, s.z + k, c)
    }
  }
  for (const u of d.units) {
    if (u.mode === "locked") circle(u.x, u.z, u.radius, DEBUG_COLORS.locked)
    else if (u.yielding) circle(u.x, u.z, u.radius, DEBUG_COLORS.yield)
    if (u.pvx !== 0 || u.pvz !== 0)
      seg(u.x, u.z, u.x + u.pvx * 0.4, u.z + u.pvz * 0.4, DEBUG_COLORS.pref)
    if (u.vx !== 0 || u.vz !== 0)
      seg(u.x, u.z, u.x + u.vx * 0.4, u.z + u.vz * 0.4, DEBUG_COLORS.vel)
  }
  return n
}

export const createDebugLayer = (heightAt: (x: number, z: number) => number) => {
  const pos = new Float32Array(MAX_SEGMENTS * 6)
  const col = new Float32Array(MAX_SEGMENTS * 6)
  const geometry = new BufferGeometry()
  const pa = new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage)
  const ca = new BufferAttribute(col, 3).setUsage(DynamicDrawUsage)
  geometry.setAttribute("position", pa)
  geometry.setAttribute("color", ca)
  geometry.setDrawRange(0, 0)
  const material = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  })
  const lines = new LineSegments(geometry, material)
  lines.name = "crowd-debug"
  lines.frustumCulled = false
  lines.renderOrder = 999
  lines.visible = false
  let lastTime = Number.NaN

  return {
    object: lines,
    /** Rebuild from `read()` only when the sim clock moved. Returns ms spent (0 when skipped). */
    update: (on: boolean, simTime: number, read: () => CrowdDebug | undefined): number => {
      lines.visible = on
      if (!on) {
        lastTime = Number.NaN
        return 0
      }
      if (simTime === lastTime) return 0
      const t0 = performance.now()
      lastTime = simTime
      const d = read()
      const n = d ? buildDebugSegments(d, heightAt, pos, col) : 0
      geometry.setDrawRange(0, n * 2)
      pa.clearUpdateRanges()
      pa.addUpdateRange(0, n * 6)
      pa.needsUpdate = true
      ca.clearUpdateRanges()
      ca.addUpdateRange(0, n * 6)
      ca.needsUpdate = true
      return performance.now() - t0
    },
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}
