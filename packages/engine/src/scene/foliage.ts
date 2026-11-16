import { Terrain, type MobaMap } from "@mobacraft/map"
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardNodeMaterial,
  Object3D,
  type BufferGeometry,
} from "three/webgpu"
import { float, hash, instanceIndex, positionLocal, sin, time, vec3 } from "three/tsl"
import { CANOPY, PROP, TRUNK } from "../palette.ts"

const dummy = new Object3D()
const tmp = new Color()

/** Wind: sway proportional to height above the instance origin, phase per instance. */
const swayingMaterial = (strength: number) => {
  const m = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, flatShading: true })
  const phase = hash(instanceIndex).mul(6.283)
  const bend = sin(time.mul(1.4).add(phase))
    .mul(strength)
    .mul(positionLocal.y.max(float(0)))
  m.positionNode = positionLocal.add(vec3(bend, float(0), bend.mul(0.6)))
  return m
}

const instanced = (
  geometry: BufferGeometry,
  material: MeshStandardNodeMaterial,
  count: number,
  name: string,
) => {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, count))
  mesh.count = count
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = name
  return mesh
}

/**
 * Trees as instanced trunks + 3 canopy blobs each (Quack-style cloud trees),
 * plus props and decorative grass tufts. ~10 draw calls for the whole forest.
 */
export const buildFoliage = (map: MobaMap): Group => {
  const group = new Group()
  group.name = "foliage"

  // --- trees ----------------------------------------------------------------
  const trees = map.trees
  const trunkGeo = new CylinderGeometry(0.09, 0.14, 1, 5).translate(0, 0.5, 0)
  const canopyGeo = new IcosahedronGeometry(0.5, 1)
  const trunks = instanced(
    trunkGeo,
    new MeshStandardNodeMaterial({ color: TRUNK, roughness: 1 }),
    trees.length,
    "trunks",
  )
  const canopy = instanced(canopyGeo, swayingMaterial(0.05), trees.length * 3, "canopy")

  trees.forEach((t, i) => {
    const y = map.heightAt(t.position.x, t.position.z)
    const s = t.scale
    const trunkH = 0.9 + t.variant * 0.6
    dummy.position.set(t.position.x, y, t.position.z)
    dummy.rotation.set(0, t.variant * 6.283, 0)
    dummy.scale.set(s, trunkH * s, s)
    dummy.updateMatrix()
    trunks.setMatrixAt(i, dummy.matrix)

    const palette = CANOPY[t.team]
    for (let b = 0; b < 3; b++) {
      const a = t.variant * 40 + b * 2.1
      const r = b === 0 ? 0 : 0.28 * s
      const blob = (b === 0 ? 1.15 : 0.8) * s
      dummy.position.set(
        t.position.x + Math.cos(a) * r,
        y + trunkH * s + (b === 0 ? 0.25 : -0.05) * s,
        t.position.z + Math.sin(a) * r,
      )
      dummy.rotation.set(a, a * 0.7, 0)
      dummy.scale.set(blob, blob * 0.9, blob)
      dummy.updateMatrix()
      canopy.setMatrixAt(i * 3 + b, dummy.matrix)
      tmp.setHex(palette[Math.floor((t.variant * 7 + b) % palette.length)]!)
      tmp.offsetHSL(0, 0, (b - 1) * 0.03)
      canopy.setColorAt(i * 3 + b, tmp)
    }
  })
  group.add(trunks, canopy)

  // --- props ------------------------------------------------------------------
  const byKind = {
    flower: [] as typeof map.props,
    rock: [] as typeof map.props,
    bush: [] as typeof map.props,
  }
  for (const p of map.props) (byKind[p.kind] as (typeof p)[]).push(p)

  const propMesh = (
    kind: keyof typeof byKind,
    geometry: BufferGeometry,
    material: MeshStandardNodeMaterial,
    lift: number,
  ) => {
    const list = byKind[kind]
    const mesh = instanced(geometry, material, list.length, kind)
    list.forEach((p, i) => {
      dummy.position.set(
        p.position.x,
        map.heightAt(p.position.x, p.position.z) + lift * p.scale,
        p.position.z,
      )
      dummy.rotation.set(0, p.variant * 6.283, 0)
      dummy.scale.setScalar(p.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      const colors = PROP[kind]
      mesh.setColorAt(i, tmp.setHex(colors[Math.floor(p.variant * colors.length)]!))
    })
    return mesh
  }
  const flowers = propMesh("flower", new IcosahedronGeometry(0.09, 0), swayingMaterial(0.15), 0.12)
  flowers.castShadow = false
  group.add(
    flowers,
    propMesh(
      "rock",
      new DodecahedronGeometry(0.28, 0).scale(1, 0.6, 1),
      new MeshStandardNodeMaterial({ roughness: 1, flatShading: true }),
      0.08,
    ),
    propMesh(
      "bush",
      new IcosahedronGeometry(0.38, 0).scale(1, 0.75, 1),
      swayingMaterial(0.04),
      0.2,
    ),
  )

  // --- grass tufts (purely cosmetic, renderer-local scatter) -------------------
  const N = map.size
  const tufts: { x: number; z: number; s: number; r: number; team: number }[] = []
  let seed = map.spec.seed * 2654435761
  const rnd = () => (seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 1) >>> 0) / 4294967296
  for (let tz = 0; tz < N; tz++) {
    for (let tx = 0; tx < N; tx++) {
      const t = map.terrain[tz * N + tx]
      if (t !== Terrain.Grass && t !== Terrain.Forest) continue
      for (let k = 0; k < 3; k++)
        tufts.push({
          x: tx + rnd(),
          z: tz + rnd(),
          s: 0.5 + rnd() * 0.7,
          r: rnd(),
          team: map.side[tz * N + tx]!,
        })
    }
  }
  const tuftMesh = instanced(
    new ConeGeometry(0.06, 0.32, 3).translate(0, 0.16, 0),
    swayingMaterial(0.35),
    tufts.length,
    "grass",
  )
  tuftMesh.castShadow = false
  tufts.forEach((t, i) => {
    dummy.position.set(t.x, map.heightAt(t.x, t.z), t.z)
    dummy.rotation.set((t.r - 0.5) * 0.5, t.r * 6.283, 0)
    dummy.scale.setScalar(t.s)
    dummy.updateMatrix()
    tuftMesh.setMatrixAt(i, dummy.matrix)
    tmp.setHex(t.team === 0 ? 0x6f9a3a : 0x8f8a3a).offsetHSL(0, 0, (t.r - 0.5) * 0.12)
    tuftMesh.setColorAt(i, tmp)
  })
  group.add(tuftMesh)

  return group
}
