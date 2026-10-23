// Every pixel is a photon traced backwards from the camera through curved spacetime.
//
// Units: the Schwarzschild radius rs = 1, so the event horizon sits at r = 1,
// the photon sphere at r = 1.5 and the innermost stable circular orbit at r = 3.
//
// Light bending uses the force law  x'' = -3/2 h^2 x / r^5  (h = |x × v|), which
// reproduces the exact Schwarzschild photon orbit equation u'' + u = 3/2 u^2
// while letting us integrate in plain Cartesian coordinates.

precision highp float;

uniform float uTime;
uniform vec3 uCamPos;
uniform mat4 uCamWorld;
uniform mat4 uProjInv;
uniform float uEscape;

uniform float uGravity;
uniform float uStepScale;

uniform float uDiskInner;
uniform float uDiskOuter;
uniform float uDiskIntensity;
uniform float uDiskTemp;
uniform float uDiskDensity;
uniform float uDiskSpeed;
uniform float uDoppler;

uniform float uStars;
uniform float uGalaxy;

varying vec2 vUv;

#define MAX_STEPS 400

const vec3 GALAXY_NORMAL = normalize(vec3(0.42, 1.0, 0.28));
const vec3 GALAXY_CORE = normalize(vec3(-0.85, 0.25, -0.46));

// ---------------------------------------------------------------------------
// Hashing and noise

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 hash42(vec2 p) {
  vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * noise(p);
    p = p * 2.03 + vec3(17.1, 9.2, 3.7);
    amp *= 0.5;
  }
  return sum;
}

// Approximate colour of a black body at temperature t (Kelvin), linear RGB.
vec3 blackbody(float t) {
  t = max(t, 1.0);
  vec3 c;
  c.r = 56100000.0 * pow(t, -1.5) + 148.0;
  c.g = t > 6500.0 ? 35200000.0 * pow(t, -1.5) + 184.0 : 100.04 * log(t) - 623.6;
  c.b = 194.18 * log(t) - 1448.6;
  c = clamp(c, 0.0, 255.0) / 255.0;
  if (t < 1000.0) c *= t / 1000.0;
  return pow(c, vec3(2.2));
}

// ---------------------------------------------------------------------------
// Sky

// One layer of stars on a cube-mapped grid. `px` is the angular size of the
// pixel footprint on the sky; stars smaller than that are blurred to it with
// their total flux preserved, which keeps them from shimmering, and lets
// heavily lensed regions fade into a smooth glow instead of aliasing.
vec3 starLayer(vec3 d, float cells, float density, float size, float brightness, float px, float seed) {
  vec3 a = abs(d);
  vec2 uv;
  float face;
  float major;
  if (a.x >= a.y && a.x >= a.z) {
    uv = d.yz / a.x; major = a.x; face = d.x > 0.0 ? 0.0 : 1.0;
  } else if (a.y >= a.z) {
    uv = d.xz / a.y; major = a.y; face = d.y > 0.0 ? 2.0 : 3.0;
  } else {
    uv = d.xy / a.z; major = a.z; face = d.z > 0.0 ? 4.0 : 5.0;
  }

  vec2 g = uv * cells;
  vec2 id = floor(g);
  float toAngle = major * sqrt(major) / cells;
  float sigma = min(max(size, px), toAngle * 0.5);
  float conserve = (size * size) / (sigma * sigma);

  vec3 col = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = id + vec2(x, y);
      vec4 h = hash42(cell + vec2(face * 1013.0 + seed, seed * 0.37));
      if (h.w > density) continue;
      vec2 star = cell + 0.5 + (h.xy - 0.5) * 0.85;
      float dist = length(g - star) * toAngle;
      float mag = brightness * (0.04 + pow(h.z, 12.0));
      float temp = mix(2900.0, 13000.0, pow(fract(h.z * 91.7 + h.x * 7.3), 2.0));
      col += blackbody(temp) * mag * exp(-0.5 * dist * dist / (sigma * sigma));
    }
  }
  return col * conserve;
}

vec3 galaxy(vec3 d, float lat, float band) {
  float thin = exp(-lat * lat * 160.0);
  float bulge = pow(max(dot(d, GALAXY_CORE), 0.0), 7.0);
  float clouds = fbm(d * 4.0, 5);
  float dust = fbm(d * 9.0 + 7.3, 4);
  float lanes = smoothstep(0.42, 0.62, dust) * (thin + bulge * 0.5);

  vec3 cool = vec3(0.55, 0.66, 1.0);
  vec3 warm = vec3(1.0, 0.72, 0.46);
  vec3 c = mix(cool, warm, clamp(bulge * 1.6 + thin * 0.35, 0.0, 1.0));
  float glow = band * (0.2 + clouds * clouds * 1.8) * (1.0 + bulge * 4.0) * (1.0 - lanes * 0.85);

  float neb = pow(fbm(d * 2.2 + 3.1, 4), 3.0);
  vec3 nebCol = mix(vec3(0.35, 0.12, 0.5), vec3(0.08, 0.3, 0.45), fbm(d * 1.3, 2));

  return (c * glow * 0.05 + nebCol * neb * 0.06) * uGalaxy;
}

vec3 background(vec3 d) {
  float px = 0.5 * length(fwidth(d));
  float lat = dot(d, GALAXY_NORMAL);
  float band = exp(-lat * lat * 22.0);

  vec3 col = galaxy(d, lat, band);
  col += uStars * starLayer(d, 300.0, 0.08 + 0.35 * band, 0.0006, 1.2, px, 0.0);
  col += uStars * starLayer(d, 46.0, 0.08, 0.0011, 18.0, px, 71.0);
  return col;
}

// ---------------------------------------------------------------------------
// Accretion disk

float diskPattern(float r, float a, float seed) {
  vec3 q = vec3(cos(a) * 2.4, sin(a) * 2.4, r * 1.6) + seed;
  float clumps = fbm(q, 5);
  float grooves = noise(vec3(r * 9.0 + seed, cos(a) * 1.3, sin(a) * 1.3));
  return clumps * 0.8 + grooves * 0.3;
}

// Emission (rgb) and opacity (a) where a ray crosses the disk plane at p.
vec4 disk(vec3 p, vec3 rd) {
  float r = length(p.xz);
  if (r < uDiskInner * 0.8 || r > uDiskOuter) return vec4(0.0);

  // Keplerian shear: inner orbits spin faster. Two copies of the pattern
  // restart out of phase and are cross-faded so the spiral never winds up
  // into noise; the blend is normalised to keep contrast constant.
  float phi = atan(p.z, p.x);
  float omega = 2.5 * pow(r, -1.5);
  const float PERIOD = 10.0;
  float t = uTime * uDiskSpeed / PERIOD;
  float ph1 = fract(t);
  float ph2 = fract(t + 0.5);
  float w = abs(2.0 * ph1 - 1.0);
  float n1 = diskPattern(r, phi - omega * ph1 * PERIOD, 0.0);
  float n2 = diskPattern(r, phi - omega * ph2 * PERIOD, 31.7);
  float n = (mix(n1, n2, w) - 0.5) * inversesqrt(w * w + (1.0 - w) * (1.0 - w)) + 0.5;

  float x = (r - uDiskInner) / (uDiskOuter - uDiskInner);
  float edges = smoothstep(uDiskInner * 0.8, uDiskInner * 1.06, r) * (1.0 - smoothstep(0.4, 1.0, x));
  float dens = edges * (0.12 + 1.2 * smoothstep(0.3, 0.85, n));
  float alpha = clamp(dens * uDiskDensity, 0.0, 1.0);

  // Relativistic Doppler factor of the orbiting gas, times gravitational redshift.
  vec3 v = vec3(-p.z, 0.0, p.x) / r;
  float beta = min(sqrt(0.5 / max(r - 1.0, 0.01)), 0.9);
  float gamma = inversesqrt(1.0 - beta * beta);
  float shift = sqrt(1.0 - 1.0 / r) / (gamma * (1.0 + beta * dot(v, rd)));
  shift = mix(1.0, shift, uDoppler);

  float temp = uDiskTemp * pow(uDiskInner / r, 0.75);
  float brightness = uDiskIntensity * pow(uDiskInner / r, 1.5) * pow(shift, 4.0) * (0.55 + 0.9 * n);
  return vec4(blackbody(temp * shift) * brightness, alpha);
}

// ---------------------------------------------------------------------------

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 view = uProjInv * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(view.xyz / view.w, 0.0)).xyz);

  vec3 pos = uCamPos;
  vec3 vel = dir;
  vec3 hv = cross(pos, vel);
  float k = 1.5 * dot(hv, hv) * uGravity;

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float escaped = 0.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    if (r < 1.0) break;
    if (r > uEscape && dot(pos, vel) > 0.0) {
      escaped = 1.0;
      break;
    }

    // Big steps far away, small ones near the photon sphere.
    float dt = uStepScale * r * clamp(0.3 + 0.35 * (r - 1.0), 0.3, 1.0);
    vec3 prev = pos;
    vel -= k * pos / (r2 * r2 * r) * dt;
    pos += vel * dt;

    if (prev.y * pos.y < 0.0) {
      vec3 hit = mix(prev, pos, prev.y / (prev.y - pos.y));
      vec4 d = disk(hit, normalize(vel));
      col += (1.0 - alpha) * d.a * d.rgb;
      alpha += (1.0 - alpha) * d.a;
      if (alpha > 0.995) break;
    }
  }

  // Kept outside the loop so fwidth() runs in uniform control flow.
  vec3 sky = background(normalize(vel));
  col += (1.0 - alpha) * escaped * sky;

  gl_FragColor = vec4(col, 1.0);
}
