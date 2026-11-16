/**
 * Joint binding for the procedural creature kits — turns the kit's joint declarations
 * into a full Skeleton (skeleton.ts) and skins every part to it.
 *
 * Bone creation, in order:
 *   1. An explicit skeleton spec, when the kit declares one (root → pelvis → spine →
 *      chest → head, tails, capes); limbs are built from the declared joints;
 *   2. Otherwise an auto-rig: the declared joints become leaf chains, a spine chain
 *      (root → hips → chest → head) is interpolated from their heights, and the material
 *      animates body regions procedurally (breathe, lean, lunge) through a pelvis /
 *      spine pair every model gets.
 *
 * Skinning: each part is bound to one primary bone (its joint, or the spine bone nearest
 * its centroid for body parts). During the bake, parts straddling a joint (e.g. a hood
 * over a neck) get a second influence so the surface bends instead of creasing: the
 * blend is vertical — vertices nearer the joint's parent keep the parent bone. Two
 * influences per vertex (pairwise blend weights 0/1, 1/0, or ~0.5), no matrices at
 * build time.
 */
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { Box3, BufferGeometry, Float32BufferAttribute } from "three/webgpu"
import {
  type ArmChain,
  type AttackStyle,
  FLOATS_PER_BONE,
  type LegChain,
  type Skeleton,
  type WingChain,
} from "./skeleton.ts"

export type JointKind =
  | "leg"
  | "arm"
  | "wing"
  | "wheel"
  | "lever"
  | "head"
  | "tail"
  | "cape"
  | "body"

/** Vertex `bone` codes for joint kinds that are single pivots (legacy + siege). */
export const BONE: Record<string, number> = {
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
  /** Chain continuation: a second joint further out (knee, elbow, wing mid, tail seg). */
  readonly child?: V3
  readonly grandchild?: V3
  /** Leg group for gait timing (±1); default from limb sign. */
  readonly group?: number
}

export interface SkeletonSpec {
  /** Pelvis height (fall / crouch pivot). Default: 60% of hip height. */
  readonly pelvisY?: number
  /** Chest / shoulder-line height. Default: interpolated toward the top. */
  readonly chestY?: number
  /** Head joint position. Default: topmost joint. */
  readonly headY?: number
  readonly quadruped?: boolean
  readonly floating?: boolean
  /** Attack clip family (default "swing"; siege engines are forced to "siege"). */
  readonly attack?: AttackStyle
}

export interface BoundPart {
  readonly geo: BufferGeometry
  readonly limb: number
  /** Restrict binding to one joint kind (e.g. a weapon that must follow the arm). */
  readonly joint?: JointKind | undefined
  /** Force the part onto the spine chain (torso armour over limbs). */
  readonly torso?: boolean
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

// ── Skeleton assembly ───────────────────────────────────────────────────────────

interface Bone {
  name: string
  parent: number
  x: number
  y: number
  z: number
}

class SkeletonBuilder {
  readonly bones: Bone[] = []
  add(name: string, parent: number, at: V3): number {
    const i = this.bones.length
    this.bones.push({ name, parent, x: at[0], y: at[1], z: at[2] })
    return i
  }
}

export interface BuildResult {
  readonly skeleton: Skeleton
  /** Per-vertex (boneA, boneB, weightA) indices into the skeleton, flat arrays. */
  readonly skin: {
    readonly a: Uint16Array
    readonly b: Uint16Array
    readonly w: Float32Array
  }
}

/**
 * Assemble the Skeleton for a model and resolve each part's primary bone.
 * `height` is the model's bounding height (before the ground snap).
 */
// eslint-disable-next-line max-statements
export const buildSkeleton = (
  parts: readonly BoundPart[],
  joints: readonly Joint[],
  height: number,
  spec: SkeletonSpec = {},
): BuildResult => {
  const b = new SkeletonBuilder()
  const root = b.add("root", -1, [0, 0, 0])

  // Legs (and wheel/lever pivots) first: they define the hip line.
  const legs: LegChain[] = []
  const wheels: number[] = []
  let lever = -1
  const legJoints = joints.filter((j) => j.kind === "leg")
  const hipY =
    legJoints.length > 0
      ? legJoints.reduce((a, j) => a + j.at[1], 0) / legJoints.length
      : height * 0.38
  for (const j of legJoints) {
    const thigh = b.add("thigh", root, j.at)
    // Bind knee: halfway down the leg, pushed forward so the chain is ~12% longer
    // than the straight hip→ankle line — the IK solver needs that slack to move the
    // foot at all, and the bend gives the knee its natural pole direction.
    const d = Math.hypot(0, j.at[1], 0.04) || 1e-3
    const knee: V3 = [j.at[0], j.at[1] * 0.5, j.at[2] + 0.04 * 0.5 + d * 0.3]
    const shin = b.add("shin", thigh, knee)
    const foot = b.add("foot", shin, [j.at[0], 0.02, j.at[2] + 0.06])
    legs.push({
      thigh,
      shin,
      foot,
      group: j.group ?? (j.limb > 0 ? 1 : -1),
      side: Math.sign(j.at[0]) || 1,
      front: j.at[2] > 0,
    })
  }
  for (const j of joints) {
    if (j.kind === "wheel") wheels.push(b.add("wheel", root, j.at))
    if (j.kind === "lever") lever = b.add("lever", root, j.at)
  }

  // Spine: root → pelvis → spine → chest → head.
  const pelvisY = spec.pelvisY ?? hipY * 1.08
  const topY = Math.max(height * 0.72, pelvisY + 0.01)
  const chestY = spec.chestY ?? (pelvisY + topY) / 2
  const headJoint = joints.find((j) => j.kind === "head")
  const pelvis = b.add("pelvis", root, [0, pelvisY, 0])
  const spine = b.add("spine", pelvis, [0, (pelvisY + chestY) / 2, 0])
  const chest = b.add("chest", spine, [0, chestY, 0])
  const head = headJoint ? b.add("head", chest, headJoint.at) : -1

  // Arms hang off the chest.
  const arms: ArmChain[] = []
  for (const j of joints.filter((x) => x.kind === "arm")) {
    const upper = b.add("upperArm", chest, j.at)
    const fore = j.child
      ? b.add("foreArm", upper, j.child)
      : b.add("foreArm", upper, [j.at[0] * 1.18, j.at[1] - 0.16, j.at[2] + 0.03])
    const hand = b.add(
      "hand",
      fore,
      j.grandchild ?? [j.at[0] * 1.3, j.at[1] - 0.32, j.at[2] + 0.05],
    )
    arms.push({
      upper,
      fore,
      hand,
      group: j.group ?? (j.limb > 0 ? 1 : -1),
      side: Math.sign(j.at[0]) || 1,
      holds: true,
    })
  }

  // Wings (pinned: only parts that ask for "wing" follow them).
  const wings: WingChain[] = []
  for (const j of joints.filter((x) => x.kind === "wing")) {
    const wroot = b.add("wingRoot", chest, j.at)
    const wmid = j.child ? b.add("wingMid", wroot, j.child) : wroot
    wings.push({ root: wroot, mid: wmid, side: Math.sign(j.at[0]) || 1 })
  }

  // Tail / cape chains hang off the pelvis / chest.
  const tail: number[] = []
  for (const j of joints.filter((x) => x.kind === "tail")) {
    let parent = pelvis
    const segs = j.child ? [j.at, j.child, j.grandchild ?? j.child] : [j.at]
    for (const at of segs) {
      const i = b.add(`tail${tail.length}`, parent, at)
      tail.push(i)
      parent = i
    }
  }
  const cape: number[] = []
  for (const j of joints.filter((x) => x.kind === "cape")) {
    let parent = chest
    const segs = j.child ? [j.at, j.child, j.grandchild ?? j.child] : [j.at]
    for (const at of segs) {
      const i = b.add(`cape${cape.length}`, parent, at)
      cape.push(i)
      parent = i
    }
  }

  // Knee poles from the bind pose: bend forward (+z), quadruped hind legs backward.
  const poles = new Float32Array(legs.length * 3)
  legs.forEach((l, i) => {
    const j = legJoints[i]!
    const back = !l.front && spec.quadruped
    poles[i * 3] = 0
    poles[i * 3 + 1] = 0
    poles[i * 3 + 2] = j.child ? Math.sign(j.child[2] - j.at[2]) || (back ? -1 : 1) : back ? -1 : 1
  })

  const skeleton: Skeleton = {
    count: b.bones.length,
    names: b.bones.map((x) => x.name),
    parent: new Int16Array(b.bones.map((x) => x.parent)),
    rest: new Float32Array(b.bones.flatMap((x) => [x.x, x.y, x.z])),
    height,
    hipY,
    root,
    pelvis,
    spine,
    chest,
    head,
    legs,
    poles,
    arms,
    wings,
    tail,
    cape,
    wheels,
    lever,
    quadruped: spec.quadruped ?? legs.length === 4,
    floating: spec.floating ?? (legs.length === 0 && wheels.length === 0),
  }

  // ── resolve each part's primary bone ──
  const boneOf = (part: BoundPart, c: [number, number, number]): number => {
    if (part.joint === "head" && head >= 0) return head
    if (part.joint === "tail" && tail.length > 0) return nearest(c, tail, skeleton)
    if (part.joint === "cape" && cape.length > 0) return nearest(c, cape, skeleton)
    if (part.torso) return nearestY(c[1], [pelvis, spine, chest], skeleton)
    if (part.limb === 0 || part.joint === "body")
      return nearestY(c[1], [pelvis, spine, chest], skeleton)
    if (part.joint === "wheel" && wheels.length > 0) return nearest(c, wheels, skeleton)
    if (part.joint === "lever" && lever >= 0) return lever
    if (part.joint === "wing" && wings.length > 0) {
      const w = nearest(
        c,
        wings.map((x) => x.root),
        skeleton,
      )
      const mid = wings.find((x) => x.root === w)?.mid ?? w
      return nearest(c, [w, mid], skeleton)
    }
    // Limb parts: nearest declared joint of their group, then that joint's bone.
    const cand = joints.filter(
      (j) =>
        (j.kind === "leg" || j.kind === "arm" || j.kind === "wheel" || j.kind === "lever") &&
        j.limb === part.limb &&
        (Math.abs(j.at[0]) < CENTRE ||
          Math.abs(c[0]) < CENTRE ||
          Math.sign(j.at[0]) === Math.sign(c[0])),
    )
    let best: Joint | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const j of cand) {
      const d = Math.hypot(c[0] - j.at[0], c[1] - j.at[1], c[2] - j.at[2])
      if (d < bestD) {
        bestD = d
        best = j
      }
    }
    if (!best) return nearestY(c[1], [pelvis, spine, chest], skeleton)
    if (best.kind === "wheel") return nearest(c, wheels, skeleton)
    if (best.kind === "lever") return lever
    if (best.kind === "arm") {
      const arm = nearestChain(
        c,
        arms.map((a) => [a.upper, a.fore, a.hand]),
        skeleton,
      )
      return arm
    }
    const leg = legs[legJoints.indexOf(best)]
    if (!leg) return nearestY(c[1], [pelvis, spine, chest], skeleton)
    return nearest(c, [leg.thigh, leg.shin, leg.foot], skeleton)
  }

  const nTotal = parts.reduce((a, p) => a + p.geo.getAttribute("position").count, 0)
  const a = new Uint16Array(nTotal)
  const bb = new Uint16Array(nTotal)
  const w = new Float32Array(nTotal)
  let vi = 0
  const primaries: number[] = []
  const centroids: [number, number, number][] = []
  for (const part of parts) {
    const c = centroid(part.geo)
    primaries.push(boneOf(part, c))
    centroids.push(c)
  }
  parts.forEach((part, pi) => {
    const g = part.geo
    const n = g.getAttribute("position").count
    const pos = g.getAttribute("position")
    const primary = primaries[pi]!
    const parent = skeleton.parent[primary]!
    // A vertical blend zone across the joint: vertices above the joint line belong to
    // the parent bone, below to the primary — surfaces bend instead of creasing.
    const jointY = skeleton.rest[primary * 3 + 1]!
    const parentY = parent >= 0 ? skeleton.rest[parent * 3 + 1]! : jointY
    const zone =
      parent >= 0 && parent !== skeleton.root && jointY > parentY + 0.01
        ? Math.max(0.01, Math.min(0.25, (jointY - parentY) * 0.5))
        : 0
    for (let i = 0; i < n; i++, vi++) {
      a[vi] = primary
      bb[vi] = parent
      if (zone > 0) {
        const y = pos.getY(i)
        w[vi] = Math.min(1, Math.max(0, 0.5 + (jointY - y) / (2 * zone)))
      } else w[vi] = 1
    }
  })

  return { skeleton, skin: { a, b: bb, w } }
}

const nearest = (c: V3, bones: readonly number[], s: Skeleton): number => {
  let best = bones[0]!
  let bestD = Number.POSITIVE_INFINITY
  for (const bi of bones) {
    const d = Math.hypot(
      c[0] - s.rest[bi * 3]!,
      c[1] - s.rest[bi * 3 + 1]!,
      c[2] - s.rest[bi * 3 + 2]!,
    )
    if (d < bestD) {
      bestD = d
      best = bi
    }
  }
  return best
}

const nearestChain = (c: V3, chains: readonly number[][], s: Skeleton): number => {
  let best = chains[0]![0]!
  let bestD = Number.POSITIVE_INFINITY
  for (const chain of chains)
    for (const bi of chain) {
      const d = Math.hypot(
        c[0] - s.rest[bi * 3]!,
        c[1] - s.rest[bi * 3 + 1]!,
        c[2] - s.rest[bi * 3 + 2]!,
      )
      if (d < bestD) {
        bestD = d
        best = bi
      }
    }
  return best
}

const nearestY = (y: number, bones: readonly number[], s: Skeleton): number => {
  let best = bones[0]!
  let bestD = Number.POSITIVE_INFINITY
  for (const bi of bones) {
    const d = Math.abs(y - s.rest[bi * 3 + 1]!)
    if (d < bestD) {
      bestD = d
      best = bi
    }
  }
  return best
}

/**
 * Merge a kit's parts into one skinned geometry: builds the Skeleton (shifting joints
 * if the ground snap moves the model), then bakes `partInfo` + `bind` per vertex and
 * stows the skeleton in `geometry.userData.skeleton`.
 */
export const bakeModel = (
  parts: readonly BoundPart[],
  joints: readonly Joint[],
  spec: SkeletonSpec = {},
): BufferGeometry => {
  const merged = mergeGeometries(
    parts.map((p) => p.geo),
    false,
  )
  if (!merged) throw new Error("rig: merge failed")
  merged.computeBoundingBox()
  const box = merged.boundingBox ?? new Box3()
  const minY = box.min.y
  if (minY !== 0) merged.translate(0, -minY, 0)
  const height = box.max.y - minY
  const shift = (v: V3): V3 => [v[0], v[1] - minY, v[2]]
  const shifted = joints.map((j) => ({
    ...j,
    at: shift(j.at),
    child: j.child ? shift(j.child) : undefined,
    grandchild: j.grandchild ? shift(j.grandchild) : undefined,
  }))
  const shiftedSpec: SkeletonSpec = {
    ...spec,
    pelvisY: spec.pelvisY !== undefined ? spec.pelvisY - minY : undefined,
    chestY: spec.chestY !== undefined ? spec.chestY - minY : undefined,
  }
  const { skeleton, skin } = buildSkeleton(parts, shifted, height, shiftedSpec)

  const n = merged.getAttribute("position").count
  const partInfo = new Float32Array(n * 4)
  const bind = new Float32Array(n * 4)
  let vi = 0
  parts.forEach((p) => {
    const g = p.geo
    const cnt = g.getAttribute("position").count
    const limb = g.getAttribute("limb").getX(0)
    const glow = g.getAttribute("glow").getX(0)
    for (let k = 0; k < cnt; k++, vi++) {
      partInfo.set([limb, glow, height, skeleton.hipY], vi * 4)
      bind.set([skin.a[vi]!, skin.b[vi]!, skin.w[vi]!, 0], vi * 4)
    }
  })
  for (const p of parts) p.geo.dispose()
  for (const name of ["glow", "limb"]) merged.deleteAttribute(name)
  merged.setAttribute("partInfo", new Float32BufferAttribute(partInfo, 4))
  merged.setAttribute("bind", new Float32BufferAttribute(bind, 4))
  merged.computeVertexNormals()
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  merged.userData.skeleton = skeleton
  return merged
}

export { FLOATS_PER_BONE }
export type { Skeleton }
