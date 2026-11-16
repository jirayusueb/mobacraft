import { Terrain, type MobaMap } from "@mobacraft/map"
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  DoubleSide,
  Vector2,
} from "three/webgpu"
import {
  abs,
  color,
  cos,
  float,
  fract,
  hash,
  instanceIndex,
  instancedBufferAttribute,
  int,
  select,
  uniformArray,
  vec2,
  mix,
  positionGeometry,
  sin,
  smoothstep,
  time,
  uniform,
  vec3,
} from "three/tsl"
import { ScatterRng } from "./scatter-rng.ts"

const ambientMesh = (
  geometry: BufferGeometry,
  material: MeshBasicNodeMaterial | MeshStandardNodeMaterial,
  count: number,
  name: string,
) => {
  const mesh = new InstancedMesh(geometry, material, count)
  mesh.name = name
  mesh.castShadow = false
  mesh.receiveShadow = false
  // Positions are computed on the GPU; the CPU bounds are meaningless.
  mesh.frustumCulled = false
  return mesh
}

/** Two-triangle "V" bird, wings along ±x, beak toward +z. Wing tips carry |x| = 1. */
const birdGeometry = () => {
  const g = new BufferGeometry()
  // prettier-ignore
  const p = [
    -1, 0, -0.15,   0, 0, 0.35,   0, 0, -0.2,
     0, 0, -0.2,    0, 0, 0.35,   1, 0, -0.15,
  ]
  g.setAttribute("position", new BufferAttribute(new Float32Array(p), 3))
  g.computeVertexNormals()
  return g
}

/**
 * Ambient life, fully GPU-animated from `instanceIndex` + `time` (no per-frame CPU work):
 *  - bird flocks circling high above the map (always on, fewer silhouettes at night via fade)
 *  - fireflies near forests and the river (night only, emissive → picked up by bloom)
 *  - petals/leaves drifting down the river.
 * Nothing casts shadows. Three draw calls by day, four at night.
 */
export const buildAmbient = (
  map: MobaMap,
): { group: Group; setNight: (night01: number) => void } => {
  const group = new Group()
  group.name = "ambient"
  const N = map.size
  const rnd = new ScatterRng(map.spec.seed + 7)
  const night = uniform(0)

  // --- birds -------------------------------------------------------------------
  const FLOCKS = 4
  const PER_FLOCK = 11
  const birdMat = new MeshBasicNodeMaterial({ side: DoubleSide })
  {
    const idx = float(instanceIndex)
    const flock = idx.div(PER_FLOCK).floor()
    const member = idx.sub(flock.mul(PER_FLOCK))
    const fh = hash(flock.add(3))
    // Each flock circles its own centre, alternating direction.
    const dirSign = flock.mod(2).mul(2).sub(1)
    const centre = vec3(
      float(N * 0.5).add(cos(flock.mul(1.9)).mul(N * 0.22)),
      float(13).add(fh.mul(5)),
      float(N * 0.5).add(sin(flock.mul(1.9)).mul(N * 0.22)),
    )
    const radius = float(N * 0.12).add(fh.mul(N * 0.1))
    const ang = time.mul(0.07).add(fh.mul(6.283)).mul(dirSign)
    // Loose V formation trailing behind the leader, with a little jitter.
    const row = member.add(1).div(2).floor()
    const side = member.mod(2).mul(2).sub(1)
    const jitter = hash(idx.add(91)).sub(0.5)
    const lag = row.mul(0.03).add(jitter.mul(0.01)).mul(dirSign)
    const a = ang.sub(lag)
    const r = radius.add(side.mul(row).mul(0.7))
    const bob = sin(time.mul(1.3).add(idx)).mul(0.25)
    const pos = centre.add(vec3(cos(a).mul(r), bob.add(row.mul(0.15)), sin(a).mul(r)))
    // Heading: tangent of the circle.
    const hx = sin(a).negate().mul(dirSign)
    const hz = cos(a).mul(dirSign)
    // Wing flap: tips go up and down.
    const flap = sin(time.mul(9).add(hash(idx).mul(6.283))).mul(0.45)
    const lx = positionGeometry.x
    const lz = positionGeometry.z
    const ly = abs(lx).mul(flap)
    const size = float(0.32)
    // Local +z → heading, local +x → right of heading.
    const world = vec3(
      lz.mul(hx).add(lx.mul(hz)).mul(size),
      ly.mul(size),
      lz.mul(hz).sub(lx.mul(hx)).mul(size),
    )
    birdMat.positionNode = pos.add(world)
    // Dark-ish silhouettes with a warm underside tint; softened at night.
    birdMat.colorNode = mix(color(0x3a3430), color(0x1c1f2a), night)
  }
  group.add(ambientMesh(birdGeometry(), birdMat, FLOCKS * PER_FLOCK, "birds"))

  // --- fireflies -----------------------------------------------------------------
  const spots: number[] = []
  const near = (tx: number, tz: number, kind: number) => {
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = tx + dx
        const z = tz + dz
        if (x >= 0 && z >= 0 && x < N && z < N && map.terrain[z * N + x] === kind) return true
      }
    return false
  }
  for (let tz = 1; tz < N - 1; tz++)
    for (let tx = 1; tx < N - 1; tx++) {
      const t = map.terrain[tz * N + tx]
      if (t !== Terrain.Grass && t !== Terrain.Shore) continue
      const byForest = near(tx, tz, Terrain.Forest)
      const byWater = t === Terrain.Shore || near(tx, tz, Terrain.Water)
      if (!byForest && !byWater) continue
      if (rnd.next() > (byWater ? 0.18 : 0.07)) continue
      const x = tx + rnd.next()
      const z = tz + rnd.next()
      spots.push(x, map.heightAt(x, z) + 0.3 + rnd.next() * 0.9, z)
    }
  const fireflyCount = Math.max(1, Math.min(900, spots.length / 3))
  const base = instancedBufferAttribute(
    new BufferAttribute(new Float32Array(spots.slice(0, fireflyCount * 3)), 3),
    "vec3" as const,
  )
  const fireflyMat = new MeshStandardNodeMaterial({ transparent: true, depthWrite: false })
  {
    const idx = float(instanceIndex)
    const h1 = hash(idx).mul(6.283)
    const h2 = hash(idx.add(17)).mul(6.283)
    const t = time.mul(0.6)
    const drift = vec3(
      sin(t.add(h1))
        .mul(0.45)
        .add(sin(t.mul(2.3).add(h2)).mul(0.12)),
      sin(t.mul(1.4).add(h2)).mul(0.22),
      cos(t.mul(0.8).add(h2)).mul(0.45),
    )
    fireflyMat.positionNode = base.add(drift).add(positionGeometry.mul(0.045))
    // Slow blink: mostly on, briefly dark.
    const blink = smoothstep(
      float(0.15),
      float(0.55),
      sin(time.mul(1.7).add(h1.mul(3)))
        .mul(0.5)
        .add(0.5),
    )
    const glow = color(0xd8ff7a).mul(night.mul(blink))
    fireflyMat.colorNode = glow.mul(0.3)
    fireflyMat.emissiveNode = glow.mul(2.5)
    fireflyMat.opacityNode = night.mul(blink.mul(0.85).add(0.15))
  }
  const fireflies = ambientMesh(new OctahedronGeometry(1, 0), fireflyMat, fireflyCount, "fireflies")
  fireflies.visible = false
  group.add(fireflies)

  // --- river petals ----------------------------------------------------------------
  // Segment, lateral offset and colour all derive from hash(instanceIndex) and a
  // uniform array of river points — no per-instance attributes needed.
  const river = map.river
  const PETALS = 140
  const segs = Math.max(1, river.length - 1)
  const riverPts = uniformArray<"vec2">(
    river.map((p) => new Vector2(p.x, p.z)),
    "vec2",
  )
  const petalCount = river.length > 1 ? PETALS : 1
  const petalMat = new MeshBasicNodeMaterial({ side: DoubleSide })
  {
    const idx = float(instanceIndex)
    const h = hash(idx.add(5))
    const seg = hash(idx.add(41)).mul(segs).floor()
    const a = vec2(riverPts.element(int(seg)))
    const b = vec2(riverPts.element(int(seg.add(1).min(segs))))
    const d = b.sub(a)
    const nrm = vec2(d.y.negate(), d.x).div(d.length().max(0.001))
    const off = hash(idx.add(73)).sub(0.5).mul(1.6)
    const k = fract(h.add(time.mul(0.012).mul(h.mul(0.5).add(0.75))))
    const wob = sin(time.mul(0.9).add(h.mul(20))).mul(0.25)
    const spin = time.mul(0.4).add(h.mul(6.283))
    const lx = positionGeometry.x
    const lz = positionGeometry.y // PlaneGeometry lies in XY; lay it flat.
    const local = vec3(
      lx.mul(cos(spin)).sub(lz.mul(sin(spin))),
      0,
      lx.mul(sin(spin)).add(lz.mul(cos(spin))),
    )
    const p = a.add(d.mul(k)).add(nrm.mul(off))
    // Fade in/out at segment ends by shrinking.
    const grow = smoothstep(float(0), float(0.08), k).mul(smoothstep(float(1), float(0.92), k))
    petalMat.positionNode = vec3(
      p.x.add(wob),
      float(map.waterLevel + 0.03),
      p.y.add(wob.mul(0.6)),
    ).add(local.mul(grow.mul(0.14)))
    const pick = hash(idx.add(97))
    const tintC = select(
      pick.lessThan(0.3),
      color(0xf5a8c7),
      select(
        pick.lessThan(0.6),
        color(0xfcedf2),
        select(pick.lessThan(0.8), color(0xdb8c40), color(0xbf9ef2)),
      ),
    )
    petalMat.colorNode = tintC.mul(mix(float(1), float(0.45), night))
  }
  group.add(ambientMesh(new PlaneGeometry(1, 0.6), petalMat, petalCount, "petals"))

  return {
    group,
    setNight: (night01: number) => {
      const n = Math.min(1, Math.max(0, night01))
      night.value = n
      fireflies.visible = n > 0.02
    },
  }
}
