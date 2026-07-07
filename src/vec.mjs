// Minimal 3-vector helpers (arrays [x,y,z]). Kept tiny and dependency-free.
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [1, 0, 0];
};
export const lerp = (a, b, x) => a + (b - a) * x;

// 3×3 rotation from Euler angles in DEGREES, applied Z·Y·X (rows-major [r0,r1,r2]).
export function eulerMatrix([rx = 0, ry = 0, rz = 0] = []) {
  const d = Math.PI / 180;
  const cx = Math.cos(rx * d), sx = Math.sin(rx * d);
  const cy = Math.cos(ry * d), sy = Math.sin(ry * d);
  const cz = Math.cos(rz * d), sz = Math.sin(rz * d);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}
export const matVec = (R, v) => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];
// Transpose = inverse for a rotation matrix.
export const transpose3 = (R) => [
  [R[0][0], R[1][0], R[2][0]],
  [R[0][1], R[1][1], R[2][1]],
  [R[0][2], R[1][2], R[2][2]],
];
