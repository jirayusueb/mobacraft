/**
 * Unit renderer: one InstancedMesh per kind (creatures + heroes), fed from
 * Population snapshots, plus health bars. Per-frame CPU = instance matrices plus a
 * vec4 of animation state per unit (stride phase, move weight, attack progress, seed),
 * derived from how far each unit actually moved and its attack counter.
 */
import type { MobaMap } from "@mobacraft/map"
import { ALL_CREATURE_KINDS, HEROES, type Unit, type UnitKind } from "@mobacraft/sim"
import {
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from "three/webgpu"
import { createBarLayer } from "./bars.ts"
import { ANIM } from "./contract.ts"
import { type AnimState, createAnimState, stepAnim } from "./motion.ts"
import { creatureMaterial, creatureModel } from "./kit.ts"

const capacity = (kind: UnitKind) =>
  kind === "roshan"
    ? 2
    : HEROES.some((h) => h.id === kind)
      ? 2
      : kind.includes("-siege")
        ? 24
        : kind.startsWith("radiant-") || kind.startsWith("dire-")
          ? 96
          : 16

export const createUnitLayer = (map: MobaMap) => {
  const group = new Group()
  group.name = "units"
  const meshes = new Map<UnitKind, InstancedMesh>()
  const heights = new Map<UnitKind, number>()
  const strides = new Map<UnitKind, number>()
  const anims = new Map<UnitKind, InstancedBufferAttribute>()
  const kinds: UnitKind[] = [...ALL_CREATURE_KINDS, ...HEROES.map((h) => h.id)]
  for (const kind of kinds) {
    const model = creatureModel(kind)
    heights.set(kind, model.height)
    strides.set(kind, model.stride)
    const n = capacity(kind)
    // Shallow clone: shares the baked vertex buffers, adds this mesh's instanced state.
    const geometry = model.geometry.clone()
    const anim = new InstancedBufferAttribute(new Float32Array(n * 4).fill(1), 4)
    anim.setUsage(DynamicDrawUsage)
    geometry.setAttribute(ANIM, anim)
    anims.set(kind, anim)
    const mesh = new InstancedMesh(geometry, creatureMaterial(), n)
    mesh.count = 0
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Instances move across the whole map; per-mesh bounds would cull wrongly.
    mesh.frustumCulled = false
    mesh.name = `unit-${kind}`
    meshes.set(kind, mesh)
    group.add(mesh)
  }
  const bars = createBarLayer()
  group.add(bars.mesh)

  const m = new Matrix4()
  const q = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const pos = new Vector3()
  const scl = new Vector3(1, 1, 1)
  const counts = new Map<UnitKind, number>()
  const states = new Map<string, AnimState>()
  let frame = 0
  const barList: { x: number; y: number; z: number; hp: number; team: string; hero: boolean }[] = []

  const groundY = (u: Unit) => {
    const ground = map.heightAt(u.x, u.z)
    // Wade knee-deep through the river; Roshan sits above the waterline.
    return u.kind === "roshan"
      ? Math.max(ground, map.waterLevel + 0.05)
      : Math.max(ground, map.waterLevel - 0.12)
  }

  /** Write this frame's units into the instance buffers. `camQ` orients health bars. */
  const update = (units: readonly Unit[], camQ: Quaternion, showBars: boolean, dt: number) => {
    frame++
    counts.clear()
    barList.length = 0
    for (const u of units) {
      if (u.alive === false) continue
      const mesh = meshes.get(u.kind)
      if (!mesh) continue
      const i = counts.get(u.kind) ?? 0
      if (i >= mesh.instanceMatrix.count) continue
      const y = groundY(u)
      let st = states.get(u.id)
      if (!st) {
        st = createAnimState(u)
        states.set(u.id, st)
      }
      stepAnim(st, u, dt, strides.get(u.kind) ?? 1)
      st.frame = frame
      pos.set(u.x, y, u.z)
      q.setFromAxisAngle(up, st.heading)
      m.compose(pos, q, scl)
      mesh.setMatrixAt(i, m)
      anims.get(u.kind)?.setXYZW(i, st.phase, st.move, st.attack, st.seed)
      counts.set(u.kind, i + 1)
      if (showBars && u.hp !== undefined && (u.hero || u.hp < 0.999)) {
        barList.push({
          x: u.x,
          y: y + (heights.get(u.kind) ?? 1) + 0.35,
          z: u.z,
          hp: u.hp,
          team: u.team,
          hero: u.hero ?? false,
        })
      }
    }
    for (const [kind, mesh] of meshes) {
      const n = counts.get(kind) ?? 0
      if (mesh.count !== n) mesh.count = n
      if (n > 0) {
        mesh.instanceMatrix.needsUpdate = true
        const a = anims.get(kind)
        if (a) {
          a.clearUpdateRanges()
          a.addUpdateRange(0, n * 4)
          a.needsUpdate = true
        }
      }
    }
    // Forget units that left the snapshot (despawned creeps).
    for (const [id, st] of states) if (st.frame !== frame) states.delete(id)
    bars.update(barList, camQ)
  }

  return {
    group,
    update,
    heightOf: (kind: UnitKind) => heights.get(kind) ?? 1,
    dispose: () => {
      for (const mesh of meshes.values()) {
        mesh.geometry.deleteAttribute(ANIM)
        mesh.dispose()
      }
      bars.dispose()
    },
  }
}

export type UnitLayer = ReturnType<typeof createUnitLayer>
