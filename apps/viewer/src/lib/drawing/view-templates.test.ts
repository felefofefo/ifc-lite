/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeViewTemplates, encodeViewTemplates, type ViewTemplate } from './view-templates.js';

test('retains IFC type rows and sparse pen overrides in a reusable library', () => {
  const templates: ViewTemplate[] = [{ id: 'drawing-template:one', name: 'Section', rows: [
    { ifcClass: 'IfcWall', style: { lineWeight: 'heavy' } },
    { ifcClass: 'IfcWall', typeName: 'Wall 200', style: { projectionLineStyle: 'dashed', visible: false } },
  ] }];
  assert.deepEqual(decodeViewTemplates(encodeViewTemplates(templates, [])).templates, templates);
  assert.throws(() => decodeViewTemplates(encodeViewTemplates([...templates, ...templates], [])));
});
