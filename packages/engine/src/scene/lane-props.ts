import { Terrain, type MobaMap } from "@mobacraft/map"
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  AdditiveBlending,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Object3D,
  OctahedronGeometry,
} from "three/webgpu"
import { color, float, smoothstep, uv } from "three/tsl"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { WINDOW } from "../palette.ts"
import { nightGlow } from "./structures.ts"

const dummy = new Object3D()

/**
 * Lane dressing: lantern posts at regular intervals along each lane (glowing at
 * night), and short fence runs where lanes cross open grass. Placement walks
 * each lane polyline and offsets to both sides, skipping water and structures.
 * Three instanced meshes total.
 */
export const buildLaneProps = (map: MobaMap): Group => {
  const group = new Group()
  group.name = "lane-props"

  type Post = { x: number; z: number; y: number; a: number }
  const lanterns: Post[] = []
  const fences: Post[] = []

  const nearStructure = (x: number, z: number, r: number) =>
    map.structures.some((s) => Math.hypot(s.position.x - x, s.position.z - z) < s.radius + r)
  const ok = (x: number, z: number) => {
    const t = map.terrainAt(x, z)
    return (t === Terrain.Grass || t === Terrain.Shore) && !nearStructure(x, z, 1.4)
  }

  for (const lane of map.lanes) {
    let carry = 0
    let k = 0
    for (let i = 0; i < lane.path.length - 1; i++) {
      const a = lane.path[i]!
      const b = lane.path[i + 1]!
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      const dx = (b.x - a.x) / len
      const dz = (b.z - a.z) / len
      for (let d = carry; d < len; d += 3) {
        k++
        const cx = a.x + dx * d
        const cz = a.z + dz * d
        const angle = Math.atan2(dx, dz)
        for (const side of [-1, 1]) {
          const off = 3.2
          const x = cx - dz * off * side
          const z = cz + dx * off * side
          if (!ok(x, z)) continue
          const y = map.heightAt(x, z)
          // Lanterns every ~12 units, alternating sides; fences in between.
          if (k % 4 === 0 && (k / 4) % 2 === (side > 0 ? 0 : 1))
            lanterns.push({ x, z, y, a: angle })
          else if (k % 4 === 2) fences.push({ x, z, y, a: angle })
        }
      }
      carry = (carry + len) % 3
    }
  }

  const wood = new MeshStandardNodeMaterial({ color: 0x7a5a3c, roughness: 0.95, flatShading: true })
  const glass = new MeshStandardNodeMaterial({ color: 0x3a2a18, roughness: 0.5, flatShading: true })
  glass.emissiveNode = color(WINDOW).mul(nightGlow.mul(2.2).add(0.15))

  // Lantern: post + lamp, two instanced meshes sharing transforms.
  const postGeo = new CylinderGeometry(0.05, 0.07, 1.3, 5).translate(0, 0.65, 0)
  const lampGeo = new OctahedronGeometry(0.13).scale(1, 1.3, 1).translate(0, 1.42, 0)
  const posts = new InstancedMesh(postGeo, wood, Math.max(1, lanterns.length))
  const lamps = new InstancedMesh(lampGeo, glass, Math.max(1, lanterns.length))
  posts.count = lamps.count = lanterns.length
  lanterns.forEach((l, i) => {
    dummy.position.set(l.x, l.y, l.z)
    dummy.rotation.set(0, l.a, 0)
    dummy.scale.setScalar(1)
    dummy.updateMatrix()
    posts.setMatrixAt(i, dummy.matrix)
    lamps.setMatrixAt(i, dummy.matrix)
  })
  posts.castShadow = true

  // Fence segment: two posts + two rails merged into one geometry.
  const fenceGeo = mergeGeometries([
    new BoxGeometry(0.08, 0.5, 0.08).translate(0, 0.25, -0.6),
    new BoxGeometry(0.08, 0.5, 0.08).translate(0, 0.25, 0.6),
    new BoxGeometry(0.05, 0.06, 1.3).translate(0, 0.38, 0),
    new BoxGeometry(0.05, 0.06, 1.3).translate(0, 0.2, 0),
  ])!
  const fenceMesh = new InstancedMesh(fenceGeo, wood, Math.max(1, fences.length))
  fenceMesh.count = fences.length
  const tint = new Color()
  fences.forEach((f, i) => {
    dummy.position.set(f.x, f.y, f.z)
    dummy.rotation.set(0, f.a + (i % 3 === 0 ? 0.08 : -0.05), (i % 5) * 0.02)
    dummy.scale.setScalar(1)
    dummy.updateMatrix()
    fenceMesh.setMatrixAt(i, dummy.matrix)
    fenceMesh.setColorAt(i, tint.setHex(0xffffff).multiplyScalar(0.85 + (i % 4) * 0.05))
  })
  fenceMesh.castShadow = true
  fenceMesh.receiveShadow = true

  // Fake light pools: additive radial discs on the ground, visible only at night.
  const poolMat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const r = uv().sub(0.5).length().mul(2)
  poolMat.colorNode = color(0xffb766)
  poolMat.opacityNode = smoothstep(float(1), float(0), r).pow(2).mul(nightGlow).mul(0.55)
  const lights = [
    ...lanterns.map((l) => ({ x: l.x, y: l.y, z: l.z, s: 3.2 })),
    ...map.camps.map((c) => ({
      x: c.position.x,
      y: map.heightAt(c.position.x, c.position.z),
      z: c.position.z,
      s: 4,
    })),
  ]
  const pools = new InstancedMesh(
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    poolMat,
    Math.max(1, lights.length),
  )
  pools.count = lights.length
  lights.forEach((l, i) => {
    dummy.position.set(l.x, l.y + 0.04, l.z)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(l.s, 1, l.s)
    dummy.updateMatrix()
    pools.setMatrixAt(i, dummy.matrix)
  })
  pools.renderOrder = 2

  group.add(posts, lamps, fenceMesh, pools)
  return group
}
