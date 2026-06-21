'use strict';

// FLOW FIELD — heavy/bold. A full-screen WebGL2 fragment shader: domain-warped
// fractal noise whose turbulence, color, speed and brightness are driven live
// by the signals. CPU -> turbulence/speed, GPU -> brightness, net -> hue drift,
// disk -> ripple bands, temp -> red bias. FPS-capped in config.

import { signalBus as bus } from '../signalBus.js';

const VERT = `#version 300 es
in vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 res;
uniform float t;
uniform float cpu, gpu, net, disk, temp, ram;

// hash + value noise + fbm
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<6;i++){ v+=a*noise(p); p*=2.0; a*=0.5; }
  return v;
}
vec3 palette(float x){
  // shift hue with network activity, warm with temperature
  vec3 base = 0.5 + 0.5*cos(6.2831*(x + vec3(0.0,0.33,0.67) + net*0.4));
  vec3 warm = vec3(1.0,0.35,0.12);
  return mix(base, warm, temp*0.6);
}
void main(){
  vec2 uv=(gl_FragCoord.xy - 0.5*res)/res.y;
  float speed = 0.05 + cpu*0.5;
  float scale = 2.0 + ram*3.0;
  vec2 q = uv*scale;
  // domain warp; turbulence grows with cpu+gpu
  float warp = 0.3 + (cpu+gpu)*1.6;
  vec2 w = vec2(fbm(q + vec2(0.0, t*speed)), fbm(q + vec2(5.2, -t*speed)));
  float f = fbm(q + warp*w + t*speed*0.5);
  // disk activity adds concentric ripple bands
  float ripple = sin(length(uv)*30.0 - t*4.0)*disk*0.25;
  f += ripple;
  vec3 col = palette(f);
  // brightness driven by gpu, with a soft vignette
  float bright = 0.35 + gpu*0.9 + cpu*0.2;
  col *= bright * smoothstep(1.3, 0.2, length(uv));
  col = pow(col, vec3(0.85));
  o = vec4(col, 1.0);
}`;

let gl, glCanvas, prog, u = {}, time = 0, vao;
const sig = { cpu: 0, gpu: 0, net: 0, disk: 0, temp: 0, ram: 0 };

function compile(g, type, src) {
  const s = g.createShader(type);
  g.shaderSource(s, src);
  g.compileShader(s);
  if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
    console.error('[flowfield] shader error:', g.getShaderInfoLog(s));
  }
  return s;
}

// (Re)build all GL resources — also used to recover after a context restore.
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
  // Full-screen triangle.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  u = {};
  for (const name of ['res', 't', 'cpu', 'gpu', 'net', 'disk', 'temp', 'ram']) {
    u[name] = gl.getUniformLocation(prog, name);
  }
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
}

function onContextLost(e) { e.preventDefault(); }
function onContextRestored() { if (gl) setupGL(); }

export default {
  id: 'flowfield',
  gl: true,
  init({ ctx, canvas }) {
    gl = ctx; glCanvas = canvas; time = 0;
    if (!gl) return;
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener('webglcontextrestored', onContextRestored, false);
    setupGL();
  },
  resize(canvas) {
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
  },
  update(dt) {
    time += dt;
    // Smooth signal lerp so the field flows rather than snaps.
    const k = Math.min(1, dt * 3);
    sig.cpu += (bus.get('cpuTotal') - sig.cpu) * k;
    sig.gpu += (bus.get('gpu') - sig.gpu) * k;
    sig.net += (Math.max(bus.get('netDown'), bus.get('netUp')) - sig.net) * k;
    sig.disk += (Math.max(bus.get('diskRead'), bus.get('diskWrite')) - sig.disk) * k;
    sig.temp += (bus.get('temp') - sig.temp) * k;
    sig.ram += (bus.get('ramUsed') - sig.ram) * k;
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
