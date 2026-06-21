'use strict';

// FACE — the pièce de résistance. A raymarched 3D signed-distance-field head
// that idles (sways, breathes, blinks) and flares per signal:
//   CPU      -> neurons firing across the cranium
//   GPU      -> the eyes (glow + color shift, blinking)
//   network  -> the mouth (talks/opens with up+down traffic)
//   netDown  -> the ears (swell + glow with incoming traffic)
//   temp     -> the cheeks (flush red)
//   diskR/W  -> spokes of light streaming INTO (read) and OUT OF (write) the head
// Heavy tier, WebGL2. Performance be damned.

import { signalBus as bus } from '../signalBus.js';

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 res;
uniform float t, cpu, gpu, netDown, netUp, diskR, diskW, temp, fan;

#define PI 3.14159265

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z);
}
float fbm(vec3 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v += a*noise(p); p *= 2.0; a *= 0.5; } return v; }

float sdEllipsoid(vec3 p, vec3 r){ float k0=length(p/r); float k1=length(p/(r*r)); return k0*(k0-1.0)/max(k1,1e-4); }
float sdSphere(vec3 p, float r){ return length(p) - r; }
float smin(float a, float b, float k){ float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h) - k*h*(1.0-h); }

float gMouth, gEar;

// returns vec2(distance, materialId)  (1 = skin, 2 = eyes)
vec2 mapF(vec3 p){
  float head = sdEllipsoid(p, vec3(0.9, 1.05, 0.85));
  float jaw  = sdEllipsoid(p - vec3(0.0,-0.5,0.12), vec3(0.6,0.52,0.72));
  float d = smin(head, jaw, 0.35);
  float nose = sdEllipsoid(p - vec3(0.0,-0.05,0.86), vec3(0.12,0.18,0.14));
  d = smin(d, nose, 0.1);

  float es = 1.0 + gEar*0.45;
  float earL = sdEllipsoid(p - vec3(-0.9,0.08,0.0), vec3(0.16,0.30,0.20)*es);
  float earR = sdEllipsoid(p - vec3( 0.9,0.08,0.0), vec3(0.16,0.30,0.20)*es);
  d = smin(d, earL, 0.07); d = smin(d, earR, 0.07);

  // carve the mouth (opens with network)
  vec3 mp = p - vec3(0.0,-0.45,0.74);
  float mouth = sdEllipsoid(mp, vec3(0.30, 0.05 + 0.22*gMouth, 0.18));
  d = max(d, -mouth);

  float eyeL = sdSphere(p - vec3(-0.33,0.16,0.72), 0.16);
  float eyeR = sdSphere(p - vec3( 0.33,0.16,0.72), 0.16);
  float eyes = min(eyeL, eyeR);

  vec2 r = vec2(d, 1.0);
  if(eyes < r.x) r = vec2(eyes, 2.0);
  return r;
}

vec3 calcNormal(vec3 p){
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    mapF(p+e.xyy).x - mapF(p-e.xyy).x,
    mapF(p+e.yxy).x - mapF(p-e.yxy).x,
    mapF(p+e.yyx).x - mapF(p-e.yyx).x));
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*res) / res.y;

  // feature drivers
  float netA = clamp(netUp + netDown, 0.0, 1.0);
  gMouth = netA * (0.45 + 0.55*sin(t*7.0));          // talking when active
  gEar = netDown;
  float blinkPhase = fract(t*0.2);
  float blink = smoothstep(0.05, 0.12, abs(blinkPhase - 0.05)); // 0 = closed

  // camera + idle sway
  vec3 ro = vec3(0.0, 0.0, 3.6);
  vec3 rd = normalize(vec3(uv, -1.6));
  float breathe = 1.0 + 0.02*sin(t*1.3);
  float yaw = sin(t*0.5)*0.35;
  float pitch = sin(t*0.37)*0.12;

  // raymarch
  float tt = 0.0; vec2 hit = vec2(-1.0); vec3 p;
  for(int i=0;i<90;i++){
    p = ro + rd*tt;
    vec3 q = p / breathe;
    q.xz *= rot(yaw); q.yz *= rot(pitch);
    vec2 d = mapF(q);
    if(d.x < 0.001){ hit = vec2(tt, d.y); break; }
    tt += d.x;
    if(tt > 8.0) break;
  }

  vec3 col = vec3(0.02,0.025,0.04);
  col += 0.03*fbm(vec3(uv*3.0, t*0.1));

  if(hit.y > 0.0){
    vec3 q = p / breathe;
    q.xz *= rot(yaw); q.yz *= rot(pitch);
    vec3 nor = calcNormal(q);
    vec3 lig = normalize(vec3(0.5,0.6,0.7));
    float dif = clamp(dot(nor, lig), 0.0, 1.0);
    float rim = pow(1.0 - clamp(dot(nor, -rd), 0.0, 1.0), 2.5);

    if(hit.y < 1.5){
      vec3 skin = vec3(0.55,0.45,0.42);
      col = skin*(0.25 + 0.75*dif) + rim*vec3(0.25,0.35,0.6)*0.6;

      // neurons firing across the cranium (CPU) — electric sparks + traveling pulses
      if(q.y > -0.1){
        float headMask = smoothstep(-0.1, 0.35, q.y);   // forehead -> crown
        float nv = fbm(q*6.0 + vec3(0.0, 0.0, t*0.5));
        // crisp synapse points
        float spark = smoothstep(0.58, 0.70, nv);
        // each point fires on its own phase, travelling
        float fire = 0.5 + 0.5*sin(t*10.0 + nv*42.0);
        float fire2 = pow(max(0.0, sin(t*5.0 + nv*60.0)), 6.0); // occasional bright bursts
        vec3 neon = vec3(0.35,0.85,1.0);
        col += neon * spark * (fire*0.7 + fire2*1.3) * headMask * cpu * 2.6;
        // faint always-on filament shimmer so the brain reads even at low CPU
        col += neon * smoothstep(0.50,0.62,nv) * headMask * (0.06 + cpu*0.1);
      }
      // cheeks: heat (temp) flushes red; the fan blows cooling blue wisps that
      // fight the flush — the battle is most visible where they overlap.
      vec3 cl = q - vec3(-0.5,-0.12,0.5);
      vec3 cr = q - vec3( 0.5,-0.12,0.5);
      float cheek = exp(-dot(cl,cl)*7.0) + exp(-dot(cr,cr)*7.0);
      float heat = cheek * temp;
      // cold air streaming over the face front, faster with fan RPM
      float front = smoothstep(0.0, 0.6, q.z);
      float flow  = fbm(q*5.0 + vec3(1.7, -t*(1.0 + fan*2.5), 0.0));
      float wisp  = smoothstep(0.45, 0.72, flow);
      float flick = 0.7 + 0.3*sin(t*9.0 + flow*30.0);
      float cool  = wisp * front * fan * flick;      // 0 when fan idles
      col += vec3(1.0,0.25,0.15) * heat * (1.25 - 0.8*cool);   // red, quenched by cooling
      col += vec3(0.30,0.70,1.0) * cool * (0.35 + 1.2*heat);   // blue wisps, fiercer over heat

      // mouth interior glow (network)
      vec3 mp = q - vec3(0.0,-0.45,0.74);
      vec3 ms = mp*vec3(2.0,3.0,3.0);
      col += vec3(1.0,0.3,0.4) * exp(-dot(ms,ms)*2.0) * gMouth * 1.3;
    } else {
      // eyes (GPU), with blink
      vec3 eyeCol = mix(vec3(0.2,0.9,0.7), vec3(1.0,0.2,0.8), gpu);
      vec3 lit = eyeCol*(0.4 + gpu*2.2) + rim*0.4;
      col = mix(vec3(0.42,0.35,0.33), lit, blink); // closed lid ~ skin tone
    }
  }

  // disk I/O spokes — into the head (read) and out of it (write)
  {
    float ang = atan(uv.y, uv.x);
    float rr = length(uv);
    float spokes = 40.0;
    float sp = abs(fract(ang/(2.0*PI)*spokes) - 0.5);
    float onSpoke = smoothstep(0.09, 0.0, sp);
    float mask = smoothstep(0.55, 0.78, rr);
    float din  = fract(-rr*5.0 + t*1.2);
    float dout = fract( rr*5.0 - t*1.2);
    col += vec3(0.3,0.8,1.0) * onSpoke * mask * smoothstep(0.6,1.0,din) * diskR * 1.3;
    col += vec3(1.0,0.6,0.2) * onSpoke * mask * smoothstep(0.6,1.0,dout) * diskW * 1.3;
  }

  col = pow(max(col, 0.0), vec3(0.85));
  o = vec4(col, 1.0);
}`;

let gl, glCanvas, prog, u = {}, time = 0, vao;
const sig = { cpu: 0, gpu: 0, netDown: 0, netUp: 0, diskR: 0, diskW: 0, temp: 0, fan: 0 };

function compile(g, type, src) {
  const s = g.createShader(type);
  g.shaderSource(s, src);
  g.compileShader(s);
  if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
    console.error('[face] shader error:', g.getShaderInfoLog(s));
  }
  return s;
}

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
  for (const name of ['res', 't', 'cpu', 'gpu', 'netDown', 'netUp', 'diskR', 'diskW', 'temp', 'fan']) {
    u[name] = gl.getUniformLocation(prog, name);
  }
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
}

function onContextLost(e) { e.preventDefault(); }
function onContextRestored() { if (gl) setupGL(); }

export default {
  id: 'face',
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
    const k = Math.min(1, dt * 3);
    sig.cpu += (bus.get('cpuTotal') - sig.cpu) * k;
    sig.gpu += (bus.get('gpu') - sig.gpu) * k;
    sig.netDown += (bus.get('netDown') - sig.netDown) * k;
    sig.netUp += (bus.get('netUp') - sig.netUp) * k;
    sig.diskR += (bus.get('diskRead') - sig.diskR) * k;
    sig.diskW += (bus.get('diskWrite') - sig.diskW) * k;
    sig.temp += (bus.get('temp') - sig.temp) * k;
    sig.fan += (bus.get('fan') - sig.fan) * k;
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
    gl.uniform1f(u.netDown, sig.netDown);
    gl.uniform1f(u.netUp, sig.netUp);
    gl.uniform1f(u.diskR, sig.diskR);
    gl.uniform1f(u.diskW, sig.diskW);
    gl.uniform1f(u.temp, sig.temp);
    gl.uniform1f(u.fan, sig.fan);
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
