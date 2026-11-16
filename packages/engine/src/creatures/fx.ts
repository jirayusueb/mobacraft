/**
 * Combat FX — pooled effect records simulated on the CPU, drawn through six
 * instanced meshes (fx-draw.ts; ≤ 6 draw calls total). Driven by Population FxEvents.
 *
 * Per-style looks:
 *  - arrow   thin team-tinted streak with a bright tip, tiny spark on landing
 *  - bolt    faceted orb (style core + team halo) with a short fading trail; ring flash on impact
 *  - siege   big tumbling ember boulder on a high arc; dust ring + smoke puffs + debris on impact
 *  - beam    stretched lance from caster to target that flares then thins; impact flare
 *  - slash   two crossing crescent arcs swept across the target, quick
 *  - nova    expanding filled disc + shock ring + upward sparks
 *  - storm   staggered falling lightning-rain streaks over the radius with ground flashes
 *  - heal    soft green ring + rising plus-shaped motes
 *  - shield  translucent faceted dome with fresnel rim and scan band, pulses then fades
 * Kinds: stun = orbiting star ring above the head, levelup = golden pillar + motes,
 * death = dark smoke puffs + pale skull flash with glowing eyes, hit = white spark burst.
 * Everything glowing is additive emissive (night bloom picks it up) and fades by
 * darkening the instance colour. `update` is allocation-free.
 */
import type { FxEvent, FxStyle } from "@mobacraft/sim"
import { Color, Group, Vector3 } from "three/webgpu"
import { createFxDraw } from "./fx-draw.ts"

// --- palette -----------------------------------------------------------------------
const TEAM: Record<string, Color> = {
  radiant: new Color(0x8affb0),
  dire: new Color(0xff7a3a),
  neutral: new Color(0xc8a0ff),
}
const C = {
  white: new Color(0xffffff),
  bolt: new Color(0xb4a0ff),
  nova: new Color(0xff9a3a),
  novaHot: new Color(0xffe0a0),
  slash: new Color(0xd8ecff),
  beam: new Color(0x6ad8ff),
  heal: new Color(0x7dff8a),
  shield: new Color(0x7ec8ff),
  storm: new Color(0xa68aff),
  stormHot: new Color(0xe6dcff),
  stun: new Color(0xffe066),
  gold: new Color(0xffc23a),
  goldHot: new Color(0xfff0b0),
  ember: new Color(0xff9a50),
  smoke: new Color(0x2e2636),
  dust: new Color(0x8a7058),
  bone: new Color(0xe6e0f4),
  soul: new Color(0xb060ff),
} as const

// --- effect types ------------------------------------------------------------------
const ARROW = 0
const BOLT = 1
const SIEGE = 2
const ORB = 3
const BEAM = 4
const SLASH = 5
const WHIRL = 6
const NOVA = 7
const STORM = 8
const HEAL = 9
const SHIELD = 10
const COLUMN = 11
const BURST = 12
const STUN = 13
const LEVELUP = 14
const DEATH = 15
const HIT = 16
const DUST = 17

/** Aoe effect type for a style. */
const AOE_OF: Record<FxStyle, number> = {
  bolt: BURST,
  arrow: BURST,
  siege: DUST,
  nova: NOVA,
  storm: STORM,
  heal: HEAL,
  shield: SHIELD,
  slash: WHIRL,
  beam: COLUMN,
}
const STYLE_COLOR: Record<FxStyle, Color> = {
  bolt: C.bolt,
  arrow: C.white,
  siege: C.ember,
  nova: C.nova,
  storm: C.storm,
  heal: C.heal,
  shield: C.shield,
  slash: C.slash,
  beam: C.beam,
}

interface Rec {
  type: number
  /** follow-up aoe type for ORB */
  sub: number
  t0: number
  dur: number
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  r: number
  seed: number
  readonly c: Color
  readonly c2: Color
}

const MAX_FX = 384

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
const easeOut = (k: number) => 1 - (1 - k) * (1 - k)
const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k)

export const createFxLayer = (heightAt: (x: number, z: number) => number) => {
  const draw = createFxDraw()
  const { camRight } = draw
  const group = new Group()
  group.name = "fx"
  group.add(...draw.meshes)

  const pool: Rec[] = []
  for (let i = 0; i < MAX_FX; i++)
    pool.push({
      type: 0,
      sub: 0,
      t0: 0,
      dur: 1,
      ax: 0,
      ay: 0,
      az: 0,
      bx: 0,
      by: 0,
      bz: 0,
      r: 1,
      seed: 0,
      c: new Color(),
      c2: new Color(),
    })
  /** active[0..live) are running; the rest are free. */
  const active: Rec[] = pool.slice()
  let live = 0
  let seedN = 1

  const spawn = (type: number, now: number, dur: number): Rec | null => {
    if (live >= MAX_FX) return null
    const r = active[live++]!
    r.type = type
    r.sub = 0
    r.t0 = now
    r.dur = dur
    r.r = 1
    r.seed = seedN++ % 9973
    return r
  }
  const at = (r: Rec, x: number, z: number, lift = 0) => {
    r.ax = r.bx = x
    r.az = r.bz = z
    r.ay = r.by = heightAt(x, z) + lift
    return r
  }
  const spawnAoe = (type: number, now: number, x: number, y: number, z: number, radius: number) => {
    const dur =
      type === STORM
        ? 0.8
        : type === SHIELD
          ? 1.1
          : type === HEAL
            ? 0.95
            : type === DUST
              ? 0.85
              : type === WHIRL
                ? 0.45
                : type === COLUMN
                  ? 0.6
                  : type === BURST
                    ? 0.35
                    : 0.6
    const r = spawn(type, now, dur)
    if (!r) return null
    r.ax = r.bx = x
    r.ay = r.by = y
    r.az = r.bz = z
    r.r = radius
    return r
  }

  const push = (events: readonly FxEvent[], now: number) => {
    for (const e of events) {
      const team = TEAM[e.team] ?? TEAM.neutral!
      if (e.kind === "projectile") {
        const s = e.style
        const fromY = heightAt(e.from.x, e.from.z)
        const toY = heightAt(e.to.x, e.to.z)
        let r: Rec | null
        if (s === "beam" || s === "slash") {
          r = spawn(s === "beam" ? BEAM : SLASH, now, s === "beam" ? 0.45 : 0.32)
          if (!r) continue
          r.c.copy(STYLE_COLOR[s])
        } else if (s === "arrow") {
          r = spawn(ARROW, now, Math.max(0.08, e.duration))
          if (!r) continue
          r.c.copy(team)
          r.c2.copy(team).lerp(C.white, 0.6)
        } else if (s === "siege") {
          r = spawn(SIEGE, now, Math.max(0.3, e.duration * 1.6))
          if (!r) continue
          r.c.copy(C.ember).lerp(team, 0.35)
          r.c2.copy(team)
        } else if (s === "bolt") {
          r = spawn(BOLT, now, Math.max(0.08, e.duration))
          if (!r) continue
          r.c.copy(C.bolt).lerp(C.white, 0.35)
          r.c2.copy(team)
        } else {
          r = spawn(ORB, now, Math.max(0.12, e.duration))
          if (!r) continue
          r.sub = AOE_OF[s]
          r.c.copy(STYLE_COLOR[s])
          r.c2.copy(STYLE_COLOR[s]).lerp(C.white, 0.5)
        }
        r.ax = e.from.x
        r.ay = fromY + 0.75
        r.az = e.from.z
        r.bx = e.to.x
        r.by = toY + 0.6
        r.bz = e.to.z
      } else if (e.kind === "aoe") {
        const type = AOE_OF[e.style]
        const r = spawnAoe(
          type,
          now,
          e.at.x,
          heightAt(e.at.x, e.at.z) + 0.06,
          e.at.z,
          Math.max(0.5, e.radius),
        )
        if (!r) continue
        r.c.copy(STYLE_COLOR[e.style])
        r.c2.copy(team)
      } else {
        const y = heightAt(e.at.x, e.at.z) + 0.06
        let r: Rec | null = null
        switch (e.kind) {
          case "heal":
            r = spawnAoe(HEAL, now, e.at.x, y, e.at.z, 0.8)
            if (r) r.c.copy(C.heal)
            break
          case "shield":
            r = spawnAoe(SHIELD, now, e.at.x, y, e.at.z, 0.75)
            if (r) r.c.copy(C.shield)
            break
          case "stun":
            r = spawn(STUN, now, 1.1)
            if (r) at(r, e.at.x, e.at.z).c.copy(C.stun)
            break
          case "levelup":
            r = spawn(LEVELUP, now, 1.25)
            if (r) at(r, e.at.x, e.at.z, 0.05).c.copy(C.gold)
            break
          case "death":
            r = spawn(DEATH, now, 1.15)
            if (r) {
              at(r, e.at.x, e.at.z)
              r.c.copy(C.soul)
              r.c2.copy(team)
            }
            break
          case "hit":
            r = spawn(HIT, now, 0.2)
            if (r) {
              at(r, e.at.x, e.at.z, 0.75)
              r.c.copy(C.white).lerp(team, 0.3)
            }
            break
        }
      }
    }
  }

  // --- per-type renderers (allocation-free) -----------------------------------------
  const P = new Vector3()
  const Q = new Vector3()
  /** Point along a projectile arc at progress k. */
  const arc = (r: Rec, k: number, h: number, out: Vector3) => {
    const kk = clamp01(k)
    out.set(
      r.ax + (r.bx - r.ax) * kk,
      r.ay + (r.by - r.ay) * kk + Math.sin(kk * Math.PI) * h,
      r.az + (r.bz - r.az) * kk,
    )
    return out
  }
  const flightDist = (r: Rec) => Math.hypot(r.bx - r.ax, r.bz - r.az)

  const drawArrow = (r: Rec, k: number) => {
    const h = 0.25 + flightDist(r) * 0.03
    arc(r, k, h, P)
    arc(r, k - 0.06, h, Q)
    // Direction × fixed length so the streak is ~0.85 long regardless of speed.
    const dx = P.x - Q.x
    const dy = P.y - Q.y
    const dz = P.z - Q.z
    const l = Math.hypot(dx, dy, dz) || 1
    const L = 0.85 * Math.min(1, k * 6 + 0.2)
    draw.streak(
      P.x - (dx / l) * L,
      P.y - (dy / l) * L,
      P.z - (dz / l) * L,
      P.x,
      P.y,
      P.z,
      0.04,
      r.c,
      2.2,
      1,
    )
    draw.gem(P.x, P.y, P.z, 0.055, 0, r.c2, 2.6)
  }

  const drawBolt = (r: Rec, k: number, t: number) => {
    const h = 0.4
    arc(r, k, h, P)
    arc(r, k - 0.35, h, Q)
    draw.streak(Q.x, Q.y, Q.z, P.x, P.y, P.z, 0.1, r.c2, 1.6, 1)
    draw.gem(P.x, P.y, P.z, 0.22, -t * 5, r.c2, 0.9)
    draw.gem(P.x, P.y, P.z, 0.12, t * 9, r.c, 2.8)
  }

  const drawSiege = (r: Rec, k: number, t: number) => {
    const h = 1.6 + flightDist(r) * 0.08
    arc(r, k, h, P)
    draw.gem(P.x, P.y, P.z, 0.27, t * 7 + r.seed, r.c, 1.3)
    draw.gem(P.x, P.y, P.z, 0.17, -t * 4, C.goldHot, 0.9)
    for (let j = 1; j <= 4; j++) {
      arc(r, k - j * 0.05, h, Q)
      draw.gem(Q.x, Q.y, Q.z, 0.09 * (1 - j * 0.18), t * 3 + j, C.ember, 1.6 * (1 - j * 0.2))
    }
  }

  const drawOrb = (r: Rec, k: number, t: number) => {
    const h = 0.5
    arc(r, k, h, P)
    arc(r, k - 0.3, h, Q)
    draw.streak(Q.x, Q.y, Q.z, P.x, P.y, P.z, 0.12, r.c, 1.6, 1)
    draw.gem(P.x, P.y, P.z, 0.2, t * 6, r.c, 1.4)
    draw.gem(P.x, P.y, P.z, 0.1, -t * 8, r.c2, 2.6)
  }

  const drawBeam = (r: Rec, k: number, t: number) => {
    const grow = k < 0.15 ? k / 0.15 : 1
    const fade = k < 0.15 ? 1 : Math.pow(1 - (k - 0.15) / 0.85, 1.4)
    const w = 0.24 * grow * (0.35 + 0.65 * fade)
    // Lance tip reaches the target during the grow phase.
    const tx = r.ax + (r.bx - r.ax) * grow
    const ty = r.ay + (r.by - r.ay) * grow
    const tz = r.az + (r.bz - r.az) * grow
    draw.streak(r.ax, r.ay, r.az, tx, ty, tz, w, r.c, 1.8 * fade, 0.25)
    draw.streak(r.ax, r.ay, r.az, tx, ty, tz, w * 0.35, C.white, 2.4 * fade, 0.1)
    draw.gem(r.ax, r.ay, r.az, 0.18 * fade, t * 6, r.c, 2)
    draw.gem(tx, ty, tz, 0.38 * fade * grow, -t * 7, r.c, 1.8)
  }

  const drawSlash = (r: Rec, k: number) => {
    const dx = r.bx - r.ax
    const dz = r.bz - r.az
    const l = Math.hypot(dx, dz) || 1
    const yaw = Math.atan2(dx, dz)
    // Centre behind the target so the arc passes through it.
    const cx = r.bx - (dx / l) * 0.55
    const cz = r.bz - (dz / l) * 0.55
    const fade = 1 - k * k
    draw.crescent(cx, r.by + 0.1, cz, 0.9, yaw, 0.5, k * 1.7, r.c, 2.6 * fade)
    draw.crescent(cx, r.by + 0.15, cz, 0.72, yaw + 0.3, -0.55, (k - 0.18) * 1.9, C.white, 2 * fade)
    if (k < 0.4) draw.gem(r.bx, r.by, r.bz, 0.18 * (1 - k / 0.4), k * 20, C.white, 2.2)
  }

  const drawWhirl = (r: Rec, k: number) => {
    const R = r.r
    const fade = 1 - k * k
    for (let j = 0; j < 3; j++) {
      const yaw = r.seed + k * 9 + j * 2.094
      draw.crescent(
        r.ax,
        r.ay + 0.55 + j * 0.08,
        r.az,
        R * 0.85,
        yaw,
        0.12,
        0.7 + k,
        r.c,
        2.2 * fade,
      )
    }
    draw.decal(r.ax, r.ay, r.az, R * (0.6 + 0.4 * easeOut(k)), 0.14, r.c, 1.6 * fade)
  }

  const drawNova = (r: Rec, k: number) => {
    const R = r.r
    const e = easeOut(clamp01(k * 1.4))
    const f = 1 - k
    draw.decal(r.ax, r.ay, r.az, R * e, 1, r.c, 1.1 * f * f)
    draw.decal(r.ax, r.ay + 0.02, r.az, R * (0.3 + 0.8 * e), 0.13, C.novaHot, 2.4 * f)
    if (k < 0.3) {
      const g = 1 - k / 0.3
      draw.gem(r.ax, r.ay + 0.5, r.az, 0.55 * g * g, k * 10, C.novaHot, 2.2 * g)
    }
    for (let j = 0; j < 12; j++) {
      const h1 = hash(r.seed + j * 3.1)
      const h2 = hash(r.seed + j * 7.7)
      const a = h1 * Math.PI * 2
      const d = R * (0.25 + 0.75 * h2) * e
      const y = r.ay + 0.15 + k * (1.2 + h2 * 1.4)
      draw.gem(
        r.ax + Math.cos(a) * d,
        y,
        r.az + Math.sin(a) * d,
        0.07 * f + 0.02,
        k * 12 + j,
        j % 3 === 0 ? C.novaHot : r.c,
        2.6 * f,
      )
    }
  }

  const drawStorm = (r: Rec, k: number, t: number) => {
    const R = r.r
    const el = k * r.dur
    const env = Math.sin(Math.PI * k)
    draw.decal(r.ax, r.ay, r.az, R, 1, r.c, 0.35 * env)
    draw.decal(r.ax, r.ay + 0.02, r.az, R, 0.08, r.c, 1.5 * env)
    const FALL = 0.2
    for (let j = 0; j < 18; j++) {
      const h1 = hash(r.seed + j * 5.3)
      const h2 = hash(r.seed + j * 9.1)
      const start = hash(r.seed + j * 2.7) * (r.dur - FALL - 0.12)
      const tj = (el - start) / FALL
      if (tj < 0 || tj > 1.6) continue
      const a = h1 * Math.PI * 2
      const d = R * Math.sqrt(h2) * 0.92
      const gx = r.ax + Math.cos(a) * d
      const gz = r.az + Math.sin(a) * d
      if (tj <= 1) {
        const top = 4.5
        const hy = r.ay + top * (1 - tj)
        draw.streak(
          gx + 0.35 * (1 - tj) + 0.3,
          hy + 1.3,
          gz + 0.2,
          gx + 0.35 * (1 - tj),
          hy,
          gz,
          0.05,
          j % 3 === 0 ? C.stormHot : r.c,
          2.8,
          1,
        )
      } else {
        const g = 1 - (tj - 1) / 0.6
        draw.gem(gx, r.ay + 0.12, gz, 0.2 * g, t * 10 + j, C.stormHot, 2.4 * g, 0.5)
      }
    }
  }

  const drawHeal = (r: Rec, k: number) => {
    const R = r.r
    const f = 1 - k
    draw.decal(r.ax, r.ay, r.az, R * (0.5 + 0.5 * easeOut(k)), 0.32, r.c, 1.5 * f)
    draw.decal(r.ax, r.ay, r.az, R * 0.8, 1, r.c, 0.4 * f * f)
    const n = R > 1.2 ? 12 : 7
    for (let j = 0; j < n; j++) {
      const h1 = hash(r.seed + j * 4.3)
      const h2 = hash(r.seed + j * 6.1)
      const lk = clamp01(k * 1.25 - h2 * 0.25)
      if (lk <= 0 || lk >= 1) continue
      const a = h1 * Math.PI * 2
      const d = R * 0.75 * Math.sqrt(h2)
      const x = r.ax + Math.cos(a) * d
      const z = r.az + Math.sin(a) * d
      const y = r.ay + 0.35 + lk * (1.1 + h1 * 0.8)
      const s = 0.1 * (0.8 + h2 * 0.5)
      const g = Math.sin(Math.PI * lk) * 2.4
      const rx = camRight.x * s
      const ry = camRight.y * s
      const rz = camRight.z * s
      draw.streak(x, y - s, z, x, y + s, z, 0.028, r.c, g, 0)
      draw.streak(x - rx, y - ry, z - rz, x + rx, y + ry, z + rz, 0.028, r.c, g, 0)
    }
  }

  const drawShield = (r: Rec, k: number, t: number) => {
    const R = r.r
    const pop = k < 0.18 ? easeOut(k / 0.18) : 1
    const over = k < 0.18 ? 1 + 0.15 * Math.sin((k / 0.18) * Math.PI) : 1
    const fade = Math.pow(1 - k, 1.2) * (0.8 + 0.2 * Math.sin(t * 18))
    const band = (k * 2.4) % 1
    draw.dome(r.ax, r.ay, r.az, R * pop * over, band, r.c, 1.7 * fade * pop)
    draw.decal(r.ax, r.ay + 0.01, r.az, R * pop * 1.02, 0.1, r.c, 1.6 * fade)
  }

  const drawColumn = (r: Rec, k: number, t: number) => {
    const R = r.r
    const f = 1 - k
    const w = R * 0.32 * (k < 0.12 ? k / 0.12 : f)
    draw.streak(r.ax, r.ay + 6, r.az, r.ax, r.ay, r.az, w, r.c, 1.7 * f, 1)
    draw.streak(r.ax, r.ay + 6, r.az, r.ax, r.ay, r.az, w * 0.35, C.white, 2.2 * f, 1)
    draw.decal(r.ax, r.ay, r.az, R * (0.4 + 0.6 * easeOut(k)), 1, r.c, 1.2 * f * f)
    draw.decal(r.ax, r.ay + 0.02, r.az, R * (0.5 + 0.6 * easeOut(k)), 0.12, r.c, 2 * f)
    draw.gem(r.ax, r.ay + 0.3, r.az, 0.4 * f, t * 6, C.white, 1.8 * f, 0.6)
  }

  const drawBurst = (r: Rec, k: number) => {
    const R = r.r
    const f = 1 - k
    draw.decal(r.ax, r.ay, r.az, R * (0.3 + 0.7 * easeOut(k)), 0.25, r.c, 2 * f)
    draw.gem(r.ax, r.ay + 0.5, r.az, 0.3 * f * f * Math.min(1.5, R), k * 9, r.c, 2.4 * f)
    for (let j = 0; j < 6; j++) {
      const a = hash(r.seed + j * 3.3) * Math.PI * 2
      const d = R * 0.7 * easeOut(k)
      draw.gem(
        r.ax + Math.cos(a) * d,
        r.ay + 0.5 + Math.sin(k * Math.PI) * 0.4,
        r.az + Math.sin(a) * d,
        0.05 * f + 0.01,
        j,
        C.white,
        2 * f,
      )
    }
  }

  const drawStun = (r: Rec, k: number, t: number) => {
    const g = Math.min(1, k * 8) * Math.min(1, (1 - k) * 5)
    const y = r.ay + 1.25
    for (let j = 0; j < 5; j++) {
      const a = t * 5 + (j * Math.PI * 2) / 5
      draw.gem(
        r.ax + Math.cos(a) * 0.34,
        y + Math.sin(a * 2 + j) * 0.04,
        r.az + Math.sin(a) * 0.34,
        0.085 * g,
        t * 6 + j,
        r.c,
        2.4 * g,
        0.45,
      )
    }
  }

  const drawLevelup = (r: Rec, k: number, t: number) => {
    const f = Math.pow(1 - k, 1.3)
    const top = r.ay + 1 + 3.8 * easeOut(clamp01(k * 1.6))
    const w = 0.42 * (1 - 0.55 * k)
    draw.streak(r.ax, top, r.az, r.ax, r.ay, r.az, w, r.c, 1.8 * f, 1)
    draw.streak(r.ax, top + 0.4, r.az, r.ax, r.ay, r.az, w * 0.35, C.goldHot, 2.4 * f, 0.8)
    draw.decal(r.ax, r.ay, r.az, 0.5 + 0.9 * easeOut(k), 0.2, r.c, 2 * f)
    for (let j = 0; j < 10; j++) {
      const h1 = hash(r.seed + j * 2.9)
      const lk = clamp01(k * 1.3 - h1 * 0.3)
      if (lk <= 0 || lk >= 1) continue
      const a = h1 * Math.PI * 2 + t * 3
      const d = 0.35 + 0.25 * hash(r.seed + j * 8.3)
      draw.gem(
        r.ax + Math.cos(a) * d,
        r.ay + 0.2 + lk * 3,
        r.az + Math.sin(a) * d,
        0.06,
        t * 8 + j,
        j % 2 ? C.goldHot : r.c,
        2.6 * Math.sin(Math.PI * lk),
      )
    }
  }

  const drawDeath = (r: Rec, k: number, t: number) => {
    // Opaque smoke: grows then shrinks away.
    for (let j = 0; j < 6; j++) {
      const h1 = hash(r.seed + j * 3.7)
      const h2 = hash(r.seed + j * 1.9)
      const a = h1 * Math.PI * 2
      const d = 0.15 + 0.35 * h2 * easeOut(k)
      const size = 0.3 * (0.7 + h2 * 0.6) * Math.sin(Math.PI * clamp01(k * 1.15))
      draw.smoke(
        r.ax + Math.cos(a) * d,
        r.ay + 0.3 + k * (0.9 + h1 * 0.6),
        r.az + Math.sin(a) * d,
        size,
        h1 * 6 + t,
        C.smoke,
      )
    }
    draw.decal(r.ax, r.ay + 0.02, r.az, 0.4 + 0.9 * easeOut(k), 0.18, r.c, 1.2 * (1 - k))
    // Skull flash: pale cranium + jaw with glowing team-coloured eyes, toward the camera.
    if (k < 0.7) {
      const g = 1 - k / 0.7
      const y = r.ay + 1.35 + k * 0.6
      const bx = r.ax + draw.camBack.x * 0.25
      const bz = r.az + draw.camBack.z * 0.25
      draw.gem(bx, y, bz, 0.2, 0, C.bone, 1.3 * g, 0.85)
      draw.gem(bx, y - 0.2, bz, 0.11, 0.6, C.bone, 1.0 * g, 0.6)
      const ex = camRight.x * 0.08
      const ez = camRight.z * 0.08
      const fx = draw.camBack.x * 0.18
      const fz = draw.camBack.z * 0.18
      draw.gem(bx - ex + fx, y - 0.02, bz - ez + fz, 0.05, t * 4, r.c2, 3 * g)
      draw.gem(bx + ex + fx, y - 0.02, bz + ez + fz, 0.05, t * 4, r.c2, 3 * g)
    }
  }

  const drawHit = (r: Rec, k: number) => {
    const f = 1 - k
    const R = r.r
    draw.gem(r.ax, r.ay, r.az, 0.15 * R * f, k * 8, C.white, 2.6 * f)
    for (let j = 0; j < 5; j++) {
      const a = hash(r.seed + j * 4.1) * Math.PI * 2
      const cx = camRight.x * Math.cos(a)
      const cy = Math.sin(a)
      const cz = camRight.z * Math.cos(a)
      const d0 = (0.06 + k * 0.3) * R
      const d1 = (0.18 + k * 0.45) * R
      draw.streak(
        r.ax + cx * d0,
        r.ay + cy * d0,
        r.az + cz * d0,
        r.ax + cx * d1,
        r.ay + cy * d1,
        r.az + cz * d1,
        0.028 * R,
        r.c,
        2.4 * f,
        1,
      )
    }
  }

  const drawDust = (r: Rec, k: number, t: number) => {
    const R = r.r
    const f = 1 - k
    draw.decal(r.ax, r.ay, r.az, R * (0.4 + 0.8 * easeOut(k)), 0.3, r.c, 1.4 * f * f)
    if (k < 0.25) {
      const g = 1 - k / 0.25
      draw.gem(r.ax, r.ay + 0.35, r.az, 0.5 * g, k * 6, C.goldHot, 2 * g, 0.6)
    }
    for (let j = 0; j < 6; j++) {
      const h1 = hash(r.seed + j * 2.3)
      const h2 = hash(r.seed + j * 5.9)
      const a = h1 * Math.PI * 2 + j
      const d = R * (0.3 + 0.7 * easeOut(k)) * (0.6 + 0.4 * h2)
      const size = 0.26 * (0.7 + h2 * 0.5) * Math.sin(Math.PI * clamp01(k * 1.1))
      draw.smoke(
        r.ax + Math.cos(a) * d,
        r.ay + 0.15 + k * 0.4,
        r.az + Math.sin(a) * d,
        size,
        h1 * 5 + t * 0.5,
        C.dust,
      )
      // Debris: small ember chunks thrown out on short arcs.
      const dd = R * 0.9 * easeOut(k) * (0.5 + h2 * 0.5)
      draw.gem(
        r.ax + Math.cos(a + 0.5) * dd,
        r.ay + 0.1 + Math.sin(Math.PI * k) * (0.6 + h1 * 0.6),
        r.az + Math.sin(a + 0.5) * dd,
        0.06,
        t * 9 + j,
        C.ember,
        1.6 * f,
      )
    }
  }

  /** Spawned when a projectile lands (may run during update; pooled, no allocation). */
  const land = (r: Rec, now: number) => {
    if (r.type === ARROW) {
      const h = spawn(HIT, now, 0.14)
      if (h) {
        h.ax = h.bx = r.bx
        h.ay = h.by = r.by
        h.az = h.bz = r.bz
        h.r = 0.55
        h.c.copy(r.c2)
      }
    } else if (r.type === BOLT) {
      const b = spawnAoe(BURST, now, r.bx, r.by - 0.55, r.bz, 0.55)
      if (b) b.c.copy(r.c2)
    } else if (r.type === SIEGE) {
      const b = spawnAoe(DUST, now, r.bx, r.by - 0.55, r.bz, 1.1)
      if (b) b.c.copy(C.ember)
    } else if (r.type === ORB) {
      const b = spawnAoe(r.sub, now, r.bx, r.by - 0.55, r.bz, r.sub === SHIELD ? 0.75 : 1.1)
      if (b) b.c.copy(r.c)
    }
  }

  /** `now` is real seconds; fx are visual only and play in real time. */
  const update = (now: number) => {
    draw.begin()
    let i = 0
    while (i < live) {
      const r = active[i]!
      const el = now - r.t0
      const k = el / r.dur
      if (k >= 1) {
        // Swap-remove into the free region before spawning follow-ups.
        live--
        active[i] = active[live]!
        active[live] = r
        land(r, now)
        continue
      }
      if (k >= 0) {
        switch (r.type) {
          case ARROW:
            drawArrow(r, k)
            break
          case BOLT:
            drawBolt(r, k, now)
            break
          case SIEGE:
            drawSiege(r, k, now)
            break
          case ORB:
            drawOrb(r, k, now)
            break
          case BEAM:
            drawBeam(r, k, now)
            break
          case SLASH:
            drawSlash(r, k)
            break
          case WHIRL:
            drawWhirl(r, k)
            break
          case NOVA:
            drawNova(r, k)
            break
          case STORM:
            drawStorm(r, k, now)
            break
          case HEAL:
            drawHeal(r, k)
            break
          case SHIELD:
            drawShield(r, k, now)
            break
          case COLUMN:
            drawColumn(r, k, now)
            break
          case BURST:
            drawBurst(r, k)
            break
          case STUN:
            drawStun(r, k, now)
            break
          case LEVELUP:
            drawLevelup(r, k, now)
            break
          case DEATH:
            drawDeath(r, k, now)
            break
          case HIT:
            drawHit(r, k)
            break
          case DUST:
            drawDust(r, k, now)
            break
        }
      }
      i++
    }
    draw.end()
  }

  return {
    group,
    push,
    update,
    dispose: () => {
      draw.dispose()
    },
  }
}

export type FxLayer = ReturnType<typeof createFxLayer>
