import assert from "node:assert/strict";
import test from "node:test";

import {
  MOBIUS_TAU,
  mobiusDifferentialFrame,
  mobiusGridFrame,
  mobiusPoint,
} from "../src/view/mobiusGeometry.js";

function assertVectorClose(actual, expected, tolerance = 1e-9) {
  assert.ok(actual.distanceTo(expected) <= tolerance, `${actual.toArray()} != ${expected.toArray()}`);
}

test("Mobius surface joins one turn after reversing its width coordinate", () => {
  const majorRadius = 6;
  for (let index = 0; index <= 100; index += 1) {
    const v = -3.5 + (index / 100) * 7;
    assertVectorClose(
      mobiusPoint(MOBIUS_TAU, v, majorRadius),
      mobiusPoint(0, -v, majorRadius),
    );
    const endNormal = mobiusDifferentialFrame(
      MOBIUS_TAU,
      v,
      majorRadius,
    ).normal;
    const startNormal = mobiusDifferentialFrame(0, -v, majorRadius).normal;
    assert.ok(endNormal.dot(startNormal) < -0.999999);
  }
});

test("all supported Mobius grid frames are finite with unit local frames", () => {
  for (const size of [5, 6, 9, 10, 13, 19, 25]) {
    const majorRadius = size / 3;
    const halfWidth = majorRadius * 0.62;
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const frame = mobiusGridFrame({
          row,
          col,
          height: size,
          width: size,
          majorRadius,
          halfWidth,
        });
        for (const vector of [
          frame.position,
          frame.normal,
          frame.tangentU,
          frame.tangentV,
        ]) {
          assert.ok(vector.toArray().every(Number.isFinite));
        }
        assert.ok(Math.abs(frame.normal.length() - 1) < 1e-9);
        assert.ok(Math.abs(frame.tangentU.length() - 1) < 1e-9);
        assert.ok(Math.abs(frame.tangentV.length() - 1) < 1e-9);
      }
    }
  }
});

test("the virtual column seam lands on the mirrored canonical row", () => {
  for (const size of [5, 6, 9, 10, 13, 19]) {
    const majorRadius = size / 3;
    const halfWidth = majorRadius * 0.62;
    for (let row = 0; row < size; row += 1) {
      const frame = mobiusGridFrame({
        row,
        col: 0,
        height: size,
        width: size,
        majorRadius,
        halfWidth,
      });
      const mirrored = mobiusGridFrame({
        row: size - 1 - row,
        col: 0,
        height: size,
        width: size,
        majorRadius,
        halfWidth,
      });
      assertVectorClose(
        mobiusPoint(MOBIUS_TAU, frame.v, majorRadius),
        mirrored.position,
      );
    }
  }
});
