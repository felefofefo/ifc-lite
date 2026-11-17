/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_DIMENSION_STYLE, applyDimensionSizeEdits, formatDimensionLabel, hitDimensionLabel, readDimensionStyle, readDimensionStyleLibrary, resolveDimensionStyle, styledDimension } from './dimension-style';

test('reads valid settings and defaults invalid or missing fields independently', () => {
  const style = readDimensionStyle('{"textMm":3.5,"strokeMm":-1,"decimalPlaces":2,"terminator":"arrow","unit":"cm","showUnit":false}');
  assert.deepEqual(style, {
    ...DEFAULT_DIMENSION_STYLE, textMm: 3.5, decimalPlaces: 2, startTerminator: 'arrow', endTerminator: 'arrow', unit: 'cm', showUnit: false,
  });
  const warn = console.warn;
  try {
    console.warn = () => {};
    assert.deepEqual(readDimensionStyle('{'), DEFAULT_DIMENSION_STYLE);
  } finally {
    console.warn = warn;
  }
});

test('converts paper size exactly once and extends witness lines beyond the dimension', () => {
  const style = { ...DEFAULT_DIMENSION_STYLE, extensionMm: 1, startTerminator: 'arrow', endTerminator: 'arrow' } as const;
  const result = styledDimension({ x: 0, y: 5 }, { x: 20, y: 5 }, [{ x: 0, y: 9 }, { x: 20, y: 9 }], style, 2);
  assert.ok(result);
  assert.equal(result.lineWidth, style.strokeMm * 2);
  assert.equal(result.textSize, style.textMm * 2);
  assert.equal(result.strokes.length, 7);
  assert.deepEqual(result.strokes[1], [{ x: 0, y: 9 }, { x: 0, y: 3 }]);
  assert.deepEqual(result.strokes[3], [{ x: 0, y: 5 }, { x: 3, y: 6.2 }]);
  assert.equal(styledDimension({ x: 0, y: 0 }, { x: 0, y: 0 }, undefined, style, 1), null);
});

test('uses the project formatter or converts the dimension explicitly', () => {
  const formatProject = (distance: number, precision: number | null, showUnit: boolean) => {
    assert.equal(distance, 1.25);
    assert.equal(precision, 3);
    assert.equal(showUnit, false);
    return '1.250';
  };
  assert.equal(formatDimensionLabel(1.25, { ...DEFAULT_DIMENSION_STYLE, decimalPlaces: 3, showUnit: false }, formatProject), '1.250');
  assert.equal(formatDimensionLabel(1.25, { ...DEFAULT_DIMENSION_STYLE, unit: 'cm', decimalPlaces: 1 }, formatProject), '125.0 cm');
});

test('keeps the printed text height across publication scales', () => {
  for (const scale of [50, 100]) {
    const metresPerPaperMillimetre = scale / 1000;
    const graphic = styledDimension({ x: 0, y: 0 }, { x: 4, y: 0 }, undefined, DEFAULT_DIMENSION_STYLE, metresPerPaperMillimetre);
    assert.ok(graphic);
    assert.equal(graphic.textSize / metresPerPaperMillimetre, DEFAULT_DIMENSION_STYLE.textMm);
    assert.ok(Math.abs(graphic.lineWidth / metresPerPaperMillimetre - DEFAULT_DIMENSION_STYLE.strokeMm) < 1e-8);
  }
});

test('migrates the single terminator, preserves mixed ends and rejects unsafe colours', () => {
  const old = readDimensionStyle('{"terminator":"arrow"}');
  assert.equal(old.startTerminator, 'arrow');
  assert.equal(old.endTerminator, 'arrow');
  const style = readDimensionStyle('{"startTerminator":"tick","endTerminator":"arrow","lineColor":"#123456","textColor":"url(unsafe)"}');
  assert.equal(style.lineColor, '#123456');
  assert.equal(style.textColor, null);
  const first = { x: 2, y: 3 };
  const second = { x: 22, y: 3 };
  const normal = styledDimension(first, second, undefined, style, 1);
  const reversed = styledDimension(second, first, undefined, style, 1);
  assert.ok(normal && reversed);
  assert.equal(normal.strokes.length, 4);
  assert.deepEqual(normal.strokes.slice(1), reversed.strokes.slice(1));
});

test('opens types by stable ID and migrates an existing project style to Architectural', () => {
  const old = readDimensionStyleLibrary('{"textMm":3.5,"terminator":"arrow"}');
  assert.equal(old.types[0].style.textMm, 3.5);
  assert.equal(old.types[0].style.endTerminator, 'arrow');
  const library = readDimensionStyleLibrary(JSON.stringify({
    version: 2, defaultId: 'detail',
    types: [...old.types, { id: 'detail', name: 'Detail', style: { textMm: 4 } }],
  }));
  const styles = new Map(library.types.map(type => [type.id, type.style]));
  assert.equal(library.defaultId, 'detail');
  assert.equal(resolveDimensionStyle(styles, 'detail', DEFAULT_DIMENSION_STYLE).textMm, 4);
  assert.equal(resolveDimensionStyle(styles, undefined, DEFAULT_DIMENSION_STYLE).textMm, 3.5);
  assert.equal(resolveDimensionStyle(styles, 'missing', DEFAULT_DIMENSION_STYLE).textMm, 3.5);
});

test('selects the rotated text using its visual rectangle', () => {
  const hit = { id: 'label', center: { x: 30, y: 20 }, width: 20, height: 6, angle: 90 };
  assert.equal(hitDimensionLabel(hit, { x: 30, y: 28 }), true);
  assert.equal(hitDimensionLabel(hit, { x: 39, y: 20 }), false);
});

test('keeps the preview at the saved size while an incomplete field is being edited', () => {
  const base = { ...DEFAULT_DIMENSION_STYLE, labelGapMm: 2 };
  const { style, invalid } = applyDimensionSizeEdits(base, { labelGapMm: '', textMm: '3.5', strokeMm: '50' });
  assert.deepEqual(invalid, ['labelGapMm', 'strokeMm']);
  assert.equal(style.labelGapMm, 2);
  assert.equal(style.strokeMm, base.strokeMm);
  assert.equal(style.textMm, 3.5);
});

test('keeps new end marks independent and in paper units', () => {
  const style = readDimensionStyle('{"startTerminator":"dot","endTerminator":"filledArrow","tickMm":2}');
  const start = { x: 0, y: 4 };
  const end = { x: 16, y: 4 };
  const filled = styledDimension(start, end, undefined, style, 2);
  assert.ok(filled);
  assert.deepEqual(filled.circles, [{ center: start, radius: 2, filled: true }]);
  assert.equal(filled.triangles.length, 1);
  assert.equal(filled.triangles[0][0], end);

  const open = styledDimension(start, end, undefined, { ...style, startTerminator: 'circle', endTerminator: 'bar' }, 2);
  assert.ok(open);
  assert.deepEqual(open.circles, [{ center: start, radius: 2, filled: false }]);
  assert.deepEqual(open.strokes[1], [{ x: 16, y: 2 }, { x: 16, y: 6 }]);
});
