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
import { createCreepSim, CREATURE_NAME, type Creature } from "@mobacraft/sim"
import { creatureModel } from "./creatures/kit.ts"
import { createCreatureLayer } from "./creatures/render.ts"
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
  /** Display name when the kind alone isn't enough (creatures). */
  readonly name?: string
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
  // Creatures: the sim owns where they are; the layer only draws snapshots.
  const sim = createCreepSim(map)
  const creatures = createCreatureLayer(map)
  let snapshot: readonly Creature[] = []
  const ring = buildSelectionRing()
  scene.add(
    terrain,
    water,
    foliage,
    laneProps,
    structures,
    pickables,
    ring,
    ambient.group,
    creatures.group,
  )
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
    const hit = raycaster.intersectObject(pickables, true)[0]
    // Creatures: nearest one whose body the ray passes through (sampled at mid-height).
    const { origin, direction } = raycaster.ray
    let best: { c: Creature; t: number } | null = null
    for (const c of snapshot) {
      const model = creatureModel(c.kind)
      const y = map.heightAt(c.x, c.z) + model.height * 0.5
      const t = (y - origin.y) / direction.y
      const dx = origin.x + direction.x * t - c.x
      const dz = origin.z + direction.z * t - c.z
      if (Math.hypot(dx, dz) < Math.max(0.45, model.radius * 0.9) && (!best || t < best.t))
        best = { c, t }
    }
    // Creatures win over camp/landmark proxies (they stand inside them); buildings
    // still win when clearly in front.
    const proxyIsArea = hit && String(hit.object.userData.kind).match(/^camp-|^roshan$|^rune$/)
    if (best && (!hit || proxyIsArea || best.t < hit.distance)) {
      const c = best.c
      return { id: `creature-${c.id}`, kind: c.kind, team: c.team, name: CREATURE_NAME[c.kind] }
    }
    const o = hit?.object
    return o
      ? {
          id: o.userData.id as string,
          kind: o.userData.kind as string,
          team: o.userData.team as string,
        }
      : null
  }
  /** Current position of a picked creature (they move), for the ring and camera follow. */
  const creatureById = (id: string) => {
    const n = Number(id.slice("creature-".length))
    return snapshot.find((c) => c.id === n)
  }
  /** Ground point under the cursor (for zoom-to-cursor and focus). */
  const groundAt = (ndcX: number, ndcY: number) => {
    ndc.set(ndcX, ndcY)
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObject(terrain, false)[0]
    return hit ? { x: hit.point.x, z: hit.point.z } : null
  }

  let highlighted: string | null = null
  const highlight = (id: string | null) => {
    highlighted = id
    if (id?.startsWith("creature-")) {
      const c = creatureById(id)
      ring.visible = c !== undefined
      if (!c) return
      const r = creatureModel(c.kind).radius + 0.3
      ring.position.set(c.x, map.heightAt(c.x, c.z) + 0.08, c.z)
      ring.scale.set(r, 1, r)
      return
    }
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
    /** Advance creature sim; the ring follows a selected creature. */
    tick: (dt: number) => {
      sim.step(dt)
      snapshot = sim.creatures()
      creatures.update(snapshot)
      if (highlighted?.startsWith("creature-")) highlight(highlighted)
    },
    creatureById,
    render: () => post.render(),
    stats: () => ({
      calls: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
    }),
    dispose: () => {
      post.dispose()
      creatures.dispose()
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
