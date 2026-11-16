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
import {
  float,
  hash,
  instanceIndex,
  mix,
  positionGeometry,
  positionLocal,
  sin,
  smoothstep,
  time,
  vec3,
} from "three/tsl"
import { CANOPY, PROP, TRUNK } from "../palette.ts"

const dummy = new Object3D()
const tmp = new Color()

/** Wind: sway proportional to height above the instance origin, phase per instance. */
const sway = (strength: number) => {
  const phase = hash(instanceIndex).mul(6.283)
  const bend = sin(time.mul(1.4).add(phase))
    .mul(strength)
    .mul(positionLocal.y.max(float(0)))
  return positionLocal.add(vec3(bend, float(0), bend.mul(0.6)))
}

const swayingMaterial = (strength: number) => {
  const m = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, flatShading: true })
  m.positionNode = sway(strength)
  return m
}

/**
 * Canopy lobes: wind sway plus fake volume — each lobe darkens toward its
 * underside (geometry-local y, so it follows the lobe) and gets a soft sunlit top.
 * Instance colour still multiplies in.
 */
const canopyMaterial = () => {
  const m = swayingMaterial(0.045)
  const y = positionGeometry.y.div(0.5) // icosahedron radius 0.5 → -1..1
  const shade = mix(float(0.55), float(1.12), smoothstep(float(-1), float(0.9), y))
  const jitter = hash(instanceIndex.add(7)).sub(0.5).mul(0.12)
  m.colorNode = vec3(shade.add(jitter))
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

const prng = (seed: number) => {
  let s = (seed * 2654435761) >>> 0
  return () => (s = (Math.imul(s ^ (s >>> 15), 2246822519) + 1) >>> 0) / 4294967296
}

const lobeCount = (v: number) => (v > 0.45 ? 5 : 4)

/** Lobe layout for a round tree: [dx, dy, dz, size] in units of tree scale. */
const LOBES: readonly (readonly [number, number, number, number])[] = [
  [0, 0.42, 0, 1.18],
  [0.34, 0.1, 0.12, 0.86],
  [-0.3, 0.14, 0.2, 0.8],
  [0.05, 0.05, -0.36, 0.84],
  [-0.12, 0.78, -0.05, 0.7],
]

/**
 * Quack-style trees (instanced trunks + 4–5 shaded lobes, plus a minority of
 * stacked-cone conifers), clustered flower patches, rocks, bushes and dense
 * grass tufts. Fixed draw-call cost regardless of instance counts.
 */
export const buildFoliage = (map: MobaMap): Group => {
  const group = new Group()
  group.name = "foliage"
  const rnd = prng(map.spec.seed + 101)

  // --- trees ----------------------------------------------------------------
  const trees = map.trees
  // Conifers: ~14% on Radiant, ~24% on Dire (darker, wintrier silhouettes among the autumn).
  const isConifer = (t: (typeof trees)[number]) =>
    (t.variant * 9973) % 1 < (t.team === "dire" ? 0.24 : 0.14)
  const round = trees.filter((t) => !isConifer(t))
  const conifers = trees.filter(isConifer)

  const trunkGeo = new CylinderGeometry(0.08, 0.15, 1, 6).translate(0, 0.5, 0)
  const trunks = instanced(
    trunkGeo,
    new MeshStandardNodeMaterial({ color: TRUNK, roughness: 1, flatShading: true }),
    trees.length,
    "trunks",
  )
  const totalLobes = round.reduce((n, t) => n + lobeCount(t.variant), 0)
  const canopy = instanced(new IcosahedronGeometry(0.5, 1), canopyMaterial(), totalLobes, "canopy")
  const coneGeo = new ConeGeometry(0.5, 1, 7).translate(0, 0.5, 0)
  const coneMat = swayingMaterial(0.03)
  {
    const y = positionGeometry.y // 0..1 along the cone
    coneMat.colorNode = vec3(
      mix(float(0.6), float(1.1), y).add(hash(instanceIndex.add(3)).sub(0.5).mul(0.1)),
    )
  }
  const cones = instanced(coneGeo, coneMat, conifers.length * 3, "conifers")

  let ti = 0
  const placeTrunk = (x: number, y: number, z: number, s: number, h: number, v: number) => {
    dummy.position.set(x, y - 0.05, z)
    dummy.rotation.set(0, v * 6.283, 0)
    dummy.scale.set(s, h * s, s)
    dummy.updateMatrix()
    trunks.setMatrixAt(ti++, dummy.matrix)
  }

  let li = 0
  for (const t of round) {
    const { x, z } = t.position
    const y = map.heightAt(x, z)
    const s = t.scale
    const trunkH = 1.05 + t.variant * 0.6
    placeTrunk(x, y, z, s, trunkH, t.variant)
    const palette = CANOPY[t.team]
    const baseHex = palette[Math.floor((t.variant * 7) % palette.length)]!
    const rot = t.variant * 6.283
    const n = lobeCount(t.variant)
    for (let b = 0; b < n; b++) {
      const [dx, dy, dz, size] = LOBES[b]!
      const c = Math.cos(rot)
      const sn = Math.sin(rot)
      const wob = 0.9 + ((t.variant * (b + 3) * 17) % 1) * 0.22
      dummy.position.set(
        x + (dx * c - dz * sn) * s,
        y + trunkH * s + dy * s,
        z + (dx * sn + dz * c) * s,
      )
      dummy.rotation.set(rot + b, rot * 0.7 + b, 0)
      const blob = size * wob * s
      dummy.scale.set(blob, blob * 0.88, blob)
      dummy.updateMatrix()
      canopy.setMatrixAt(li, dummy.matrix)
      // Mostly one hue per tree, small per-lobe shift; occasional neighbour hue.
      const hex =
        b === 4 || (b === 2 && t.variant > 0.7)
          ? palette[(Math.floor(t.variant * 7) + 1) % palette.length]!
          : baseHex
      tmp
        .setHex(hex)
        .offsetHSL(
          (((t.variant * 31) % 1) - 0.5) * 0.03,
          0.04,
          (b === 4 ? 0.04 : 0) + (((t.variant * 13 + b * 0.37) % 1) - 0.5) * 0.06,
        )
      canopy.setColorAt(li++, tmp)
    }
  }

  const CONIFER_GREEN = [0x2f6b45, 0x386f3e, 0x2c5f48, 0x41784a]
  conifers.forEach((t, i) => {
    const { x, z } = t.position
    const y = map.heightAt(x, z)
    const s = t.scale * 1.05
    const trunkH = 0.55
    placeTrunk(x, y, z, s * 0.9, trunkH, t.variant)
    const hex = CONIFER_GREEN[Math.floor(t.variant * 97) % CONIFER_GREEN.length]!
    for (let k = 0; k < 3; k++) {
      const w = (1.25 - k * 0.3) * s
      dummy.position.set(x, y + (trunkH + k * 0.55) * s, z)
      dummy.rotation.set(0, t.variant * 6.283 + k, 0)
      dummy.scale.set(w, (1.05 - k * 0.1) * s, w)
      dummy.updateMatrix()
      cones.setMatrixAt(i * 3 + k, dummy.matrix)
      tmp.setHex(hex).offsetHSL(t.team === "dire" ? -0.03 : 0, 0, k * 0.03)
      cones.setColorAt(i * 3 + k, tmp)
    }
  })
  group.add(trunks, canopy, cones)

  // --- props ------------------------------------------------------------------
  const byKind = {
    flower: [] as typeof map.props,
    rock: [] as typeof map.props,
    bush: [] as typeof map.props,
  }
  for (const p of map.props) (byKind[p.kind] as (typeof p)[]).push(p)

  const propMesh = (
    kind: "rock" | "bush",
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
      mesh.setColorAt(
        i,
        tmp
          .setHex(colors[Math.floor(p.variant * colors.length)]!)
          .offsetHSL(0, 0, (p.variant - 0.5) * 0.08),
      )
    })
    return mesh
  }

  // Flowers: each map flower seeds a patch of 5–12 blooms of one or two colours.
  const N = map.size
  const flowerPts: { x: number; z: number; s: number; c: number }[] = []
  const grassy = (x: number, z: number) => {
    const t = map.terrainAt(x, z)
    return t === Terrain.Grass || t === Terrain.Shore
  }
  for (const p of byKind.flower) {
    const n = 5 + Math.floor(rnd() * 8)
    const colors = PROP.flower
    const main = colors[Math.floor(p.variant * colors.length)]!
    const alt = colors[Math.floor(rnd() * colors.length)]!
    const r = 0.5 + p.scale * 0.6
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.283
      const d = Math.sqrt(rnd()) * r
      const x = p.position.x + Math.cos(a) * d
      const z = p.position.z + Math.sin(a) * d
      if (!grassy(x, z)) continue
      flowerPts.push({ x, z, s: 0.7 + rnd() * 0.6, c: rnd() < 0.75 ? main : alt })
    }
  }
  const flowers = instanced(
    new IcosahedronGeometry(0.07, 0),
    swayingMaterial(0.15),
    flowerPts.length,
    "flowers",
  )
  flowers.castShadow = false
  flowerPts.forEach((f, i) => {
    dummy.position.set(f.x, map.heightAt(f.x, f.z) + 0.1 * f.s, f.z)
    dummy.rotation.set(0, f.s * 9, 0)
    dummy.scale.set(f.s, f.s * 0.7, f.s)
    dummy.updateMatrix()
    flowers.setMatrixAt(i, dummy.matrix)
    flowers.setColorAt(i, tmp.setHex(f.c).offsetHSL(0, 0, (f.s - 1) * 0.1))
  })

  group.add(
    flowers,
    propMesh(
      "rock",
      new DodecahedronGeometry(0.28, 0).scale(1, 0.6, 1),
      new MeshStandardNodeMaterial({ roughness: 1, flatShading: true }),
      0.08,
    ),
    propMesh("bush", new IcosahedronGeometry(0.38, 1).scale(1, 0.75, 1), canopyMaterial(), 0.2),
  )

  // --- grass tufts (purely cosmetic, renderer-local scatter) -------------------
  const tufts: { x: number; z: number; s: number; h: number; r: number; team: number }[] = []
  for (let tz = 0; tz < N; tz++) {
    for (let tx = 0; tx < N; tx++) {
      const t = map.terrain[tz * N + tx]
      const k = t === Terrain.Grass ? 5 : t === Terrain.Forest ? 3 : t === Terrain.Shore ? 2 : 0
      for (let j = 0; j < k; j++)
        tufts.push({
          x: tx + rnd(),
          z: tz + rnd(),
          s: 0.5 + rnd() * 0.6,
          h: 0.6 + rnd() * 1.1,
          r: rnd(),
          team: map.side[tz * N + tx]!,
        })
    }
  }
  const tuftMat = swayingMaterial(0.35)
  // Blades: darker at the root, sunlit tips.
  tuftMat.colorNode = vec3(mix(float(0.62), float(1.15), positionGeometry.y.div(0.32)))
  const tuftMesh = instanced(
    new ConeGeometry(0.06, 0.32, 3).translate(0, 0.16, 0),
    tuftMat,
    tufts.length,
    "grass",
  )
  tuftMesh.castShadow = false
  tufts.forEach((t, i) => {
    dummy.position.set(t.x, map.heightAt(t.x, t.z), t.z)
    dummy.rotation.set((t.r - 0.5) * 0.6, t.r * 6.283, 0)
    dummy.scale.set(t.s, t.s * t.h, t.s)
    dummy.updateMatrix()
    tuftMesh.setMatrixAt(i, dummy.matrix)
    tmp
      .setHex(t.team === 0 ? 0x6f9a3a : 0x8f8a3a)
      .offsetHSL((t.r - 0.5) * 0.04, (t.h - 1) * 0.08, (t.r - 0.5) * 0.14)
    tuftMesh.setColorAt(i, tmp)
  })
  group.add(tuftMesh)

  return group
}
