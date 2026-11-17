/**
 * Unit renderer: one InstancedMesh per kind (creatures + heroes), fed from
 * Population snapshots, plus health bars. Per-frame CPU = instance matrices, an
 * animation-state vec4 and a skin-data row per unit (the PoseSolver's bone matrices);
 * vertices are skinned in the material against the skin texture.
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
import { creatureMaterial as creatureMaterialFor, creatureModel as modelOf } from "./kit.ts"
import { ANIM, type CreatureModel } from "./contract.ts"
import { bindSkin, createSkin, writeSkin, type SkinTarget } from "./kit.ts"
import { createAnimState, poseInput, stepAnim, type AnimState } from "./motion.ts"

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
  const skins = new Map<UnitKind, SkinTarget>()
  const anims = new Map<UnitKind, InstancedBufferAttribute>()
  const kinds: UnitKind[] = [...ALL_CREATURE_KINDS, ...HEROES.map((h) => h.id)]
  for (const kind of kinds) {
    const model: CreatureModel = modelOf(kind)
    const n = capacity(kind)
    const skin = createSkin(kind, n)
    skins.set(kind, skin)
    // Shallow clone: shares the baked vertex buffers, adds this mesh's instanced state.
    const geometry = model.geometry.clone()
    const anim = new InstancedBufferAttribute(new Float32Array(n * 4).fill(1), 4)
    anim.setUsage(DynamicDrawUsage)
    geometry.setAttribute(ANIM, anim)
    anims.set(kind, anim)
    const mesh = new InstancedMesh(geometry, creatureMaterialFor(kind, skin), n)
    mesh.count = 0
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Instances move across the whole map; per-mesh bounds would cull wrongly.
    mesh.frustumCulled = false
    mesh.name = `unit-${kind}`
    meshes.set(kind, mesh)
    group.add(mesh)
    // Pre-fill every slot with the bind pose so fresh slots never read zeros.
    for (let i = 0; i < n; i++) bindSkin(skin, i)
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
  let clock = 0
  let frame = 0

  const groundY = (u: Unit) => {
    const ground = map.heightAt(u.x, u.z)
    // Wade knee-deep through the river; Roshan sits above the waterline.
    return u.kind === "roshan"
      ? Math.max(ground, map.waterLevel + 0.05)
      : Math.max(ground, map.waterLevel - 0.12)
  }

  /** Write this frame's units into the instance buffers. `camQ` orients health bars. */
  const update = (
    units: readonly Unit[],
    camQ: Quaternion,
    showBars: boolean,
    dt: number,
    /** Game seconds per real second (swing extrapolation, spec/13). */
    timeScale = 1,
  ) => {
    clock += dt
    frame++
    counts.clear()
    const barList: { x: number; y: number; z: number; hp: number; team: string; hero: boolean }[] =
      []
    for (const u of units) {
      let st = states.get(u.id)
      if (!st) {
        st = createAnimState(u)
        states.set(u.id, st)
      }
      stepAnim(st, u, dt, skins.get(u.kind)?.stride ?? 1, timeScale)
      st.frame = frame
      // Dying units keep animating (and keep their health bar hidden) until sunk.
      if (u.alive === false && st.death >= 1) continue
      const skin = skins.get(u.kind)
      const mesh = meshes.get(u.kind)
      if (!skin || !mesh) continue
      const i = counts.get(u.kind) ?? 0
      if (i >= mesh.instanceMatrix.count) continue
      skin.solver.solve(poseInput(st, clock, skin.stride, skin.style), skin.scratch)
      writeSkin(skin, i)
      const y = groundY(u)
      // Sinking units drop with the clip's tail.
      pos.set(u.x, y, u.z)
      q.setFromAxisAngle(up, st.heading)
      m.compose(pos, q, scl)
      mesh.setMatrixAt(i, m)
      anims.get(u.kind)?.setXYZW(i, st.phase, st.move, st.attack, st.seed)
      counts.set(u.kind, i + 1)
      if (showBars && u.alive !== false && u.hp !== undefined && (u.hero || u.hp < 0.999)) {
        barList.push({
          x: u.x,
          y: y + (modelOf(u.kind).height ?? 1) + 0.35,
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
    heightOf: (kind: UnitKind) => modelOf(kind).height,
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
