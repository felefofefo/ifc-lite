import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { constrainSketchPoint, readSketchFields, sketchMeasures, sketchRectangle, EMPTY_SKETCH_FIELDS } from './sketch-input.js';
const origin = { x: 0, y: 0 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const lock = (first: string, second: string, p = { x: 3, y: 4 }) => constrainSketchPoint('polygon', origin, p, p, { first, second });

describe('shared sketch input', () => {
  it('passes through existing snapping when no locks are set', () => {
    const p = { x: 3, y: 4 };
    assert.deepEqual(constrainSketchPoint('polygon', origin, p, p, EMPTY_SKETCH_FIELDS), { point: p, reference: p });
  });
  it('accepts a decimal comma and a signed angle', () => assert.deepEqual(readSketchFields('polygon', { first: '2,5', second: '-90' }), { first: 2.5, second: -90 }));
  it('rejects invalid numbers and non-positive distances', () => {
    for (const first of ['0', '-1', 'Infinity', '1e100', '2 m', '1,2.3', 'NaN']) assert.equal(readSketchFields('polygon', { first, second: '' }), null);
    assert.equal(readSketchFields('rectangle', { first: '2', second: '0' }), null);
  });
  it('locks length while preserving direction', () => {
    const r = lock('10', '')!; near(r.point.x, 6); near(r.point.y, 8); assert.equal(r.reference, null);
  });
  it('locks angle while preserving radial length', () => {
    const r = lock('', '180')!; near(r.point.x, -5); near(r.point.y, 0); assert.equal(r.reference, null);
  });
  it('locks length and angle together, independent of the cursor', () => {
    const r = lock('8', '-90')!; near(r.point.x, 0); near(r.point.y, -8);
  });
  it('keeps only a snap that coincides with the numeric result', () => {
    const p = { x: 5, y: 0 }; assert.deepEqual(lock('5', '0', p), { point: p, reference: p });
  });
  it('locks rectangle width and height in every cursor quadrant', () => {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const p = { x: sx, y: sy };
      assert.deepEqual(constrainSketchPoint('rectangle', origin, p, p, { first: '5', second: '3' })?.point, { x: sx * 5, y: sy * 3 });
    }
  });
  it('allows one rectangle axis to follow the cursor', () => assert.deepEqual(constrainSketchPoint('rectangle', origin, { x: -1, y: 7 }, null, { first: '4', second: '' })?.point, { x: -4, y: 7 }));
  it('computes live measures in drawing coordinates', () => {
    assert.deepEqual(sketchMeasures('polygon', origin, { x: 0, y: -3 }), { first: 3, second: 270 });
    assert.deepEqual(sketchMeasures('rectangle', origin, { x: -4, y: 3 }), { first: 4, second: 3 });
  });
  it('creates a four-node rectangle with exact area and perimeter', () => {
    const r = sketchRectangle({ x: 1000000, y: 2000000 }, { x: 1000005, y: 2000003 })!;
    assert.equal(r.points.length, 4); near(r.area, 15); near(r.perimeter, 16);
  });
  it('rejects collapsed and invalid rectangles', () => {
    assert.equal(sketchRectangle(origin, { x: 1, y: 0 }), null);
    assert.equal(sketchRectangle(origin, { x: Infinity, y: 1 }), null);
  });
});
