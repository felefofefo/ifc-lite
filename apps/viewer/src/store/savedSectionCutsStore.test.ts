/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Saved section cuts (#5514): applying one must re-enter the Section/Drawing
 * contract exactly like every other section writer, so BCF viewpoint capture
 * and the floor-plan command — both of which just read `sectionPlane` /
 * `activeSectionPlane()` — see it without any code of their own.
 */

import '@/test/setup-dom.js';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useViewerStore } from './index.js';
import { publishDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import type { GeometryResult } from '@ifc-lite/geometry';
import { activeSectionPlane } from './section-active.js';
import {
  applySavedSectionCut, createDrawingView, duplicateSavedSectionCut, setSavedViewsProject, updateSavedSectionCut,
  removeSavedSectionCut,
  renameSavedSectionCut,
  saveCurrentSectionCut,
  useSavedSectionCuts,
} from './savedSectionCutsStore.js';

function state() {
  return useViewerStore.getState();
}

beforeEach(() => {
  state().setActiveTool('select');
  state().setSectionPlaneEnabled(false);
  useViewerStore.setState({
    sectionPlane: { ...state().sectionPlane, axis: 'down', position: 50, flipped: false, custom: undefined },
  });
  useSavedSectionCuts.setState({ cuts: [], activeCutId: null });
});

describe('saved section cuts (#5514)', () => {
  it('saves the live cut and restores it exactly, reopening the Section tool', () => {
    state().setActiveTool('section');
    state().setSectionPlaneAxis('front');
    state().setSectionPlanePosition(37);
    state().flipSectionPlane();
    const id = saveCurrentSectionCut('Front @ level 2');

    // Move the live cut elsewhere and leave the tool — the saved cut must
    // still describe the ORIGINAL geometry, not whatever is live now. The
    // moved cut stays on screen after leaving the tool (#5893 — lasting
    // scene state, not tool-coupled), so this asserts it is the MOVED
    // geometry still showing, not the one about to be restored.
    state().setSectionPlaneAxis('down');
    state().setSectionPlanePosition(10);
    state().setActiveTool('select');
    assert.equal(activeSectionPlane(state())?.position, 10, 'the moved cut, not the saved one, is still on screen');

    applySavedSectionCut(id);

    const plane = state().sectionPlane;
    assert.equal(plane.axis, 'front');
    assert.equal(plane.position, 37);
    assert.equal(plane.flipped, true);
    assert.equal(state().activeTool, 'section', 'applying a saved cut opens the Section tool');
    const shown = activeSectionPlane(state());
    assert.ok(shown, 'the saved cut is visible, exactly like any other section writer');
    assert.equal(useSavedSectionCuts.getState().activeCutId, id);
  });

  it('restores the individual publication scale of each saved cut', () => {
    state().setActiveTool('section');
    useViewerStore.setState({ sheetEnabled: false });
    state().updateDrawing2DDisplayOptions({ scale: 50 });
    const detail = saveCurrentSectionCut('Detail');
    state().updateDrawing2DDisplayOptions({ scale: 100 });
    const overall = saveCurrentSectionCut('Overall');

    applySavedSectionCut(detail);
    assert.equal(state().drawing2DDisplayOptions.scale, 50);
    applySavedSectionCut(overall);
    assert.equal(state().drawing2DDisplayOptions.scale, 100);
  });

  it('reopens project views with independent scale, depth and graphic overrides', () => {
    setSavedViewsProject('saved-views-test');
    try {
      state().setActiveTool('section');
      state().updateDrawing2DDisplayOptions({ scale: 50, constructionProjectionDepth: 1.2 });
      state().addCustomRule({ id: 'foreground', name: 'Foreground', enabled: true, priority: 1,
        criteria: { type: 'all' }, style: { hatchPattern: 'diagonal' } });
      const original = saveCurrentSectionCut('A', 'elevation');
      const copy = duplicateSavedSectionCut(original, 'B')!;
      applySavedSectionCut(copy);
      state().updateDrawing2DDisplayOptions({ scale: 100, constructionProjectionDepth: 2.5 });
      state().updateCustomRule('foreground', { style: { hatchPattern: 'cross-hatch' } });
      updateSavedSectionCut(copy);

      setSavedViewsProject('another-project');
      assert.equal(useSavedSectionCuts.getState().cuts.length, 0);
      setSavedViewsProject('saved-views-test');
      assert.equal(useSavedSectionCuts.getState().cuts[0]?.kind, 'elevation');
      applySavedSectionCut(original);
      assert.equal(state().drawing2DDisplayOptions.scale, 50);
      assert.equal(state().drawing2DDisplayOptions.constructionProjectionDepth, 1.2);
      assert.equal(state().customOverrideRules[0]?.style.hatchPattern, 'diagonal');
      applySavedSectionCut(copy);
      assert.equal(state().drawing2DDisplayOptions.scale, 100);
      assert.equal(state().drawing2DDisplayOptions.constructionProjectionDepth, 2.5);
      assert.equal(state().customOverrideRules[0]?.style.hatchPattern, 'cross-hatch');
    } finally {
      setSavedViewsProject(undefined);
      state().clearCustomRules();
      localStorage.removeItem('ifc-lite:saved-drawing-views:v1:saved-views-test');
    }
  });

  it('reopens a camera-only 3D view at its saved publication scale', () => {
    const camera = {
      position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 },
      fov: 45, projectionMode: 'orthographic' as const, orthoSize: 4,
    };
    const callbacks = state().cameraCallbacks;
    let restored: unknown;
    useViewerStore.setState({ cameraCallbacks: {
      ...callbacks, getViewpoint: () => camera, applyViewpoint: (value) => { restored = value; },
    } });
    setSavedViewsProject('3d-view-test');
    try {
      state().clearSectionPlanes();
      const id = saveCurrentSectionCut('Axonometric', '3d', 75);
      setSavedViewsProject(undefined);
      setSavedViewsProject('3d-view-test');
      state().setActiveTool('section');
      applySavedSectionCut(id);
      assert.deepEqual(restored, camera);
      assert.equal(state().drawing2DDisplayOptions.scale, 75);
      assert.equal(activeSectionPlane(state()), null);
      assert.equal(useSavedSectionCuts.getState().cuts[0]?.publicationScale, 75);
    } finally {
      useViewerStore.setState({ cameraCallbacks: callbacks });
      setSavedViewsProject(undefined);
      localStorage.removeItem('ifc-lite:saved-drawing-views:v1:3d-view-test');
    }
  });

  it('applying a saved cut un-hides it, even if the chip hid the previous one (#5893 review)', () => {
    state().setActiveTool('section');
    state().setSectionPlaneAxis('front');
    const id = saveCurrentSectionCut('Front');
    state().setSectionVisible(false); // hide the (now different) live cut via the chip
    assert.equal(state().sceneState.section.visible, false);

    applySavedSectionCut(id);
    assert.equal(state().sceneState.section.visible, true, 'BUG: a stale hide left the restored cut invisible');
    assert.ok(activeSectionPlane(state()));
  });

  it('restores a face-picked (custom) plane bit for bit', () => {
    state().setActiveTool('section');
    state().setSectionPlaneFromFace([0, 1, 0], [0, 2, 0]);
    const custom = state().sectionPlane.custom;
    assert.ok(custom, 'the face pick made a custom plane');
    const id = saveCurrentSectionCut('Face pick');

    state().setSectionPlaneAxis('side'); // drops `custom`
    assert.equal(state().sectionPlane.custom, undefined);

    applySavedSectionCut(id);
    assert.deepEqual(state().sectionPlane.custom, custom);
  });

  it('rename updates the name only; delete drops the cut and clears activeCutId', () => {
    const id = saveCurrentSectionCut('Original name');
    renameSavedSectionCut(id, 'Renamed');
    assert.equal(useSavedSectionCuts.getState().cuts[0]?.name, 'Renamed');

    applySavedSectionCut(id);
    assert.equal(useSavedSectionCuts.getState().activeCutId, id);

    removeSavedSectionCut(id);
    assert.equal(useSavedSectionCuts.getState().cuts.length, 0);
    assert.equal(useSavedSectionCuts.getState().activeCutId, null, 'removing the active cut clears the pointer');
  });

  it('a blank rename is rejected, keeping the original name', () => {
    const id = saveCurrentSectionCut('Keep me');
    renameSavedSectionCut(id, '   ');
    assert.equal(useSavedSectionCuts.getState().cuts[0]?.name, 'Keep me');
  });

  it('applying a saved plane cut leaves section box mode, so the plane is the cut (#5513)', () => {
    state().setActiveTool('section');
    state().setSectionPlaneAxis('front');
    const id = saveCurrentSectionCut('Front');
    state().setSectionBox({ min: [0, 0, 0], max: [4, 3, 2] });
    assert.ok(state().sectionPlane.box, 'in box mode');
    applySavedSectionCut(id);
    assert.equal(state().sectionPlane.box, undefined, 'the box is gone');
    assert.equal(activeSectionPlane(state())?.axis, 'front');
  });

  it('applying an unknown id is a no-op', () => {
    const before = state().sectionPlane;
    applySavedSectionCut('does-not-exist');
    assert.deepEqual(state().sectionPlane, before);
  });
});

// #8162: a cut beyond the bounds (a plan cut above the model top) is saved and
// restored where it was, not clamped back onto the bound face.
describe('saved section cuts beyond the bounds (#8162)', () => {
  for (const position of [123.25, -15]) {
    it(`saves and restores a cut at ${position} %`, () => {
      state().setActiveTool('section');
      state().setSectionPlaneAxis('down');
      state().setSectionPlanePosition(position);
      const id = saveCurrentSectionCut(`Plan @ ${position}`);
      state().setSectionPlanePosition(10);
      applySavedSectionCut(id);
      assert.equal(state().sectionPlane.position, position);
      assert.equal(activeSectionPlane(state())?.position, position, 'and it is the cut on screen');
    });
  }
});

it('reopens a new plan at the same elevation after the workspace bounds change', () => {
  function publish(max: number) {
    publishDrawingRuntime({
      geometryResult: { coordinateInfo: { shiftedBounds: { min: { y: 0 }, max: { y: max } } } } as GeometryResult,
      sourceCoordinateInfo: undefined,
      generateDrawing: async () => {},
      isRegenerating: false,
    });
  }
  setSavedViewsProject('new-plan-height-test');
  try {
    publish(12);
    const id = createDrawingView('Terrace', 'plan', { axis: 'down', position: 50 }, 6);
    assert.equal(state().sectionPlane.position, 50);
    assert.equal(state().drawing2DDisplayOptions.showConstructionProjection, true);
    setSavedViewsProject(undefined);
    setSavedViewsProject('new-plan-height-test');
    publish(24);
    applySavedSectionCut(id);
    assert.equal(state().sectionPlane.position, 25);
    assert.equal(useSavedSectionCuts.getState().activeCutId, id);
  } finally {
    publishDrawingRuntime(null);
    setSavedViewsProject(undefined);
    localStorage.removeItem('ifc-lite:saved-drawing-views:v1:new-plan-height-test');
  }
});
