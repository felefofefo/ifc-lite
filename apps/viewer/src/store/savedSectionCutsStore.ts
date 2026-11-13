/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Named section cuts (#5514, charter #5478): a small library of saved cut
 * geometries a user can name, re-apply, rename, and delete. Listed in the
 * Drawing panel as the drawing's source; applying one becomes THE visible
 * cut (`useViewerStore`'s `sectionPlane`), so BCF viewpoint capture
 * (`useSectionViewpointCapture.ts`, reads `drawing2D.config.plane`) and the
 * floor-plan command (`useFloorplanView.ts`, reads/writes the same
 * `sectionPlane`) get it for free — neither has to know saved cuts exist.
 *
 * Lives in its OWN zustand store, not a `ViewerState` slice, for two
 * reasons:
 *
 *  1. `store/index.ts` and `slices/sectionSlice.ts` are both already at
 *     their `check-module-size` ratchet with zero headroom (#5478 house
 *     rule: never raise a budget). A same-shaped contribution to either
 *     would fail CI on line count alone; splitting `sectionSlice.ts` to buy
 *     room is a larger, riskier PR than this feature justifies.
 *  2. A saved cut is a document the user authored, like a `BasketView`
 *     preset (`pinboardSlice.ts`) — the same reasoning that keeps
 *     `basketViews` out of the `'all-models-cleared'` teardown arm applies
 *     here without qualification: this store is never torn down by a model
 *     swap. Its geometry (axis/position/custom) can go stale relative to a
 *     very different model's bounds, exactly like a `BasketView`'s
 *     `entityRefs` can — a soft UX question, not a correctness bug, and one
 *     the existing precedent already accepts.
 *
 * A saved cut is a SET (#7545): every plane that was cutting, which of them was
 * active, the zoom the user last used and the exact camera, so applying it brings
 * back the view and not only the geometry. A set of one plane is what a saved cut
 * always was, so the Drawing panel's list, rename and delete keep working.
 *
 * The only coupling to the main store is one-directional and explicit:
 * `saveCurrentSectionCut` reads the live plane set, and `applySavedSectionCut`
 * installs it through `installSectionPlanes` (fresh ids, unique names, un-hidden)
 * and opens the Section tool - so a saved cut re-enters the Section/Drawing
 * contract (`store/section-active.ts`) exactly like every other section writer.
 */

import { create } from 'zustand';
import { COMMON_SCALES, formatScaleFactorLabel, type DrawingScale, type GraphicOverrideRule } from '@ifc-lite/drawing-2d';
import type { CameraViewpoint, SectionBox, SectionCapStyle, SectionPlane, SectionPlaneAxis } from './types.js';
import { useViewerStore, type ViewerState } from './index.js';
import { getDefaultSectionPlane } from './slices/sectionSlice.js';
import { clippingSectionPlanes } from '@/store/section-active';
import { orderedSectionPlanes, sectionPlaneCount } from '@/lib/section/section-plane-set';
import { zoomToSectionTarget } from '@/lib/section/section-zoom';
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
  'useSymbolicRepresentations' | 'showIfcAnnotations'>;

export interface SavedSectionCut {
  id: string;
  name: string;
  /** Every plane that was cutting, in creation order. */
  planes: SavedSectionCutPlane[];
  /** Which of `planes` was the active one. */
  activeIndex: number;
  /** The zoom the user had chosen; applied when there is no exact camera. */
  zoom: SectionZoomSpec | null;
  /** The exact camera when the set was saved, so applying it is a restore and not a re-frame. */
  viewpoint: CameraViewpoint | null;
  publicationScale?: number;
  kind?: SavedViewKind;
  graphics?: { presetId: string | null; enabled: boolean; rules: GraphicOverrideRule[] };
  display?: ViewDisplay;
  createdAt: number;
  updatedAt: number;
}

interface SavedSectionCutsState {
  cuts: SavedSectionCut[];
  projectId?: string;
  /** The saved cut currently on screen, if the live cut still matches one
   *  exactly (cleared the moment the user edits the cut further). */
  activeCutId: string | null;
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
    && (cut.publicationScale === undefined || (Number.isFinite(cut.publicationScale) && cut.publicationScale > 0));
}

export function setSavedViewsProject(projectId: string | undefined): void {
  if (useSavedSectionCuts.getState().projectId === projectId) return;
  let cuts: SavedSectionCut[] = [];
  if (projectId) {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(savedViewsKey(projectId)) ?? '[]');
      if (Array.isArray(value)) cuts = value.filter(isSavedSectionCut);
    } catch (error) {
      console.warn('Could not load saved drawing views', error);
    }
  }
  useSavedSectionCuts.setState({ projectId, cuts, activeCutId: null });
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

/** Whether there is a cut to save: a viewer with no plane yet holds only an untouched placeholder. */
export function canSaveSectionCut(state: Pick<ReturnType<typeof useViewerStore.getState>, 'sectionPlane' | 'inactiveSectionPlanes'> = useViewerStore.getState()): boolean {
  return sectionPlaneCount(state.sectionPlane, state.inactiveSectionPlanes) > 0;
}

export function canSaveDrawingView(state: ViewerState, kind: SavedViewKind): boolean {
  return kind === '3d' ? !!state.cameraCallbacks.getViewpoint : canSaveSectionCut(state);
}

/**
 * Save the live cut as a new named set: every plane that is cutting (all of them,
 * active first when none is), with the zoom and the camera as they are now. Returns its id.
 */
export function saveCurrentSectionCut(name: string, kind?: SavedViewKind, scale?: number): string {
  const cut = captureSectionCut(name, kind, undefined, scale);
  commitCuts({ cuts: [...useSavedSectionCuts.getState().cuts, cut], activeCutId: cut.id });
  return cut.id;
}

function captureSectionCut(name: string, kind?: SavedViewKind, existing?: SavedSectionCut, scale?: number): SavedSectionCut {
  const state = useViewerStore.getState();
  // The untouched placeholder is not a cut: saving it would store a plane that cuts the model when applied.
  if (kind !== '3d' && !canSaveSectionCut(state)) throw new Error('saveCurrentSectionCut: there is no cutting plane to save');
  const viewpoint = state.cameraCallbacks.getViewpoint?.() ?? null;
  if (kind === '3d' && scale !== undefined && (!Number.isFinite(scale) || scale <= 0)) throw new Error('Invalid 3D publication scale.');
  if (kind === '3d' && !viewpoint) throw new Error('The 3D camera is not ready.');
  const all = orderedSectionPlanes(state.sectionPlane, state.inactiveSectionPlanes);
  const cutting = all.filter((p) => p.enabled);
  const visible = kind === '3d' ? new Set(clippingSectionPlanes(state)) : undefined;
  const planes = visible ? all.filter((plane) => visible.has(plane))
    : cutting.length > 0 ? cutting : [state.sectionPlane];
  const id = existing?.id ?? createCutId();
  const now = Date.now();
  const display = state.drawing2DDisplayOptions;
  return {
    id,
    name,
    kind: kind ?? (state.sectionPlane.axis === 'down' ? 'plan' : 'section'),
    planes: structuredClone(planes.map(planeSnapshot)),
    activeIndex: Math.max(0, planes.findIndex((p) => p.id === state.sectionPlane.id)),
    zoom: state.sectionZoom,
    viewpoint: structuredClone(viewpoint),
    publicationScale: kind === '3d' && scale !== undefined ? scale
      : kind !== '3d' && state.sheetEnabled && state.activeSheet ? state.activeSheet.scale.factor : display.scale,
    graphics: { presetId: state.activePresetId, enabled: state.overridesEnabled, rules: structuredClone(state.customOverrideRules) },
    display: {
      showConstructionProjection: display.showConstructionProjection, constructionProjectionDepth: display.constructionProjectionDepth,
      showHiddenLines: display.showHiddenLines, showHatching: display.showHatching,
      useSymbolicRepresentations: display.useSymbolicRepresentations, showIfcAnnotations: display.showIfcAnnotations,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function updateSavedSectionCut(id: string, scale?: number): void {
  const state = useSavedSectionCuts.getState();
  const existing = state.cuts.find((cut) => cut.id === id);
  if (!existing || state.activeCutId !== id) return;
  const cut = captureSectionCut(existing.name, savedViewKind(existing), existing, scale);
  commitCuts({ cuts: state.cuts.map((item) => item.id === id ? cut : item) });
}

export function duplicateSavedSectionCut(id: string, name: string): string | undefined {
  const { cuts } = useSavedSectionCuts.getState();
  const existing = cuts.find((cut) => cut.id === id);
  if (!existing) return undefined;
  const now = Date.now();
  const copy = { ...structuredClone(existing), id: createCutId(), name, createdAt: now, updatedAt: now };
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
export function applySavedSectionCut(id: string): void {
  const cut = useSavedSectionCuts.getState().cuts.find((c) => c.id === id);
  if (!cut) return;
  const state = useViewerStore.getState();
  const base = getDefaultSectionPlane();
  const planes: SectionPlane[] = cut.planes.map((saved) => ({
    ...base,
    ...saved,
    name: saved.name ?? '',
    enabled: true,
    parked: false,
  }));
  if (planes.length) {
    state.installSectionPlanes(planes, cut.activeIndex);
    state.setSectionVisible(true);
    if (useViewerStore.getState().activeTool !== 'section') state.setActiveTool('section');
  } else if (cut.kind === '3d') {
    state.clearSectionPlanes();
    if (state.activeTool === 'section') state.setActiveTool('select');
  }
  if (cut.graphics) {
    useViewerStore.setState({
      activePresetId: cut.graphics.presetId, overridesEnabled: cut.graphics.enabled,
      customOverrideRules: structuredClone(cut.graphics.rules),
    });
  }
  if (cut.display) state.updateDrawing2DDisplayOptions(cut.display);
  useSavedSectionCuts.setState({ activeCutId: id });
  if (cut.publicationScale) {
    const factor = cut.publicationScale;
    if (cut.kind === '3d') state.updateDrawing2DDisplayOptions({ scale: factor });
    else setDrawingPublicationScale(COMMON_SCALES.find((scale) => scale.factor === factor)
      ?? { factor, name: `1:${formatScaleFactorLabel(factor)}`, useCase: '' });
  }
  const live = useViewerStore.getState();
  if (cut.viewpoint && live.cameraCallbacks.applyViewpoint) live.cameraCallbacks.applyViewpoint(cut.viewpoint, true);
  else if (cut.zoom) void zoomToSectionTarget(live, cut.zoom);
}

export function setDrawingPublicationScale(scale: DrawingScale): void {
  const state = useViewerStore.getState();
  if (state.sheetEnabled && state.activeSheet) state.setDrawingScale(scale);
  state.updateDrawing2DDisplayOptions({ scale: scale.factor });
}

export function renameSavedSectionCut(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { cuts } = useSavedSectionCuts.getState();
  commitCuts({ cuts: cuts.map((c) => (c.id === id ? { ...c, name: trimmed, updatedAt: Date.now() } : c)) });
}

export function removeSavedSectionCut(id: string): void {
  const { cuts, activeCutId } = useSavedSectionCuts.getState();
  commitCuts({ cuts: cuts.filter((c) => c.id !== id), activeCutId: activeCutId === id ? null : activeCutId });
}
