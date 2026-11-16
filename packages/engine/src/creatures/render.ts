/**
 * Creature renderer: one InstancedMesh per kind (≈23 draw calls max), fed from
 * sim snapshots. The only per-frame CPU work is writing instance matrices.
 */
import type { MobaMap } from "@mobacraft/map"
import { ALL_CREATURE_KINDS, type Creature, type CreatureKind } from "@mobacraft/sim"
import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three/webgpu"
import { creatureMaterial, creatureModel } from "./kit.ts"

/** Upper bounds per kind; lane creeps scale with waves in flight. */
const capacity = (kind: CreatureKind) =>
  kind === "roshan"
    ? 1
    : kind.includes("-siege")
      ? 12
      : kind.startsWith("radiant-") || kind.startsWith("dire-")
        ? 48
        : 16

export const createCreatureLayer = (map: MobaMap) => {
  const group = new Group()
  group.name = "creatures"
  const meshes = new Map<CreatureKind, InstancedMesh>()
  for (const kind of ALL_CREATURE_KINDS) {
    const model = creatureModel(kind)
    const gait = kind.startsWith("radiant-") || kind.startsWith("dire-") ? "walk" : "idle"
    const mesh = new InstancedMesh(
      model.geometry,
      creatureMaterial(gait, model.height),
      capacity(kind),
    )
    mesh.count = 0
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Instances move across the whole map; per-mesh bounds would cull wrongly.
    mesh.frustumCulled = false
    mesh.name = `creature-${kind}`
    meshes.set(kind, mesh)
    group.add(mesh)
  }

  const m = new Matrix4()
  const q = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const pos = new Vector3()
  const scl = new Vector3(1, 1, 1)
  const counts = new Map<CreatureKind, number>()

  /** Write this frame's snapshot into the instance buffers. */
  const update = (creatures: readonly Creature[]) => {
    counts.clear()
    for (const c of creatures) {
      const mesh = meshes.get(c.kind)
      if (!mesh) continue
      const i = counts.get(c.kind) ?? 0
      if (i >= mesh.instanceMatrix.count) continue
      // Roshan's pit sits a little below the bank; never sink under water.
      // Wade knee-deep through the river instead of sinking; Roshan sits above the waterline.
      const ground = map.heightAt(c.x, c.z)
      const y =
        c.kind === "roshan"
          ? Math.max(ground, map.waterLevel + 0.05)
          : Math.max(ground, map.waterLevel - 0.12)
      pos.set(c.x, y, c.z)
      q.setFromAxisAngle(up, c.heading)
      m.compose(pos, q, scl)
      mesh.setMatrixAt(i, m)
      counts.set(c.kind, i + 1)
    }
    for (const [kind, mesh] of meshes) {
      const n = counts.get(kind) ?? 0
      if (mesh.count !== n) mesh.count = n
      if (n > 0) mesh.instanceMatrix.needsUpdate = true
    }
  }

  return {
    group,
    update,
    dispose: () => {
      for (const mesh of meshes.values()) mesh.dispose()
    },
  }
}

export type CreatureLayer = ReturnType<typeof createCreatureLayer>
