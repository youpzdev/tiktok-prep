const canvas = document.querySelector('#ribbon');
const gl = canvas.getContext('webgl2', {alpha: false, antialias: false});
if (gl) {
 const compile = (type, source) => {
  const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('ribbon.compile: ' + gl.getShaderInfoLog(shader));
  return shader;
 };
 const program = gl.createProgram();
 gl.attachShader(program, compile(gl.VERTEX_SHADER, '#version 300 es\nin vec2 position; void main(){gl_Position=vec4(position,0.,1.);}'));
 gl.attachShader(program, compile(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float;\n\n\nuniform vec2 uRes;\nuniform float uTime;\nuniform float uSize;\nuniform float uAngle;\nuniform vec3 uBg;\nuniform float uPaper;\nuniform float uOpacity;\nuniform float uFadeStart;\nuniform float uFadeEnd;\nuniform float uSideStart;\nuniform float uSideEnd;\n\nout vec4 fragColor;\n\nconst float LAYERS = 84.0;\nconst float GAIN = 0.62;\nconst vec2 CENTRE = vec2(-0.62, 0.24);\nconst float TILT = 0.6;\nconst float ZOOM = 1.05;\nconst float THETA = 2.13;\nconst float SHEAR = 0.963;\nconst float SHRINK = 0.953;\nconst vec2 WARP_FREQ = vec2(0.42, 2.4);\nconst vec2 WARP_AMP = vec2(0.13, 0.027);\nconst vec2 ASPECT = vec2(2.1, 0.17);\nconst float OFFSET = 0.36;\nconst float GLOW = 0.0021;\nconst float SOFT = 0.0019;\nconst float FALLOFF = 0.37;\nconst float PHASE = 12.0;\nconst float CYCLE = 0.16;\nconst float HUE_TRAVEL = 2.0;\n\nmat2 rot(float a) {\n  float c = cos(a), s = sin(a);\n  return mat2(c, s, -s, c);\n}\n\nfloat ign(vec2 p, float f) {\n  p += 5.588238 * mod(f, 64.0);\n  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));\n}\n\nvoid main() {\n  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);\n  vec2 fieldFrag = vec2(frag.x, uRes.y - frag.y);\n  vec2 pos = (fieldFrag - 0.5 * uRes) / uRes.y;\n  pos = rot(uAngle) * pos / uSize;\n  float t = uTime * 0.49 + PHASE;\n  float breath = (-sin(uTime * 0.735) + sin(uTime * 0.49 + 1.0)) * 0.25 + 0.5;\n  vec2 u = rot(TILT) * ((pos - CENTRE) * (ZOOM - breath * 0.085));\n  mat2 fold = mat2(cos(THETA), sin(THETA), -SHEAR, cos(THETA));\n  float value = 0.0;\n  for (float i = 1.0; i <= LAYERS; i += 1.0) {\n    u.x -= sin(u.y * WARP_FREQ.x + t + i * 0.007) * WARP_AMP.x;\n    u.y -= sin(u.x * WARP_FREQ.y - t + i * 0.02) * WARP_AMP.y;\n    u = fold * u * SHRINK;\n    vec2 q = (u - vec2(OFFSET + breath * 0.1, 0.0)) * ASPECT;\n    float g = GLOW / (dot(q, q) + SOFT) * (0.25 + breath * 0.4);\n    float r = length(u);\n    float k = sin(i * CYCLE + t * 1.2 + r * HUE_TRAVEL) * 0.5 + 0.5;\n    value += g * mix(1.0, 0.0, k) * (0.62 + 0.5 * k) * exp2(-r * FALLOFF);\n  }\n  float x = max(value * GAIN, 0.0);\n  value = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);\n  vec3 col = pow(vec3(clamp(value, 0.0, 1.0)), vec3(0.85, 0.92, 0.98));\n  col *= 1.0 - smoothstep(0.5, 1.6, length(pos)) * 0.07;\n  vec3 light = max(col, 0.0);\n  vec3 dark = uBg + light * (1.0 - uBg);\n  vec3 paper = uBg * (1.0 - light);\n  col = mix(dark, paper, uPaper);\n  col += (ign(frag, floor(uTime * 24.0)) - 0.5) / 255.0;\n  float opacity = uOpacity * (1.0 - smoothstep(uFadeStart, uFadeEnd, frag.y / uRes.y));\n  if (uSideEnd > 0.0) {\n    float sideDistance = min(frag.x, uRes.x - frag.x);\n    opacity *= smoothstep(uSideStart, uSideEnd, sideDistance);\n  }\n  fragColor = vec4(clamp(col, 0.0, 1.0) * opacity, opacity);\n}\n"));
 gl.linkProgram(program);
 if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('ribbon.link: ' + gl.getProgramInfoLog(program));
 gl.useProgram(program);
 const buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
 const position=gl.getAttribLocation(program,'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
 const uniform=name=>gl.getUniformLocation(program,name);
 gl.uniform1f(uniform('uSize'),1.0); gl.uniform1f(uniform('uAngle'),-Math.PI);
 gl.uniform3f(uniform('uBg'),9/255,11/255,13/255); gl.uniform1f(uniform('uPaper'),0);
 gl.uniform1f(uniform('uOpacity'),1); gl.uniform1f(uniform('uFadeStart'),.25); gl.uniform1f(uniform('uFadeEnd'),1);
 gl.uniform1f(uniform('uSideStart'),0); gl.uniform1f(uniform('uSideEnd'),0);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let frame=0, time=0, previous=0;
 const draw=stamp=>{
  frame=0;
  if(previous) time+=Math.min((stamp-previous)/1000,.05)*.65;
  previous=stamp;
  const width=Math.min(640, Math.round(canvas.clientWidth*.5)),height=Math.round(canvas.clientHeight*width/canvas.clientWidth);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);}
  gl.uniform2f(uniform('uRes'),width,height); gl.uniform1f(uniform('uTime'),time);
  gl.drawArrays(gl.TRIANGLES,0,6);
  if(!reduced.matches&&!document.hidden) frame=requestAnimationFrame(draw);
 };
 const sync=()=>{cancelAnimationFrame(frame); previous=0; draw(performance.now());};
 reduced.addEventListener('change',sync); document.addEventListener('visibilitychange',sync); window.addEventListener('resize',sync); sync();
} else { console.warn('ribbon.context: WebGL2 unavailable'); }
