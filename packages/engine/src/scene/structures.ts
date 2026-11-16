import type { Camp, Landmark, MobaMap, Structure } from "@mobacraft/map"
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  MeshBasicNodeMaterial,
  OctahedronGeometry,
  Shape,
  TorusGeometry,
  type BufferGeometry,
} from "three/webgpu"
import { color, float, sin, time, uniform } from "three/tsl"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { TEAM, WINDOW } from "../palette.ts"

/** 0 day → 1 night; windows, campfires and crystals glow brighter at night. */
export const nightGlow = uniform(0)

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

/** Shared windows glow warmly at night (emissive scaled by the `nightGlow` uniform). */
const windowMat = (() => {
  const m = new MeshStandardNodeMaterial({ color: 0x2a2018, roughness: 0.6, flatShading: true })
  m.emissiveNode = color(WINDOW).mul(nightGlow.mul(3).add(0.1))
  return m
})()

/** Ring of `n` boxes around the Y axis — crenellations, fence posts, stones. */
const ringOf = (
  n: number,
  r: number,
  geo: () => BufferGeometry,
  material: MeshStandardNodeMaterial,
  y: number,
  phase = 0,
) =>
  Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2 + phase
    const m = part(geo(), material, Math.cos(a) * r, y, Math.sin(a) * r)
    m.rotation.y = -a
    return m
  })

/** Gabled roof: a triangular prism along X, eaves overhanging, ridge at height `h`. */
const gable = (length: number, depth: number, h: number) => {
  const shape = new Shape()
  shape.moveTo(-depth / 2, 0)
  shape.lineTo(depth / 2, 0)
  shape.lineTo(0, h)
  shape.closePath()
  return new ExtrudeGeometry(shape, { depth: length, bevelEnabled: false })
    .translate(0, 0, -length / 2)
    .rotateY(Math.PI / 2)
}

const tower = (p: Palette, tier: number) => {
  const g = new Group()
  const h = 1.9 + tier * 0.3
  g.add(
    // Stepped stone footing.
    part(new CylinderGeometry(0.85, 0.95, 0.22, 8), mat(p.stoneDark), 0, 0.11),
    part(new CylinderGeometry(0.72, 0.8, 0.2, 8), mat(p.stone), 0, 0.32),
    // Shaft with two darker stone courses.
    part(new CylinderGeometry(0.42, 0.55, h, 8).translate(0, h / 2, 0), mat(p.stone), 0, 0.42),
    part(new CylinderGeometry(0.5, 0.5, 0.1, 8), mat(p.stoneDark), 0, 0.42 + h * 0.35),
    part(new CylinderGeometry(0.46, 0.46, 0.1, 8), mat(p.stoneDark), 0, 0.42 + h * 0.7),
    // Arrow-slit window facing out.
    part(new BoxGeometry(0.12, 0.34, 0.06), windowMat, 0, 0.42 + h * 0.52, 0.47),
    // Battlement platform + crenellations.
    part(new CylinderGeometry(0.66, 0.5, 0.22, 8), mat(p.stoneDark), 0, h + 0.5),
    ...ringOf(8, 0.58, () => new BoxGeometry(0.16, 0.2, 0.12), mat(p.stone), h + 0.71, Math.PI / 8),
    // Roof cap + glowing team crystal.
    part(new ConeGeometry(0.52, 0.85, 8), mat(p.roof), 0, h + 1.15),
    part(new CylinderGeometry(0.03, 0.03, 0.5, 4), mat(p.wood), 0, h + 1.7),
    part(
      new OctahedronGeometry(0.2).scale(1, 1.4, 1),
      mat(p.accent, { emissive: true, pulse: true }),
      0,
      h + 2.05,
    ),
  )
  // Banner on higher tiers.
  if (tier >= 2) {
    g.add(
      part(new CylinderGeometry(0.025, 0.025, 1, 4), mat(p.wood), 0.52, h + 1.05, 0),
      part(
        new BoxGeometry(0.02, 0.34, 0.26),
        mat(p.accent, { emissive: true }),
        0.53,
        h + 1.35,
        0.14,
      ),
    )
  }
  return g
}

const ancient = (p: Palette) => {
  const g = new Group()
  g.add(
    // Three-tier stepped dais.
    part(new CylinderGeometry(2.4, 2.6, 0.3, 12), mat(p.stoneDark), 0, 0.15),
    part(new CylinderGeometry(2.0, 2.2, 0.3, 12), mat(p.stone), 0, 0.45),
    part(new CylinderGeometry(1.5, 1.7, 0.35, 12), mat(p.stone), 0, 0.77),
    part(new CylinderGeometry(1.0, 1.2, 0.5, 8), mat(p.stoneDark), 0, 1.2),
    // Floating crystal with a smaller twin and orbit rings.
    part(
      new OctahedronGeometry(0.95).scale(1, 1.9, 1),
      mat(p.accent, { emissive: true, pulse: true }),
      0,
      3.1,
    ),
    part(new OctahedronGeometry(0.3).scale(1, 1.6, 1), mat(p.accent, { emissive: true }), 0, 1.75),
    part(
      new TorusGeometry(1.35, 0.06, 6, 32).rotateX(Math.PI / 2),
      mat(p.accent, { emissive: true }),
      0,
      2.6,
    ),
    part(
      new TorusGeometry(1.05, 0.05, 6, 32).rotateX(Math.PI / 2 + 0.35),
      mat(p.accent, { emissive: true }),
      0,
      3.4,
    ),
    // Steps toward the front.
    part(new BoxGeometry(1, 0.15, 0.5), mat(p.stone), 0, 0.08, 2.65),
  )
  // Obelisks with glowing tips.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6
    const x = Math.cos(a) * 1.85
    const z = Math.sin(a) * 1.85
    g.add(
      part(new CylinderGeometry(0.14, 0.24, 2, 4).rotateY(Math.PI / 4), mat(p.stone), x, 1.6, z),
      part(new OctahedronGeometry(0.11), mat(p.accent, { emissive: true }), x, 2.7, z),
    )
  }
  return g
}

const barracks = (p: Palette, ranged: boolean) => {
  const g = new Group()
  const w = ranged ? 1.7 : 2.1
  const d = w * 0.75
  const wallH = 0.95
  g.add(
    // Stone plinth, timber walls, corner posts.
    part(new BoxGeometry(w + 0.2, 0.2, d + 0.2), mat(p.stoneDark), 0, 0.1),
    part(new BoxGeometry(w, wallH, d), mat(p.stone), 0, 0.2 + wallH / 2),
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) =>
        part(
          new BoxGeometry(0.12, wallH + 0.05, 0.12),
          mat(p.wood),
          (sx * w) / 2,
          0.2 + wallH / 2,
          (sz * d) / 2,
        ),
      ),
    ),
    part(new BoxGeometry(w + 0.04, 0.08, d + 0.04), mat(p.wood), 0, 0.2 + wallH, 0),
    // Gabled roof: a long triangular prism.
    part(gable(w + 0.3, d + 0.35, 0.75), mat(p.roof), 0, 0.2 + wallH, 0),
    part(new BoxGeometry(w + 0.34, 0.06, 0.08), mat(p.roofDark), 0, 0.2 + wallH + 0.76, 0),
    // Door + two warm windows on the front, one on each side.
    part(new BoxGeometry(0.36, 0.55, 0.06), mat(p.wood), 0, 0.48, d / 2 + 0.02),
    part(new BoxGeometry(0.22, 0.2, 0.05), windowMat, -w * 0.3, 0.75, d / 2 + 0.02),
    part(new BoxGeometry(0.22, 0.2, 0.05), windowMat, w * 0.3, 0.75, d / 2 + 0.02),
    part(new BoxGeometry(0.05, 0.2, 0.22), windowMat, w / 2 + 0.02, 0.75, 0),
    // Chimney.
    part(new BoxGeometry(0.2, 0.5, 0.2), mat(p.stoneDark), w * 0.28, 0.2 + wallH + 0.55, -d * 0.15),
  )
  if (ranged) {
    // Archery target outside.
    g.add(
      part(
        new CylinderGeometry(0.22, 0.22, 0.06, 12).rotateX(Math.PI / 2),
        mat(p.cloth),
        w / 2 + 0.45,
        0.42,
        d * 0.2,
      ),
      part(
        new CylinderGeometry(0.1, 0.1, 0.07, 10).rotateX(Math.PI / 2),
        mat(p.accent, { emissive: true }),
        w / 2 + 0.45,
        0.42,
        d * 0.2 + 0.01,
      ),
    )
  } else {
    // Weapon rack: two crossed posts.
    g.add(part(new BoxGeometry(0.5, 0.06, 0.06), mat(p.wood), w / 2 + 0.4, 0.45, 0))
  }
  return g
}

const fountain = (p: Palette) => {
  const g = new Group()
  g.add(
    part(new CylinderGeometry(1.9, 2.0, 0.3, 16), mat(p.stoneDark), 0, 0.15),
    part(new CylinderGeometry(1.75, 1.75, 0.08, 16), mat(p.stone), 0, 0.34),
    part(
      new CylinderGeometry(1.55, 1.55, 0.1, 16),
      mat(p.accent, { emissive: true, pulse: true }),
      0,
      0.35,
    ),
    part(new CylinderGeometry(0.55, 0.7, 0.4, 10), mat(p.stone), 0, 0.55),
    part(new CylinderGeometry(0.18, 0.28, 1.3, 8), mat(p.stone), 0, 1.2),
    part(new CylinderGeometry(0.6, 0.2, 0.18, 10), mat(p.stoneDark), 0, 1.9),
    part(new IcosahedronGeometry(0.28, 0), mat(p.accent, { emissive: true }), 0, 2.2),
    ...ringOf(10, 1.85, () => new BoxGeometry(0.18, 0.26, 0.18), mat(p.stone), 0.42),
  )
  return g
}

const shop = (p: Palette) => {
  const g = new Group()
  g.add(
    // Market stall: counter, posts, striped awning, goods.
    part(new BoxGeometry(1.5, 0.6, 0.7), mat(p.wood), 0, 0.3, 0.1),
    part(new BoxGeometry(1.56, 0.06, 0.76), mat(0xb08a5a), 0, 0.62, 0.1),
    ...[-0.72, 0.72].flatMap((x) =>
      [-0.3, 0.5].map((z) => part(new BoxGeometry(0.07, 1.4, 0.07), mat(p.wood), x, 0.7, z)),
    ),
    part(new BoxGeometry(1.7, 0.06, 1.1).rotateX(0.22), mat(p.roof), 0, 1.45, 0.15),
    part(new BoxGeometry(1.7, 0.065, 0.2).rotateX(0.22), mat(p.cloth), 0, 1.465, -0.12),
    part(new BoxGeometry(1.7, 0.065, 0.2).rotateX(0.22), mat(p.cloth), 0, 1.38, 0.28),
    part(new BoxGeometry(0.3, 0.3, 0.3), mat(0xd9b26a), 0.95, 0.15, 0.55),
    part(new BoxGeometry(0.24, 0.24, 0.24), mat(0xc9a25a), 1.05, 0.12, 0.15),
    part(new CylinderGeometry(0.14, 0.16, 0.36, 8), mat(0x8a5a34), -0.98, 0.18, 0.5),
    part(new IcosahedronGeometry(0.09, 0), mat(0xe05a4a), -0.3, 0.72, 0.1),
    part(new IcosahedronGeometry(0.09, 0), mat(0xf2c14a), 0, 0.72, 0.05),
    part(new IcosahedronGeometry(0.1, 0), mat(p.accent, { emissive: true }), 0.35, 0.73, 0.15),
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

const CAMP_TENTS: Record<Camp["kind"], number> = { small: 1, medium: 2, large: 2, ancient: 3 }

/** Neutral camp: a campfire with log seats, tents and a crate pile; ancient camps get standing stones. */
const camp = (c: Camp, y: number) => {
  const g = new Group()
  const ancientCamp = c.kind === "ancient"
  // Fire pit: stone ring, crossed logs, flame.
  g.add(
    ...ringOf(7, 0.32, () => new DodecahedronGeometry(0.09, 0), mat(0x8a8478), 0.06),
    part(new BoxGeometry(0.5, 0.07, 0.07).rotateY(0.6), mat(0x5a3e2b), 0, 0.07),
    part(new BoxGeometry(0.5, 0.07, 0.07).rotateY(-0.6), mat(0x5a3e2b), 0, 0.09),
    part(new ConeGeometry(0.14, 0.38, 5), mat(0xff9a3a, { emissive: true, pulse: true }), 0, 0.3),
    part(new ConeGeometry(0.08, 0.24, 5), mat(0xffe08a, { emissive: true }), 0, 0.26),
  )
  // Log seats.
  for (const a of [0.4, 2.5, 4.4]) {
    g.add(
      part(
        new CylinderGeometry(0.08, 0.08, 0.5, 6).rotateZ(Math.PI / 2).rotateY(a),
        mat(0x6a4a32),
        Math.cos(a) * 0.75,
        0.08,
        Math.sin(a) * 0.75,
      ),
    )
  }
  // Tents.
  const tents = CAMP_TENTS[c.kind]
  for (let k = 0; k < tents; k++) {
    const a = 1.4 + k * 1.6
    const tent = part(
      new ConeGeometry(0.42, 0.62, 4),
      mat(k % 2 ? 0xc9b48a : 0xa88a6a),
      Math.cos(a) * 1.25,
      0.31,
      Math.sin(a) * 1.25,
    )
    tent.rotation.y = a
    g.add(tent)
  }
  g.add(
    part(new BoxGeometry(0.26, 0.26, 0.26), mat(0x8a6a48), -1.1, 0.13, -0.5),
    part(new BoxGeometry(0.2, 0.2, 0.2).rotateY(0.5), mat(0x7a5a3c), -1.05, 0.36, -0.48),
  )
  if (ancientCamp) {
    g.add(...ringOf(5, 1.75, () => new BoxGeometry(0.28, 1.1, 0.22), mat(0x7a7468), 0.55, 0.3))
  }
  g.position.set(c.position.x, y, c.position.z)
  g.name = c.id
  g.userData = { kind: `camp-${c.kind}`, team: c.team, id: c.id }
  return g
}

const landmark = (l: Landmark, y: number) => {
  const g = new Group()
  if (l.kind === "roshan") {
    // Rocky lair: dark floor, ring of jagged spires open toward the river, glowing aegis plinth.
    g.add(part(new CylinderGeometry(2.3, 2.7, 0.3, 12), mat(0x4e4a46), 0, -0.05))
    g.add(part(new CylinderGeometry(1.6, 1.9, 0.12, 12), mat(0x3a3634), 0, 0.12))
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 1.55 + 0.95
      const h = 1.4 + ((k * 7) % 4) * 0.45
      const spire = part(
        new ConeGeometry(0.42, h, 5),
        mat(k % 2 ? 0x6a6460 : 0x5a5450),
        Math.cos(a) * 2.3,
        h / 2 - 0.05,
        Math.sin(a) * 2.3,
      )
      spire.rotation.set(Math.sin(a) * 0.2, a, Math.cos(a) * -0.2)
      g.add(spire)
    }
    g.add(
      part(new CylinderGeometry(0.35, 0.45, 0.4, 6), mat(0x8a8478), 0, 0.35),
      part(
        new IcosahedronGeometry(0.42, 0),
        mat(0xb07cff, { emissive: true, pulse: true }),
        0,
        1.0,
      ),
      // Bones scattered around.
      part(
        new CylinderGeometry(0.05, 0.05, 0.6, 5).rotateZ(Math.PI / 2).rotateY(0.7),
        mat(0xe8e0cc),
        0.9,
        0.2,
        0.5,
      ),
      part(
        new CylinderGeometry(0.05, 0.05, 0.5, 5).rotateZ(Math.PI / 2).rotateY(-0.4),
        mat(0xe8e0cc),
        -0.7,
        0.2,
        0.8,
      ),
      part(new IcosahedronGeometry(0.14, 0), mat(0xe8e0cc), -0.4, 0.22, 1.1),
    )
  } else {
    // Rune: stone disc with carved ring, hovering crystal.
    g.add(
      part(new CylinderGeometry(0.7, 0.78, 0.12, 12), mat(0xa89c86), 0, 0.06),
      part(
        new TorusGeometry(0.5, 0.04, 4, 20).rotateX(Math.PI / 2),
        mat(0x56d6ff, { emissive: true }),
        0,
        0.13,
      ),
      part(
        new OctahedronGeometry(0.26).scale(1, 1.4, 1),
        mat(0x56d6ff, { emissive: true, pulse: true }),
        0,
        0.95,
      ),
    )
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
