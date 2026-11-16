/**
 * Post-processing stack (TSL, WebGPU-first; three compiles the same graph to GLSL on fallback):
 *   scene pass (MRT: colour + view normals + emissive)
 *   → GTAO ambient occlusion fed back into the lighting (contact shadows under trees/buildings)
 *   → selective bloom on emissive only (team crystals, campfires, runes)
 *   → warm "diorama" grade: gentle saturation lift, lifted shadows, soft vignette.
 */
import type { Camera, Scene, WebGPURenderer } from "three/webgpu"
import { RenderPipeline } from "three/webgpu"
import {
  builtinAOContext,
  emissive,
  float,
  length,
  mix,
  mrt,
  normalView,
  output,
  pass,
  saturation,
  screenUV,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl"
import { bloom } from "three/addons/tsl/display/BloomNode.js"
import { ao } from "three/addons/tsl/display/GTAONode.js"

export interface PostOptions {
  /** Ambient occlusion is the most expensive pass; disable on weak GPUs. */
  readonly ao: boolean
}

export const createPost = (
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  opts: PostOptions,
) => {
  const pipeline = new RenderPipeline(renderer)

  const scenePass = pass(scene, camera)
  scenePass.setMRT(mrt({ output, normal: normalView, emissive }))
  const color = scenePass.getTextureNode("output")
  const glow = scenePass.getTextureNode("emissive")

  if (opts.ao) {
    // AO from a cheaper depth/normal pre-pass at half resolution.
    const prePass = pass(scene, camera)
    prePass.setMRT(mrt({ output: normalView }))
    const aoPass = ao(prePass.getTextureNode("depth"), prePass.getTextureNode(), camera)
    aoPass.resolutionScale = 0.5
    aoPass.radius.value = 0.6
    aoPass.distanceExponent.value = 1.4
    aoPass.scale.value = 1.15
    scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r)
  }

  /** 0 at day, 1 at night — night lets the glows bloom harder. */
  const night = uniform(0)
  const bloomPass = bloom(glow, 1, 0.45, 0.05)

  const lit = color.rgb.add(bloomPass.rgb.mul(night.mul(0.9).add(0.45)))
  const graded = saturation(lit, float(1.08))
  // Vignette: darken toward the corners so the island floats in the centre.
  const v = smoothstep(float(0.95), float(0.35), length(screenUV.sub(0.5).mul(vec3(1.25, 1, 0).xy)))
  const final = mix(graded.mul(0.72), graded, v)
  pipeline.outputNode = vec4(final, float(1))

  return {
    render: () => pipeline.render(),
    setNight: (n: number) => {
      night.value = n
    },
    dispose: () => pipeline.dispose(),
  }
}

export type Post = ReturnType<typeof createPost>
