import { Data } from "effect"

/** The browser could not create any GPU renderer (neither WebGPU nor the WebGL2 fallback). */
export class RendererInitError extends Data.TaggedError("RendererInitError")<{
  readonly cause: unknown
}> {}
