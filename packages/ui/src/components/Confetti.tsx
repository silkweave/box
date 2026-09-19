// A one-shot confetti burst, hand-rolled on a canvas.
//
// No dependency: `canvas-confetti` is 6kB of someone else's animation loop for what is forty lines
// of arithmetic, and every dependency is a thing to keep up to date, audit and explain. This is a
// particle array, gravity, and a fade.
//
// It respects `prefers-reduced-motion`, where it renders nothing at all rather than a slower
// version - a burst of moving specks is exactly the effect that setting exists to turn off.

import { useEffect, useRef } from 'react'

const COUNT = 140
const LIFE_MS = 2600
/** The house palette, in the order the categorical theme assigns it. Confetti is decoration, so it
 *  reads its colours off the same CSS variables everything else does rather than hard-coding hex. */
const VARS = ['--accent', '--success', '--warning', '--danger', '--text-muted']

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  spin: number
  angle: number
  w: number
  h: number
  color: string
}

export function Confetti({ fire }: { fire: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (fire === 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = el.clientWidth
    const h = el.clientHeight
    el.width = w * dpr
    el.height = h * dpr
    ctx.scale(dpr, dpr)

    const styles = getComputedStyle(document.documentElement)
    const colors = VARS.map((v) => styles.getPropertyValue(v).trim() || '#888')

    // Two fountains, from the bottom corners, which is where a footer button lives - the burst comes
    // out of the thing you just pressed rather than raining from a ceiling that is not there.
    const particles: Particle[] = Array.from({ length: COUNT }, (_, i) => {
      const left = i % 2 === 0
      const angle = (left ? -60 : -120) + (Math.random() - 0.5) * 46
      const speed = 9 + Math.random() * 10
      return {
        x: left ? w * 0.08 : w * 0.92,
        y: h,
        vx: Math.cos((angle * Math.PI) / 180) * speed * (left ? 1 : -1),
        vy: Math.sin((angle * Math.PI) / 180) * speed,
        spin: (Math.random() - 0.5) * 0.3,
        angle: Math.random() * Math.PI,
        w: 5 + Math.random() * 5,
        h: 3 + Math.random() * 4,
        color: colors[i % colors.length] as string,
      }
    })

    const start = performance.now()
    let raf = 0
    const tick = (now: number): void => {
      const t = now - start
      if (t > LIFE_MS) {
        ctx.clearRect(0, 0, w, h)
        return
      }
      ctx.clearRect(0, 0, w, h)
      ctx.globalAlpha = t > LIFE_MS * 0.6 ? 1 - (t - LIFE_MS * 0.6) / (LIFE_MS * 0.4) : 1
      for (const p of particles) {
        p.vy += 0.26 // gravity
        p.vx *= 0.992 // drag
        p.x += p.vx
        p.y += p.vy
        p.angle += p.spin
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.angle)
        ctx.fillStyle = p.color
        // A rectangle seen edge-on is a line, which is what makes a flat chip read as tumbling.
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.angle)))
        ctx.restore()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fire])

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className='pointer-events-none fixed inset-0 z-50 h-full w-full'
    />
  )
}
