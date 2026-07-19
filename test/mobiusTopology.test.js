import assert from "node:assert/strict";
import test from "node:test";

import {
  mobiusPointFromCover,
  mobiusPointInCopy,
  mobiusRowForCopy,
} from "../src/game/mobiusTopology.js";

test("Mobius cover copies alternate between normal and reversed rows", () => {
  const height = 5;
  assert.equal(mobiusRowForCopy(1, 0, height), 1);
  assert.equal(mobiusRowForCopy(1, 1, height), 3);
  assert.equal(mobiusRowForCopy(1, 2, height), 1);
  assert.equal(mobiusRowForCopy(1, -1, height), 3);
  assert.equal(mobiusRowForCopy(1, -2, height), 1);
});

test("Mobius cover mapping round-trips across positive and negative copies", () => {
  for (const size of [4, 5, 9, 13, 19, 25]) {
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        for (let copyIndex = -3; copyIndex <= 3; copyIndex += 1) {
          const image = mobiusPointInCopy(
            row,
            col,
            copyIndex,
            size,
          );
          const logical = mobiusPointFromCover(
            image.row,
            image.coverColumn,
            size,
          );
          assert.deepEqual(
            { row: logical.row, col: logical.col },
            { row, col },
          );
          assert.equal(logical.copyIndex, copyIndex);
        }
      }
    }
  }
});

test("the immediate cover neighbours encode the reversed seam", () => {
  assert.deepEqual(
    mobiusPointFromCover(1, -1, 4),
    { row: 2, col: 3, copyIndex: -1 },
  );
  assert.deepEqual(
    mobiusPointFromCover(1, 4, 4),
    { row: 2, col: 0, copyIndex: 1 },
  );
  assert.deepEqual(
    mobiusPointFromCover(1, -1, 5),
    { row: 3, col: 4, copyIndex: -1 },
  );
});
