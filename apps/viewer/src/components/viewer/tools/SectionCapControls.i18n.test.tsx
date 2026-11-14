/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import '@/test/section-tool-ready.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { cleanup, click, render } from '@/test/render.js';
import { registerLocale, setLocale, type Catalogue } from '@/i18n';
import { useViewerStore } from '@/store';
import { applySavedSectionCut, saveCurrentSectionCut, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import { getDefaultSectionPlane } from '@/store/slices/sectionSlice.js';
import { ViewportHud } from '../../viewport-ui/hud/ViewportHud.js';
import { ToolOverlays } from '../ToolOverlays.js';
import { SceneOverlayRoot } from '@/components/viewport-ui/scene';

const CAP_LOCALE: Catalogue = {
  'sectionTool.cap.label': 'Surface locale',
  'sectionCap.display': 'Affichage',
  'sectionCap.surfaces': 'Faces',
  'sectionCap.lines': 'Traits',
  'sectionCap.hideSurfaces': 'Masquer toutes les faces',
  'sectionCap.showSurfaces': 'Afficher toutes les faces',
  'sectionCap.hideLines': 'Masquer tous les traits',
  'sectionCap.showLines': 'Afficher tous les traits',
};

/** Mount the Section tool through its production host and open the bar's Cap popover (#5499). */
function mountedCap(capLabel = 'Cap'): HTMLElement {
  render(<><ViewportHud /><SceneOverlayRoot><ToolOverlays /></SceneOverlayRoot></>);
  const bar = document.querySelector<HTMLElement>('[data-tool-bar="section"]');
  assert.ok(bar, 'the Section bar is mounted');
  const trigger = [...bar.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === capLabel);
  assert.ok(trigger, `Cap trigger "${capLabel}"`);
  click(trigger);
  const cap = document.querySelector<HTMLElement>('[data-section-cap-controls]');
  assert.ok(cap, 'the Cap popover opened');
  return cap;
}

function toggle(ui: HTMLElement, text: string): HTMLButtonElement {
  const found = [...ui.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === text);
  assert.ok(found, `toggle ${text}`);
  return found;
}

beforeEach(() => {
  window.localStorage.clear();
  useSavedSectionCuts.setState({ cuts: [], activeCutId: null, drawingPlaneId: undefined });
  setLocale('en');
  useViewerStore.setState({
    activeTool: 'section', sectionPlane: getDefaultSectionPlane(), inactiveSectionPlanes: [], sectionUndo: null,
    sectionPickMode: false, sectionPickPreview: null,
  });
  // The bar's Cap control belongs to a plane, so the tool opens on a Down cut at 50 % (opening restores nothing, #7545).
  useViewerStore.getState().updateDrawing2DDisplayOptions({ show3DOverlay: true });
  useViewerStore.getState().addSectionPlane('down');
});

afterEach(() => {
  cleanup();
  setLocale('en');
  window.localStorage.clear();
});

describe('mounted Section cap localization (#4785)', () => {
  it('shows independent display toggles for the drawing cap', () => {
    const ui = mountedCap();
    assert.match(ui.textContent ?? '', /Display/);
    assert.equal(ui.querySelector('select'), null);
    const surfaces = toggle(ui, 'Surfaces');
    const lines = toggle(ui, 'Lines');
    assert.equal(surfaces.title, 'Hide surfaces');
    assert.equal(lines.title, 'Hide lines');
    assert.equal(surfaces.getAttribute('aria-pressed'), 'true');
    click(surfaces);
    assert.equal(toggle(ui, 'Surfaces').title, 'Show surfaces');
    assert.equal(toggle(ui, 'Surfaces').getAttribute('aria-pressed'), 'false');
    assert.equal(useViewerStore.getState().sectionPlane.showOutlines, true);
    click(lines);
    assert.equal(toggle(ui, 'Lines').title, 'Show lines');
    assert.equal(useViewerStore.getState().sectionPlane.showCap, false);
  });

  it('renders the translated display toggles and tooltips through the production host', () => {
    registerLocale('cap-test', CAP_LOCALE);
    setLocale('cap-test');
    const ui = mountedCap('Surface locale');
    assert.match(ui.textContent ?? '', /Affichage/);
    assert.equal(toggle(ui, 'Faces').title, 'Masquer toutes les faces');
    assert.equal(toggle(ui, 'Traits').title, 'Masquer tous les traits');
    click(toggle(ui, 'Faces'));
    assert.equal(toggle(ui, 'Faces').title, 'Afficher toutes les faces');
  });

  it('offers no cap settings while the 3D overlay is off', () => {
    useViewerStore.getState().updateDrawing2DDisplayOptions({ show3DOverlay: false });
    const ui = mountedCap();
    assert.match(ui.textContent ?? '', /Enable 3D overlay/);
    assert.equal(ui.querySelector('select, input, button'), null);
  });

  it('toggles and restores the saved 3D cap with the Drawing overlay off', () => {
    const state = useViewerStore.getState();
    state.updateDrawing2DDisplayOptions({ show3DOverlay: false });
    useViewerStore.setState({ cameraCallbacks: { ...state.cameraCallbacks, getViewpoint: () => ({
      position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 },
      fov: 45, projectionMode: 'orthographic', orthoSize: 4,
    }) } });
    const id = saveCurrentSectionCut('Axon', '3d');
    const ui = mountedCap();
    click(toggle(ui, 'Surfaces'));
    assert.equal(useViewerStore.getState().sectionPlane.showCap, false);
    assert.equal(useViewerStore.getState().sectionPlane.showOutlines, true);
    act(() => applySavedSectionCut(id, false));
    assert.equal(useViewerStore.getState().sectionPlane.showCap, false);
    assert.equal(useViewerStore.getState().drawing2DDisplayOptions.show3DOverlay, false);
  });

  it('keeps the saved drawing name on its plane when another clip is selected', () => {
    const state = useViewerStore.getState();
    const drawingPlaneId = state.sectionPlane.id;
    const other = state.addSectionPlane('front')!;
    useViewerStore.getState().activateSectionPlane(drawingPlaneId);
    saveCurrentSectionCut('Ground floor', 'plan', undefined, 'P-01');
    act(() => useViewerStore.getState().activateSectionPlane(other));
    mountedCap();
    const tabs = [...document.querySelectorAll('[role="tab"][data-plane-id]')];
    assert.ok(tabs.some(tab => tab.getAttribute('data-plane-id') === drawingPlaneId
      && tab.textContent === 'P-01 · Ground floor'));
    assert.ok(tabs.some(tab => tab.getAttribute('data-plane-id') === other
      && tab.textContent?.startsWith('3D clip ') && tab.getAttribute('aria-selected') === 'true'));
  });

  it('falls back per missing cap key and updates an active catalogue in place', () => {
    registerLocale('partial-cap', { 'sectionCap.display': 'Localized display', 'sectionCap.hideSurfaces': 'Localized hide' });
    setLocale('partial-cap');
    const ui = mountedCap();
    assert.match(ui.textContent ?? '', /Localized display/);
    assert.equal(toggle(ui, 'Surfaces').title, 'Localized hide');
    assert.equal(toggle(ui, 'Lines').title, 'Hide lines');
    act(() => registerLocale('partial-cap', { 'sectionCap.display': 'Replacement display', 'sectionCap.hideSurfaces': 'Replacement hide' }));
    assert.match(ui.textContent ?? '', /Replacement display/);
    assert.equal(toggle(ui, 'Surfaces').title, 'Replacement hide');
  });

});
