export function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function mobiusCopyIndex(coverColumn, width) {
  if (!Number.isInteger(coverColumn) || !Number.isInteger(width) || width < 1) {
    throw new TypeError("coverColumn and width must be integers with width > 0");
  }
  return Math.floor(coverColumn / width);
}

export function mobiusRowForCopy(row, copyIndex, height) {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(copyIndex) ||
    !Number.isInteger(height) ||
    height < 1 ||
    row < 0 ||
    row >= height
  ) {
    throw new TypeError("row, copyIndex and height do not describe a valid point");
  }
  return positiveModulo(copyIndex, 2) === 1 ? height - 1 - row : row;
}

/** Map one point in the infinite rectangular cover back to the base board. */
export function mobiusPointFromCover(row, coverColumn, width, height = width) {
  const copyIndex = mobiusCopyIndex(coverColumn, width);
  return {
    row: mobiusRowForCopy(row, copyIndex, height),
    col: positiveModulo(coverColumn, width),
    copyIndex,
  };
}

/** Place a canonical board point in a chosen copy of the infinite cover. */
export function mobiusPointInCopy(
  row,
  col,
  copyIndex,
  width,
  height = width,
) {
  if (!Number.isInteger(col) || col < 0 || col >= width) {
    throw new TypeError("col must be inside the base board");
  }
  return {
    row: mobiusRowForCopy(row, copyIndex, height),
    coverColumn: col + copyIndex * width,
    copyIndex,
  };
}
