/**
 * fluidSim — self-contained WebGL fluid simulation (Navier–Stokes, dye + bloom-less)
 * for the OMEGA orb background. Faithful to the Pavel Dobryakov "WebGL Fluid
 * Simulation" algorithm (MIT), trimmed to the pieces we use: advection,
 * divergence, curl/vorticity, Jacobi pressure, gradient subtract, splat, display.
 *
 * Colorful neon dye that flows + dissipates and reacts to pointer movement over
 * the canvas. No React deps. startFluid(canvas) → { stop, splatColor, autoSplat }.
 *
 * [moft 2026-05-30] Replaces the prior 2D water/ripple orb on operator request.
 */

interface RGB { r: number; g: number; b: number }
interface FBO { texture: WebGLTexture; fbo: WebGLFramebuffer; width: number; height: number; texelSizeX: number; texelSizeY: number; attach: (id: number) => number }
interface DoubleFBO { width: number; height: number; texelSizeX: number; texelSizeY: number; read: FBO; write: FBO; swap: () => void }

const CONFIG = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 1024,
    DENSITY_DISSIPATION: 0.45,
    VELOCITY_DISSIPATION: 0.2,
    PRESSURE: 0.8,
    PRESSURE_ITERATIONS: 20,
    CURL: 30,
    SPLAT_RADIUS: 0.45,
    SPLAT_FORCE: 8000,
}

export interface FluidHandle {
    stop: () => void
    /** Inject a splat at normalized (nx,ny in 0..1) with a velocity + color. */
    splat: (nx: number, ny: number, dx: number, dy: number, color: RGB) => void
    /** Random ambient burst — color tinted toward the given hex (mood). */
    autoSplat: (hex: string, count?: number) => void
}

function hexToRgb(hex: string): RGB {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#00d4ff')
    if (!m) return { r: 0, g: 0.83, b: 1 }
    return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 }
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        // eslint-disable-next-line no-console
        console.warn('[fluid] shader compile:', gl.getShaderInfoLog(shader))
    }
    return shader
}

function createProgram(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    return program
}

function getUniforms(gl: WebGLRenderingContext, program: WebGLProgram): Record<string, WebGLUniformLocation> {
    const uniforms: Record<string, WebGLUniformLocation> = {}
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < count; i++) {
        const name = gl.getActiveUniform(program, i)!.name
        uniforms[name] = gl.getUniformLocation(program, name)!
    }
    return uniforms
}

// ── Shaders ──
const baseVertex = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform vec2 texelSize;
    void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }`
const clearShader = `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; uniform sampler2D uTexture; uniform float value;
    void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`
const displayShader = `precision highp float; precision highp sampler2D; varying vec2 vUv; uniform sampler2D uTexture;
    void main () { vec3 c = texture2D(uTexture, vUv).rgb; float a = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c, a); }`
const splatShader = `precision highp float; precision highp sampler2D; varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius;
    void main () { vec2 p = vUv - point.xy; p.x *= aspectRatio; vec3 splat = exp(-dot(p, p) / radius) * color; vec3 base = texture2D(uTarget, vUv).xyz; gl_FragColor = vec4(base + splat, 1.0); }`
const advectionShader = `precision highp float; precision highp sampler2D; varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform float dt; uniform float dissipation;
    void main () { vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize; vec4 result = texture2D(uSource, coord); float decay = 1.0 + dissipation * dt; gl_FragColor = result / decay; }`
const divergenceShader = `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uVelocity;
    void main () { float L = texture2D(uVelocity, vL).x; float R = texture2D(uVelocity, vR).x; float T = texture2D(uVelocity, vT).y; float B = texture2D(uVelocity, vB).y; vec2 C = texture2D(uVelocity, vUv).xy; if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x; if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y; float div = 0.5 * (R - L + T - B); gl_FragColor = vec4(div, 0.0, 0.0, 1.0); }`
const curlShader = `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uVelocity;
    void main () { float L = texture2D(uVelocity, vL).y; float R = texture2D(uVelocity, vR).y; float T = texture2D(uVelocity, vT).x; float B = texture2D(uVelocity, vB).x; float vorticity = R - L - T + B; gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0); }`
const vorticityShader = `precision highp float; precision highp sampler2D; varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt;
    void main () { float L = texture2D(uCurl, vL).x; float R = texture2D(uCurl, vR).x; float T = texture2D(uCurl, vT).x; float B = texture2D(uCurl, vB).x; float C = texture2D(uCurl, vUv).x; vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L)); force /= length(force) + 0.0001; force *= curl * C; force.y *= -1.0; vec2 velocity = texture2D(uVelocity, vUv).xy; velocity += force * dt; velocity = min(max(velocity, -1000.0), 1000.0); gl_FragColor = vec4(velocity, 0.0, 1.0); }`
const pressureShader = `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uPressure; uniform sampler2D uDivergence;
    void main () { float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x; float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x; float divergence = texture2D(uDivergence, vUv).x; float pressure = (L + R + B + T - divergence) * 0.25; gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0); }`
const gradientSubtractShader = `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uPressure; uniform sampler2D uVelocity;
    void main () { float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x; float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x; vec2 velocity = texture2D(uVelocity, vUv).xy; velocity.xy -= vec2(R - L, T - B); gl_FragColor = vec4(velocity, 0.0, 1.0); }`

export function startFluid(canvas: HTMLCanvasElement): FluidHandle | null {
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false }
    const gl = (canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params)) as WebGLRenderingContext | null
    if (!gl) return null

    const halfFloat = gl.getExtension('OES_texture_half_float')
    gl.getExtension('OES_texture_half_float_linear')
    const HALF_FLOAT = halfFloat ? halfFloat.HALF_FLOAT_OES : gl.UNSIGNED_BYTE
    gl.clearColor(0, 0, 0, 1)

    const vs = compileShader(gl, gl.VERTEX_SHADER, baseVertex)
    function prog(fs: string) {
        const p = createProgram(gl!, vs, compileShader(gl!, gl!.FRAGMENT_SHADER, fs))
        return { program: p, uniforms: getUniforms(gl!, p) }
    }
    const clearP = prog(clearShader)
    const displayP = prog(displayShader)
    const splatP = prog(splatShader)
    const advectionP = prog(advectionShader)
    const divergenceP = prog(divergenceShader)
    const curlP = prog(curlShader)
    const vorticityP = prog(vorticityShader)
    const pressureP = prog(pressureShader)
    const gradientP = prog(gradientSubtractShader)

    // fullscreen triangle/quad
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW)
    const elem = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elem)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(0)

    function blit(target: FBO | null) {
        if (target == null) {
            gl!.viewport(0, 0, gl!.drawingBufferWidth, gl!.drawingBufferHeight)
            gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
        } else {
            gl!.viewport(0, 0, target.width, target.height)
            gl!.bindFramebuffer(gl!.FRAMEBUFFER, target.fbo)
        }
        gl!.drawElements(gl!.TRIANGLES, 6, gl!.UNSIGNED_SHORT, 0)
    }

    function createFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): FBO {
        gl!.activeTexture(gl!.TEXTURE0)
        const texture = gl!.createTexture()!
        gl!.bindTexture(gl!.TEXTURE_2D, texture)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, param)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, param)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
        gl!.texImage2D(gl!.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)
        const fbo = gl!.createFramebuffer()!
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo)
        gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, texture, 0)
        gl!.viewport(0, 0, w, h)
        gl!.clear(gl!.COLOR_BUFFER_BIT)
        return {
            texture, fbo, width: w, height: h, texelSizeX: 1 / w, texelSizeY: 1 / h,
            attach(id: number) { gl!.activeTexture(gl!.TEXTURE0 + id); gl!.bindTexture(gl!.TEXTURE_2D, texture); return id },
        }
    }
    function createDoubleFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): DoubleFBO {
        let fbo1 = createFBO(w, h, internalFormat, format, type, param)
        let fbo2 = createFBO(w, h, internalFormat, format, type, param)
        return {
            width: w, height: h, texelSizeX: 1 / w, texelSizeY: 1 / h,
            get read() { return fbo1 }, set read(v) { fbo1 = v },
            get write() { return fbo2 }, set write(v) { fbo2 = v },
            swap() { const t = fbo1; fbo1 = fbo2; fbo2 = t },
        }
    }

    const rgba = gl.RGBA
    const simRes = getResolution(CONFIG.SIM_RESOLUTION)
    const dyeRes = getResolution(CONFIG.DYE_RESOLUTION)
    let dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba, rgba, HALF_FLOAT, gl.LINEAR)
    let velocity = createDoubleFBO(simRes.width, simRes.height, rgba, rgba, HALF_FLOAT, gl.LINEAR)
    const divergence = createFBO(simRes.width, simRes.height, rgba, rgba, HALF_FLOAT, gl.NEAREST)
    const curl = createFBO(simRes.width, simRes.height, rgba, rgba, HALF_FLOAT, gl.NEAREST)
    let pressure = createDoubleFBO(simRes.width, simRes.height, rgba, rgba, HALF_FLOAT, gl.NEAREST)

    function getResolution(resolution: number) {
        let aspect = gl!.drawingBufferWidth / gl!.drawingBufferHeight
        if (aspect < 1) aspect = 1 / aspect
        const min = Math.round(resolution)
        const max = Math.round(resolution * aspect)
        return gl!.drawingBufferWidth > gl!.drawingBufferHeight ? { width: max, height: min } : { width: min, height: max }
    }

    function use(p: { program: WebGLProgram }) { gl!.useProgram(p.program) }

    let lastTime = (typeof performance !== 'undefined' ? performance.now() : 0)
    let running = true

    function step(dt: number) {
        gl!.disable(gl!.BLEND)
        // curl
        use(curlP); gl!.uniform2f(curlP.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY); gl!.uniform1i(curlP.uniforms.uVelocity, velocity.read.attach(0)); blit(curl)
        // vorticity
        use(vorticityP); gl!.uniform2f(vorticityP.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY); gl!.uniform1i(vorticityP.uniforms.uVelocity, velocity.read.attach(0)); gl!.uniform1i(vorticityP.uniforms.uCurl, curl.attach(1)); gl!.uniform1f(vorticityP.uniforms.curl, CONFIG.CURL); gl!.uniform1f(vorticityP.uniforms.dt, dt); blit(velocity.write); velocity.swap()
        // divergence
        use(divergenceP); gl!.uniform2f(divergenceP.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY); gl!.uniform1i(divergenceP.uniforms.uVelocity, velocity.read.attach(0)); blit(divergence)
        // clear pressure
        use(clearP); gl!.uniform1i(clearP.uniforms.uTexture, pressure.read.attach(0)); gl!.uniform1f(clearP.uniforms.value, CONFIG.PRESSURE); blit(pressure.write); pressure.swap()
        // pressure iterations
        use(pressureP); gl!.uniform2f(pressureP.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY); gl!.uniform1i(pressureP.uniforms.uDivergence, divergence.attach(0))
        for (let i = 0; i < CONFIG.PRESSURE_ITERATIONS; i++) { gl!.uniform1i(pressureP.uniforms.uPressure, pressure.read.attach(1)); blit(pressure.write); pressure.swap() }
        // gradient subtract
        use(gradientP); gl!.uniform2f(gradientP.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY); gl!.uniform1i(gradientP.uniforms.uPressure, pressure.read.attach(0)); gl!.uniform1i(gradientP.uniforms.uVelocity, velocity.read.attach(1)); blit(velocity.write); velocity.swap()
        // advect velocity
        use(advectionP); gl!.uniform2f(advectionP.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY); gl!.uniform1i(advectionP.uniforms.uVelocity, velocity.read.attach(0)); gl!.uniform1i(advectionP.uniforms.uSource, velocity.read.attach(0)); gl!.uniform1f(advectionP.uniforms.dt, dt); gl!.uniform1f(advectionP.uniforms.dissipation, CONFIG.VELOCITY_DISSIPATION); blit(velocity.write); velocity.swap()
        // advect dye
        gl!.uniform2f(advectionP.uniforms.texelSize, dye.texelSizeX, dye.texelSizeY); gl!.uniform1i(advectionP.uniforms.uVelocity, velocity.read.attach(0)); gl!.uniform1i(advectionP.uniforms.uSource, dye.read.attach(1)); gl!.uniform1f(advectionP.uniforms.dissipation, CONFIG.DENSITY_DISSIPATION); blit(dye.write); dye.swap()
    }

    function render() {
        gl!.disable(gl!.BLEND)
        use(displayP); gl!.uniform1i(displayP.uniforms.uTexture, dye.read.attach(0)); blit(null)
    }

    function splat(nx: number, ny: number, dx: number, dy: number, color: RGB) {
        const aspect = canvas.width / canvas.height
        use(splatP)
        gl!.uniform1i(splatP.uniforms.uTarget, velocity.read.attach(0))
        gl!.uniform1f(splatP.uniforms.aspectRatio, aspect)
        gl!.uniform2f(splatP.uniforms.point, nx, ny)
        gl!.uniform3f(splatP.uniforms.color, dx, dy, 0)
        gl!.uniform1f(splatP.uniforms.radius, correctRadius(CONFIG.SPLAT_RADIUS / 100))
        blit(velocity.write); velocity.swap()
        gl!.uniform1i(splatP.uniforms.uTarget, dye.read.attach(0))
        gl!.uniform3f(splatP.uniforms.color, color.r, color.g, color.b)
        blit(dye.write); dye.swap()
    }
    function correctRadius(r: number) { const aspect = canvas.width / canvas.height; return aspect > 1 ? r * aspect : r }

    function autoSplat(hex: string, count = 1) {
        const base = hexToRgb(hex)
        for (let i = 0; i < count; i++) {
            // tint between mood color and a vivid neon for the Pavel look
            const neon = HSVtoRGB(Math.random(), 1.0, 1.0)
            const c: RGB = { r: (base.r + neon.r) * 0.5 * 0.85, g: (base.g + neon.g) * 0.5 * 0.85, b: (base.b + neon.b) * 0.5 * 0.85 }
            const nx = Math.random(), ny = Math.random()
            const dx = 1600 * (Math.random() - 0.5)
            const dy = 1600 * (Math.random() - 0.5)
            splat(nx, ny, dx, dy, c)
        }
    }

    // ── pointer ──
    let pointerDown = false
    let lastX = 0, lastY = 0
    function toNorm(e: { clientX: number; clientY: number }) {
        const rect = canvas.getBoundingClientRect()
        return { x: (e.clientX - rect.left) / rect.width, y: 1 - (e.clientY - rect.top) / rect.height }
    }
    function moveSplat(e: { clientX: number; clientY: number }) {
        const p = toNorm(e)
        const dx = (p.x - lastX) * CONFIG.SPLAT_FORCE
        const dy = (p.y - lastY) * CONFIG.SPLAT_FORCE
        lastX = p.x; lastY = p.y
        const c = HSVtoRGB(Math.random(), 1.0, 1.0)
        splat(p.x, p.y, dx, dy, { r: c.r * 0.7, g: c.g * 0.7, b: c.b * 0.7 })
    }
    const onMove = (e: PointerEvent) => { if (!pointerDown) { const p = toNorm(e); lastX = p.x; lastY = p.y } else moveSplat(e); if (!pointerDown) moveSplat(e) }
    const onDown = (e: PointerEvent) => { pointerDown = true; const p = toNorm(e); lastX = p.x; lastY = p.y }
    const onUp = () => { pointerDown = false }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)

    function HSVtoRGB(h: number, s: number, v: number): RGB {
        const i = Math.floor(h * 6); const f = h * 6 - i; const p = v * (1 - s); const q = v * (1 - f * s); const t = v * (1 - (1 - f) * s)
        let r = 0, g = 0, b = 0
        switch (i % 6) { case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; case 5: r = v; g = p; b = q; break }
        return { r, g, b }
    }

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const w = Math.floor(canvas.clientWidth * dpr)
        const h = Math.floor(canvas.clientHeight * dpr)
        if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h }
    }
    resize()
    const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(resize) : null
    if (ro) ro.observe(canvas)

    // seed a few ambient splats so it isn't empty on load
    for (let i = 0; i < 8; i++) autoSplat('#00d4ff', 1)

    let raf = 0
    function frame() {
        if (!running) return
        const now = (typeof performance !== 'undefined' ? performance.now() : 0)
        let dt = (now - lastTime) / 1000
        dt = Math.min(dt, 0.016666)
        lastTime = now
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer)
        gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, elem)
        gl!.vertexAttribPointer(0, 2, gl!.FLOAT, false, 0, 0)
        gl!.enableVertexAttribArray(0)
        step(dt)
        render()
        raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return {
        stop() {
            running = false
            cancelAnimationFrame(raf)
            canvas.removeEventListener('pointermove', onMove)
            canvas.removeEventListener('pointerdown', onDown)
            window.removeEventListener('pointerup', onUp)
            if (ro) ro.disconnect()
        },
        splat,
        autoSplat,
    }
}
