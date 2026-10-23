// Lens character applied after tone mapping: slight chromatic fringing,
// vignette and film grain.

uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;

varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 c = vUv - 0.5;
  vec2 fringe = c * dot(c, c) * 0.014;
  vec3 col = vec3(
    texture2D(tDiffuse, vUv - fringe).r,
    texture2D(tDiffuse, vUv).g,
    texture2D(tDiffuse, vUv + fringe).b
  );

  float vignette = 1.0 - smoothstep(0.3, 0.95, length(c) * 1.25);
  col *= mix(1.0, vignette, uVignette * 0.7);
  col += (hash12(vUv * uResolution + fract(uTime * 7.31) * 1000.0) - 0.5) * uGrain;

  gl_FragColor = vec4(col, 1.0);
}
