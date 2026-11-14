/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Named drawing views and their project-scoped publication settings. */

import type { DistantElements } from '@/lib/drawing/distant-elements';
import { create } from 'zustand';
import { COMMON_SCALES, formatScaleFactorLabel, type DrawingScale, type GraphicOverrideRule } from '@ifc-lite/drawing-2d';
import type { CameraViewpoint, SectionBox, SectionCapStyle, SectionPlane, SectionPlaneAxis } from './types.js';
import { useViewerStore, type ViewerState } from './index.js';
import { getDefaultSectionPlane } from './slices/sectionSlice.js';
import { clippingSectionPlanes } from '@/store/section-active';
import { orderedSectionPlanes, sectionPlaneCount } from '@/lib/section/section-plane-set';
import { zoomToSectionTarget } from '@/lib/section/section-zoom';
import { planCutPosition, verticalViewPlane } from '@/lib/drawing/view-placement';
import { getDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import { DEFAULT_VIEW_MARKERS, isViewCodeAvailable, nextViewCode, type MarkerTrace } from '@/lib/drawing/view-markers';
import { captureViewVisibility, restoreViewVisibility, type SavedViewVisibility } from '@/lib/drawing/view-visibility';
import type { SavedFilterPreset } from '@/lib/search/saved-filters';
import type { SectionZoomSpec } from '@/lib/section/section-zoom-spec';

/** The subset of `SectionPlane` that defines the CUT itself, not its
 *  on-screen/parked lifecycle (`enabled` / `parked`), which only ever means
 *  something for the currently active tool. */
export interface SavedSectionCutPlane {
  /** The plane's chip name; absent in cuts saved before the set existed. */
  name?: string;
  axis: SectionPlaneAxis;
  position: number;
  flipped: boolean;
  custom?: SectionPlane['custom'];
  /** A box cut (#5513): the plane IS this box. */
  box?: SectionBox;
  capStyle: SectionCapStyle;
  showCap: boolean;
  showOutlines: boolean;
}

export const SAVED_VIEW_KINDS = ['plan', 'section', 'elevation', '3d'] as const;
export type SavedViewKind = typeof SAVED_VIEW_KINDS[number];
type ViewDisplay = Pick<ViewerState['drawing2DDisplayOptions'],
  'showConstructionProjection' | 'constructionProjectionDepth' | 'showHiddenLines' | 'showHatching' |
  'useSymbolicRepresentations' | 'showIfcAnnotations' | 'showSurfacePatterns3D' | 'distantElements'>;

export interface SavedSectionCut {
  id: string;
  name: string;
  code?: string;
  markerTrace?: MarkerTrace;
  markers?: typeof DEFAULT_VIEW_MARKERS;
  visibility?: SavedViewVisibility;
  filter?: { mode: 'show' | 'hide'; preset: SavedFilterPreset };
  /** Every plane that was cutting, in creation order. */
  planes: SavedSectionCutPlane[];
  /** Which of `planes` was the active one. */
  activeIndex: number;
  /** The zoom the user had chosen; applied when there is no exact camera. */
  zoom: SectionZoomSpec | null;
  /** The exact camera when the set was saved, so applying it is a restore and not a re-frame. */
  viewpoint: CameraViewpoint | null;
  publicationScale?: number;
  /** Fixed Y in the drawing's placed frame, independent of visible model bounds. */
  planElevation?: number;
  kind?: SavedViewKind;
  graphics?: { presetId: string | null; enabled: boolean; rules: GraphicOverrideRule[] };
  display?: ViewDisplay;
  createdAt: number;
  updatedAt: number;
}

interface SavedSectionCutsState {
  cuts: SavedSectionCut[];
  projectId?: string;
  /** The saved view currently selected. */
  activeCutId: string | null;
  /** Session id of the plane the selected 2D view was opened with. */
  drawingPlaneId?: string;
}

function createCutId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `section-cut-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function planeSnapshot(plane: SectionPlane): SavedSectionCutPlane {
  return {
    name: plane.name,
    axis: plane.axis,
    position: plane.position,
    flipped: plane.flipped,
    custom: plane.custom,
    box: plane.box,
    capStyle: plane.capStyle,
    showCap: plane.showCap,
    showOutlines: plane.showOutlines,
  };
}

export const useSavedSectionCuts = create<SavedSectionCutsState>()(() => ({
  cuts: [],
  activeCutId: null,
}));

const savedViewsKey = (projectId: string) => `ifc-lite:saved-drawing-views:v1:${projectId}`;

function isSavedSectionCut(value: unknown): value is SavedSectionCut {
  if (!value || typeof value !== 'object') return false;
  const cut = value as Partial<SavedSectionCut>;
  return typeof cut.id === 'string' && typeof cut.name === 'string' && Array.isArray(cut.planes)
    && typeof cut.activeIndex === 'number' && Number.isInteger(cut.activeIndex)
    && (cut.kind === '3d' && cut.planes.length === 0
      ? cut.activeIndex === 0 && !!cut.viewpoint
      : cut.activeIndex >= 0 && cut.activeIndex < cut.planes.length)
    && cut.planes.every((plane) => plane && ['down', 'front', 'side'].includes(plane.axis) && Number.isFinite(plane.position))
    && (!cut.graphics || (Array.isArray(cut.graphics.rules) && cut.graphics.rules.every((rule) =>
      rule && typeof rule.id === 'string' && rule.criteria && rule.style)))
    && (cut.code === undefined || typeof cut.code === 'string')
    && (cut.planElevation === undefined || Number.isFinite(cut.planElevation))
    && (cut.publicationScale === undefined || (Number.isFinite(cut.publicationScale) && cut.publicationScale > 0));
}

export function setSavedViewsProject(projectId: string | undefined): void {
  if (useSavedSectionCuts.getState().projectId === projectId) return;
  let cuts: SavedSectionCut[] = [];
  if (projectId) {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(savedViewsKey(projectId)) ?? '[]');
      if (Array.isArray(value)) {
        const loaded = value.filter(isSavedSectionCut).map(withSingleDrawingPlane);
        const used: SavedSectionCut[] = [];
        cuts = loaded.map(cut => {
          const code = cut.code && isViewCodeAvailable(cut.code, used)
            ? cut.code : nextViewCode(savedViewKind(cut), [...loaded, ...used]);
          const withCode = { ...cut, code };
          used.push(withCode);
          return withCode;
        });
      }
    } catch (error) {
      console.warn('Could not load saved drawing views', error);
    }
  }
  useSavedSectionCuts.setState({ projectId, cuts, activeCutId: null, drawingPlaneId: undefined });
}

function commitCuts(patch: Partial<SavedSectionCutsState>): void {
  const { projectId } = useSavedSectionCuts.getState();
  if (projectId && patch.cuts) localStorage.setItem(savedViewsKey(projectId), JSON.stringify(patch.cuts));
  useSavedSectionCuts.setState(patch);
}

export function savedViewKind(cut: Pick<SavedSectionCut, 'kind' | 'planes' | 'activeIndex'>): SavedViewKind {
  return cut.kind && SAVED_VIEW_KINDS.includes(cut.kind) ? cut.kind
    : cut.planes[cut.activeIndex]?.axis === 'down' ? 'plan' : 'section';
}

/** Older 2D views may contain auxiliary clips. Keep the plane that generated the drawing. */
function withSingleDrawingPlane(cut: SavedSectionCut): SavedSectionCut {
  if (savedViewKind(cut) === '3d' || cut.planes.length <= 1) return cut;
  return { ...cut, planes: [cut.planes[cut.activeIndex]], activeIndex: 0 };
}

function drawingPlaneToSave(state: Pick<ViewerState, 'sectionPlane' | 'inactiveSectionPlanes'>): SectionPlane {
  const { sectionPlane, inactiveSectionPlanes } = state;
  if (sectionPlane.enabled) return sectionPlane;
  return orderedSectionPlanes(sectionPlane, inactiveSectionPlanes).find(plane => plane.enabled) ?? sectionPlane;
}

/** Whether there is a cut to save: a viewer with no plane yet holds only an untouched placeholder. */
export function canSaveSectionCut(state: Pick<ReturnType<typeof useViewerStore.getState>, 'sectionPlane' | 'inactiveSectionPlanes'> = useViewerStore.getState()): boolean {
  return sectionPlaneCount(state.sectionPlane, state.inactiveSectionPlanes) > 0;
}

export function canSaveDrawingView(state: ViewerState, kind: SavedViewKind): boolean {
  return kind === '3d' ? !!state.cameraCallbacks.getViewpoint : canSaveSectionCut(state);
}

/**
 * Save the drawing plane for a 2D view or the visible clipping set for a 3D view,
 * with the current zoom and camera. Returns the view id.
 */
export function saveCurrentSectionCut(name: string, kind?: SavedViewKind, scale?: number, code?: string): string {
  const cut = captureSectionCut(name, kind, undefined, scale);
  cut.code = validateViewCode(savedViewKind(cut), code);
  commitCuts({ cuts: [...useSavedSectionCuts.getState().cuts, cut], activeCutId: cut.id,
    drawingPlaneId: savedViewKind(cut) === '3d' ? undefined : drawingPlaneToSave(useViewerStore.getState()).id });
  return cut.id;
}

export function createDrawingView(
  name: string, kind: 'plan' | 'section' | 'elevation', geometry: Pick<SectionPlane, 'axis' | 'position' | 'custom'>,
  planElevation?: number, code?: string, markerTrace?: MarkerTrace,
): string {
  const cut = captureSectionCut(name, kind, undefined, undefined,
    { ...getDefaultSectionPlane(), ...geometry, flipped: false, enabled: true });
  cut.planElevation = planElevation;
  cut.code = validateViewCode(kind, code);
  cut.markerTrace = markerTrace;
  commitCuts({ cuts: [...useSavedSectionCuts.getState().cuts, cut] });
  applySavedSectionCut(cut.id);
  return cut.id;
}

function captureSectionCut(name: string, kind?: SavedViewKind, existing?: SavedSectionCut, scale?: number, newPlane?: SectionPlane): SavedSectionCut {
  const state = useViewerStore.getState();
  // The untouched placeholder is not a cut: saving it would store a plane that cuts the model when applied.
  if (!newPlane && kind !== '3d' && !canSaveSectionCut(state)) throw new Error('saveCurrentSectionCut: there is no cutting plane to save');
  const viewpoint = state.cameraCallbacks.getViewpoint?.() ?? null;
  if (scale !== undefined && (!Number.isFinite(scale) || scale <= 0)) throw new Error('Invalid publication scale.');
  if (kind === '3d' && !viewpoint) throw new Error('The 3D camera is not ready.');
  const drawingPlane = newPlane ?? drawingPlaneToSave(state);
  const visible = kind === '3d' ? new Set(clippingSectionPlanes(state)) : undefined;
  const planes = visible
    ? orderedSectionPlanes(state.sectionPlane, state.inactiveSectionPlanes).filter(plane => visible.has(plane))
    : [drawingPlane];
  const id = existing?.id ?? createCutId();
  const now = Date.now();
  const display = state.drawing2DDisplayOptions;
  return {
    id,
    name,
    code: existing?.code,
    markers: existing?.markers,
    markerTrace: existing?.markerTrace,
    visibility: captureViewVisibility(state),
    filter: existing?.filter,
    kind: kind ?? (drawingPlane.axis === 'down' ? 'plan' : 'section'),
    planes: structuredClone(planes.map(planeSnapshot)),
    activeIndex: Math.max(0, planes.findIndex((p) => p.id === state.sectionPlane.id)),
    zoom: newPlane ? null : state.sectionZoom,
    viewpoint: newPlane ? null : structuredClone(viewpoint),
    planElevation: existing?.planElevation !== undefined && drawingPlane.axis === 'down'
      ? cutElevationForPosition(drawingPlane.position) ?? existing.planElevation : undefined,
    publicationScale: scale ?? (kind !== '3d' && state.sheetEnabled && state.activeSheet ? state.activeSheet.scale.factor : display.scale),
    graphics: { presetId: state.activePresetId, enabled: state.overridesEnabled, rules: structuredClone(state.customOverrideRules) },
    display: {
      showConstructionProjection: newPlane ? true : display.showConstructionProjection,
      constructionProjectionDepth: newPlane ? null : display.constructionProjectionDepth,
      showSurfacePatterns3D: display.showSurfacePatterns3D ?? false,
      distantElements: newPlane ? undefined : display.distantElements,
      showHiddenLines: display.showHiddenLines, showHatching: display.showHatching,
      useSymbolicRepresentations: display.useSymbolicRepresentations, showIfcAnnotations: display.showIfcAnnotations,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function cutElevationForPosition(position: number): number | undefined {
  const bounds = getDrawingRuntime().geometryResult?.coordinateInfo.shiftedBounds;
  return bounds && bounds.min.y + position * (bounds.max.y - bounds.min.y) / 100;
}

export function updateSavedSectionCut(id: string, scale?: number): void {
  const state = useSavedSectionCuts.getState();
  const existing = state.cuts.find((cut) => cut.id === id);
  if (!existing || state.activeCutId !== id) return;
  const cut = captureSectionCut(existing.name, savedViewKind(existing), existing, scale);
  commitCuts({ cuts: state.cuts.map((item) => item.id === id ? cut : item),
    drawingPlaneId: savedViewKind(cut) === '3d' ? undefined : drawingPlaneToSave(useViewerStore.getState()).id });
}

export function duplicateSavedSectionCut(id: string, name: string): string | undefined {
  const { cuts } = useSavedSectionCuts.getState();
  const existing = cuts.find((cut) => cut.id === id);
  if (!existing) return undefined;
  const now = Date.now();
  const copy = { ...structuredClone(withSingleDrawingPlane(existing)), id: createCutId(), name, code: validateViewCode(savedViewKind(existing)), createdAt: now, updatedAt: now };
  commitCuts({ cuts: [...cuts, copy] });
  return copy.id;
}

/**
 * Put a saved set ON SCREEN. It REPLACES the whole plane set (active and inactive;
 * a leftover box or plane from before must not keep cutting beside it), un-hides it
 * (`sceneState.section.visible`, #5893 - like `basketViewActivator.ts`'s section
 * branch, a stale `visible: false` left by an earlier chip-hide must not survive a
 * saved cut being applied fresh, or it renders nothing with no chip open to explain
 * why), opens the Section tool so the user can see and edit what they just applied,
 * and then restores the exact camera, or frames the saved zoom when there is none.
 */
export function applySavedSectionCut(id: string, restoreCamera = true): void {
  const savedCut = useSavedSectionCuts.getState().cuts.find((c) => c.id === id);
  if (!savedCut) return;
  const cut = withSingleDrawingPlane(savedCut);
  const state = useViewerStore.getState();
  const base = getDefaultSectionPlane();
  const planes: SectionPlane[] = cut.planes.map((saved) => ({
    ...base,
    ...saved,
    name: saved.name ?? '',
    enabled: true,
    parked: false,
  }));
  if (cut.planElevation !== undefined && planes[cut.activeIndex]?.axis === 'down') {
    const bounds = getDrawingRuntime().geometryResult?.coordinateInfo.shiftedBounds ?? null;
    const position = planCutPosition(cut.planElevation, bounds);
    if (position !== null) planes[cut.activeIndex].position = position;
  }
  if (planes.length) {
    state.installSectionPlanes(planes, cut.activeIndex);
    state.setSectionVisible(true);
    if (restoreCamera && useViewerStore.getState().activeTool !== 'section') state.setActiveTool('section');
  } else if (cut.kind === '3d') {
    state.clearSectionPlanes();
    if (state.activeTool === 'section') state.setActiveTool('select');
  }
  if (cut.visibility) useViewerStore.setState(restoreViewVisibility(state, cut.visibility));
  if (cut.graphics) {
    useViewerStore.setState({
      activePresetId: cut.graphics.presetId, overridesEnabled: true,
      customOverrideRules: structuredClone(cut.graphics.rules),
    });
  }
  if (cut.display) state.updateDrawing2DDisplayOptions({
    ...cut.display, showSurfacePatterns3D: cut.display.showSurfacePatterns3D ?? false, distantElements: cut.display.distantElements,
  });
  else state.updateDrawing2DDisplayOptions({ distantElements: undefined });
  useSavedSectionCuts.setState({ activeCutId: id,
    drawingPlaneId: savedViewKind(cut) === '3d' ? undefined : useViewerStore.getState().sectionPlane.id });
  if (cut.publicationScale) {
    const factor = cut.publicationScale;
    if (cut.kind === '3d') state.updateDrawing2DDisplayOptions({ scale: factor });
    else setDrawingPublicationScale(COMMON_SCALES.find((scale) => scale.factor === factor)
      ?? { factor, name: `1:${formatScaleFactorLabel(factor)}`, useCase: '' });
  }
  if (!restoreCamera) return;
  const live = useViewerStore.getState();
  if (cut.viewpoint && live.cameraCallbacks.applyViewpoint) live.cameraCallbacks.applyViewpoint(cut.viewpoint, true);
  else if (cut.zoom) void zoomToSectionTarget(live, cut.zoom);
}

export function setDrawingPublicationScale(scale: DrawingScale): void {
  const state = useViewerStore.getState();
  const { cuts, activeCutId } = useSavedSectionCuts.getState();
  const view = cuts.find(cut => cut.id === activeCutId);
  if (view && view.publicationScale !== scale.factor) updateViewSettings(view.id, { publicationScale: scale.factor });
  if ((!view || savedViewKind(view) !== '3d') && state.sheetEnabled && state.activeSheet) state.setDrawingScale(scale);
  state.updateDrawing2DDisplayOptions({ scale: scale.factor });
}

function validateViewCode(kind: SavedViewKind, code?: string, except?: string): string {
  const { cuts } = useSavedSectionCuts.getState();
  const value = code?.trim() || nextViewCode(kind, cuts);
  if (!isViewCodeAvailable(value, cuts, except)) throw new Error('Duplicate drawing view code.');
  return value;
}

export function renameSavedSectionCut(id: string, name: string, code?: string): void {
  const trimmed = name.trim();
  const { cuts } = useSavedSectionCuts.getState();
  const cut = cuts.find(c => c.id === id);
  if (!trimmed || !cut) return;
  updateViewSettings(id, { name: trimmed, code: validateViewCode(savedViewKind(cut), code ?? cut.code, id) });
}

export function updateViewSettings(id: string, settings: Partial<Pick<SavedSectionCut, 'name' | 'code' | 'markers' | 'visibility' | 'filter' | 'display' | 'graphics' | 'publicationScale'>>): void {
  const { cuts } = useSavedSectionCuts.getState();
  commitCuts({ cuts: cuts.map(cut => cut.id === id ? { ...cut, ...settings, updatedAt: Date.now() } : cut) });
}

export function editSavedViewTrace(id: string, trace: MarkerTrace, reverse: boolean, distantElements?: DistantElements | null): void {
  const { cuts } = useSavedSectionCuts.getState();
  const cut = cuts.find(view => view.id === id);
  const plane = cut?.planes[cut.activeIndex];
  const custom = verticalViewPlane(trace[0], trace[1], false, reverse);
  if (!cut || !plane || !custom || plane.axis === 'down' || plane.box) return;
  const planes = [...cut.planes];
  planes[cut.activeIndex] = { ...plane, axis: 'front', flipped: false, custom };
  const display = distantElements === undefined ? cut.display : {
    ...(cut.display ?? useViewerStore.getState().drawing2DDisplayOptions),
    distantElements: distantElements ?? undefined,
  };
  const edited = { ...cut, planes, markerTrace: trace, display, viewpoint: null, zoom: null, updatedAt: Date.now() };
  commitCuts({ cuts: cuts.map(view => view.id === id ? edited : view) });
}

export function removeSavedSectionCut(id: string): void {
  const { cuts, activeCutId } = useSavedSectionCuts.getState();
  commitCuts({ cuts: cuts.filter((c) => c.id !== id), activeCutId: activeCutId === id ? null : activeCutId,
    ...(activeCutId === id ? { drawingPlaneId: undefined } : {}) });
}

export function selectActiveSavedView(state: SavedSectionCutsState): SavedSectionCut | undefined {
  return state.cuts.find(view => view.id === state.activeCutId);
}

export function selectSaved3DActive(state: SavedSectionCutsState): boolean {
  return selectActiveSavedView(state)?.kind === '3d';
}

export function setViewSectionCap(showCap: boolean): void {
  const saved = useSavedSectionCuts.getState();
  const view = selectActiveSavedView(saved);
  const state = useViewerStore.getState();
  if (view?.kind !== '3d') {
    state.setSectionShowCap(showCap);
    return;
  }
  commitCuts({ cuts: saved.cuts.map(cut => cut.id === view.id
    ? { ...cut, updatedAt: Date.now(), planes: cut.planes.map(plane => ({ ...plane, showCap })) } : cut) });
  useViewerStore.setState({
    sectionPlane: { ...state.sectionPlane, showCap },
    inactiveSectionPlanes: state.inactiveSectionPlanes.map(plane => ({ ...plane, showCap })),
  });
}

export function setViewSurfacePatterns(showSurfacePatterns3D: boolean): void {
  const { activeCutId, cuts } = useSavedSectionCuts.getState();
  const cut = cuts.find(view => view.id === activeCutId);
  const state = useViewerStore.getState();
  if (cut) updateViewSettings(cut.id, { display: { ...(cut.display ?? state.drawing2DDisplayOptions), showSurfacePatterns3D } });
  state.updateDrawing2DDisplayOptions({ showSurfacePatterns3D });
}

export function setDrawingViewTemplate(id: string | null): void {
  const state = useViewerStore.getState();
  const { activeCutId, cuts } = useSavedSectionCuts.getState();
  const active = cuts.find(cut => cut.id === activeCutId);
  if (active) updateViewSettings(active.id, { graphics: {
    ...active.graphics, presetId: id ?? 'preset-3d-colors', enabled: true,
    rules: active.graphics?.rules ?? structuredClone(state.customOverrideRules),
  } });
  useViewerStore.setState({ activePresetId: id ?? 'preset-3d-colors', overridesEnabled: true });
}

export function setDrawingProjectionDisplay(patch: Partial<Pick<ViewDisplay, 'showHiddenLines' | 'distantElements'>>): void {
  const state = useViewerStore.getState();
  const { activeCutId, cuts } = useSavedSectionCuts.getState();
  const active = cuts.find(view => view.id === activeCutId);
  if (active) updateViewSettings(active.id, { display: { ...state.drawing2DDisplayOptions, ...active.display, ...patch } });
  state.updateDrawing2DDisplayOptions(patch);
}
