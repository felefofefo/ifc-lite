/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { act } from 'react';
import { advance, cleanup, click, press, render, type } from '@/test/render.js';
import { ConfirmDialogHost } from '@/components/ui/confirm-dialog';
import { readDimensionStyleLibrary, type DimensionStyleLibrary } from '@/lib/drawing/dimension-style';
import { DrawingDimensionStyles } from './DrawingDimensionStyles';

afterEach(cleanup);

function button(name: string, container: ParentNode = document) {
  const match = Array.from(container.querySelectorAll('button')).find(el => el.textContent?.trim() === name || el.getAttribute('aria-label') === name);
  assert.ok(match, `Missing button: ${name}`);
  return match;
}

test('duplicates a type with a distinct name and assigns it to the selected dimension', () => {
  const library = readDimensionStyleLibrary(null);
  const settings = { projectId: 'test', library, styles: new Map(library.types.map(item => [item.id, item.style])) };
  const saved: DimensionStyleLibrary[] = [];
  const applied: string[] = [];
  const ui = render(<DrawingDimensionStyles settings={{ ...settings, save: value => saved.push(value) }} unitOverrides={{}}
    selection={{ typeId: library.defaultId, assign: id => applied.push(id) }} />);
  click(button('Manage styles', ui));
  assert.ok(document.querySelector('fieldset'));
  assert.equal(document.querySelector('#dimension-copy-name'), null);
  click(button('Duplicate type'));
  const name = document.querySelector<HTMLInputElement>('#dimension-copy-name');
  assert.ok(name);
  assert.equal(button('Save as new type').disabled, true);
  type(name, 'Architectural dimension style');
  assert.equal(button('Save as new type').disabled, true);
  type(name, 'Detail 1:20');
  assert.equal(button('Save as new type').disabled, false);
  const form = name.closest('form');
  assert.ok(form);
  act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(saved[0].types.length, 2);
  assert.equal(saved[0].types[1].name, 'Detail 1:20');
  assert.deepEqual(applied, [saved[0].types[1].id]);
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test('offers separate controls for restoring text position and rotation', () => {
  const library = readDimensionStyleLibrary(null);
  const settings = { projectId: 'test', library, styles: new Map(), save() {} };
  let restored = 0;
  const angles: number[] = [];
  const ui = render(<DrawingDimensionStyles settings={settings} unitOverrides={{}}
    labelEdit={{ id: 'label', angle: 35, hasOffset: true, resetPosition: () => { restored += 1; }, rotate: angle => { angles.push(angle); } }} />);
  click(button('Reset text position', ui));
  assert.equal(restored, 1);
  assert.deepEqual(angles, []);
  click(button('Reset rotation', ui));
  assert.deepEqual(angles, [0]);
});

test('keeps current edits when switching types is cancelled', async () => {
  const library = readDimensionStyleLibrary(null);
  library.types.push({ ...library.types[0], id: 'detail', name: 'Detail' });
  const settings = { projectId: 'test', library, styles: new Map(), save() {} };
  const ui = render(<>
    <ConfirmDialogHost />
    <DrawingDimensionStyles settings={settings} unitOverrides={{}} />
  </>);
  click(button('Manage styles', ui));
  const size = document.querySelector<HTMLInputElement>('#dimension-textMm');
  assert.ok(size);
  type(size, '4.5');
  press(button('Dimension type'), 'ArrowDown');
  await advance(20);
  const detail = Array.from(document.querySelectorAll('[role="option"]')).find(option => option.textContent === 'Detail');
  assert.ok(detail);
  click(detail);
  await advance(20);
  assert.ok(document.body.textContent?.includes('Discard your unsaved edits'));
  const confirmation = Array.from(document.querySelectorAll('[role="alertdialog"]')).find(dialog => dialog.textContent?.includes('Discard your unsaved edits'));
  assert.ok(confirmation);
  click(button('Cancel', confirmation));
  await advance(20);
  assert.equal(size.value, '4.5');
});
