/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Named drawing views and their project-scoped publication settings. */

import { moveProjectGrid, readProjectGrids, validGridViewExtents, type GridViewExtents, type ProjectGrid } from '@/lib/drawing/project-grids';
import type { DistantElements } from '@/lib/drawing/distant-elements';
import { create } from 'zustand';
import { COMMON_SCALES, formatScaleFactorLabel, type DrawingScale, type GraphicOverrideRule, type Point2D, type SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { CameraViewpoint, SectionBox, SectionCapStyle, SectionPlane, SectionPlaneAxis } from './types.js';
import { useViewerStore, type ViewerState } from './index.js';
import { getDefaultSectionPlane } from './slices/sectionSlice.js';
import { clippingSectionPlanes } from '@/store/section-active';
import { orderedSectionPlanes, sectionPlaneCount } from '@/lib/section/section-plane-set';
import { zoomToSectionTarget } from '@/lib/section/section-zoom';
import { drawnSectionPlane } from '@/lib/drawing/drawn-section-plane';
import { savedDimensionViewKey, temporaryDimensionViewKey, transferViewMarkup } from '@/lib/drawing/dimension-view';
import { planCutPosition, verticalViewPlane } from '@/lib/drawing/view-placement';
import { getDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import { DEFAULT_VIEW_MARKERS, isViewCodeAvailable, nextViewCode, type MarkerTrace } from '@/lib/drawing/view-markers';
import { captureViewVisibility, restoreViewVisibility, type SavedViewVisibility } from '@/lib/drawing/view-visibility';
import { readDrawingViewTemplates, templateProjectionDisplay, VIEW_TEMPLATE_GROUPS, viewTemplateGroups, type TemplateRow, type ViewTemplate } from '@/lib/drawing/view-templates';
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
  'showConstructionProjection' | 'showOverheadProjection' | 'constructionProjectionDepth' | 'showHiddenLines' | 'showHatching' |
  'useSymbolicRepresentations' | 'showIfcAnnotations' | 'showSurfacePatterns3D' | 'distantElements'>
  & Partial<Pick<ViewerState['drawing2DDisplayOptions'], 'showAnnotations' | 'show3DOverlay'>>;

import { defaultMarkerStyleId, EMPTY_TAG_LIBRARY, readTagLibrary, type TagLibrary } from '@/lib/drawing/drawing-tag-library';
import type { AnnotationStyleKind, AnnotationStyleSelection, AnnotationSymbolStyle } from '@/lib/drawing/annotation-types';
import type { DrawingElementTag } from '@/lib/drawing/drawing-element-tags';

export interface SavedViewFolder {
  id: string;
  kind: SavedViewKind;
  name: string;
  prefix: string;
}

export interface DrawingAnnotationOptions {
  visibility: Record<string, boolean>;
  styles?: Partial<Record<AnnotationStyleKind | 'ifc', AnnotationSymbolStyle>>;
  styleIds?: Partial<Record<AnnotationStyleSelection, string>>;
}

export function drawingAnnotationVisible(view: Pick<SavedSectionCut, 'annotationOptions' | 'markers'> | undefined, group: string, style?: string): boolean {
  const visibility = view?.annotationOptions?.visibility;
  const markerFlag = group === 'section' || group === 'elevation' ? view?.markers?.[group] : undefined;
  return (visibility?.[group] ?? markerFlag) !== false && (!style || visibility?.[`${group}:${style}`] !== false);
}

export interface SavedSectionCut {
  annotationOptions?: DrawingAnnotationOptions;
  folderId?: string;
  elementTags?: DrawingElementTag[];
  /** Per-view graphic extents of global grids in sections and elevations. */
  gridExtents?: Record<string, GridViewExtents>;
  markerSymbolId?: string;
  markerStyleId?: string;
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
  graphics?: { presetId: string | null; enabled: boolean; rules: GraphicOverrideRule[]; rows?: TemplateRow[]; templateRevision?: string };
  display?: ViewDisplay;
  createdAt: number;
  updatedAt: number;
}

interface SavedSectionCutsState {
  temporaryOptions: Record<string, { graphicsRows?: TemplateRow[]; annotationOptions?: DrawingAnnotationOptions }>;
  tagLibrary: TagLibrary;
  cuts: SavedSectionCut[];
  folders: SavedViewFolder[];
  grids: ProjectGrid[];
  projectId?: string;
  /** The saved view currently selected. */
  activeCutId: string | null;
  /** Session id of the plane the selected 2D view was opened with. */
  drawingPlaneId?: string;
  templateEdit?: {
    draft: SavedSectionCut;
    display: ViewerState['drawing2DDisplayOptions'];
    visibility: SavedViewVisibility;
    rules: GraphicOverrideRule[];
    presetId: ViewerState['activePresetId'];
    enabled: boolean;
    sheetScale?: DrawingScale;
  };
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
  folders: [],
  grids: [],
  temporaryOptions: {},
  tagLibrary: EMPTY_TAG_LIBRARY,
  activeCutId: null,
}));

const savedViewsKey = (projectId: string) => `ifc-lite:saved-drawing-views:v1:${projectId}`;

const tagLibraryKey = (projectId: string) => `ifc-lite:drawing-tag-library:v1:${projectId}`;

export function saveDrawingTagLibrary(projectId: string, library: TagLibrary): void {
  if (useSavedSectionCuts.getState().projectId !== projectId) throw new Error('Drawing project changed');
  localStorage.setItem(tagLibraryKey(projectId), JSON.stringify(library));
  useSavedSectionCuts.setState({ tagLibrary: library });
}

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
  cancelDrawingTemplateEdit();
  let cuts: SavedSectionCut[] = [];
  let folders: SavedViewFolder[] = [];
  let grids: ProjectGrid[] = [];
  if (projectId) {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(savedViewsKey(projectId)) ?? '[]');
      const stored = value && typeof value === 'object' && 'cuts' in value ? value : undefined;
      if (stored && 'folders' in stored && Array.isArray(stored.folders)) {
        folders = stored.folders.filter((folder): folder is SavedViewFolder => !!folder
          && typeof folder.id === 'string' && SAVED_VIEW_KINDS.includes(folder.kind)
          && typeof folder.name === 'string' && typeof folder.prefix === 'string');
      }
      if (stored && 'grids' in stored) grids = readProjectGrids(stored.grids);
      const entries = stored ? stored.cuts : value;
      if (Array.isArray(entries)) {
        const loaded = entries.filter(isSavedSectionCut).map(withSingleDrawingPlane).map(cut =>
          folders.some(folder => folder.id === cut.folderId && folder.kind === savedViewKind(cut))
            ? cut : { ...cut, folderId: undefined });
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
  let tagLibrary = EMPTY_TAG_LIBRARY;
  if (projectId) {
    try {
      tagLibrary = readTagLibrary(JSON.parse(localStorage.getItem(tagLibraryKey(projectId)) ?? 'null'));
    } catch (error) {
      console.warn('Could not load drawing tag library', error);
    }
  }
  useSavedSectionCuts.setState({ projectId, cuts, folders, grids, tagLibrary, activeCutId: null, drawingPlaneId: undefined, temporaryOptions: {} });
}

function commitCuts(patch: Partial<SavedSectionCutsState>): void {
  const state = useSavedSectionCuts.getState();
  if (patch.cuts || patch.folders || patch.grids) {
    const folders = patch.folders ?? state.folders;
    const cuts = numberFolderViews(patch.cuts ?? state.cuts, folders);
    if (state.projectId) localStorage.setItem(savedViewsKey(state.projectId), JSON.stringify({ cuts, folders, grids: patch.grids ?? state.grids }));
    patch = { ...patch, cuts };
  }
  useSavedSectionCuts.setState(patch);
}

export function saveProjectGrid(grid: ProjectGrid, remove = false): void {
  const state = useSavedSectionCuts.getState();
  if (!state.projectId) throw new Error('No drawing project');
  if (!remove && readProjectGrids([grid]).length !== 1) throw new Error('Invalid grid');
  if (!remove && !grid.name.trim()) throw new Error('Grid name is required');
  if (!remove && state.grids.some(item => item.id !== grid.id && item.name.trim().toLocaleLowerCase() === grid.name.trim().toLocaleLowerCase()))
    throw new Error('Grid name is already in use');
  const grids = remove ? state.grids.filter(item => item.id !== grid.id)
    : [...state.grids.filter(item => item.id !== grid.id), { ...grid, name: grid.name.trim() }];
  if (!remove) { commitCuts({ grids }); return; }
  commitCuts({ grids, cuts: state.cuts.map(view => {
    if (!view.gridExtents?.[grid.id]) return view;
    const gridExtents = { ...view.gridExtents };
    delete gridExtents[grid.id];
    return { ...view, gridExtents, updatedAt: Date.now() };
  }) });
}

/** Changing graphic extents never moves the shared model grid. */
export function saveGridViewExtents(viewId: string, gridId: string, extents: GridViewExtents): void {
  const state = useSavedSectionCuts.getState();
  if (!state.projectId || state.activeCutId !== viewId || !state.grids.some(grid => grid.id === gridId)
    || !validGridViewExtents(extents)) throw new Error('Invalid grid view extents');
  const view = state.cuts.find(item => item.id === viewId);
  if (!view || savedViewKind(view) === 'plan' || savedViewKind(view) === '3d') throw new Error('Not a vertical view');
  updateViewSettings(viewId, { gridExtents: { ...view.gridExtents, [gridId]: extents } });
}

export function promoteProjectGrid(grid: ProjectGrid, viewId: string): void {
  const state = useSavedSectionCuts.getState();
  if (state.grids.some(item => item.id === grid.id)) return;
  commitCuts({ grids: [...state.grids, grid], cuts: state.cuts.map(view => view.id === viewId
    ? { ...view, elementTags: view.elementTags?.filter(tag => tag.id !== grid.id) } : view) });
}

function numberFolderViews(cuts: SavedSectionCut[], folders: SavedViewFolder[]): SavedSectionCut[] {
  const numbered = new Map(folders.filter(folder => folder.prefix).map(folder => [folder.id, folder]));
  const reserved = cuts.filter(cut => !cut.folderId || !numbered.has(cut.folderId));
  const counters = new Map<string, number>();
  return cuts.map(cut => {
    const folder = cut.folderId && numbered.get(cut.folderId);
    if (!folder) return cut;
    let index = counters.get(folder.id) ?? 0;
    let code: string;
    do {
      index += 1;
      code = [folder.prefix, String(index).padStart(2, '0')].join('-');
    } while (!isViewCodeAvailable(code, reserved));
    counters.set(folder.id, index);
    const updated = cut.code === code ? cut : { ...cut, code };
    reserved.push(updated);
    return updated;
  });
}

export function saveViewFolder(kind: SavedViewKind, name: string, prefix: string, id?: string): void {
  const { folders } = useSavedSectionCuts.getState();
  const cleanPrefix = prefix.trim().toUpperCase();
  if (!name.trim() || (cleanPrefix && !/^[A-Z0-9][A-Z0-9._-]{0,23}$/.test(cleanPrefix))) throw new Error('Invalid view folder');
  if (cleanPrefix && folders.some(folder => folder.id !== id && folder.prefix === cleanPrefix)) throw new Error('Duplicate view folder prefix');
  const folder = { id: id ?? createCutId(), kind, name: name.trim(), prefix: cleanPrefix };
  commitCuts({ folders: id ? folders.map(item => item.id === id ? folder : item) : [...folders, folder] });
}

export function removeViewFolder(id: string): void {
  const { folders, cuts } = useSavedSectionCuts.getState();
  commitCuts({ folders: folders.filter(folder => folder.id !== id),
    cuts: cuts.map(cut => cut.folderId === id ? { ...cut, folderId: undefined } : cut) });
}

export function moveSavedView(id: string, kind: SavedViewKind, folderId?: string, beforeId?: string): void {
  const { cuts, folders } = useSavedSectionCuts.getState();
  const view = cuts.find(cut => cut.id === id);
  const target = beforeId && cuts.find(cut => cut.id === beforeId);
  if (!view || id === beforeId || savedViewKind(view) !== kind
    || (folderId && !folders.some(folder => folder.id === folderId && folder.kind === kind))
    || (beforeId && (!target || savedViewKind(target) !== kind || target.folderId !== folderId))) return;
  const rest = cuts.filter(cut => cut.id !== id);
  const index = beforeId ? rest.findIndex(cut => cut.id === beforeId) : rest.length;
  const code = view.folderId !== folderId && folders.some(folder => folder.id === view.folderId && folder.prefix)
    && !folders.some(folder => folder.id === folderId && folder.prefix)
    ? nextViewCode(kind, cuts) : view.code;
  rest.splice(index, 0, { ...view, folderId, code });
  commitCuts({ cuts: rest });
}

type ViewPlane = Pick<SavedSectionCutPlane, 'axis' | 'custom'>;

function isPlanPlane(plane: ViewPlane): boolean {
  return plane.custom
    ? Math.hypot(plane.custom.normal[0], plane.custom.normal[2]) < 1e-8
    : plane.axis === 'down';
}

function isVerticalPlane(plane: ViewPlane): boolean {
  return plane.custom ? Math.abs(plane.custom.normal[1]) < 1e-8 : plane.axis !== 'down';
}

export function savedViewKind(cut: Pick<SavedSectionCut, 'kind' | 'planes' | 'activeIndex'>): SavedViewKind {
  if (cut.kind === '3d') return '3d';
  const plane = cut.planes[cut.activeIndex];
  if (plane && isPlanPlane(plane)) return 'plan';
  if (plane && cut.kind === 'elevation' && isVerticalPlane(plane)) return 'elevation';
  return 'section';
}

/** Older 2D views may contain auxiliary clips. Keep the plane that generated the drawing. */
function withSingleDrawingPlane(cut: SavedSectionCut): SavedSectionCut {
  const kind = savedViewKind(cut);
  if (kind === '3d') return cut;
  if (cut.planes.length <= 1) return cut.kind === kind ? cut : { ...cut, kind };
  return { ...cut, kind, planes: [cut.planes[cut.activeIndex]], activeIndex: 0 };
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

export function currentDrawingViewKind(state: ViewerState): Exclude<SavedViewKind, '3d'> | undefined {
  if (!canSaveSectionCut(state)) return undefined;
  const plane = drawingPlaneToSave(state);
  const onScreen = state.drawing2DStatus === 'ready' ? state.drawing2DPlane : null;
  if (onScreen && (onScreen.id !== plane.id || isPlanPlane(onScreen) !== isPlanPlane(plane))) {
    return undefined;
  }
  if (isPlanPlane(plane)) return 'plan';
  const { cuts, activeCutId, drawingPlaneId } = useSavedSectionCuts.getState();
  const active = cuts.find(cut => cut.id === activeCutId);
  return active && plane.id === drawingPlaneId && savedViewKind(active) === 'elevation' && isVerticalPlane(plane)
    ? 'elevation' : 'section';
}

export function canSaveDrawingView(state: ViewerState, kind: SavedViewKind): boolean {
  return kind === '3d' ? !!state.cameraCallbacks.getViewpoint : currentDrawingViewKind(state) === kind;
}

/**
 * Save the drawing plane for a 2D view or the visible clipping set for a 3D view,
 * with the current zoom and camera. Returns the view id.
 */
export function saveCurrentSectionCut(name: string, kind?: SavedViewKind, scale?: number, code?: string): string {
  cancelDrawingTemplateEdit();
  const cut = captureSectionCut(name, kind, undefined, scale);
  cut.code = validateViewCode(savedViewKind(cut), code);
  const previous = useSavedSectionCuts.getState();
  const state = useViewerStore.getState();
  const plane = savedViewKind(cut) === '3d' ? undefined : drawingPlaneToSave(state);
  commitCuts({ cuts: [...previous.cuts, cut], activeCutId: cut.id, drawingPlaneId: plane?.id });
  useViewerStore.setState({
    activePresetId: null,
    ...(plane && plane.id !== previous.drawingPlaneId ? {
      ...transferViewMarkup(state, temporaryDimensionViewKey(plane), savedDimensionViewKey(cut.id)),
    } : {}),
  });
  return cut.id;
}

export function createDrawingView(
  name: string, kind: 'plan' | 'section' | 'elevation', geometry: Pick<SectionPlane, 'axis' | 'position' | 'custom'>,
  planElevation?: number, code?: string, markerTrace?: MarkerTrace, scale?: number,
): string {
  const cut = captureSectionCut(name, kind, undefined, scale,
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
  const temporary = !existing && !newPlane
    ? useSavedSectionCuts.getState().temporaryOptions[temporaryDimensionViewKey(drawingPlane)] : undefined;
  const drawingKind = newPlane
    ? isPlanPlane(drawingPlane) ? 'plan' : kind === 'elevation' && isVerticalPlane(drawingPlane) ? 'elevation' : 'section'
    : currentDrawingViewKind(state);
  if (kind !== '3d' && (!drawingKind || (kind !== undefined && kind !== drawingKind))) {
    throw new Error('The selected view type does not match the drawing.');
  }
  const requestedKind = kind ?? drawingKind;
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
    folderId: existing?.folderId,
    annotationOptions: existing?.annotationOptions ?? temporary?.annotationOptions,
    markers: existing?.markers,
    elementTags: existing?.elementTags,
    markerSymbolId: existing?.markerSymbolId,
    markerStyleId: existing ? existing.markerStyleId
      : defaultMarkerStyleId(useSavedSectionCuts.getState().tagLibrary, requestedKind),
    markerTrace: existing?.markerTrace,
    visibility: captureViewVisibility(state),
    filter: existing?.filter,
    kind: requestedKind,
    planes: structuredClone(planes.map(planeSnapshot)),
    activeIndex: Math.max(0, planes.findIndex((p) => p.id === state.sectionPlane.id)),
    zoom: newPlane ? null : state.sectionZoom,
    viewpoint: newPlane ? null : structuredClone(viewpoint),
    planElevation: existing?.planElevation !== undefined && drawingPlane.axis === 'down'
      ? cutElevationForPosition(drawingPlane.position) ?? existing.planElevation : undefined,
    publicationScale: scale ?? (kind !== '3d' && state.sheetEnabled && state.activeSheet ? state.activeSheet.scale.factor : display.scale),
    graphics: { presetId: existing?.graphics?.presetId ?? null, enabled: state.overridesEnabled,
      rules: newPlane ? [] : structuredClone(state.customOverrideRules), rows: newPlane ? [] : (existing?.graphics?.rows ?? temporary?.graphicsRows),
      templateRevision: existing?.graphics?.templateRevision },
    display: {
      showConstructionProjection: newPlane ? true : display.showConstructionProjection,
      showOverheadProjection: newPlane ? undefined : display.showOverheadProjection,
      constructionProjectionDepth: newPlane ? null : display.constructionProjectionDepth,
      showSurfacePatterns3D: display.showSurfacePatterns3D ?? false,
      show3DOverlay: display.show3DOverlay,
      distantElements: newPlane ? undefined : display.distantElements,
      showHiddenLines: display.showHiddenLines, showHatching: display.showHatching,
      useSymbolicRepresentations: display.useSymbolicRepresentations, showIfcAnnotations: display.showIfcAnnotations,
      showAnnotations: display.showAnnotations,
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
  if (!existing || state.activeCutId !== id || state.templateEdit) return;
  const cut = captureSectionCut(existing.name, savedViewKind(existing), existing, scale);
  commitCuts({ cuts: state.cuts.map((item) => item.id === id ? cut : item),
    drawingPlaneId: savedViewKind(cut) === '3d' ? undefined : drawingPlaneToSave(useViewerStore.getState()).id });
}

export function duplicateSavedSectionCut(id: string, name: string, withAnnotations = false): string | undefined {
  const { cuts } = useSavedSectionCuts.getState();
  const existing = cuts.find((cut) => cut.id === id);
  if (!existing) return undefined;
  const now = Date.now();
  const copy = { ...structuredClone(withSingleDrawingPlane(existing)), id: createCutId(), name, code: validateViewCode(savedViewKind(existing)), createdAt: now, updatedAt: now };
  if (withAnnotations) {
    copy.elementTags = copy.elementTags?.map(tag => ({ ...tag, id: createCutId() }));
  } else {
    copy.elementTags = undefined;
  }
  const markup = withAnnotations
    ? transferViewMarkup(useViewerStore.getState(), savedDimensionViewKey(id), savedDimensionViewKey(copy.id), true)
    : undefined;
  commitCuts({ cuts: [...cuts, copy] });
  if (markup) useViewerStore.setState(markup);
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
  cancelDrawingTemplateEdit();
  const savedCut = useSavedSectionCuts.getState().cuts.find((c) => c.id === id);
  if (!savedCut) return;
  const cut = { ...withSingleDrawingPlane(savedCut) };
  // Apply the reusable groups on every activation. The saved view still owns
  // its plane, identity, annotations, and any settings outside those groups.
  try {
    const template = cut.graphics?.presetId && readDrawingViewTemplates().find(candidate => candidate.id === cut.graphics?.presetId);
    if (template && cut.graphics && cut.graphics.templateRevision !== (template.revision ?? template.id)) {
      const patch = drawingTemplatePatch(cut, template);
      const graphics = { ...(patch.graphics ?? cut.graphics), templateRevision: template.revision ?? template.id };
      if (template.groups === undefined && cut.graphics.rows === undefined) {
        graphics.rules = mergedDrawingRules(cut.graphics.rules, template.rules);
      }
      updateViewSettings(id, { ...patch, graphics });
      Object.assign(cut, patch, { graphics });
    }
  } catch (error) {
    console.warn('Could not restore drawing view template', error);
  }
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
  useViewerStore.setState({
    activePresetId: cut.graphics?.presetId ?? null,
    overridesEnabled: true,
    customOverrideRules: structuredClone(cut.graphics?.rules ?? []),
  });
  if (cut.display) state.updateDrawing2DDisplayOptions({
    ...cut.display, showAnnotations: true, showOverheadProjection: cut.display.showOverheadProjection, showSurfacePatterns3D: cut.display.showSurfacePatterns3D ?? false, distantElements: cut.display.distantElements,
  });
  else state.updateDrawing2DDisplayOptions({ distantElements: undefined, showOverheadProjection: undefined, showAnnotations: true });
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
  const view = selectActiveSavedView(useSavedSectionCuts.getState());
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
  const { cuts, folders } = useSavedSectionCuts.getState();
  const cut = cuts.find(c => c.id === id);
  if (!trimmed || !cut) return;
  const numbered = folders.some(folder => folder.id === cut.folderId && folder.prefix);
  updateViewSettings(id, { name: trimmed, code: numbered ? cut.code : validateViewCode(savedViewKind(cut), code ?? cut.code, id) });
}

export function updateViewSettings(id: string, settings: Partial<Pick<SavedSectionCut, 'name' | 'code' | 'markers' | 'visibility' | 'filter' | 'display' | 'graphics' | 'publicationScale' | 'elementTags' | 'gridExtents' | 'markerSymbolId' | 'markerStyleId' | 'annotationOptions'>>): void {
  const { cuts, templateEdit } = useSavedSectionCuts.getState();
  if (templateEdit?.draft.id === id) {
    const { visibility, filter, display, graphics, publicationScale, annotationOptions, ...local } = settings;
    const draft = { ...templateEdit.draft };
    if ('visibility' in settings) draft.visibility = visibility;
    if ('filter' in settings) draft.filter = filter;
    if ('display' in settings) draft.display = display;
    if ('graphics' in settings) draft.graphics = graphics;
    if ('annotationOptions' in settings) draft.annotationOptions = annotationOptions;
    if ('publicationScale' in settings) draft.publicationScale = publicationScale;
    if (Object.keys(local).length) commitCuts({ cuts: cuts.map(cut => cut.id === id ? { ...cut, ...local, updatedAt: Date.now() } : cut) });
    useSavedSectionCuts.setState({ templateEdit: { ...templateEdit, draft } });
    return;
  }
  commitCuts({ cuts: cuts.map(cut => cut.id === id ? { ...cut, ...settings, updatedAt: Date.now() } : cut) });
}

export function setViewMarkerStyle(viewId: string, styleId: string | undefined): void {
  const { cuts, tagLibrary } = useSavedSectionCuts.getState();
  const view = cuts.find(item => item.id === viewId);
  if (!view) return;
  const kind = savedViewKind(view);
  if (kind !== 'section' && kind !== 'elevation') return;
  if (styleId && !tagLibrary.markerStyles?.some(style => style.id === styleId && style.kind === kind)) return;
  updateViewSettings(viewId, { markerStyleId: styleId, markerSymbolId: undefined });
}

function movedViewTrace(cut: SavedSectionCut | undefined, trace: MarkerTrace, reverse: boolean, distantElements?: DistantElements | null): SavedSectionCut | undefined {
  const plane = cut?.planes[cut.activeIndex];
  const custom = verticalViewPlane(trace[0], trace[1], false, reverse);
  if (!cut || !plane || !custom || plane.axis === 'down' || plane.box) return;
  const planes = [...cut.planes];
  planes[cut.activeIndex] = { ...plane, axis: 'front', flipped: false, custom };
  const display = distantElements === undefined ? cut.display : {
    ...(cut.display ?? useViewerStore.getState().drawing2DDisplayOptions),
    distantElements: distantElements ?? undefined,
  };
  return { ...cut, planes, markerTrace: trace, display, viewpoint: null, zoom: null, updatedAt: Date.now() };
}

export function editSavedViewTrace(id: string, trace: MarkerTrace, reverse: boolean, distantElements?: DistantElements | null): void {
  const { cuts } = useSavedSectionCuts.getState();
  const edited = movedViewTrace(cuts.find(view => view.id === id), trace, reverse, distantElements);
  if (edited) commitCuts({ cuts: cuts.map(view => view.id === id ? edited : view) });
}

/** Move view-local tags, global grids and saved vertical views in one persisted write. */
export function moveDrawingWindowSymbols(viewId: string | null, tagIds: ReadonlySet<string>,
  markers: readonly { id: string; start: Point2D; end: Point2D; reverse: boolean }[],
  plane: SectionPlaneConfig, planFlipped: boolean, delta: Point2D): void {
  if (!tagIds.size && !markers.length) return;
  const state = useSavedSectionCuts.getState();
  if (!state.projectId || state.activeCutId !== viewId || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new Error('Invalid drawing move selection');
  }
  const view = state.cuts.find(item => item.id === viewId);
  const gridIds = new Set(state.grids.filter(grid => tagIds.has(grid.id)).map(grid => grid.id));
  const localIds = new Set(view?.elementTags?.map(tag => tag.id) ?? []);
  for (const id of tagIds) if (!gridIds.has(id) && !localIds.has(id)) throw new Error('Missing drawing symbol');
  const shift = (p: Point2D): Point2D => ({ x: p.x + delta.x, y: p.y + delta.y });
  const world = (p: Point2D): Point2D => ({ x: planFlipped ? -p.x : p.x, y: p.y });
  const edits = new Map<string, SavedSectionCut>();
  for (const marker of markers) {
    const cut = state.cuts.find(item => item.id === marker.id);
    if (!cut || cut.id === viewId || !['section', 'elevation'].includes(savedViewKind(cut))) throw new Error('Invalid drawing marker');
    const moved = movedViewTrace(cut, [world(shift(marker.start)), world(shift(marker.end))], planFlipped !== marker.reverse);
    if (!moved) throw new Error('Invalid marker trace');
    edits.set(marker.id, moved);
  }
  const cuts = state.cuts.map(item => {
    const moved = edits.get(item.id);
    if (moved) return moved;
    if (item.id !== viewId || !item.elementTags?.some(tag => tagIds.has(tag.id) && !gridIds.has(tag.id))) return item;
    return { ...item, updatedAt: Date.now(), elementTags: item.elementTags.map(tag =>
      !tagIds.has(tag.id) || gridIds.has(tag.id) ? tag : { ...tag, position: shift(tag.position),
        ...(tag.gridStart && { gridStart: shift(tag.gridStart) }),
        ...(!tag.free && { anchorOffset: shift(tag.anchorOffset) }),
      }) };
  });
  const grids = state.grids.map(grid => gridIds.has(grid.id) ? moveProjectGrid(grid, plane, delta) : grid);
  commitCuts({ cuts, grids });
}

/** Delete the selected view-local tags, shared grids and saved vertical views
 * in a single persisted write. The caller confirms the scope before calling. */
export function deleteDrawingWindowSymbols(viewId: string | null, tagIds: ReadonlySet<string>, markerIds: ReadonlySet<string>): void {
  if (!tagIds.size && !markerIds.size) return;
  const state = useSavedSectionCuts.getState();
  if (!state.projectId || state.activeCutId !== viewId) throw new Error('Drawing selection changed');
  const view = state.cuts.find(item => item.id === viewId);
  const gridIds = new Set(state.grids.filter(grid => tagIds.has(grid.id)).map(grid => grid.id));
  const localIds = new Set(view?.elementTags?.map(tag => tag.id) ?? []);
  for (const id of tagIds) {
    if (!gridIds.has(id) && !localIds.has(id)) throw new Error('Drawing symbol no longer exists');
  }
  for (const id of markerIds) {
    const marker = state.cuts.find(item => item.id === id);
    if (!marker || id === viewId || !['section', 'elevation'].includes(savedViewKind(marker))) {
      throw new Error('Invalid drawing marker selection');
    }
  }
  // Match the individual view-removal path, which exits template editing.
  // Persist first so a storage failure cannot partially remove a selection.
  const now = Date.now();
  const cuts = state.cuts.filter(item => !markerIds.has(item.id)).map(item => {
    const removeLocal = item.id === viewId && item.elementTags?.some(tag => tagIds.has(tag.id));
    const removeExtents = item.gridExtents && [...gridIds].some(id => Object.prototype.hasOwnProperty.call(item.gridExtents, id));
    if (!removeLocal && !removeExtents) return item;
    const gridExtents = { ...item.gridExtents };
    if (removeExtents) for (const id of gridIds) delete gridExtents[id];
    return { ...item, updatedAt: now,
      ...(removeLocal && { elementTags: item.elementTags?.filter(tag => !tagIds.has(tag.id)) }),
      ...(removeExtents && { gridExtents }),
    };
  });
  commitCuts({ cuts, grids: state.grids.filter(grid => !gridIds.has(grid.id)) });
  if (markerIds.size) cancelDrawingTemplateEdit();
}

/** Append clipboard symbols with one persisted write; do not overwrite existing ids. */
export function pasteDrawingWindowSymbols(viewId: string | null, tags: readonly DrawingElementTag[],
  grids: readonly ProjectGrid[]): void {
  if (!tags.length && !grids.length) return;
  const state = useSavedSectionCuts.getState();
  if (!state.projectId || state.activeCutId !== viewId) throw new Error('Drawing selection changed');
  const view = state.cuts.find(item => item.id === viewId);
  if (tags.length && !view) throw new Error('Save the drawing before pasting tags');
  const ids = new Set([...state.grids.map(item => item.id), ...(view?.elementTags ?? []).map(item => item.id)]);
  for (const item of [...tags, ...grids]) {
    if (!item.id || ids.has(item.id)) throw new Error('Duplicate drawing symbol id');
    ids.add(item.id);
  }
  if (readProjectGrids(grids).length !== grids.length) throw new Error('Invalid grid');
  const names = new Set(state.grids.map(item => item.name.trim().toLocaleLowerCase()));
  const copies = grids.map(grid => {
    if (!grid.name.trim()) throw new Error('Grid name is required');
    const base = grid.name.trim() + ' Copy';
    let name = base, number = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${base} ${number++}`;
    names.add(name.toLocaleLowerCase());
    return { ...grid, name };
  });
  const cuts = state.cuts.map(item => item.id === viewId && tags.length
    ? { ...item, elementTags: [...(item.elementTags ?? []), ...tags], updatedAt: Date.now() } : item);
  commitCuts({ cuts, grids: [...state.grids, ...copies] });
}

export function removeSavedSectionCut(id: string): void {
  cancelDrawingTemplateEdit();
  const { cuts, activeCutId } = useSavedSectionCuts.getState();
  commitCuts({ cuts: cuts.filter((c) => c.id !== id), activeCutId: activeCutId === id ? null : activeCutId,
    ...(activeCutId === id ? { drawingPlaneId: undefined } : {}) });
}

/** Session-only options for an unsaved drawing, keyed by its semantic plane. */
export function updateTemporaryDrawingOptions(key: string,
  patch: Partial<SavedSectionCutsState['temporaryOptions'][string]>): void {
  if (!key.startsWith('plane:')) throw new Error('Invalid temporary drawing view key');
  useSavedSectionCuts.setState(state => ({ temporaryOptions: {
    ...state.temporaryOptions, [key]: { ...state.temporaryOptions[key], ...patch },
  } }));
}

export function selectActiveSavedView(state: SavedSectionCutsState): SavedSectionCut | undefined {
  return state.templateEdit?.draft ?? state.cuts.find(view => view.id === state.activeCutId);
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
  const cut = selectActiveSavedView(useSavedSectionCuts.getState());
  const state = useViewerStore.getState();
  if (cut) updateViewSettings(cut.id, { display: { ...(cut.display ?? state.drawing2DDisplayOptions), showSurfacePatterns3D } });
  state.updateDrawing2DDisplayOptions({ showSurfacePatterns3D });
}

export function saveDrawingViewGraphics(): void {
  const active = selectActiveSavedView(useSavedSectionCuts.getState());
  if (!active) return;
  const state = useViewerStore.getState();
  updateViewSettings(active.id, { graphics: { ...active.graphics, presetId: state.activePresetId,
    enabled: state.overridesEnabled, rules: structuredClone(state.customOverrideRules) } });
}

function mergedDrawingRules(local: GraphicOverrideRule[], inherited?: GraphicOverrideRule[]): GraphicOverrideRule[] {
  const rules = new Map(inherited?.map(rule => [rule.id, rule]));
  local.forEach(rule => rules.set(rule.id, rule));
  return [...rules.values()];
}

export function saveDrawingViewRows(rows: TemplateRow[], inherited?: GraphicOverrideRule[]): void {
  const active = selectActiveSavedView(useSavedSectionCuts.getState());
  const state = useViewerStore.getState();
  if (!active) updateTemporaryDrawingOptions(temporaryDimensionViewKey(drawnSectionPlane(state)), { graphicsRows: structuredClone(rows) });
  const rules = mergedDrawingRules(state.customOverrideRules, inherited);
  if (active) updateViewSettings(active.id, { graphics: { ...active.graphics, presetId: state.activePresetId, enabled: true,
    rules: structuredClone(rules), rows: structuredClone(rows) } });
  useViewerStore.setState({ customOverrideRules: rules, overridesEnabled: true });
}

export function beginDrawingTemplateEdit(template: ViewTemplate): void {
  const saved = useSavedSectionCuts.getState();
  const view = selectActiveSavedView(saved);
  if (!view || saved.templateEdit || view.graphics?.presetId !== template.id) return;
  const state = useViewerStore.getState();
  useSavedSectionCuts.setState({ templateEdit: {
    draft: structuredClone(view), display: structuredClone(state.drawing2DDisplayOptions),
    visibility: captureViewVisibility(state), rules: structuredClone(state.customOverrideRules),
    presetId: state.activePresetId, enabled: state.overridesEnabled,
    sheetScale: state.sheetEnabled ? state.activeSheet?.scale : undefined,
  } });
  try {
    applyDrawingTemplate({ ...template, groups: VIEW_TEMPLATE_GROUPS.filter(group =>
      group === 'graphics' || (group === 'projection' ? !!template.projection : group === 'filters' ? !!template.filters : !!template.annotations)) }, template);
  } catch (error) { cancelDrawingTemplateEdit(); throw error; }
}

export function cancelDrawingTemplateEdit(): void {
  const { templateEdit } = useSavedSectionCuts.getState();
  if (!templateEdit) return;
  const state = useViewerStore.getState();
  useSavedSectionCuts.setState({ templateEdit: undefined });
  useViewerStore.setState({
    ...restoreViewVisibility(state, templateEdit.visibility), typeVisibility: templateEdit.visibility.types,
    activePresetId: templateEdit.presetId, overridesEnabled: templateEdit.enabled,
    customOverrideRules: templateEdit.rules,
  });
  state.updateDrawing2DDisplayOptions({ ...templateEdit.display, ...templateProjectionDisplay(templateEdit.display) });
  if (templateEdit.sheetScale && state.activeSheet) state.setDrawingScale(templateEdit.sheetScale);
}

export function captureDrawingTemplate(view: SavedSectionCut): Pick<ViewTemplate, 'projection' | 'filters' | 'rules' | 'annotations'> {
  const state = useViewerStore.getState();
  return {
    projection: { scale: view.publicationScale ?? state.drawing2DDisplayOptions.scale,
      display: structuredClone(templateProjectionDisplay(state.drawing2DDisplayOptions)) },
    filters: { visibility: captureViewVisibility(state), filter: view.filter && structuredClone(view.filter) },
    rules: structuredClone(state.customOverrideRules),
    annotations: structuredClone(view.annotationOptions ?? { visibility: { ...DEFAULT_VIEW_MARKERS, ...view.markers } }),
  };
}

function drawingTemplatePatch(view: SavedSectionCut, template: ViewTemplate): Parameters<typeof updateViewSettings>[1] {
  const groups = viewTemplateGroups(template);
  const projection = groups.includes('projection') ? template.projection : undefined;
  const filters = groups.includes('filters') ? template.filters : undefined;
  const currentDisplay = view.display ?? useViewerStore.getState().drawing2DDisplayOptions;
  const kind = savedViewKind(view);
  const display = projection && templateProjectionDisplay(projection.display);
  const viewDisplay = display && {
    ...currentDisplay,
    ...(display.showHiddenLines !== undefined && { showHiddenLines: display.showHiddenLines }),
    ...(kind === '3d' ? {
      ...(display.showSurfacePatterns3D !== undefined && { showSurfacePatterns3D: display.showSurfacePatterns3D }),
    } : {
      showConstructionProjection: display.showConstructionProjection,
      constructionProjectionDepth: display.constructionProjectionDepth,
      show3DOverlay: display.show3DOverlay ?? currentDisplay.show3DOverlay,
      distantElements: display.distantElements,
      ...(kind === 'plan' && {
        useSymbolicRepresentations: display.useSymbolicRepresentations ?? currentDisplay.useSymbolicRepresentations,
        showOverheadProjection: display.showOverheadProjection,
      }),
    }),
  };
  return structuredClone({
    ...(groups.includes('graphics') && { graphics: {
      presetId: template.id, enabled: true, rows: template.rows, rules: template.rules ?? [],
    } }),
    ...(projection && { publicationScale: projection.scale,
      display: viewDisplay }),
    ...(groups.includes('annotations') && kind !== '3d' && { annotationOptions: template.annotations }),
    ...(filters && { visibility: filters.visibility, ...(kind !== '3d' && { filter: filters.filter }) }),
  });
}

export function applyDrawingTemplate(template: ViewTemplate | undefined, previous?: ViewTemplate): void {
  const active = selectActiveSavedView(useSavedSectionCuts.getState());
  if (!active) return;
  const state = useViewerStore.getState();
  const patch = template ? drawingTemplatePatch({ ...active, display: state.drawing2DDisplayOptions }, template) : {};
  const graphics = {
    ...(patch.graphics ?? {
      enabled: true,
      rows: active.graphics?.rows ?? previous?.rows ?? [],
      rules: mergedDrawingRules(state.customOverrideRules, active.graphics?.rows === undefined ? previous?.rules : undefined),
    }),
    presetId: template?.id ?? null,
    templateRevision: template ? template.revision ?? template.id : undefined,
  };
  updateViewSettings(active.id, { ...patch, graphics: structuredClone(graphics) });
  refreshDrawingTemplate(active, patch, graphics);
}

function refreshDrawingTemplate(active: SavedSectionCut, patch: ReturnType<typeof drawingTemplatePatch>,
  graphics: NonNullable<SavedSectionCut['graphics']>): void {
  const state = useViewerStore.getState();
  useViewerStore.setState({ activePresetId: graphics.presetId, overridesEnabled: true,
    customOverrideRules: structuredClone(graphics.rules),
    ...(patch.visibility && restoreViewVisibility(state, patch.visibility)),
  });
  if (patch.display && patch.publicationScale) {
    const factor = patch.publicationScale;
    const scale = COMMON_SCALES.find(candidate => candidate.factor === factor)
      ?? { factor, name: `1:${formatScaleFactorLabel(factor)}`, useCase: '' };
    state.updateDrawing2DDisplayOptions({ ...patch.display, scale: factor });
    if (savedViewKind(active) !== '3d' && state.sheetEnabled && state.activeSheet) state.setDrawingScale(scale);
  }
}

export function assignDrawingTemplateViews(template: ViewTemplate, selectedIds: ReadonlySet<string>,
  templates: readonly ViewTemplate[]): void {
  const { cuts, activeCutId, templateEdit } = useSavedSectionCuts.getState();
  if (templateEdit) return;
  const state = useViewerStore.getState();
  let live: { view: SavedSectionCut; patch: ReturnType<typeof drawingTemplatePatch>; graphics: NonNullable<SavedSectionCut['graphics']> } | undefined;
  let changed = false;
  const next = cuts.map(view => {
    const linked = view.graphics?.presetId === template.id;
    const selected = selectedIds.has(view.id);
    if (linked === selected) return view;
    changed = true;
    const active = view.id === activeCutId;
    const source = active ? { ...view, display: state.drawing2DDisplayOptions } : view;
    const patch = selected ? drawingTemplatePatch(source, template) : {};
    const previous = templates.find(item => item.id === view.graphics?.presetId);
    const graphics: NonNullable<SavedSectionCut['graphics']> = structuredClone({
      ...(patch.graphics ?? {
        enabled: true, rows: view.graphics?.rows ?? previous?.rows ?? [],
        rules: mergedDrawingRules(active ? state.customOverrideRules : view.graphics?.rules ?? [],
          view.graphics?.rows === undefined ? previous?.rules : undefined),
      }),
      presetId: selected ? template.id : null,
      templateRevision: selected ? template.revision ?? template.id : undefined,
    });
    if (active) live = { view, patch, graphics };
    return { ...view, ...patch, graphics, updatedAt: Date.now() };
  });
  if (!changed) return;
  commitCuts({ cuts: next });
  if (live) refreshDrawingTemplate(live.view, live.patch, live.graphics);
}

export function setDrawingViewTemplate(id: string | null): void {
  const state = useViewerStore.getState();
  const { activeCutId, cuts } = useSavedSectionCuts.getState();
  const active = cuts.find(cut => cut.id === activeCutId);
  if (active) updateViewSettings(active.id, { graphics: {
    ...active.graphics, presetId: id, enabled: true,
    rules: structuredClone(state.customOverrideRules),
  } });
  useViewerStore.setState({ activePresetId: id, overridesEnabled: true });
}

export function clearDeletedDrawingViewTemplate(id: string): void {
  const { cuts } = useSavedSectionCuts.getState();
  if (cuts.some(cut => cut.graphics?.presetId === id)) {
    commitCuts({ cuts: cuts.map(cut => cut.graphics?.presetId === id
      ? { ...cut, graphics: { ...cut.graphics, presetId: null, templateRevision: undefined }, updatedAt: Date.now() }
      : cut) });
  }
  if (useViewerStore.getState().activePresetId === id) {
    useViewerStore.setState({ activePresetId: null });
  }
}

export function setDrawingProjectionDisplay(patch: Partial<Pick<ViewDisplay, 'showHiddenLines' | 'distantElements' | 'constructionProjectionDepth'
  | 'showConstructionProjection' | 'showOverheadProjection' | 'showAnnotations' | 'show3DOverlay' | 'useSymbolicRepresentations'>>): void {
  const state = useViewerStore.getState();
  const active = selectActiveSavedView(useSavedSectionCuts.getState());
  if (active) updateViewSettings(active.id, { display: { ...state.drawing2DDisplayOptions, ...active.display, ...patch } });
  state.updateDrawing2DDisplayOptions(patch);
}
