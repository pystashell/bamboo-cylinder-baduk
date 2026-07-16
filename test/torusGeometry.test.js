import assert from "node:assert/strict";
import test from "node:test";

import {
  TAU,
  torusAnglesFromPoint,
  torusFrame,
  torusGridFrame,
  torusGridPointFromCartesian,
} from "../src/view/torusGeometry.js";

const EPSILON = 1e-10;

function close(actual, expected, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} is not within ${epsilon} of ${expected}`,
  );
}

function circularDistance(left, right) {
  const direct = Math.abs(left - right) % TAU;
  return Math.min(direct, TAU - direct);
}

test("torusFrame matches the outer, top and inner cardinal points", () => {
  const majorRadius = 5;
  const minorRadius = 2;

  const outer = torusFrame(0, 0, majorRadius, minorRadius);
  assert.deepEqual(outer.position, { x: 7, y: 0, z: 0 });
  assert.deepEqual(outer.normal, { x: 1, y: 0, z: 0 });

  const top = torusFrame(0, Math.PI / 2, majorRadius, minorRadius);
  close(top.position.x, 5);
  close(top.position.y, 0);
  close(top.position.z, 2);
  close(top.normal.x, 0);
  close(top.normal.y, 0);
  close(top.normal.z, 1);

  const inner = torusFrame(0, Math.PI, majorRadius, minorRadius);
  close(inner.position.x, 3);
  close(inner.position.y, 0);
  close(inner.position.z, 0);
  close(inner.normal.x, -1);
});

test("normal offsets preserve angles and move exactly along the unit normal", () => {
  const base = torusFrame(1.1, 4.2, 6, 2);
  const raised = torusFrame(1.1, 4.2, 6, 2, 0.25);
  const normalLength = Math.hypot(
    base.normal.x,
    base.normal.y,
    base.normal.z,
  );
  close(normalLength, 1);
  close(raised.position.x - base.position.x, base.normal.x * 0.25);
  close(raised.position.y - base.position.y, base.normal.y * 0.25);
  close(raised.position.z - base.position.z, base.normal.z * 0.25);

  const inverted = torusAnglesFromPoint(raised.position, 6);
  close(circularDistance(inverted.u, 1.1), 0);
  close(circularDistance(inverted.v, 4.2), 0);
});

for (const size of [9, 13, 19, 25]) {
  test(`all ${size}x${size} torus grid points survive Cartesian roundtrip`, () => {
    const minorRadius = size / TAU;
    const majorRadius = minorRadius * 2.1;
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const frame = torusGridFrame({
          row,
          col,
          size,
          majorRadius,
          minorRadius,
          offset: 0.125,
        });
        assert.deepEqual(
          torusGridPointFromCartesian(frame.position, size, majorRadius),
          { row, col },
        );
      }
    }
  });
}
