import { type MobaMap, Terrain } from "@mobacraft/map"
import { TEAM, TERRAIN_COLOR } from "./palette.ts"

const css = (hex: number) => `#${hex.toString(16).padStart(6, "0")}`

/**
 * Paint a static top-down minimap of `map` into a 2D canvas (1 px per tile × `scale`).
 * The live viewport marker is the caller's job — it changes every frame, this doesn't.
 */
export const drawMinimap = (map: MobaMap, canvas: HTMLCanvasElement, scale = 2) => {
  const N = map.size
  canvas.width = N * scale
  canvas.height = N * scale
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const img = ctx.createImageData(N, N)
  for (let i = 0; i < N * N; i++) {
    const team = map.side[i] === 0 ? "radiant" : "dire"
    let hex = TERRAIN_COLOR[team][map.terrain[i] as Terrain]
    if (map.terrain[i] === Terrain.Water) hex = 0x3f7f8a
    const shade = 0.85 + map.height[i]! * 0.1
    img.data[i * 4] = Math.min(255, ((hex >> 16) & 0xff) * shade)
    img.data[i * 4 + 1] = Math.min(255, ((hex >> 8) & 0xff) * shade)
    img.data[i * 4 + 2] = Math.min(255, (hex & 0xff) * shade)
    img.data[i * 4 + 3] = 255
  }
  const tmp = document.createElement("canvas")
  tmp.width = N
  tmp.height = N
  tmp.getContext("2d")?.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, 0, 0, N * scale, N * scale)

  for (const s of map.structures) {
    const r = s.kind === "ancient" ? 3.2 : s.kind === "tower" ? 1.6 : 1.3
    ctx.fillStyle = css(TEAM[s.team].accent)
    ctx.strokeStyle = "rgba(0,0,0,0.6)"
    ctx.lineWidth = 1
    ctx.beginPath()
    if (s.kind === "tower" || s.kind === "ancient")
      ctx.arc(s.position.x * scale, s.position.z * scale, r * scale, 0, Math.PI * 2)
    else
      ctx.rect((s.position.x - r) * scale, (s.position.z - r) * scale, r * 2 * scale, r * 2 * scale)
    ctx.fill()
    ctx.stroke()
  }
  for (const c of map.camps) {
    ctx.fillStyle = "#f5b04a"
    ctx.beginPath()
    ctx.arc(c.position.x * scale, c.position.z * scale, 1.1 * scale, 0, Math.PI * 2)
    ctx.fill()
  }
  for (const l of map.landmarks) {
    ctx.fillStyle = l.kind === "roshan" ? "#b07cff" : "#56d6ff"
    ctx.beginPath()
    ctx.arc(
      l.position.x * scale,
      l.position.z * scale,
      (l.kind === "roshan" ? 2.4 : 1.4) * scale,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
}
