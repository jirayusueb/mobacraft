import { Terrain, type MobaMap } from "@mobacraft/map"
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardNodeMaterial } from "three/webgpu"
import { color, float, mix, mx_noise_float, positionWorld, smoothstep, time, vec3 } from "three/tsl"

/**
 * River surface: only tiles that are water get a quad. The material is pure TSL —
 * drifting noise for ripples and sparkles, compiled to WGSL on WebGPU (GLSL on fallback).
 */
export const buildWater = (map: MobaMap): Mesh => {
  const N = map.size
  const y = map.waterLevel
  const pos: number[] = []
  for (let tz = 0; tz < N; tz++) {
    for (let tx = 0; tx < N; tx++) {
      if (map.terrain[tz * N + tx] !== Terrain.Water) continue
      // Slight overlap hides seams against the shore cliffs.
      const a = [tx - 0.02, y, tz - 0.02]
      const b = [tx - 0.02, y, tz + 1.02]
      const c = [tx + 1.02, y, tz + 1.02]
      const d = [tx + 1.02, y, tz - 0.02]
      pos.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3))
  geometry.computeVertexNormals()

  const material = new MeshStandardNodeMaterial({
    roughness: 0.25,
    metalness: 0,
    transparent: true,
  })
  const p = positionWorld.xz
  const drift = vec3(p.x.mul(0.35).add(time.mul(0.25)), p.y.mul(0.35), time.mul(0.15))
  const ripple = mx_noise_float(drift).mul(0.5).add(0.5)
  const sparkle = smoothstep(
    float(0.72),
    float(0.8),
    mx_noise_float(vec3(p.mul(1.4), time.mul(0.6))),
  )
  const deep = color(0x2f5a63)
  const shallow = color(0x5f9c95)
  material.colorNode = mix(deep, shallow, ripple).add(sparkle.mul(0.35))
  material.opacityNode = float(0.88)

  const mesh = new Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.name = "water"
  return mesh
}
