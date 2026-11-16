/**
 * Health bars — one instanced billboard quad per unit with an `hp` value.
 * The bar is a single quad; a TSL fragment splits it into fill (team colour)
 * and empty (dark) by uv.x vs the per-instance hp stored in instanceColor.r.
 * Team is encoded in instanceColor.g (0 radiant, 0.5 dire, 1 neutral); heroes get
 * a taller bar via instance scale.
 */
import {
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three/webgpu"
import { color, float, mix, smoothstep, step, uv, vec3 } from "three/tsl"
import { instanceColor } from "three/tsl"

const MAX = 600

export const createBarLayer = () => {
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide })
  const hp = instanceColor.r
  const team = instanceColor.g
  const u = uv()
  const teamCol = mix(
    mix(color(0x6af08a), color(0xff6a4a), step(float(0.25), team)),
    color(0xd0b0ff),
    step(float(0.75), team),
  )
  const filled = step(u.x, hp)
  // 1px-ish dark border.
  const border = smoothstep(float(0.0), float(0.08), u.y).mul(
    smoothstep(float(1.0), float(0.92), u.y),
  )
  const fill = mix(vec3(0.08, 0.08, 0.1), teamCol, filled)
  mat.colorNode = mix(vec3(0.02, 0.02, 0.03), fill, border)
  mat.opacityNode = float(0.92)

  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, MAX)
  mesh.frustumCulled = false
  mesh.count = 0
  mesh.renderOrder = 10
  mesh.name = "health-bars"
  const m = new Matrix4()
  const p = new Vector3()
  const s = new Vector3()
  const c = new Color()
  mesh.setColorAt(0, c.setRGB(1, 0, 0))

  /** `q` = camera quaternion so bars face the camera. */
  const update = (
    bars: readonly { x: number; y: number; z: number; hp: number; team: string; hero: boolean }[],
    q: Quaternion,
  ) => {
    let n = 0
    for (const b of bars) {
      if (n >= MAX) break
      p.set(b.x, b.y, b.z)
      s.set(b.hero ? 1.1 : 0.6, b.hero ? 0.13 : 0.08, 1)
      m.compose(p, q, s)
      mesh.setMatrixAt(n, m)
      mesh.setColorAt(
        n,
        c.setRGB(
          Math.max(0, Math.min(1, b.hp)),
          b.team === "radiant" ? 0 : b.team === "dire" ? 0.5 : 1,
          0,
        ),
      )
      n++
    }
    mesh.count = n
    if (n) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }
  return { mesh, update, dispose: () => mesh.dispose() }
}
