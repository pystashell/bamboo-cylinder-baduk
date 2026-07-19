import assert from "node:assert/strict";
import test from "node:test";

import * as tf from "@tensorflow/tfjs";

import { padSpatialForTopology } from "../src/ai/katago/vendor/modelV8.ts";

test("KataGo Mobius convolution padding reverses rows at both column halos", async () => {
  const input = tf.tensor4d(
    [
      1, 2, 3,
      4, 5, 6,
      7, 8, 9,
    ],
    [1, 3, 3, 1],
  );
  const padded = padSpatialForTopology(input, 1, 1, "mobius");
  assert.deepEqual(padded.shape, [1, 5, 5, 1]);
  assert.deepEqual(Array.from(await padded.data()), [
    0, 0, 0, 0, 0,
    9, 1, 2, 3, 7,
    6, 4, 5, 6, 4,
    3, 7, 8, 9, 1,
    0, 0, 0, 0, 0,
  ]);
  input.dispose();
  padded.dispose();
});

test("KataGo cylinder padding keeps ordinary row orientation", async () => {
  const input = tf.tensor4d(
    [
      1, 2, 3,
      4, 5, 6,
      7, 8, 9,
    ],
    [1, 3, 3, 1],
  );
  const padded = padSpatialForTopology(input, 1, 1, "cylinder");
  assert.deepEqual(Array.from(await padded.data()), [
    0, 0, 0, 0, 0,
    3, 1, 2, 3, 1,
    6, 4, 5, 6, 4,
    9, 7, 8, 9, 7,
    0, 0, 0, 0, 0,
  ]);
  input.dispose();
  padded.dispose();
});
