/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { IfcParser } from '@ifc-lite/parser';
import { drawingPublicationHatchStyle } from '@/hooks/drawingPublicationHatchStyle';
import { materialNameForCut, materialNames, readMaterialHatches, reassignMaterialHatches } from './material-hatches.js';
import { drawingLineweightScales, lineweightsAtScale, readLineweightTable } from './lineweight-table.js';
import { materialSettingsFile, readMaterialSettingsFile, readLineweightSettingsFile } from './publication-settings-file.js';

test('lists IFC materials and resolves the material of a cut from its id or its occurrence', async () => {
  const bytes = await readFile(new URL('../../../public/samples/building-architecture.ifc', import.meta.url));
  const store = await new IfcParser().parseColumnar(Uint8Array.from(bytes).buffer);
  const concrete = 'concrete_reinforced_in-situ';
  assert.equal(materialNames([store, store]).filter((name) => name === concrete).length, 1);
  assert.equal(materialNameForCut(store, 52, 62), concrete);
  assert.equal(materialNameForCut(store, 52), concrete);
  const hatch = drawingPublicationHatchStyle({
    [concrete]: { background: { pattern: 'solid', color: '#eeddcc' }, foreground: { pattern: 'diagonal', color: '#815132' },
      surface: { background: { pattern: 'solid', color: '#eeeeee' }, foreground: { pattern: 'diagonal', color: '#223344' } } },
  }, 50, new Map(), store, [{
    id: 'walls', name: 'Walls', priority: 1, enabled: true, criteria: { type: 'all' },
    style: { hatchPattern: 'cross-hatch', fillColor: '#aabbcc',
      surfaceHatch: { foreground: { pattern: 'cross-hatch' } } },
  }], () => undefined, (expressId) => ({ modelId: 'legacy', expressId }));
  const polygon = { entityId: 52, modelIndex: 0, materialId: 62, ifcType: 'IfcSlab',
    polygon: { outer: [], holes: [] } };
  assert.deepEqual(hatch({ ...polygon, isCut: true }, '#ffffff')?.map(({ pattern, color, spacing }) => [pattern, color, spacing]), [
    ['solid', '#aabbcc', 0.125], ['cross-hatch', '#815132', 0.125],
  ]);
  assert.deepEqual(hatch({ ...polygon, isCut: false }, '#ffffff')?.map(({ pattern, color }) => [pattern, color]), [
    ['solid', '#eeeeee'], ['cross-hatch', '#223344'],
  ]);
  const surfaceOnly = drawingPublicationHatchStyle({
    [concrete]: { surface: { foreground: { pattern: 'diagonal' } } },
  }, 50, new Map(), store, [], () => undefined, (expressId) => ({ modelId: 'legacy', expressId }));
  assert.equal(surfaceOnly({ ...polygon, isCut: true }, '#ffffff'), undefined);
});

test('restores saved custom scales and keeps their edited weights', () => {
  const table = readLineweightTable('{"75":{"heavy":0.5,"medium":0.3,"light":0.2,"hairline":0.15}}');
  const scales = drawingLineweightScales(table, 100, [75, 125, Infinity, -3]);
  assert.equal(scales.filter(({ factor }) => factor === 75).length, 1);
  assert.ok(scales.some(({ name }) => name === '1:125'));
  assert.ok(scales.every(({ factor }) => Number.isFinite(factor) && factor > 0));
  assert.equal(lineweightsAtScale(table, 75).medium, 0.3);
});

test('loads separate surface paints and applies only surface overrides to projection', () => {
  const materials = readMaterialHatches('{"Wood":{"foreground":{"pattern":"diagonal"},"surface":{"background":{"pattern":"cross-hatch","color":"#eeeeee"},"foreground":{"pattern":"diagonal","color":"#777777"}}}}');
  assert.deepEqual(materials.Wood?.surface?.background, { pattern: 'solid', color: '#eeeeee' });
  const hatch = drawingPublicationHatchStyle(undefined, 50, new Map(), null, [{
    id: 'finish', name: 'Finish', priority: 1, enabled: true, criteria: { type: 'all' },
    style: { hatchPattern: 'diagonal', fillColor: '#334455',
      surfaceHatch: { foreground: { pattern: 'cross-hatch', color: '#778899' }, background: { pattern: 'none', color: '#aaaaaa' } } },
  }], () => undefined, (expressId) => ({ modelId: 'legacy', expressId }));
  const polygon = { entityId: 1, modelIndex: 0, ifcType: 'IfcWall', polygon: { outer: [], holes: [] } };
  assert.deepEqual(hatch({ ...polygon, isCut: false }, '#ffffff')?.map(({ pattern, color }) => [pattern, color]),
    [['cross-hatch', '#778899']]);
  assert.deepEqual(hatch({ ...polygon, isCut: true }, '#ffffff')?.map(({ pattern, color }) => [pattern, color]),
    [['solid', '#334455'], ['diagonal', '#666666']]);
});

test('moves a missing material association over the target without touching other settings', () => {
  const source = { foreground: { color: '#ff0000' } };
  const target = { foreground: { color: '#0000ff' } };
  assert.deepEqual(reassignMaterialHatches({ Missing: source, Concrete: target, Wood: target }, 'Missing', 'Concrete'),
    { Concrete: source, Wood: target });
  assert.deepEqual(reassignMaterialHatches({ Missing: source }, 'Missing'), {});
});

test('round trips material settings with only the referenced custom patterns', () => {
  const brick = { id: 'pat:BRICK' as const, name: 'Brick', repeatScale: 2,
    lines: [{ angle: 0, x: 0, y: 0, dx: 0, dy: 4, dash: [3, -1] }] };
  const file = materialSettingsFile({ OldBrick: { foreground: { pattern: brick.id } } },
    [brick, { ...brick, id: 'pat:UNUSED' }], true);
  const imported = readMaterialSettingsFile(JSON.stringify(file));
  assert.equal(imported.materials.OldBrick?.foreground?.pattern, brick.id);
  assert.deepEqual(imported.patterns, [brick]);
  assert.equal(imported.joinUnassigned, true);
  assert.throws(() => readLineweightSettingsFile(JSON.stringify(file)));
});

test('imports a custom lineweight scale and rejects malformed rows', () => {
  const file = { version: 1, kind: 'ifc-lite-lineweights',
    scales: { 75: { heavy: 0.5, medium: 0.3, light: 0.2, hairline: 0.15 } } };
  assert.equal(readLineweightSettingsFile(JSON.stringify(file))[75]?.medium, 0.3);
  file.scales[75].medium = -1;
  assert.throws(() => readLineweightSettingsFile(JSON.stringify(file)));
});
