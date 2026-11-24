/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Export PDF uses only the view or sheet scale, never a selected override. */

import '@/test/setup-dom.js';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, cleanup, click } from '@/test/render';
import { DrawingPdfExportDialog } from './DrawingPdfExportDialog';
import type { DrawingSheet } from '@ifc-lite/drawing-2d';

afterEach(() => cleanup());

function exportButton(): HTMLButtonElement {
  const button = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Export');
  assert.ok(button, 'the Export button must render');
  return button as HTMLButtonElement;
}

function sheetFixture(): DrawingSheet {
  return {
    id: 's1', name: 'Sheet 1',
    paper: { id: 'A3_LANDSCAPE', name: 'A3 Landscape', category: 'ISO', widthMm: 420, heightMm: 297, orientation: 'landscape', defaultMarginMm: 15 },
    frame: {} as DrawingSheet['frame'],
    titleBlock: {} as DrawingSheet['titleBlock'],
    scaleBar: {} as DrawingSheet['scaleBar'],
    scale: { name: '1:50', factor: 50, useCase: '' },
    northArrow: {} as DrawingSheet['northArrow'],
    viewportBounds: { x: 0, y: 0, width: 100, height: 100 },
    revisions: [],
  };
}

describe('DrawingPdfExportDialog (#5496)', () => {
  it('exports at the current view scale', () => {
    const calls: Array<number | undefined> = [];
    render(
      <DrawingPdfExportDialog
        open onOpenChange={() => {}} displayedScale={100}
        sheetEnabled={false} activeSheet={null}
        onExport={(n) => calls.push(n)}
      />,
    );
    click(exportButton());
    assert.deepEqual(calls, [100]);
  });

  it('locks a non-sheet export to the current view scale without exposing scale controls', () => {
    const calls: Array<number | undefined> = [];
    render(<DrawingPdfExportDialog open onOpenChange={() => {}} displayedScale={75}
      sheetEnabled={false} activeSheet={null} onExport={n => calls.push(n)} />);
    assert.equal(document.body.querySelector('[role="combobox"]'), null);
    assert.match(document.body.textContent ?? '', /1:75/);
    click(exportButton());
    assert.deepEqual(calls, [75]);
  });

  it('sheet mode ignores the scale controls and exports with no scale argument, letting the sheet decide', () => {
    // `handleExportPDF` reads scale/paper off `activeSheet` itself in sheet
    // mode and ignores any `scaleFactor` argument (see useDrawingExport.ts) —
    // so the dialog must not offer a scale select that would silently do
    // nothing, and must call onExport with no argument.
    const calls: Array<number | undefined> = [];
    render(
      <DrawingPdfExportDialog
        open onOpenChange={() => {}} displayedScale={100}
        sheetEnabled activeSheet={sheetFixture()}
        onExport={(n) => calls.push(n)}
      />,
    );
    assert.equal(document.body.querySelector('[role="combobox"]'), null, 'no scale select in sheet mode');
    assert.match(document.body.textContent ?? '', /1:50/, "the sheet's own fixed scale must be stated");
    click(exportButton());
    assert.deepEqual(calls, [undefined]);
  });

  it('shows the fixed view or sheet scale rather than offering alternate scales', () => {
    const headline = () => document.body.querySelector('[role="dialog"] p')?.textContent;
    const chooser = 'The PDF uses the current view scale.';
    const confirmation = 'The active sheet sets the scale and paper for this PDF.';

    render(
      <DrawingPdfExportDialog
        open onOpenChange={() => {}} displayedScale={100}
        sheetEnabled activeSheet={sheetFixture()}
        onExport={() => {}}
      />,
    );
    assert.equal(headline(), confirmation);
    cleanup();

    render(
      <DrawingPdfExportDialog
        open onOpenChange={() => {}} displayedScale={100}
        sheetEnabled={false} activeSheet={null}
        onExport={() => {}}
      />,
    );
    assert.equal(headline(), chooser);
    cleanup();

    // A disabled sheet uses the active view scale, never the inactive sheet.
    render(
      <DrawingPdfExportDialog
        open onOpenChange={() => {}} displayedScale={100}
        sheetEnabled={false} activeSheet={sheetFixture()}
        onExport={() => {}}
      />,
    );
    assert.equal(headline(), chooser);
    assert.equal(document.body.querySelector('[role="combobox"]'), null, 'the view scale is fixed');
  });

  it('states the paper the PDF will use for both sheet and non-sheet mode', () => {
    render(
      <DrawingPdfExportDialog
        open onOpenChange={() => {}} displayedScale={100}
        sheetEnabled={false} activeSheet={null}
        onExport={() => {}}
      />,
    );
    assert.match(document.body.textContent ?? '', /fit the drawing/i);
    cleanup();

    render(
      <DrawingPdfExportDialog
        open onOpenChange={() => {}} displayedScale={100}
        sheetEnabled activeSheet={sheetFixture()}
        onExport={() => {}}
      />,
    );
    assert.match(document.body.textContent ?? '', /A3 Landscape/);
    assert.match(document.body.textContent ?? '', /420 x 297 mm/);
  });

  it('Cancel closes without exporting', () => {
    const calls: Array<number | undefined> = [];
    let openState = true;
    render(
      <DrawingPdfExportDialog
        open={openState} onOpenChange={(v) => { openState = v; }} displayedScale={100}
        sheetEnabled={false} activeSheet={null}
        onExport={(n) => calls.push(n)}
      />,
    );
    const cancelButton = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel');
    assert.ok(cancelButton, 'the Cancel button must render');
    click(cancelButton);
    assert.deepEqual(calls, [], 'Cancel must not export');
    assert.equal(openState, false, 'Cancel must close the dialog');
  });
});
