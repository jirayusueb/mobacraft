import { Terrain, type MobaMap } from "@mobacraft/map"
import {
  DataTexture,
  LinearFilter,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  RGBAFormat,
  UnsignedByteType,
} from "three/webgpu"
import {
  color,
  float,
  mix,
  mx_noise_float,
  positionWorld,
  sin,
  smoothstep,
  texture,
  time,
  vec2,
  vec3,
} from "three/tsl"

/** Distance (tiles) encoded in the field texture's 0..1 range. */
const MAX_DIST = 4

/**
 * Smooth Euclidean distance from each tile centre to the nearest land tile,
 * as a bilinear-filterable RGBA8 texture. Sampling it per fragment gives the
 * water clean curved contours for depth and foam, independent of the tile grid.
 */
const shoreField = (map: MobaMap) => {
  const N = map.size
  const R = MAX_DIST + 1
  const data = new Uint8Array(N * N * 4)
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      let d = MAX_DIST
      if (map.terrain[z * N + x] !== Terrain.Water) d = 0
      else {
        for (let dz = -R; dz <= R; dz++)
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx
            const nz = z + dz
            if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue
            if (map.terrain[nz * N + nx] === Terrain.Water) continue
            // Distance to the land tile's nearest edge, not its centre.
            const ex = Math.max(0, Math.abs(dx) - 0.5)
            const ez = Math.max(0, Math.abs(dz) - 0.5)
            d = Math.min(d, Math.hypot(ex, ez))
          }
      }
      const v = Math.round((Math.min(MAX_DIST, d) / MAX_DIST) * 255)
      data.set([v, v, v, 255], (z * N + x) * 4)
    }
  }
  const tex = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType)
  tex.magFilter = LinearFilter
  tex.minFilter = LinearFilter
  tex.needsUpdate = true
  return tex
}

/**
 * River surface: a single plane over the whole island at water level — land
 * occludes it everywhere except the river channel. A shore distance field
 * drives a shallow→deep gradient, breathing foam lines that follow the banks,
 * and noise advected along the river's flow (top-left → bottom-right).
 */
export const buildWater = (map: MobaMap): Mesh => {
  const N = map.size
  const geometry = new PlaneGeometry(N, N, 1, 1)
    .rotateX(-Math.PI / 2)
    .translate(N / 2, map.waterLevel, N / 2)

  const field = shoreField(map)
  const p = positionWorld.xz
  const d = texture(field, p.div(N)).r.mul(MAX_DIST) // tiles from the bank

  const material = new MeshStandardNodeMaterial({ roughness: 0.2, metalness: 0, transparent: true })
  const flow = vec2(0.55, 0.8).mul(time.mul(0.35))
  const ripple = mx_noise_float(vec3(p.mul(0.45).sub(flow), time.mul(0.12)))
    .mul(0.5)
    .add(0.5)
  const fine = mx_noise_float(vec3(p.mul(1.6).sub(flow.mul(2)), time.mul(0.4)))
    .mul(0.5)
    .add(0.5)
  // Wobble the contour lookups so foam lines aren't perfectly parallel to the bank.
  const dw = d.add(ripple.sub(0.5).mul(0.35))

  const shallow = color(0x6fb7ae)
  const mid = color(0x3f8c8f)
  const deep = color(0x255e6b)
  const body = mix(
    mix(shallow, mid, smoothstep(float(0.2), float(1.0), dw)),
    deep,
    smoothstep(float(1.0), float(2.6), dw),
  )
  const tinted = body.mul(float(0.9).add(ripple.mul(0.2)))

  // Foam: a solid lip at the bank, plus a travelling line that laps outward and fades.
  const lip = float(1).sub(smoothstep(float(0.08), float(0.32), dw))
  const lap = sin(dw.mul(6).sub(time.mul(1.6)))
    .mul(0.5)
    .add(0.5)
  const lapLine = smoothstep(float(0.8), float(0.95), lap).mul(
    float(1).sub(smoothstep(float(0.3), float(1.1), dw)),
  )
  const fleck = smoothstep(float(0.8), float(0.88), fine)
    .mul(float(1).sub(smoothstep(float(0.2), float(1.4), dw)))
    .mul(0.6)
  const foam = lip.mul(0.9).add(lapLine.mul(0.65)).add(fleck).clamp(0, 1)

  const sparkle = smoothstep(float(0.84), float(0.9), fine)
    .mul(smoothstep(float(1), float(2), dw))
    .mul(0.45)
  material.colorNode = mix(tinted, color(0xf4fbf6), foam).add(sparkle)
  material.opacityNode = mix(float(0.7), float(0.94), smoothstep(float(0.1), float(1.2), dw)).max(
    foam,
  )

  const mesh = new Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.name = "water"
  return mesh
}
