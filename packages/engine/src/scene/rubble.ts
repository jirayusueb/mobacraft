/**
 * Structure damage state. Structures are baked into merged meshes (draw-call budget),
 * so a destroyed building can't be hidden per object. Instead:
 *  - damaged structures get a health bar above them;
 *  - destroyed ones get a rubble mound + scorch disc that covers the base, and the
 *    building's silhouette is hidden by a camera-facing "smoke column" of dark
 *    faceted rocks sized to the structure.
 * Driven entirely by StructureStatus from the Population.
 */
import type { MobaMap } from "@mobacraft/map"
import type { StructureStatus } from "@mobacraft/sim"
import {
  CircleGeometry,
  Color,
  DodecahedronGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  type Quaternion,
} from "three/webgpu"
import { createBarLayer } from "../creatures/bars.ts"

const ROCKS_PER = 9

export const createRubbleLayer = (map: MobaMap) => {
  const group = new Group()
  group.name = "rubble"
  const structures = map.structures.filter(
    (s) =>
      s.team !== "neutral" &&
      (s.kind === "tower" || s.kind === "ancient" || s.kind.startsWith("barracks")),
  )
  const index = new Map(structures.map((s, i) => [s.id, i]))

  const rockMat = new MeshStandardNodeMaterial({ color: 0x3a3532, roughness: 1, flatShading: true })
  const rocks = new InstancedMesh(
    new DodecahedronGeometry(1, 0),
    rockMat,
    structures.length * ROCKS_PER,
  )
  rocks.count = 0
  rocks.castShadow = true
  rocks.receiveShadow = true
  const scorchMat = new MeshBasicNodeMaterial({
    color: 0x0c0a0a,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  const scorch = new InstancedMesh(
    new CircleGeometry(1, 20).rotateX(-Math.PI / 2),
    scorchMat,
    structures.length,
  )
  scorch.count = 0
  const bars = createBarLayer()
  group.add(rocks, scorch, bars.mesh)

  const dummy = new Object3D()
  const tint = new Color()
  const m = new Matrix4()
  let lastKey = ""
  const barList: { x: number; y: number; z: number; hp: number; team: string; hero: boolean }[] = []

  const update = (status: readonly StructureStatus[], camQ: Quaternion) => {
    // Rebuild rubble only when the set of destroyed structures changes.
    const dead = status.filter((s) => !s.alive && index.has(s.id))
    const key = dead.map((d) => d.id).join(",")
    if (key !== lastKey) {
      lastKey = key
      let r = 0
      let c = 0
      for (const d of dead) {
        const s = structures[index.get(d.id)!]!
        const y = map.heightAt(s.position.x, s.position.z)
        const size = s.kind === "ancient" ? 2.2 : s.kind === "tower" ? 1 : 1.3
        dummy.position.set(s.position.x, y + 0.03, s.position.z)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(size * 1.8, 1, size * 1.8)
        dummy.updateMatrix()
        scorch.setMatrixAt(c++, dummy.matrix)
        for (let k = 0; k < ROCKS_PER; k++) {
          const a = (k / ROCKS_PER) * Math.PI * 2 + s.position.x
          const rr = (k % 3) * 0.35 * size
          dummy.position.set(
            s.position.x + Math.cos(a) * rr,
            y + 0.1 + ((k * 7) % 3) * 0.12 * size,
            s.position.z + Math.sin(a) * rr,
          )
          dummy.rotation.set(a, a * 1.3, k)
          dummy.scale.setScalar((0.32 + ((k * 5) % 4) * 0.08) * size)
          dummy.updateMatrix()
          rocks.setMatrixAt(r, dummy.matrix)
          rocks.setColorAt(
            r,
            tint
              .setHex(s.team === "radiant" ? 0x8a8478 : 0x3a3034)
              .multiplyScalar(0.8 + (k % 3) * 0.1),
          )
          r++
        }
      }
      rocks.count = r
      scorch.count = c
      rocks.instanceMatrix.needsUpdate = true
      if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true
      scorch.instanceMatrix.needsUpdate = true
    }
    barList.length = 0
    for (const st of status) {
      if (!st.alive || st.hp >= 0.999) continue
      const i = index.get(st.id)
      if (i === undefined) continue
      const s = structures[i]!
      const h = s.kind === "ancient" ? 5 : s.kind === "tower" ? 4.2 + (s.tier ?? 1) * 0.3 : 2.4
      barList.push({
        x: s.position.x,
        y: map.heightAt(s.position.x, s.position.z) + h,
        z: s.position.z,
        hp: st.hp,
        team: s.team,
        hero: true,
      })
    }
    bars.update(barList, camQ)
    void m
  }

  return {
    group,
    update,
    /** Ids of structures currently destroyed, for hiding baked visuals elsewhere. */
    dispose: () => {
      rocks.dispose()
      scorch.dispose()
      bars.dispose()
    },
  }
}
