/**
 * World — everything three.js, no Effect. Built once from a MobaMap; owns the
 * scene, camera, lights and picking. `dispose()` frees every GPU resource.
 * Internal seam of the engine: MapView (map-view.ts) is its only caller.
 */
import type { MobaMap } from "@mobacraft/map"
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  OrthographicCamera,
  PCFShadowMap,
  Raycaster,
  Scene,
  Vector2,
  WebGPURenderer,
} from "three/webgpu"
import type { Pose } from "./camera-rig.ts"
import { color as tslColor, mix, screenUV, smoothstep, uniform } from "three/tsl"
import { createPost } from "./post.ts"
import { buildFoliage } from "./scene/foliage.ts"
import { buildAmbient } from "./scene/ambient.ts"
import { buildLaneProps } from "./scene/lane-props.ts"
import { buildSelectionRing, buildStructures, nightGlow } from "./scene/structures.ts"
import { buildTerrain } from "./scene/terrain.ts"
import { buildWater } from "./scene/water.ts"
import { skyAt } from "./sky.ts"

export interface Picked {
  readonly id: string
  readonly kind: string
  readonly team: string
}

export const createWorld = (renderer: WebGPURenderer, map: MobaMap) => {
  const scene = new Scene()
  // Soft vertical backdrop gradient; the top tint follows the sky colour.
  const skyTint = uniform(new Color(0x1d2427))
  scene.backgroundNode = mix(
    tslColor(0x0e1113),
    skyTint,
    smoothstep(0.0, 1.0, screenUV.y.oneMinus()),
  )

  const terrain = buildTerrain(map)
  const water = buildWater(map)
  const foliage = buildFoliage(map)
  const { visuals: structures, pickables } = buildStructures(map)
  const laneProps = buildLaneProps(map)
  const ambient = buildAmbient(map)
  const ring = buildSelectionRing()
  scene.add(terrain, water, foliage, laneProps, structures, pickables, ring, ambient.group)
  for (const o of [terrain, water, foliage, laneProps, structures, pickables]) {
    o.traverse((c) => {
      c.matrixAutoUpdate = false
      c.updateMatrix()
    })
  }

  const hemi = new HemisphereLight(0xffffff, 0x444444, 1)
  const sun = new DirectionalLight(0xffffff, 2)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0003
  sun.shadow.normalBias = 0.04
  sun.shadow.radius = 3
  const sc = sun.shadow.camera
  sc.near = 1
  sc.far = map.size * 4
  scene.add(hemi, sun, sun.target)
  /** Sun direction (unit, toward the sun) — shadows follow the camera focus. */
  const sunDir = { x: 0, y: 1, z: 0 }
  let shadowHalf = map.size * 0.75
  const placeSun = (fx: number, fz: number) => {
    const d = map.size * 1.5
    sun.position.set(fx + sunDir.x * d, sunDir.y * d, fz + sunDir.z * d)
    sun.target.position.set(fx, 0, fz)
    sun.target.updateMatrixWorld()
    sc.left = -shadowHalf
    sc.right = shadowHalf
    sc.top = shadowHalf
    sc.bottom = -shadowHalf
    sc.updateProjectionMatrix()
  }

  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
  const post = createPost(renderer, scene, camera, { ao: true })
  const centre = map.size / 2

  const setSize = (width: number, height: number) => {
    renderer.setSize(width, height, false)
    const aspect = width / Math.max(1, height)
    camera.userData.aspect = aspect
  }

  const applyPose = (pose: Pose) => {
    const aspect = (camera.userData.aspect as number | undefined) ?? 1
    const y = map.heightAt(pose.target.x, pose.target.z)
    const d = 300
    camera.position.set(
      pose.target.x + pose.back.x * d,
      y + pose.back.y * d,
      pose.target.z + pose.back.z * d,
    )
    camera.lookAt(pose.target.x, y, pose.target.z)
    camera.top = pose.halfHeight
    camera.bottom = -pose.halfHeight
    camera.left = -pose.halfHeight * aspect
    camera.right = pose.halfHeight * aspect
    camera.updateProjectionMatrix()
    // Tight shadow frustum around what's visible → crisper shadows when zoomed in.
    const next = Math.min(
      map.size * 0.75,
      Math.max(14, pose.halfHeight * Math.max(1, aspect) * 1.6),
    )
    const snap = Math.abs(next - shadowHalf) / shadowHalf > 0.08
    if (snap) shadowHalf = next
    placeSun(pose.target.x, pose.target.z)
  }

  const setTimeOfDay = (t: number) => {
    const sky = skyAt(t)
    sun.color.setHex(sky.sunColor)
    sun.intensity = sky.sunIntensity
    sunDir.x = sky.sunDir.x
    sunDir.y = sky.sunDir.y
    sunDir.z = sky.sunDir.z
    placeSun(sun.target.position.x || centre, sun.target.position.z || centre)
    skyTint.value.setHex(sky.skyColor).multiplyScalar(0.16)
    post.setNight(sky.night)
    nightGlow.value = sky.night
    ambient.setNight(sky.night)
    hemi.color.setHex(sky.skyColor)
    hemi.groundColor.setHex(sky.groundColor)
    hemi.intensity = sky.ambient
    return sky.label
  }

  // --- picking ----------------------------------------------------------------
  const raycaster = new Raycaster()
  const ndc = new Vector2()
  const pick = (ndcX: number, ndcY: number): Picked | null => {
    ndc.set(ndcX, ndcY)
    raycaster.setFromCamera(ndc, camera)
    const o = raycaster.intersectObject(pickables, true)[0]?.object
    return o
      ? {
          id: o.userData.id as string,
          kind: o.userData.kind as string,
          team: o.userData.team as string,
        }
      : null
  }
  /** Ground point under the cursor (for zoom-to-cursor and focus). */
  const groundAt = (ndcX: number, ndcY: number) => {
    ndc.set(ndcX, ndcY)
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObject(terrain, false)[0]
    return hit ? { x: hit.point.x, z: hit.point.z } : null
  }

  const highlight = (id: string | null) => {
    const target = id ? pickables.getObjectByName(id) : undefined
    ring.visible = target !== undefined
    if (!target) return
    const r = (target.userData.radius as number) + 0.35
    ring.position.set(target.position.x, target.position.y + 0.08, target.position.z)
    ring.scale.set(r, 1, r)
  }

  return {
    setSize,
    applyPose,
    setTimeOfDay,
    pick,
    groundAt,
    highlight,
    render: () => post.render(),
    stats: () => ({
      calls: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
    }),
    dispose: () => {
      post.dispose()
      scene.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose()
          const m = o.material
          for (const mm of Array.isArray(m) ? m : [m]) mm.dispose()
        }
      })
    },
  }
}

export type World = ReturnType<typeof createWorld>
