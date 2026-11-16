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

/** One bar to draw this frame. `team` is "radiant" | "dire" | anything else (neutral). */
export interface HealthBar {
  readonly x: number
  readonly y: number
  readonly z: number
  /** 0..1, clamped. */
  readonly hp: number
  readonly team: string
  /** Heroes (and structures) get a larger bar. */
  readonly hero: boolean
}

const teamCode = (team: string) => (team === "radiant" ? 0 : team === "dire" ? 0.5 : 1)

const barMaterial = () => {
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
  return mat
}

export class BarLayer {
  readonly mesh: InstancedMesh
  readonly #m = new Matrix4()
  readonly #p = new Vector3()
  readonly #s = new Vector3()
  readonly #c = new Color()

  constructor() {
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), barMaterial(), MAX)
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.renderOrder = 10
    mesh.name = "health-bars"
    mesh.setColorAt(0, this.#c.setRGB(1, 0, 0))
    this.mesh = mesh
  }

  /** `q` = camera quaternion so bars face the camera. */
  update(bars: readonly HealthBar[], q: Quaternion): void {
    const mesh = this.mesh
    let n = 0
    for (const b of bars) {
      if (n >= MAX) break
      this.#p.set(b.x, b.y, b.z)
      this.#s.set(b.hero ? 1.1 : 0.6, b.hero ? 0.13 : 0.08, 1)
      this.#m.compose(this.#p, q, this.#s)
      mesh.setMatrixAt(n, this.#m)
      mesh.setColorAt(n, this.#c.setRGB(Math.max(0, Math.min(1, b.hp)), teamCode(b.team), 0))
      n++
    }
    mesh.count = n
    if (n) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  dispose(): void {
    this.mesh.dispose()
  }
}

/** @deprecated Prefer `new BarLayer()`. */
export const createBarLayer = (): BarLayer => new BarLayer()
