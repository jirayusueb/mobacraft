import { Terrain, type MobaMap } from "@mobacraft/map"
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardNodeMaterial } from "three/webgpu"
import {
  attribute,
  color,
  float,
  mix,
  mx_noise_float,
  positionWorld,
  sin,
  smoothstep,
  time,
  vec2,
  vec3,
} from "three/tsl"

/**
 * River surface. One quad per water tile, with a per-vertex `shore` distance
 * (0 at the bank → 1 mid-channel) computed on the CPU by BFS. The TSL shader
 * uses it for a shallow→deep gradient and animated foam lines along the banks;
 * noise advects along the river's flow direction (top-left → bottom-right).
 */
export const buildWater = (map: MobaMap): Mesh => {
  const N = map.size
  const y = map.waterLevel

  // BFS distance (in tiles) from each water tile to the nearest non-water tile.
  const dist = new Float32Array(N * N).fill(Infinity)
  const queue: number[] = []
  for (let i = 0; i < N * N; i++) {
    if (map.terrain[i] !== Terrain.Water) {
      dist[i] = 0
      queue.push(i)
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!
    const x = i % N
    const z = (i - x) / N
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx
      const nz = z + dz
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue
      const j = nz * N + nx
      if (dist[j]! > dist[i]! + 1) {
        dist[j] = dist[i]! + 1
        queue.push(j)
      }
    }
  }
  /** Corner value = mean distance of the 4 tiles touching it (non-water counts as 0). */
  const cornerDist = (cx: number, cz: number) => {
    let sum = 0
    for (const [ox, oz] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      const tx = Math.min(N - 1, Math.max(0, cx + ox))
      const tz = Math.min(N - 1, Math.max(0, cz + oz))
      sum += Math.min(4, dist[tz * N + tx]!) - 0.5
    }
    return Math.max(0, sum / 4) / 3
  }

  const pos: number[] = []
  const shore: number[] = []
  for (let tz = 0; tz < N; tz++) {
    for (let tx = 0; tx < N; tx++) {
      if (map.terrain[tz * N + tx] !== Terrain.Water) continue
      const e = 0.02
      const v = [
        [tx - e, tz - e, cornerDist(tx, tz)],
        [tx - e, tz + 1 + e, cornerDist(tx, tz + 1)],
        [tx + 1 + e, tz + 1 + e, cornerDist(tx + 1, tz + 1)],
        [tx + 1 + e, tz - e, cornerDist(tx + 1, tz)],
      ] as const
      for (const k of [0, 1, 2, 0, 2, 3]) {
        pos.push(v[k]![0], y, v[k]![1])
        shore.push(v[k]![2])
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3))
  geometry.setAttribute("shore", new BufferAttribute(new Float32Array(shore), 1))
  geometry.computeVertexNormals()

  const material = new MeshStandardNodeMaterial({
    roughness: 0.18,
    metalness: 0,
    transparent: true,
  })
  const d = attribute<"float">("shore", "float").clamp(0, 1)
  // Flow along the river: advect noise coordinates over time.
  const flow = vec2(0.55, 0.8).mul(time.mul(0.35))
  const p = positionWorld.xz
  const ripple = mx_noise_float(vec3(p.mul(0.45).sub(flow), time.mul(0.12)))
    .mul(0.5)
    .add(0.5)
  const fine = mx_noise_float(vec3(p.mul(1.6).sub(flow.mul(2)), time.mul(0.4)))
    .mul(0.5)
    .add(0.5)

  const shallow = color(0x7cc0b0)
  const mid = color(0x3f8c8f)
  const deep = color(0x255e6b)
  const body = mix(
    mix(shallow, mid, smoothstep(float(0), float(0.35), d)),
    deep,
    smoothstep(float(0.35), float(1), d),
  )
  const tinted = body.mul(float(0.9).add(ripple.mul(0.2)))

  // Foam: a soft band hugging the bank that breathes, plus broken flecks.
  const band = float(1).sub(smoothstep(float(0.04), float(0.2), d))
  const wave = sin(d.mul(40).sub(time.mul(2.2)).add(ripple.mul(6)))
    .mul(0.5)
    .add(0.5)
  const foamLine = smoothstep(float(0.75), float(0.95), wave).mul(
    float(1).sub(smoothstep(float(0.12), float(0.32), d)),
  )
  const fleck = smoothstep(float(0.78), float(0.86), fine).mul(0.6)
  const foam = band
    .mul(0.85)
    .add(foamLine.mul(0.7))
    .add(fleck.mul(smoothstep(float(0.5), float(0.1), d)))
    .clamp(0, 1)

  const sparkle = smoothstep(float(0.83), float(0.9), fine)
    .mul(smoothstep(float(0.3), float(0.8), d))
    .mul(0.5)
  material.colorNode = mix(tinted, color(0xf4fbf6), foam).add(sparkle)
  material.opacityNode = mix(float(0.72), float(0.94), smoothstep(float(0), float(0.4), d)).max(
    foam,
  )

  const mesh = new Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.name = "water"
  return mesh
}
