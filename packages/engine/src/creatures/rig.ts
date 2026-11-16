/**
 * Joint binding for the procedural creature kits.
 *
 * Each kit declares the joints a model animates around (hip, shoulder, wing root,
 * wheel hub, siege lever) and tags parts with a limb group (±1) as before. At build
 * time every limb part is bound to one joint: same limb group, same side of the body
 * (x sign), nearest pivot — optionally restricted to one joint kind. The binding is
 * baked into two vertex attributes the material animates with:
 *
 *   pivot (vec3) — the joint's position in model space
 *   bone  (float) — BONE code of the joint kind (0 = rigid body)
 *
 * Pure geometry bookkeeping; no per-frame work.
 */
import { BufferGeometry, Float32BufferAttribute } from "three/webgpu"

export type JointKind = "leg" | "arm" | "wing" | "wheel" | "lever"

/** Vertex `bone` codes — must match the material in kit.ts. */
export const BONE: Record<JointKind | "body", number> = {
  body: 0,
  leg: 1,
  arm: 2,
  wing: 3,
  wheel: 4,
  lever: 5,
}

type V3 = readonly [number, number, number]

export interface Joint {
  readonly kind: JointKind
  /** Limb group the joint drives (matches the parts' `limb` attribute). */
  readonly limb: number
  readonly at: V3
}

export interface BoundPart {
  readonly geo: BufferGeometry
  readonly limb: number
  /** Restrict binding to one joint kind (e.g. a weapon that must follow the arm). */
  readonly joint?: JointKind | undefined
}

/** Parts / joints this close to x = 0 count as centred (match either side). */
const CENTRE = 0.02

const centroid = (g: BufferGeometry): [number, number, number] => {
  const pos = g.getAttribute("position")
  let x = 0
  let y = 0
  let z = 0
  for (let i = 0; i < pos.count; i++) {
    x += pos.getX(i)
    y += pos.getY(i)
    z += pos.getZ(i)
  }
  const n = Math.max(1, pos.count)
  return [x / n, y / n, z / n]
}

/** The joint a part follows, or null if it is rigid with the body. */
export const jointFor = (part: BoundPart, joints: readonly Joint[]): Joint | null => {
  if (part.limb === 0) return null
  const c = centroid(part.geo)
  let best: Joint | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const j of joints) {
    if (j.limb !== part.limb) continue
    if (part.joint && j.kind !== part.joint) continue
    const sameSide =
      Math.abs(j.at[0]) < CENTRE ||
      Math.abs(c[0]) < CENTRE ||
      Math.sign(j.at[0]) === Math.sign(c[0])
    if (!sameSide) continue
    const d = Math.hypot(c[0] - j.at[0], c[1] - j.at[1], c[2] - j.at[2])
    if (d < bestD) {
      bestD = d
      best = j
    }
  }
  return best
}

/** Bake pivot / bone attributes onto every part (call before merging). */
export const bindJoints = (parts: readonly BoundPart[], joints: readonly Joint[]): void => {
  for (const part of parts) {
    const j = jointFor(part, joints)
    const n = part.geo.getAttribute("position").count
    const pivot = new Float32Array(n * 3)
    if (j)
      for (let i = 0; i < n; i++) {
        pivot[i * 3] = j.at[0]
        pivot[i * 3 + 1] = j.at[1]
        pivot[i * 3 + 2] = j.at[2]
      }
    part.geo.setAttribute("pivot", new Float32BufferAttribute(pivot, 3))
    part.geo.setAttribute(
      "bone",
      new Float32BufferAttribute(new Float32Array(n).fill(j ? BONE[j.kind] : 0), 1),
    )
  }
}

/** Keep pivots in step with a whole-geometry translate / uniform scale. */
export const transformPivots = (g: BufferGeometry, scale: number, dy = 0): void => {
  const p = g.getAttribute("pivot")
  const bone = g.getAttribute("bone")
  for (let i = 0; i < p.count; i++) {
    if (bone.getX(i) === 0) continue
    p.setXYZ(i, p.getX(i) * scale, p.getY(i) * scale + dy, p.getZ(i) * scale)
  }
  p.needsUpdate = true
}
