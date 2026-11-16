import type { Camp, Landmark, MobaMap, Structure } from "@mobacraft/map"
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  MeshBasicNodeMaterial,
  OctahedronGeometry,
  TorusGeometry,
  type BufferGeometry,
} from "three/webgpu"
import { color, float, sin, time } from "three/tsl"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { TEAM } from "../palette.ts"

type Palette = (typeof TEAM)[keyof typeof TEAM]

const materials = new Map<string, MeshStandardNodeMaterial>()
const mat = (hex: number, opts: { emissive?: boolean; pulse?: boolean } = {}) => {
  const key = `${hex}-${opts.emissive ?? false}-${opts.pulse ?? false}`
  let m = materials.get(key)
  if (!m) {
    m = new MeshStandardNodeMaterial({ color: hex, roughness: 0.85, flatShading: true })
    if (opts.emissive) {
      const glow = opts.pulse ? sin(time.mul(2)).mul(0.35).add(1.15) : float(1)
      m.emissiveNode = color(hex).mul(glow)
    }
    materials.set(key, m)
  }
  return m
}

const part = (geo: BufferGeometry, material: MeshStandardNodeMaterial, x = 0, y = 0, z = 0) => {
  const m = new Mesh(geo, material)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

const tower = (p: Palette, tier: number) => {
  const g = new Group()
  const h = 2 + tier * 0.25
  g.add(
    part(new CylinderGeometry(0.75, 0.9, 0.35, 8), mat(p.stone), 0, 0.17),
    part(new CylinderGeometry(0.45, 0.6, h, 8).translate(0, h / 2, 0), mat(p.stone), 0, 0.35),
    part(new CylinderGeometry(0.62, 0.62, 0.25, 8), mat(p.stone), 0, h + 0.45),
    part(new ConeGeometry(0.7, 0.9, 8), mat(p.roof), 0, h + 1),
    part(new OctahedronGeometry(0.22), mat(p.accent, { emissive: true, pulse: true }), 0, h + 1.75),
  )
  return g
}

const ancient = (p: Palette) => {
  const g = new Group()
  g.add(
    part(new CylinderGeometry(2.2, 2.5, 0.5, 10), mat(p.stone), 0, 0.25),
    part(new CylinderGeometry(1.5, 1.8, 0.6, 10), mat(p.stone), 0, 0.8),
    part(
      new OctahedronGeometry(1.1).scale(1, 1.8, 1),
      mat(p.accent, { emissive: true, pulse: true }),
      0,
      2.9,
    ),
    part(
      new TorusGeometry(1.5, 0.08, 6, 24).rotateX(Math.PI / 2),
      mat(p.accent, { emissive: true }),
      0,
      2.4,
    ),
  )
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4
    g.add(
      part(new ConeGeometry(0.3, 2.4, 5), mat(p.stone), Math.cos(a) * 1.7, 2, Math.sin(a) * 1.7),
    )
  }
  return g
}

const barracks = (p: Palette, ranged: boolean) => {
  const g = new Group()
  const w = ranged ? 1.6 : 2
  g.add(
    part(new BoxGeometry(w, 1, w * 0.8), mat(p.stone), 0, 0.5),
    part(new ConeGeometry(w * 0.78, 0.9, 4).rotateY(Math.PI / 4), mat(p.roof), 0, 1.45),
    part(new BoxGeometry(0.35, 0.5, 0.05), mat(0x3a2a20), 0, 0.25, (w * 0.8) / 2 + 0.01),
  )
  if (ranged) g.add(part(new OctahedronGeometry(0.15), mat(p.accent, { emissive: true }), 0, 2.05))
  return g
}

const fountain = (p: Palette) => {
  const g = new Group()
  g.add(
    part(new CylinderGeometry(1.8, 1.9, 0.35, 12), mat(p.stone), 0, 0.17),
    part(
      new CylinderGeometry(1.5, 1.5, 0.1, 12),
      mat(p.accent, { emissive: true, pulse: true }),
      0,
      0.36,
    ),
    part(new CylinderGeometry(0.25, 0.35, 1.4, 8), mat(p.stone), 0, 0.9),
    part(new IcosahedronGeometry(0.3, 0), mat(p.accent, { emissive: true }), 0, 1.75),
  )
  return g
}

const shop = (p: Palette) => {
  const g = new Group()
  g.add(
    part(new BoxGeometry(1.4, 0.9, 1.1), mat(0x9a6a44), 0, 0.45),
    part(new BoxGeometry(1.7, 0.12, 1.4).rotateX(-0.15), mat(p.roof), 0, 1.05),
    part(new BoxGeometry(0.3, 0.3, 0.3), mat(0xd9b26a), 0.85, 0.15, 0.4),
    part(new BoxGeometry(0.25, 0.25, 0.25), mat(0xc9a25a), 0.8, 0.12, -0.3),
  )
  return g
}

const structure = (s: Structure, y: number, centre: number) => {
  const p = TEAM[s.team]
  const g =
    s.kind === "tower"
      ? tower(p, s.tier ?? 1)
      : s.kind === "ancient"
        ? ancient(p)
        : s.kind === "barracks-melee"
          ? barracks(p, false)
          : s.kind === "barracks-ranged"
            ? barracks(p, true)
            : s.kind === "fountain"
              ? fountain(p)
              : shop(p)
  g.position.set(s.position.x, y, s.position.z)
  // Face the map centre so doors/details look toward the action.
  g.rotation.y = Math.atan2(centre - s.position.x, centre - s.position.z)
  g.name = s.id
  g.userData = { kind: s.kind, team: s.team, id: s.id }
  return g
}

const CAMP_STONES: Record<Camp["kind"], number> = { small: 3, medium: 4, large: 5, ancient: 7 }

const camp = (c: Camp, y: number) => {
  const g = new Group()
  const n = CAMP_STONES[c.kind]
  const r = c.kind === "ancient" ? 1.4 : 1
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2
    g.add(
      part(
        new BoxGeometry(0.22, 0.45 + (k % 2) * 0.2, 0.22),
        mat(0x8a8478),
        Math.cos(a) * r,
        0.25,
        Math.sin(a) * r,
      ),
    )
  }
  g.add(part(new CylinderGeometry(0.25, 0.3, 0.2, 6), mat(0x5a4636), 0, 0.1))
  g.add(
    part(new ConeGeometry(0.16, 0.35, 5), mat(0xffa040, { emissive: true, pulse: true }), 0, 0.35),
  )
  g.position.set(c.position.x, y, c.position.z)
  g.name = c.id
  g.userData = { kind: `camp-${c.kind}`, team: c.team, id: c.id }
  return g
}

const landmark = (l: Landmark, y: number) => {
  const g = new Group()
  if (l.kind === "roshan") {
    g.add(part(new CylinderGeometry(2.2, 2.6, 0.25, 10), mat(0x4e4a46), 0, -0.1))
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 1.6 + 0.9
      g.add(
        part(
          new ConeGeometry(0.45, 1.6 + (k % 3) * 0.5, 5),
          mat(0x6a6460),
          Math.cos(a) * 2.3,
          0.7,
          Math.sin(a) * 2.3,
        ),
      )
    }
    g.add(
      part(new IcosahedronGeometry(0.6, 0), mat(0xb07cff, { emissive: true, pulse: true }), 0, 0.7),
    )
  } else {
    g.add(part(new CylinderGeometry(0.6, 0.6, 0.08, 10), mat(0xa89c86), 0, 0.04))
    g.add(part(new OctahedronGeometry(0.3), mat(0x56d6ff, { emissive: true, pulse: true }), 0, 0.9))
  }
  g.position.set(l.position.x, y, l.position.z)
  g.name = l.id
  g.userData = { kind: l.kind, team: "neutral", id: l.id }
  return g
}

/**
 * Bake every part into one merged mesh per material (≈10 draw calls for ~110
 * structures). Picking uses invisible per-entity proxy cylinders: raycasts
 * ignore `visible`, the renderer does not.
 */
const bake = (source: Group) => {
  source.updateMatrixWorld(true)
  const buckets = new Map<MeshStandardNodeMaterial, BufferGeometry[]>()
  source.traverse((o) => {
    if (!(o instanceof Mesh)) return
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(
      o.matrixWorld,
    )
    for (const name of Object.keys(g.attributes))
      if (name !== "position" && name !== "normal") g.deleteAttribute(name)
    const list = buckets.get(o.material as MeshStandardNodeMaterial) ?? []
    list.push(g)
    buckets.set(o.material as MeshStandardNodeMaterial, list)
  })
  const out = new Group()
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos)
    for (const g of geos) g.dispose()
    if (!merged) continue
    const mesh = new Mesh(merged, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    out.add(mesh)
  }
  return out
}

const proxyMaterial = new MeshBasicNodeMaterial()

/** All buildings, camps and landmarks: merged visuals + named, pickable proxies. */
export const buildStructures = (map: MobaMap): { visuals: Group; pickables: Group } => {
  const source = new Group()
  const ground = (x: number, z: number) => map.heightAt(x, z)
  for (const s of map.structures)
    source.add(structure(s, ground(s.position.x, s.position.z), map.size / 2))
  for (const c of map.camps) source.add(camp(c, ground(c.position.x, c.position.z)))
  for (const l of map.landmarks)
    source.add(landmark(l, Math.max(map.waterLevel, ground(l.position.x, l.position.z))))

  const pickables = new Group()
  pickables.name = "pickables"
  for (const g of source.children) {
    const r =
      g.userData.kind === "ancient" || g.userData.kind === "roshan"
        ? 2.4
        : g.userData.kind === "tower"
          ? 0.9
          : 1.3
    const h = g.userData.kind === "tower" ? 4.5 : g.userData.kind === "ancient" ? 4.5 : 2
    const proxy = new Mesh(new CylinderGeometry(r, r, h, 8).translate(0, h / 2, 0), proxyMaterial)
    proxy.position.copy(g.position)
    proxy.visible = false
    proxy.name = g.name
    proxy.userData = { ...g.userData, radius: r }
    pickables.add(proxy)
  }

  const visuals = bake(source)
  visuals.name = "structures"
  source.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose()
  })
  return { visuals, pickables }
}

/** Pulsing ground ring that marks the selected entity. */
export const buildSelectionRing = () => {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  m.colorNode = color(0xffffff)
  m.opacityNode = sin(time.mul(4)).mul(0.25).add(0.7)
  const ring = new Mesh(new TorusGeometry(1, 0.07, 6, 40).rotateX(Math.PI / 2), m)
  ring.visible = false
  ring.name = "selection-ring"
  return ring
}
