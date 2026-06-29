export const SH_C0 = 0.28209479177387814;

const EPSILON = 1e-12;

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function length(v) {
  return Math.sqrt(dot(v, v));
}

export function normalize(v, fallback = [0, 0, 1]) {
  const len = length(v);
  if (len <= EPSILON) return [...fallback];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

export function triangleArea(a, b, c) {
  return 0.5 * length(cross(sub(b, a), sub(c, a)));
}

export function triangleNormal(a, b, c) {
  return normalize(cross(sub(b, a), sub(c, a)));
}

export function sampleTriangleBarycentric() {
  let u = Math.random();
  let v = Math.random();

  // Reflect samples outside the unit simplex back inside for uniform area sampling.
  if (u + v > 1) {
    u = 1 - u;
    v = 1 - v;
  }

  return [1 - u - v, u, v];
}

export function weightedVec3(a, b, c, weights) {
  return [
    a[0] * weights[0] + b[0] * weights[1] + c[0] * weights[2],
    a[1] * weights[0] + b[1] * weights[1] + c[1] * weights[2],
    a[2] * weights[0] + b[2] * weights[1] + c[2] * weights[2]
  ];
}

export function rgbToShDc(rgb) {
  return [
    (rgb[0] - 0.5) / SH_C0,
    (rgb[1] - 0.5) / SH_C0,
    (rgb[2] - 0.5) / SH_C0
  ];
}

export function quaternionFromZToNormal(normal) {
  const zAxis = [0, 0, 1];
  const n = normalize(normal, zAxis);
  const d = clamp(dot(zAxis, n), -1, 1);

  if (d > 1 - 1e-8) {
    return [1, 0, 0, 0];
  }

  if (d < -1 + 1e-8) {
    // A 180-degree rotation around X maps +Z to -Z.
    return [0, 1, 0, 0];
  }

  const axis = cross(zAxis, n);
  const s = Math.sqrt((1 + d) * 2);
  const invS = 1 / s;

  return normalizeQuat([
    s * 0.5,
    axis[0] * invS,
    axis[1] * invS,
    axis[2] * invS
  ]);
}

function normalizeQuat(q) {
  const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (len <= EPSILON) return [1, 0, 0, 0];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}
