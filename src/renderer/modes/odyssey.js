'use strict';

// ODYSSEY — heavy/bold. A "2001: A Space Odyssey" Star Gate: a calm celestial
// drift when the machine is idle that dissolves into a hyperspace warp +
// kaleidoscopic light tunnel as usage climbs. WebGL2 fragment shader.
//   CPU   -> warp speed + star streaking
//   GPU   -> psychedelic color saturation
//   net   -> hue drift of the tunnel bands
//   disk  -> bright flashes
//   temp  -> heat-shift toward red
//   RAM   -> nebula density
// "energy" (a blend) drives the central bloom — the "beyond the infinite".

import { signalBus as bus } from '../signalBus.js';

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 res;
uniform float t, cpu, gpu, net, disk, temp, ram, energy;

const float TAU = 6.28318530718;
float hash(float n){ return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash2(i), b = hash2(i + vec2(1,0)), c = hash2(i + vec2(0,1)), d = hash2(i + vec2(1,1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.02; a *= 0.5; } return v; }
vec3 pal(float x){ return 0.5 + 0.5 * cos(TAU * (vec3(1.0)*x + vec3(0.0,0.33,0.67) + net*0.5)); }

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*res) / res.y;
  float r = length(uv);
  float ang = atan(uv.y, uv.x);
  float speed = 0.15 + cpu*1.2;
  float trippy = clamp(cpu*0.6 + gpu*0.5 + net*0.3 + 0.05, 0.0, 1.0);

  vec3 col = vec3(0.0);

  // nebula background — stays dark/blue when idle, blooms with color under load
  float neb = fbm(uv*1.5 + vec2(t*0.02, -t*0.015));
  neb = pow(neb, 2.2);
  vec3 nebCol = mix(vec3(0.015,0.02,0.05), pal(neb + 0.2), 0.08 + trippy*0.6);
  col += nebCol * (0.05 + ram*0.18 + trippy*0.5);

  // fine celestial star dust — always present, gives the calm sky its depth
  {
    vec2 q = uv*60.0; vec2 ip = floor(q), fp = fract(q);
    float h = hash2(ip);
    vec2 sp = vec2(hash2(ip + 1.3), hash2(ip + 2.7));
    float d = length(fp - sp);
    float br = smoothstep(0.13, 0.0, d) * step(0.9, h);
    float tw = 0.5 + 0.5*sin(t*2.0 + h*30.0);
    col += vec3(0.7,0.8,1.0) * br * tw * 0.7;
  }

  // hyperspace starfield — stars stream outward from center, streaking with CPU
  for(int i=0;i<48;i++){
    float fi = float(i);
    float a0 = hash(fi) * TAU;
    float ph = fract(hash(fi+7.0) + t*speed*0.12);
    float rad = ph*1.4;
    vec2 rd = vec2(cos(a0), sin(a0));
    vec2 td = vec2(-rd.y, rd.x);
    vec2 rel = uv - rd*rad;
    float along = dot(rel, rd), perp = dot(rel, td);
    float streak = 0.005 + (cpu*0.25 + gpu*0.1) * ph;
    float a2 = max(0.0, abs(along) - streak);
    float d = length(vec2(a2, perp));
    float core = smoothstep(0.012, 0.0, d);
    float tw = 0.6 + 0.4*sin(t*3.0 + fi*1.7);
    vec3 sc = mix(vec3(0.85,0.92,1.0), pal(ph + gpu), trippy*0.8);
    col += sc * core * ph * tw * 1.7;
  }

  // Star Gate tunnel + kaleidoscope — emerges as the system works harder
  float kAng = ang;
  float sectors = floor(mix(0.0, 6.0, trippy));
  if(sectors > 0.5){ float s = TAU / sectors; kAng = abs(mod(ang, s) - s*0.5); }
  float bands = fbm(vec2(kAng*4.0, log(r + 0.02)*5.0 - t*(speed*1.5 + 0.3)));
  vec3 tcol = pal(bands*1.5 + disk*0.5 + t*0.05);
  tcol = mix(tcol, vec3(1.0,0.3,0.1), temp*0.5);
  float tunnelMask = smoothstep(0.0, 0.5, r) * smoothstep(1.4, 0.4, r);
  col += tcol * tunnelMask * trippy * (0.5 + 0.7*bands);

  // central bloom — "beyond the infinite"
  col += pal(t*0.1 + energy) * exp(-r*3.0) * (0.25 + energy*1.2) * trippy;

  // disk I/O flashes
  col += vec3(0.9,0.95,1.0) * disk * exp(-r*2.0) * 0.2 * (0.5 + 0.5*sin(t*10.0));

  col = pow(max(col, 0.0), vec3(0.85));
  o = vec4(col, 1.0);
}`;

let gl, glCanvas, prog, u = {}, time = 0, vao;
const sig = { cpu: 0, gpu: 0, net: 0, disk: 0, temp: 0, ram: 0, energy: 0 };

function compile(g, type, src) {
  const s = g.createShader(type);
  g.shaderSource(s, src);
  g.compileShader(s);
  if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
    console.error('[odyssey] shader error:', g.getShaderInfoLog(s));
  }
  return s;
}

// (Re)build all GL resources. Re-run after a context restore (e.g. when the
// window moves to a display on another GPU).
function setupGL() {
  prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.bindAttribLocation(prog, 0, 'p');
  gl.linkProgram(prog);
  gl.useProgram(prog);

  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  u = {};
  for (const name of ['res', 't', 'cpu', 'gpu', 'net', 'disk', 'temp', 'ram', 'energy']) {
    u[name] = gl.getUniformLocation(prog, name);
  }
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
}

function onContextLost(e) { e.preventDefault(); }
function onContextRestored() { if (gl) setupGL(); }

export default {
  id: 'odyssey',
  gl: true,
  init({ ctx, canvas }) {
    gl = ctx; glCanvas = canvas; time = 0;
    if (!gl) return;
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener('webglcontextrestored', onContextRestored, false);
    setupGL();
  },
  resize(canvas) { if (gl) gl.viewport(0, 0, canvas.width, canvas.height); },
  update(dt) {
    time += dt;
    const k = Math.min(1, dt * 2.5); // slow lerp so the cosmos drifts, never snaps
    sig.cpu += (bus.get('cpuTotal') - sig.cpu) * k;
    sig.gpu += (bus.get('gpu') - sig.gpu) * k;
    sig.net += (Math.max(bus.get('netDown'), bus.get('netUp')) - sig.net) * k;
    sig.disk += (Math.max(bus.get('diskRead'), bus.get('diskWrite')) - sig.disk) * k;
    sig.temp += (bus.get('temp') - sig.temp) * k;
    sig.ram += (bus.get('ramUsed') - sig.ram) * k;
    const target = Math.min(1, sig.cpu * 0.5 + sig.gpu * 0.3 + sig.net * 0.1 + sig.disk * 0.1);
    sig.energy += (target - sig.energy) * k;
  },
  render(ctx) {
    if (!gl) return;
    const c = ctx.canvas;
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(u.res, c.width, c.height);
    gl.uniform1f(u.t, time);
    gl.uniform1f(u.cpu, sig.cpu);
    gl.uniform1f(u.gpu, sig.gpu);
    gl.uniform1f(u.net, sig.net);
    gl.uniform1f(u.disk, sig.disk);
    gl.uniform1f(u.temp, sig.temp);
    gl.uniform1f(u.ram, sig.ram);
    gl.uniform1f(u.energy, sig.energy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  },
  teardown() {
    if (glCanvas) {
      glCanvas.removeEventListener('webglcontextlost', onContextLost, false);
      glCanvas.removeEventListener('webglcontextrestored', onContextRestored, false);
    }
    if (gl && prog) { gl.deleteProgram(prog); prog = null; }
    gl = null; glCanvas = null; u = {};
  }
};
