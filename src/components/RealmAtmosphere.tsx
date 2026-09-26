'use client'

import { useEffect, useRef } from 'react'

const vertexShader = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const fragmentShader = `
precision mediump float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec4 u_left;
uniform vec4 u_right;
uniform vec4 u_odin;
uniform float u_text;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  v += 0.55 * noise(p);
  v += 0.28 * noise(p * 2.03 + 17.1);
  v += 0.17 * noise(p * 4.09 - 8.7);
  return v;
}

// A stretched, asymmetric plume rises from each raven rather than making a halo.
vec4 plume(vec2 p, vec4 anchor, vec3 color, float phase, float direction) {
  vec2 q = (p - anchor.xy) / max(anchor.zw, vec2(0.01));
  float drift = u_time * 0.05;
  vec2 flow = vec2(q.x * 2.1 + direction * drift, q.y * 2.6 - drift * 0.8);
  vec2 warp = vec2(fbm(flow + phase), fbm(flow + vec2(8.4, -11.7) + phase));
  q += (warp - 0.5) * vec2(0.28, 0.22);
  q.x += 0.06 * sin(q.y * 4.8 + drift * 1.5 + phase);

  // The extra wing lobe and tapered upper stream break the circular silhouette.
  float body = length(q * vec2(0.95, 1.08));
  float wing = length((q - vec2(direction * 0.56, 0.08)) * vec2(1.17, 1.8));
  float stream = length((q - vec2(-direction * 0.15, -0.64)) * vec2(2.1, 0.85));
  float envelope = max(1.0 - smoothstep(0.32, 1.38, body),
                       0.56 * (1.0 - smoothstep(0.15, 0.98, wing)));
  envelope = max(envelope, 0.43 * (1.0 - smoothstep(0.15, 1.04, stream)));

  float coarse = fbm(flow * 1.55 + warp * 2.4 + phase);
  float fine = fbm(flow * 4.6 + warp * 4.1 - phase);
  float folds = pow(1.0 - abs(fine * 2.0 - 1.0), 5.0);
  float veins = pow(1.0 - abs(coarse * 2.0 - 0.95), 12.0);
  float mist = envelope * (0.19 + 0.39 * coarse + 0.18 * folds);
  float threads = envelope * (0.19 * veins + 0.12 * folds * fine);
  vec3 pigment = color * (mist * 0.9 + threads * 1.4);
  pigment += vec3(0.42, 0.60, 0.95) * threads * 0.22;
  return vec4(pigment, clamp(mist * 0.48 + threads * 0.95, 0.0, 0.60));
}

// The rider's image bounds keep these upward currents close to the silhouette
// even when the scene is cropped differently on a narrow screen.
vec4 odinAura(vec2 p) {
  vec2 q = (p - u_odin.xy) / max(u_odin.zw, vec2(0.01));
  float rise = u_time * 0.10;
  float turbulence = fbm(vec2(q.x * 2.7 + 4.3, q.y * 3.1 + rise));
  float sway = (turbulence - 0.5) * 0.075;
  float breath = 0.83 + 0.17 * sin(u_time * 0.55);

  // Separate strands follow the rider and horse rather than enclosing them.
  float leftPath = 0.20 + sway + 0.035 * sin(q.y * 7.0 + rise * 1.3);
  float rightPath = 0.82 + sway + 0.040 * sin(q.y * 6.1 + rise + 1.8);
  float outerPath = 0.99 + sway * 0.8 + 0.025 * sin(q.y * 8.0 + rise * 1.5);
  float leftThread = exp(-pow((q.x - leftPath) / 0.050, 2.0));
  float rightThread = exp(-pow((q.x - rightPath) / 0.055, 2.0));
  float outerThread = exp(-pow((q.x - outerPath) / 0.042, 2.0));
  float heightFade = smoothstep(-0.18, 0.13, q.y) *
                     (1.0 - smoothstep(0.89, 1.18, q.y));
  float headQuiet = 0.50 + 0.50 * smoothstep(0.19, 0.39, q.y);
  float flowing = 0.68 + 0.32 * noise(vec2(q.x * 7.0, q.y * 6.0 + rise * 2.0));
  float filaments = (leftThread * 0.90 + rightThread * 1.02 + outerThread * 0.48) *
                    heightFade * headQuiet * flowing * breath;

  float leftMist = exp(-pow((q.x - 0.12 - sway) / 0.20, 2.0));
  float rightMist = exp(-pow((q.x - 0.87 - sway) / 0.22, 2.0));
  float footMist = smoothstep(0.38, 0.84, q.y) *
                   (1.0 - smoothstep(1.04, 1.32, q.y));
  float mist = (leftMist * 0.74 + rightMist * 0.88) * footMist *
               (0.48 + 0.52 * turbulence) * breath;

  // A few drifting points brighten gradually; none blink or form a ring.
  float glints = 0.0;
  for (int i = 0; i < 3; i++) {
    float id = float(i);
    float cycle = fract(u_time * (0.035 + id * 0.006) + id * 0.37);
    vec2 point = vec2(mix(0.17, 0.88, step(0.5, mod(id, 2.0))),
                      0.96 - cycle * 0.84);
    point.x += 0.025 * sin(u_time * 0.43 + id * 2.7);
    float dist = length((q - point) * vec2(1.0, 0.75));
    glints += (1.0 - smoothstep(0.0, 0.055, dist)) *
              sin(cycle * 3.14159) * 0.22;
  }
  glints *= heightFade;

  vec3 color = vec3(0.76, 0.84, 1.0) * filaments * 0.77 +
               vec3(0.49, 0.37, 0.88) * mist * 0.36 +
               vec3(0.88, 0.93, 1.0) * glints;
  float alpha = filaments * 0.58 + mist * 0.25 + glints * 0.45;
  return vec4(color, clamp(alpha, 0.0, 0.60));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y) / u_resolution.y;
  float aspect = u_resolution.x / u_resolution.y;

  vec4 left = plume(p, u_left, vec3(0.64, 0.24, 0.96), 1.7, -1.0);
  vec4 right = plume(p, u_right, vec3(0.18, 0.54, 1.0), 8.3, 1.0);

  vec4 sacred = odinAura(p);

  // Preserve contrast behind the main heading and search control.
  float textZone = smoothstep(0.20, 0.40, p.x / aspect) *
                   (1.0 - smoothstep(0.71, 0.93, p.x / aspect)) *
                   smoothstep(0.14, 0.32, p.y) *
                   (1.0 - smoothstep(0.80, 0.98, p.y));
  float attenuation = 1.0 - textZone * u_text * 0.68;

  vec3 rgb = (left.rgb + right.rgb) * attenuation +
             sacred.rgb * (1.0 - textZone * u_text * 0.55);
  float alpha = (left.a + right.a) * attenuation + sacred.a * (1.0 - textZone * u_text * 0.55);
  gl_FragColor = vec4(rgb, clamp(alpha, 0.0, 0.83));
}
`

type ProgramState = {
  gl: WebGLRenderingContext
  program: WebGLProgram
  buffer: WebGLBuffer
  resolution: WebGLUniformLocation | null
  time: WebGLUniformLocation | null
  left: WebGLUniformLocation | null
  right: WebGLUniformLocation | null
  odin: WebGLUniformLocation | null
  text: WebGLUniformLocation | null
}

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

function createProgram(gl: WebGLRenderingContext): ProgramState | null {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShader)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader)
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  const buffer = gl.createBuffer()
  if (!buffer) {
    gl.deleteProgram(program)
    return null
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  return {
    gl, program, buffer,
    resolution: gl.getUniformLocation(program, 'u_resolution'),
    time: gl.getUniformLocation(program, 'u_time'),
    left: gl.getUniformLocation(program, 'u_left'),
    right: gl.getUniformLocation(program, 'u_right'),
    odin: gl.getUniformLocation(program, 'u_odin'),
    text: gl.getUniformLocation(program, 'u_text'),
  }
}

export default function RealmAtmosphere({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const hero = canvas?.parentElement
    if (!canvas || !hero) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let state: ProgramState | null = null
    let frame = 0
    let inView = true
    let contextLost = false
    let lastFrame = -1000
    let elapsed = 0
    let previousTimestamp = 0
    const odin = hero.querySelector<HTMLElement>('.hero-odin')

    const release = () => {
      if (!state) return
      state.gl.deleteBuffer(state.buffer)
      state.gl.deleteProgram(state.program)
      state = null
    }

    const resize = () => {
      const rect = hero.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const maxWidth = rect.width <= 600 ? 450 : 900
      const width = Math.max(1, Math.round(Math.min(rect.width, maxWidth)))
      const height = Math.max(1, Math.round(width * rect.height / rect.width))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      state?.gl.viewport(0, 0, width, height)
      draw()
    }

    const anchor = (selector: string, fallbackX: number) => {
      const raven = hero.querySelector<HTMLElement>(selector)
      const host = hero.getBoundingClientRect()
      const rect = raven?.getBoundingClientRect()
      const height = Math.max(host.height, 1)
      if (!rect) return [fallbackX * host.width / height, 0.35, 0.34, 0.51] as const
      const isLeft = selector === '.raven-left'
      return [
        (rect.left - host.left + rect.width * (isLeft ? 0.57 : 0.43)) / height,
        (rect.top - host.top + rect.height * 0.48) / height,
        Math.max(0.24, rect.width / height * 0.83),
        Math.max(0.30, rect.height / height * 0.69),
      ] as const
    }

    const draw = () => {
      if (!state || contextLost || !canvas.width || !canvas.height) return
      const { gl } = state
      const host = hero.getBoundingClientRect()
      if (!host.height) return
      const left = anchor('.raven-left', 0.08)
      const right = anchor('.raven-right', 0.92)
      gl.useProgram(state.program)
      gl.uniform2f(state.resolution, canvas.width, canvas.height)
      gl.uniform1f(state.time, elapsed)
      gl.uniform4f(state.left, ...left)
      gl.uniform4f(state.right, ...right)
      const rider = odin?.getBoundingClientRect()
      if (rider) {
        gl.uniform4f(state.odin,
          (rider.left - host.left) / host.height,
          (rider.top - host.top) / host.height,
          rider.width / host.height,
          rider.height / host.height)
      } else {
        gl.uniform4f(state.odin, host.width / host.height * 0.39, 0.12, 0.18, 0.45)
      }
      gl.uniform1f(state.text, host.width <= 600 ? 0.75 : 1)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    const shouldAnimate = () => enabled && !media.matches && !document.hidden && inView && !contextLost && !!state
    const tick = (timestamp: number) => {
      frame = 0
      if (!shouldAnimate()) {
        hero.dataset.atmosphereActive = 'false'
        return
      }
      if (timestamp - lastFrame >= 1000 / 30) {
        elapsed += previousTimestamp ? Math.min((timestamp - previousTimestamp) / 1000, 0.1) : 0
        previousTimestamp = timestamp
        lastFrame = timestamp
        draw()
      }
      frame = requestAnimationFrame(tick)
    }

    const sync = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      previousTimestamp = 0
      hero.dataset.atmosphereActive = 'false'
      if (!enabled) {
        state?.gl.clear(state.gl.COLOR_BUFFER_BIT)
        return
      }
      if (!state && !contextLost) {
        const gl = canvas.getContext('webgl', {
          alpha: true, antialias: false, depth: false, stencil: false,
          premultipliedAlpha: false, preserveDrawingBuffer: false,
          powerPreference: 'low-power',
        })
        if (gl) {
          state = createProgram(gl)
          gl.clearColor(0, 0, 0, 0)
          resize()
        }
      }
      if (state) draw()
      if (shouldAnimate()) {
        hero.dataset.atmosphereActive = 'true'
        frame = requestAnimationFrame(tick)
      }
    }

    const onLost = (event: Event) => {
      event.preventDefault()
      contextLost = true
      state = null
      sync()
    }
    const onRestored = () => {
      contextLost = false
      sync()
    }
    const visibility = () => sync()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(hero)
    if (odin) resizeObserver.observe(odin)
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      sync()
    })
    intersectionObserver.observe(hero)
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    media.addEventListener('change', sync)
    document.addEventListener('visibilitychange', visibility)
    sync()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      media.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', visibility)
      if (!contextLost) release()
      delete hero.dataset.atmosphereActive
    }
  }, [enabled])

  return <canvas ref={canvasRef} className="realm-atmosphere" aria-hidden="true" />
}
