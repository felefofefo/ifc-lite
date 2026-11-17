/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { useState } from 'react';
import { advance, cleanup, click, press, render } from '@/test/render.js';
import type { DimensionType } from '@/lib/drawing/dimension-line';
import type { Annotation2DTool } from '@/store/slices/drawing2DSlice';
import { DrawingToolbar } from './DrawingToolbar';

const noop = () => {};

function Probe() {
  const [activeTool, onSelectTool] = useState<Annotation2DTool>('none');
  const [dimensionType, setType] = useState<DimensionType>('aligned');
  return <DrawingToolbar tier="wide" activeTool={activeTool} dimensionType={dimensionType}
    onSelectTool={onSelectTool} onSelectDimensionType={type => { setType(type); onSelectTool('measure'); }}
    selectHint="" hasMarkup={false} onClearMarkup={noop} settingsOpen={false} onToggleSettings={noop}
    zoomPercent={100} onZoomIn={noop} onZoomOut={noop} onFit={noop} pinned={false} onTogglePinned={noop} />;
}

afterEach(cleanup);

it('chooses a dimension via the arrow and remembers the choice for the main button', async () => {
  const ui = render(<Probe />);
  const choose = ui.querySelector('[aria-label="Choose dimension type"]');
  const main = ui.querySelector('[aria-label="Dimension"]');
  const select = ui.querySelector('[aria-label="Select"]');
  assert.ok(choose && main && select);

  press(choose, 'ArrowDown');
  await advance(20);
  const choices = [...document.querySelectorAll('[role="menuitemradio"]')];
  assert.deepEqual(choices.map(item => item.textContent), ['Aligned dimension', 'Horizontal dimension', 'Vertical dimension']);
  click(choices[2]);
  assert.equal(main.getAttribute('aria-checked'), 'true');

  click(select);
  click(main);
  press(choose, 'ArrowDown');
  await advance(20);
  const selected = document.querySelector('[role="menuitemradio"][aria-checked="true"]');
  assert.equal(selected?.textContent, 'Vertical dimension');
});
