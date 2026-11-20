/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Drawing2D, SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { gridFromPlan, projectGrid, readProjectGrids, type ProjectGrid } from './project-grids';

const grid: ProjectGrid = { id: 'g', templateId: 'symbol', name: 'A', start: { x: 2, y: 0, z: -4 }, end: { x: 2, y: 0, z: 4 } };
const drawing = (plane: SectionPlaneConfig) => ({ config: { plane }, bounds: { min: { x: -5, y: 0 }, max: { x: 5, y: 3 } } }) as Drawing2D;

test('a project grid round trips through a flipped plan and retains its identity', () => {
  const plane = { axis: 'y', position: 1.2, flipped: true } as const;
  const tag = projectGrid(grid, drawing(plane));
  assert.ok(tag);
  assert.equal(tag.id, grid.id);
  assert.equal(tag.position.x, -2);
  const result = gridFromPlan(tag, plane);
  assert.ok(result);
  assert.equal(result.start.x, grid.start.x);
  assert.equal(result.start.z, grid.start.z);
  assert.equal(result.end.z, grid.end.z);
});

test('the same model grid intersects cardinal and oblique vertical views', () => {
  const elevation = projectGrid(grid, drawing({ axis: 'z', position: 0, flipped: false }));
  assert.equal(elevation?.gridStart?.x, 2);
  assert.equal(elevation?.gridStart?.y, 0);
  assert.equal(elevation?.position.y, 3);
  assert.equal(projectGrid(grid, drawing({ axis: 'x', position: 1, flipped: false })), undefined);
  const normal = { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 };
  const custom = projectGrid(grid, drawing({ axis: 'z', position: 0, flipped: false, customPlane: {
    normal, distance: 0, origin: { x: 0, y: 0, z: 0 },
    tangent: { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 }, bitangent: { x: 0, y: 1, z: 0 },
  } }));
  assert.ok(custom);
  assert.ok(Math.abs(custom.position.x - 2 * Math.SQRT2) < 1e-8);
});

test('project grid storage rejects duplicate ids, malformed and degenerate axes', () => {
  assert.deepEqual(readProjectGrids([grid, grid, { ...grid, id: 'bad', start: { x: NaN, y: 0, z: 0 } },
    { ...grid, id: 'point', end: grid.start }]), [grid]);
});

test('editing a grid end in plan preserves the opposite end and the shared identity', () => {
  const plane = { axis: 'y', position: 1.2, flipped: true } as const;
  const tag = projectGrid(grid, drawing(plane));
  assert.ok(tag?.gridStart);

  const start = gridFromPlan({ ...tag, gridStart: { x: -6, y: -5 } }, plane);
  assert.ok(start);
  assert.equal(start.id, grid.id);
  assert.equal(start.start.x, 6);
  assert.equal(start.start.z, -5);
  assert.deepEqual(start.end, { ...grid.end, y: plane.position });

  const end = gridFromPlan({ ...tag, position: { x: -8, y: 7 } }, plane);
  assert.ok(end);
  assert.equal(end.id, grid.id);
  assert.deepEqual(end.start, { ...grid.start, y: plane.position });
  assert.equal(end.end.x, 8);
  assert.equal(end.end.z, 7);
});

test('vertical view overrides change only the displayed grid height, not its shared position', () => {
  const plane = { axis: 'z', position: 0, flipped: false } as const;
  const original = projectGrid(grid, drawing(plane));
  const adjusted = projectGrid(grid, drawing(plane), { start: -2, end: 8 });
  assert.equal(adjusted?.gridStart?.x, original?.gridStart?.x);
  assert.equal(adjusted?.position.x, original?.position.x);
  assert.equal(adjusted?.gridStart?.y, -2);
  assert.equal(adjusted?.position.y, 8);
  assert.equal(projectGrid(grid, drawing(plane), { start: 9, end: 8 })?.position.y, original?.position.y);
});
