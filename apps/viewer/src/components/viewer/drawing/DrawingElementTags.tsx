/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import type { Drawing2D, Point2D } from '@ifc-lite/drawing-2d';
import { isPlacedSymbol, symbolFitsView, symbolUse } from '@/lib/drawing/drawing-tag-library';
import { createDrawingModelIndex } from '@/lib/drawing/drawing-model-pick';
import { renderTagSvg, tagLeaderEnd, tagSvgFields } from '@/lib/drawing/drawing-tag-svg';
import { gridFromPlan, projectGrid } from '@/lib/drawing/project-grids';
import { ANNOTATION_STYLE_KINDS, type AnnotationStyleKind } from '@/lib/drawing/annotation-types';
import type { LineweightRow } from '@/lib/drawing/lineweight-table';
import { useDrawingDirection, type AngularSnap } from '@/hooks/useDrawingDirection';
import { useViewerStore } from '@/store';
import { saveProjectGrid, saveGridViewExtents, promoteProjectGrid, drawingAnnotationVisible, updateViewSettings, useSavedSectionCuts, type SavedSectionCut } from '@/store/savedSectionCutsStore';
import type { Annotation2DTool } from '@/store/slices/drawing2DSlice';
import { pickRoomInterior, type DrawingIfcSpaceRoom } from '@/lib/drawing/ifc-space-rooms';
import { collectTagTargets, drawingHeight, findTagTarget, measureDrawingSymbol, measurementLabel, pickTagTarget, readDrawingTags, resolveDrawingTag, resolveFreeSymbol, tagFields,
  rehostDrawingTag, unresolvedDrawingTag, type DrawingElementTag } from '@/lib/drawing/drawing-element-tags';

type Transform = { x: number; y: number; scale: number };
type Draft = { viewId: string; tag: DrawingElementTag; mode: 'new' | 'edit' | 'move' };

function isMeasurement(kind: string | null | undefined): kind is 'spotElevation' | 'slope' {
  return kind === 'spotElevation' || kind === 'slope';
}

function manualMeasurement(kind: 'spotElevation' | 'slope', input: string): string | undefined {
  const number = input.trim().replace(',', '.');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(number) && Number.isFinite(Number(number))
    ? measurementLabel(kind, Number(number)) : undefined;
}

function freeSymbol(id: string, templateId: string, position: Point2D): DrawingElementTag {
  return { id, templateId, position, free: true, leader: false,
    globalId: '', projectId: '', fingerprint: '', field: '', anchorOffset: { x: 0, y: 0 } };
}


export function useDrawingTags({ view, drawing, transform, axis, container, tool, setTool, showHidden, scale, findSnapPoint, angularSnap, lineweights, roomContours = [] }: {
  view: SavedSectionCut | undefined;
  drawing: Drawing2D | null;
  transform: Transform;
  axis: 'down' | 'front' | 'side';
  container: RefObject<HTMLDivElement | null>;
  tool: Annotation2DTool;
  setTool: (tool: Annotation2DTool) => void;
  showHidden: boolean;
  scale: number;
  angularSnap: AngularSnap;
  lineweights: LineweightRow;
  roomContours?: readonly DrawingIfcSpaceRoom[];
  findSnapPoint: (point: Point2D) => Point2D | null;
}) {
  const active = tool === 'tag';
  const [selectedTagId, setSelectedTagId] = useState<{ viewId: string; id: string } | null>(null);
  const [showHost, setShowHost] = useState(false);
  const [rehostSession, setRehostSession] = useState<{ viewId: string; projectId: string | null | undefined; id: string } | null>(null);
  const [rehostHoverId, setRehostHoverId] = useState<number>();
  const [session, setSession] = useState<Draft | null>(null);
  const [cursor, setCursor] = useState<{ point: Point2D; reference: Point2D | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [miss, setMiss] = useState(false);
  const [roomHoverId, setRoomHoverId] = useState<number | undefined>(undefined);
  const [symbolValue, setSymbolValue] = useState('');
  const [override, setOverride] = useState<string | null>(null);
  const [firstPoint, setFirstPoint] = useState<Point2D | null>(null);
  const [selection, setSelection] = useState<{ projectId?: string; id: string }>();
  const projectId = useSavedSectionCuts(s => s.projectId);
  const grids = useSavedSectionCuts(s => s.grids);
  const { templates, annotationStyles, defaultAnnotationStyles } = useSavedSectionCuts(s => s.tagLibrary);
  const template = selection?.projectId === projectId ? templates.find(item => item.id === selection?.id) : undefined;
  const models = useViewerStore(s => s.models);
  const mutationVersion = useViewerStore(s => s.mutationVersion);
  const draft = active && session?.viewId === view?.id ? session : null;
  const placing = !!draft && draft.mode !== 'edit';
  const use = template && symbolUse(template);
  const draftTemplate = draft && templates.find(item => item.id === draft.tag.templateId);
  const draftUse = draftTemplate && symbolUse(draftTemplate);
  const freeTemplate = active && !rehostSession && !!view && !!drawing && !draft && template && use && isPlacedSymbol(use) && symbolFitsView(use, axis)
    ? template : undefined;
  const ifcPicking = active && !rehostSession && !!view && !!drawing && !draft && use === 'ifc';
  const plane = drawing?.config.plane;
  const cursorPoint = cursor?.point;
  const measurementKind = draft ? draftUse : freeTemplate && use;
  const styles = view?.annotationOptions?.styles;
  const viewTypeIds = view?.annotationOptions?.styleIds;
  const resolveSymbol = useCallback((tag: DrawingElementTag) => {
    const template = templates.find(item => item.id === tag.templateId);
    const kind = template && ANNOTATION_STYLE_KINDS.find(value => value === symbolUse(template));
    if (!kind) return resolveFreeSymbol(tag, templates);
    const id = viewTypeIds?.[kind] ?? tag.appearanceId;
    const chosen = annotationStyles?.find(item => item.kind === kind && item.id === id);
    const style = chosen?.style ?? styles?.[kind];
    return resolveFreeSymbol(tag, templates, { [kind]: style }, lineweights);
  }, [templates, viewTypeIds, annotationStyles, styles, lineweights]);
  function defaultStyle(kind: string) {
    return defaultAnnotationStyles?.[kind as AnnotationStyleKind];
  }
  const mode = isMeasurement(measurementKind) ? measurementKind : undefined;
  const tolerance = draft?.tag.measurement?.tolerance ?? 9 / Math.max(transform.scale, 1e-8);
  const overrideText = override ?? (mode && draft && !draft.tag.measurement
    ? draft.tag.field.replace(/\s*(?:m|%|°)$/, '') : '');
  const measuredPoint = placing || !draft ? cursorPoint : draft.tag.position;
  const modelLabel = useMemo(() => mode && measuredPoint && !overrideText.trim()
    ? measureDrawingSymbol(mode, drawing, measuredPoint, tolerance) : undefined,
  [mode, drawing, measuredPoint, tolerance, overrideText]);
  const overrideLabel = mode && overrideText.trim()
    ? (override === null && draft?.tag.field === '90°' ? '90°' : manualMeasurement(mode, overrideText)) : undefined;
  const label = overrideText.trim() ? overrideLabel : modelLabel;
  const previewFree = useMemo(() => {
    if (!freeTemplate || !cursorPoint || !plane) return null;
    const tag = freeSymbol('free-preview', freeTemplate.id, cursorPoint);
    const kind = symbolUse(freeTemplate);
    tag.appearanceId = defaultAnnotationStyles?.[kind as AnnotationStyleKind];
    if (kind === 'grid') { tag.field = symbolValue.trim(); tag.gridStart = firstPoint ?? undefined; }
    if (kind === 'level') tag.field = drawingHeight(plane, cursorPoint).toFixed(3) + ' m';
    if (isMeasurement(kind)) tag.field = label ?? '—';
    return resolveSymbol(tag);
  }, [freeTemplate, cursorPoint, plane, symbolValue, firstPoint, label, defaultAnnotationStyles, resolveSymbol]);
  // Angle constraints also apply when adjusting an existing grid's visible ends.
  const { resolve: resolveDirection, resetDirection } = useDrawingDirection(
    (placing && (draft.tag.leader || draft.tag.gridStart) ? draft : null)
    ?? (draft?.mode === 'edit' && draftUse === 'grid' ? `${draft.viewId}:${draft.tag.id}:grid-ends` : null)
    ?? (use === 'grid' ? firstPoint : null)
    ?? (selectedTagId?.viewId === view?.id ? selectedTagId?.id ?? null : null), angularSnap);
  const stored = useMemo(() => [
    ...readDrawingTags(view?.elementTags).filter(tag => !grids.some(grid => grid.id === tag.id)),
    ...(drawing ? grids.flatMap(grid => {
      const tag = projectGrid(grid, drawing, view?.gridExtents?.[grid.id], view?.gridDrawOrder?.[grid.id]);
      return tag ? [tag] : [];
    }) : []),
  ], [view?.elementTags, view?.gridExtents, view?.gridDrawOrder, grids, drawing]);
  const currentTagSelection = selectedTagId;
  const selected = currentTagSelection !== null && currentTagSelection.viewId === view?.id
    ? stored.find(tag => tag.id === currentTagSelection.id) : undefined;
  const selectedTemplate = templates.find(item => item.id === selected?.templateId);
  const selectedUse = selectedTemplate ? symbolUse(selectedTemplate) : 'ifc';
  const selectedKind = ANNOTATION_STYLE_KINDS.find(kind => kind === selectedUse);
  const selectedStyles = annotationStyles?.filter(style => style.kind === selectedKind) ?? [];
  const selectedStyleLocked = selectedKind ? !!viewTypeIds?.[selectedKind] : false;
  useEffect(() => { setSelectedTagId(null); }, [view?.id, projectId]);
  useEffect(() => {
    if (!view || !plane || plane.axis !== 'y' || plane.customPlane) return;
    for (const tag of readDrawingTags(view.elementTags)) {
      const grid = gridFromPlan(tag, plane);
      if (grid) {
        try { promoteProjectGrid(grid, view.id); }
        catch (error) { console.warn('Could not promote grid', error); setFailed(true); }
      }
    }
  }, [view?.id, view?.elementTags, plane]);
  const targets = useMemo(() => drawing && view && (active || stored.length)
    ? collectTagTargets(drawing, showHidden, roomContours) : [], [drawing, view?.id, active, stored.length, showHidden, roomContours, models, mutationVersion]);
  const pickIndex = useMemo(() => drawing ? createDrawingModelIndex(drawing, showHidden) : undefined, [drawing, showHidden]);
  // One picker for preview and placement, so the highlighted room is the
  // same target that receives the IFC Tag on click.
  function pickEligibleTarget(eligible: readonly (typeof targets)[number][], p: Point2D, roomOnly: boolean) {
    if (!(transform.scale > 0) || !eligible.length) return undefined;
    const ids = pickIndex?.pick(p, 9 / transform.scale) ?? [];
    const indexed = ids.map(id => eligible.find(item => item.id === id)).find(item => !!item);
    return (roomOnly ? pickRoomInterior(eligible, p) : indexed)
      ?? pickTagTarget(eligible, p, 9 / transform.scale);
  }
  function pickIfcTarget(p: Point2D) {
    if (!template || symbolUse(template) !== 'ifc') return undefined;
    return pickEligibleTarget(targets.filter(item => template.classes.includes(item.ifcClass)), p,
      template.classes.length > 0 && template.classes.every(type => type === 'IfcSpace'));
  }
  useEffect(() => {
    setRoomHoverId(undefined);
  }, [active, view?.id, projectId, template?.id, drawing, transform.x, transform.y, transform.scale]);
  const selectedTarget = selected && !selected.free ? findTagTarget(targets, selected) : undefined;
  const rehosting = active && !!rehostSession && rehostSession.viewId === view?.id
    && rehostSession.projectId === projectId && rehostSession.id === selected?.id;
  const selectedHostLabel = useMemo(() => {
    if (!selectedTarget) return undefined;
    const fields = tagFields(selectedTarget);
    const name = fields.find(item => item.key === 'name')?.value ?? fields.find(item => item.key === 'long-name')?.value;
    return name ? `${selectedTarget.ifcClass} · ${name}` : selectedTarget.ifcClass;
  }, [selectedTarget, mutationVersion]);
  const hostCandidates = useMemo(() => {
    if (!rehosting || !selected || selected.free) return [];
    // Existing templates define which IFC classes can use the symbol.
    if (selectedTemplate && symbolUse(selectedTemplate) === 'ifc') {
      return targets.filter(item => selectedTemplate.classes.includes(item.ifcClass));
    }
    // Legacy tags have no class list. Keep the known original class if possible.
    return selectedTarget ? targets.filter(item => item.ifcClass === selectedTarget.ifcClass) : targets;
  }, [rehosting, selected, selectedTemplate, selectedTarget, targets]);
  function pickHost(p: Point2D) {
    if (!rehosting || !selected) return undefined;
    const hit = pickEligibleTarget(hostCandidates, p, hostCandidates.every(item => item.ifcClass === 'IfcSpace'));
    if (!hit) return undefined;
    // Plain-text tags must retain an available field. Templates already have
    // their own class validation and established missing-value fallback.
    if (!selectedTemplate && !selected.svg && !tagFields(hit).some(field => field.key === selected.field)) return undefined;
    if (!selectedTemplate && selected.svg && !selectedTarget) {
      try {
        const values = new Map<string, string>();
        tagFields(hit, values);
        if (!tagSvgFields(selected.svg).some(field => values.has(field))) return undefined;
      } catch { return undefined; }
    }
    const next = rehostDrawingTag(selected, hit, p);
    return next && findTagTarget(targets, next)?.id === hit.id ? hit : undefined;
  }
  useEffect(() => { setShowHost(false); }, [selected?.id, view?.id, projectId, tool]);
  useEffect(() => {
    if (rehostSession && !rehosting) {
      setRehostSession(null); setRehostHoverId(undefined);
      if (active) setTool('none');
    }
  }, [rehostSession, rehosting, active, setTool]);
  useEffect(() => {
    if (!rehosting) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setRehostSession(null); setRehostHoverId(undefined); setTool('none');
    };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [rehosting, setTool]);
  const hostHighlight = rehosting ? hostCandidates.find(item => item.id === rehostHoverId)
    : showHost && tool === 'none' ? selectedTarget : undefined;
  const selectedIfcTemplates = selectedTarget ? templates.filter(item =>
    symbolUse(item) === 'ifc' && item.classes.includes(selectedTarget.ifcClass)) : [];
  const items = useMemo(() => stored.flatMap(tag => {
    if (tag.free) {
      const measurement = tag.measurement;
      const value = measurement && measureDrawingSymbol(measurement.kind, drawing, tag.position, measurement.tolerance);
      const item = resolveSymbol(measurement && drawing ? { ...tag, field: value ?? '—' } : tag);
      return item ? [item] : [];
    }
    const target = findTagTarget(targets, tag);
    return target ? [resolveDrawingTag(tag, target, undefined, templates)] : drawing ? [unresolvedDrawingTag(tag)] : [];
  }), [stored, targets, templates, drawing, resolveSymbol]);
  const target = draft ? findTagTarget(targets, draft.tag) : undefined;
  const roomHighlight = active && !rehostSession && view && drawing && axis === 'down'
    ? (draft ? (draft.mode === 'new' ? target : undefined)
      : template && symbolUse(template) === 'ifc' && template.classes.includes('IfcSpace')
        ? targets.find(item => item.id === roomHoverId) : undefined)
    : undefined;
  const fields = useMemo(() => target ? tagFields(target) : [], [target, mutationVersion]);
  const hoveredTarget = ifcPicking ? targets.find(item => item.id === roomHoverId) : undefined;
  // The unplaced IFC symbol has no persistent identity or target yet. Use the
  // same SVG renderer, with real values over an eligible target and placeholders elsewhere.
  const previewIfc = useMemo(() => {
    if (!ifcPicking || !template) return null;
    const position = { x: 0, y: 0 };
    const tag = freeSymbol('ifc-preview', template.id, position);
    if (hoveredTarget) {
      return resolveDrawingTag(tag, hoveredTarget, undefined, templates);
    }
    try {
      const graphic = renderTagSvg(template.svg, new Map<string, string>());
      return { tag, graphic, anchor: position, text: graphic.text || template.name };
    } catch { return null; }
  }, [ifcPicking, template, hoveredTarget, templates]);
  const resolvedDraft = useMemo(() => {
    if (!draft) return previewFree ?? previewIfc;
    if (draft.tag.free) {
      const tag = draft.tag;
      if (mode) return resolveSymbol({ ...tag, position: measuredPoint ?? tag.position, field: label ?? '—' });
      if (!placing || !cursorPoint) return resolveSymbol(tag);
      const gridStart = tag.gridStart && { x: tag.gridStart.x + cursorPoint.x - tag.position.x,
        y: tag.gridStart.y + cursorPoint.y - tag.position.y };
      const field = draftUse === 'level' && plane ? drawingHeight(plane, cursorPoint).toFixed(3) + ' m' : tag.field;
      return resolveSymbol({ ...tag, position: cursorPoint, gridStart, field });
    }
    return target ? resolveDrawingTag(draft.tag, target, fields, templates) : null;
  }, [draft, target, fields, templates, previewFree, previewIfc, placing, cursorPoint, draftUse, plane, mode, measuredPoint, label, overrideText, resolveSymbol]);
  const [dragPreviewTag, setDragPreviewTag] = useState<DrawingElementTag | null>(null);
  const [leaderBasePreview, setLeaderBasePreview] = useState<{
    viewId: string; projectId: typeof projectId; id: string; offset: Point2D;
  } | null>(null);
  const draggedTarget = dragPreviewTag && !dragPreviewTag.free
    ? findTagTarget(targets, dragPreviewTag) : undefined;
  const dragPreview = dragPreviewTag
    ? dragPreviewTag.free ? resolveSymbol(dragPreviewTag)
      : draggedTarget ? resolveDrawingTag(dragPreviewTag, draggedTarget, undefined, templates) : unresolvedDrawingTag(dragPreviewTag)
    : null;
  const followsCursor = placing || !!freeTemplate || ifcPicking;
  const preview = dragPreview ?? (followsCursor
    ? resolvedDraft && cursor ? { ...resolvedDraft, tag: { ...resolvedDraft.tag, position: cursor.point } } : null
    : resolvedDraft);

  useEffect(() => {
    setSession(current => active && current?.viewId === view?.id ? current : null);
    setCursor(null);
    setFailed(false);
    setMiss(false);
    setFirstPoint(null);
    setSymbolValue('');
    setOverride(null);
    setDragPreviewTag(null);
    dragRef.current = null;
    leaderBaseRef.current = null;
    setLeaderBasePreview(null);
  }, [active, view?.id, projectId]);

  const screenX = axis === 'side' ? -transform.scale : transform.scale;
  const screenY = axis === 'down' ? transform.scale : -transform.scale;
  const screen = (p: Point2D) => ({ x: p.x * screenX + transform.x, y: p.y * screenY + transform.y });
  function clientPoint(clientX: number, clientY: number): Point2D | null {
    const rect = container.current?.getBoundingClientRect();
    if (!rect || transform.scale <= 0) return null;
    return { x: (clientX - rect.left - transform.x) / screenX,
      y: (clientY - rect.top - transform.y) / screenY };
  }
  function point(e: MouseEvent): Point2D | null {
    return clientPoint(e.clientX, e.clientY);
  }

  function save(update: (tags: DrawingElementTag[]) => DrawingElementTag[]): boolean {
    if (!view) return false;
    const state = useSavedSectionCuts.getState();
    const latest = state.cuts.find(item => item.id === view.id);
    if (!latest || state.activeCutId !== view.id || state.projectId !== projectId) return false;
    try {
      updateViewSettings(view.id, { elementTags: update(readDrawingTags(latest.elementTags)) });
      setFailed(false);
      return true;
    } catch (error) {
      console.warn('Could not save drawing tags', error);
      setFailed(true);
      return false;
    }
  }

  function close() {
    setSession(null);
    setCursor(null);
    setRehostSession(null);
    setRehostHoverId(undefined);
    setTool('none');
  }

  function beginChangeHost() {
    if (tool !== 'none' || !view || !drawing || !selected || selected.free || selected.gridStart) return;
    setShowHost(false);
    setSession(null); setCursor(null); setMiss(false); setFailed(false);
    setRehostHoverId(undefined);
    setRehostSession({ viewId: view.id, projectId, id: selected.id });
    setTool('tag');
  }

  function commitHost(p: Point2D) {
    if (!rehosting || !selected || !view) return;
    const hit = pickHost(p);
    if (!hit) { setMiss(true); return; }
    const original = selected;
    if (save(list => {
      let found = false;
      const next = list.map(item => {
        if (item.id !== original.id) return item;
        if (found || item.free || item.globalId !== original.globalId || item.projectId !== original.projectId
          || item.fingerprint !== original.fingerprint || item.templateId !== original.templateId
          || item.field !== original.field || item.svg !== original.svg) throw new Error('Tag changed during host selection');
        const changed = rehostDrawingTag(item, hit, p);
        if (!changed || findTagTarget(targets, changed)?.id !== hit.id) throw new Error('Invalid or ambiguous host');
        found = true;
        return changed;
      });
      if (!found) throw new Error('Tag no longer exists');
      return next;
    })) close();
  }

  function setMeasurement(tag: DrawingElementTag, kind: 'spotElevation' | 'slope') {
    const manual = !!overrideText.trim();
    const value = manual ? overrideLabel : measureDrawingSymbol(kind, drawing, tag.position, tolerance);
    if (value === undefined) {
      setMiss(true);
      return false;
    }
    tag.field = value;
    tag.measurement = manual ? undefined : { kind, tolerance };
    return true;
  }

  function commit(position: Point2D) {
    if (!draft || (!target && !draft.tag.free)) return;
    const next = { ...draft.tag, position };
    if (mode && !setMeasurement(next, mode)) return;
    if (plane && draftUse === 'level') {
      next.field = drawingHeight(plane, position).toFixed(3) + ' m';
    }
    if (draft.mode === 'move') {
      const dx = position.x - draft.tag.position.x, dy = position.y - draft.tag.position.y;
      if (draft.tag.gridStart) {
        next.gridStart = { x: draft.tag.gridStart.x + dx, y: draft.tag.gridStart.y + dy };
      }
      if (!draft.tag.free) {
        next.anchorOffset = { x: draft.tag.anchorOffset.x + dx, y: draft.tag.anchorOffset.y + dy };
      }
    }
    if (next.gridStart && plane) {
      try {
        const existing = grids.find(grid => grid.id === next.id);
        let grid = gridFromPlan(next, plane);
        if (!grid && existing) {
          const delta = next.position.x - draft.tag.position.x;
          const tangent = plane.customPlane?.tangent ?? (plane.axis === 'x' ? { x: 0, y: 0, z: plane.flipped ? -1 : 1 } : { x: plane.flipped ? -1 : 1, y: 0, z: 0 });
          const move = (point: typeof existing.start) => ({ ...point, x: point.x + tangent.x * delta, z: point.z + tangent.z * delta });
          grid = { ...existing, name: next.field, appearanceId: next.appearanceId, start: move(existing.start), end: move(existing.end) };
        }
        if (grid) { saveProjectGrid(grid); close(); return; }
      } catch (error) { console.warn('Could not save grid', error); setFailed(true); return; }
    }
    if (save(tags => tags.some(tag => tag.id === next.id)
      ? tags.map(tag => tag.id === next.id ? next : tag) : [...tags, next])) close();
  }

  function placementPoint(e: MouseEvent) {
    const p = point(e);
    if (!p) return null;
    const reference = placing || freeTemplate ? findSnapPoint(p) : null;
    const anchor = use === 'grid' && freeTemplate ? firstPoint
      : placing && draft?.tag.leader && resolvedDraft ? resolvedDraft.anchor : null;
    return { point: resolveDirection(anchor, p, reference, e.shiftKey) ?? reference ?? p, reference };
  }

  function click(e: MouseEvent): boolean {
    if (!active || e.button !== 0) return false;
    if (rehostSession) {
      // Do not turn a toolbar click into a geometry pick.
      const p = point(e);
      if (rehosting && p && (e.target as Element).tagName === 'CANVAS') commitHost(p);
      return true;
    }
    const p = placementPoint(e)?.point;
    if (!view || !drawing || !p) return true;
    if (placing) { commit(p); return true; }
    if (draft) return true;
    if (!template) return true;
    if (freeTemplate) {
      const id = globalThis.crypto?.randomUUID?.() ?? 'symbol-' + Date.now() + '-' + Math.random();
      const tag = freeSymbol(id, freeTemplate.id, p);
      const kind = symbolUse(freeTemplate);
      tag.appearanceId = defaultStyle(kind);
      if (kind === 'level') tag.field = drawingHeight(drawing.config.plane, p).toFixed(3) + ' m';
      if (isMeasurement(kind) && !setMeasurement(tag, kind)) return true;
      if (kind === 'grid') {
        if (!symbolValue.trim()) { setMiss(true); return true; }
        if (!firstPoint) { setFirstPoint(p); setMiss(false); return true; }
        if (Math.hypot(p.x - firstPoint.x, p.y - firstPoint.y) < 1e-8) return true;
        tag.field = symbolValue.trim();
        tag.gridStart = firstPoint;
      }
      if (kind === 'grid') {
        const grid = gridFromPlan(tag, drawing.config.plane);
        if (grid) {
          try { saveProjectGrid(grid); close(); }
          catch (error) { console.warn('Could not create grid', error); setFailed(true); }
        }
      } else if (save(tags => [...tags, tag])) close();
      return true;
    }
    if (symbolUse(template) !== 'ifc') return true;
    const hit = pickIfcTarget(p);
    setRoomHoverId(undefined);
    const availableFields = hit ? tagFields(hit) : [];
    const field = (hit?.ifcClass === 'IfcSpace'
      ? availableFields.find(item => item.key === 'long-name') ?? availableFields.find(item => item.key === 'name')
      : undefined) ?? availableFields[0];
    if (!hit || !field) { setMiss(true); return true; }
    setMiss(false);
    setCursor({ point: p, reference: null });
    setSession({ viewId: view.id, mode: 'new', tag: {
      id: globalThis.crypto?.randomUUID?.() ?? 'tag-' + Date.now() + '-' + Math.random(),
      globalId: hit.globalId, projectId: hit.projectId, fingerprint: hit.fingerprint,
      field: field.key, templateId: template.id, position: p, anchorOffset: { x: p.x - hit.center.x, y: p.y - hit.center.y }, leader: true,
    } });
    return true;
  }

  function choose(tag: DrawingElementTag) {
    if (!view || tool !== 'none') return;
    useViewerStore.getState().setSelectedAnnotation2D(null);
    setSelectedTagId({ viewId: view.id, id: tag.id });
  }

  function editSelected(tag: DrawingElementTag | undefined = selected) {
    if (!view || !tag || (!tag.free && !findTagTarget(targets, tag))) return;
    setSelectedTagId({ viewId: view.id, id: tag.id });
    useViewerStore.getState().setSelectedAnnotation2D(null);
    setSession({ viewId: view.id, tag, mode: 'edit' });
    setTool('tag');
  }

  function setSelectedStyle(styleId: string) {
    if (!selected || selectedStyleLocked) return;
    const appearanceId = styleId === 'original' ? undefined : styleId;
    try {
      const grid = grids.find(item => item.id === selected.id);
      if (grid) saveProjectGrid({ ...grid, appearanceId });
      else save(tags => tags.map(tag => tag.id === selected.id ? { ...tag, appearanceId } : tag));
    } catch (error) { console.warn('Could not change symbol style', error); setFailed(true); }
  }

  function replaceSelectedIfcTemplate(templateId: string) {
    if (!selected || selected.free || !selectedIfcTemplates.some(item => item.id === templateId)) return;
    save(tags => tags.map(tag => tag.id === selected.id ? { ...tag, templateId, svg: undefined } : tag));
  }
  function change(patch: Partial<Pick<DrawingElementTag, 'field' | 'leader' | 'appearanceId' | 'templateId' | 'svg'>>) {
    if (draft) setSession({ ...draft, tag: { ...draft.tag, ...patch } });
  }

  const dragRef = useRef<{ from: Point2D; clientX: number; clientY: number; tag: DrawingElementTag } | null>(null);
  const resizingRef = useRef<{ tag: DrawingElementTag; endpoint: 'start' | 'end'; clientX: number; clientY: number } | null>(null);
  const leaderBaseRef = useRef<{
    tag: DrawingElementTag; viewId: string; projectId: typeof projectId; editing: boolean;
    from: Point2D; tip: Point2D; connection: Point2D;
  } | null>(null);

  // Selected IFC tags and their Edit drafts use exactly the same tip gesture.
  const leaderControl = draft?.mode === 'edit' ? resolvedDraft
    : tool === 'none' ? items.find(item => item.tag.id === selected?.id) : undefined;
  function beginLeaderBaseDrag(clientX: number, clientY: number) {
    const item = leaderControl;
    const from = clientPoint(clientX, clientY);
    if (!view || !from || !item || item.tag.free || !item.tag.leader || item.tag.gridStart) return false;
    const host = findTagTarget(targets, item.tag);
    if (!host) return false;
    const end = tagLeaderEnd(item.graphic, screen(item.tag.position), screen(item.anchor), transform.scale * (scale || 100) / 1000);
    const connection = { x: (end.x - transform.x) / screenX, y: (end.y - transform.y) / screenY };
    resetDirection();
    leaderBaseRef.current = { tag: item.tag, viewId: view.id, projectId, editing: draft?.mode === 'edit',
      from, tip: item.anchor, connection };
    setCursor(null);
    return true;
  }

  function dragLeaderBase(clientX: number, clientY: number, finish = false, shiftKey = false) {
    const initial = leaderBaseRef.current;
    const to = clientPoint(clientX, clientY);
    if (!initial) return;
    const tag = initial.editing && draft?.mode === 'edit' ? draft.tag : tool === 'none' ? selected : undefined;
    const host = tag && findTagTarget(targets, tag);
    if (!to || initial.viewId !== view?.id || initial.projectId !== projectId || !tag || tag.id !== initial.tag.id
      || !tag.leader || !host || tag.globalId !== initial.tag.globalId || tag.projectId !== initial.tag.projectId
      || tag.fingerprint !== initial.tag.fingerprint) { cancelLeaderBaseDrag(); return; }
    const dx = to.x - initial.from.x, dy = to.y - initial.from.y;
    const raw = { x: initial.tip.x + dx, y: initial.tip.y + dy };
    const snapped = dx || dy ? findSnapPoint(raw) : null;
    const reference = dx || dy ? resolveDirection(initial.connection, raw, snapped, shiftKey) ?? snapped : null;
    const at = reference ?? raw;
    const anchorOffset = dx || dy ? { x: at.x - host.center.x, y: at.y - host.center.y } : initial.tag.anchorOffset;
    if (initial.editing) {
      setSession(current => current?.viewId === initial.viewId && current.tag.id === initial.tag.id && current.mode === 'edit'
        ? { ...current, tag: { ...current.tag, anchorOffset } } : current);
    } else if (finish) {
      // Only write the tip on release; never overwrite host or other tag properties.
      if (anchorOffset.x !== initial.tag.anchorOffset.x || anchorOffset.y !== initial.tag.anchorOffset.y) {
        save(list => list.map(item => item.id === tag.id && item.globalId === tag.globalId && item.projectId === tag.projectId
          && item.fingerprint === tag.fingerprint && item.leader ? { ...item, anchorOffset } : item));
      }
    } else {
      setLeaderBasePreview({ viewId: initial.viewId, projectId: initial.projectId, id: tag.id, offset: anchorOffset });
    }
    setCursor({ point: at, reference });
    if (finish) {
      leaderBaseRef.current = null; resetDirection(); setLeaderBasePreview(null); setCursor(null);
    }
  }

  function cancelLeaderBaseDrag() {
    const initial = leaderBaseRef.current;
    if (!initial) return;
    leaderBaseRef.current = null;
    resetDirection(); setLeaderBasePreview(null); setCursor(null);
    if (initial.editing && initial.viewId === view?.id && initial.projectId === projectId) {
      setSession(current => current?.viewId === initial.viewId && current.tag.id === initial.tag.id && current.mode === 'edit'
        ? { ...current, tag: { ...current.tag, anchorOffset: initial.tag.anchorOffset } } : current);
    }
  }

  function nudgeLeaderBase(dx: number, dy: number) {
    const item = leaderControl;
    if (!item || item.tag.free || !item.tag.leader || item.tag.gridStart || !(transform.scale > 0)) return;
    const tag = item.tag;
    const anchorOffset = { x: tag.anchorOffset.x + dx / screenX, y: tag.anchorOffset.y + dy / screenY };
    if (!Number.isFinite(anchorOffset.x) || !Number.isFinite(anchorOffset.y)) return;
    if (draft?.mode === 'edit' && draft.tag.id === tag.id) {
      setSession(current => current?.tag.id === tag.id && current.mode === 'edit'
        ? { ...current, tag: { ...current.tag, anchorOffset } } : current);
    } else if (tool === 'none' && selected?.id === tag.id) {
      save(list => list.map(item => item.id === tag.id ? { ...item, anchorOffset } : item));
    }
  }
  function toggleSelectedLeader() {
    if (tool !== 'none' || !selected || selected.free || selected.gridStart) return;
    const id = selected.id;
    save(list => list.map(item => item.id === id ? { ...item, leader: !item.leader } : item));
  }

  function saveMovedTag(tag: DrawingElementTag) {
    if (!plane || !view) return;
    const original = dragRef.current?.tag ?? selected;
    if (!original) return;
    try {
      const grid = grids.find(item => item.id === tag.id);
      if (grid && tag.gridStart) {
        if (plane.axis === 'y' && !plane.customPlane) {
          const next = gridFromPlan(tag, plane);
          if (!next) return;
          saveProjectGrid(next);
        } else {
          // A vertical edit translates the shared datum in plan; its height stays view-local.
          const dx = tag.position.x - original.position.x;
          const tangent = plane.customPlane?.tangent ?? (plane.axis === 'x'
            ? { x: 0, y: 0, z: plane.flipped ? -1 : 1 }
            : { x: plane.flipped ? -1 : 1, y: 0, z: 0 });
          const move = (p: typeof grid.start) => ({ ...p, x: p.x + tangent.x * dx, z: p.z + tangent.z * dx });
          saveProjectGrid({ ...grid, start: move(grid.start), end: move(grid.end),
            name: tag.field, appearanceId: tag.appearanceId });
        }
      } else if (!save(tags => tags.map(item => item.id === tag.id ? tag : item))) return;
      setFailed(false);
    } catch (error) {
      console.warn('Could not move drawing symbol', error);
      setFailed(true);
    }
  }

  const dragFrame = useRef<number | null>(null);
  const pendingDrag = useRef<{ x: number; y: number; shiftKey: boolean } | null>(null);

  function beginEditDrag(clientX: number, clientY: number) {
    const from = clientPoint(clientX, clientY);
    if (tool !== 'none' || !selected || !from) return false;
    resetDirection();
    dragRef.current = { from, clientX, clientY, tag: selected };
    return true;
  }

  function dragEditedSymbol(clientX: number, clientY: number, finish = false, shiftKey = false) {
    if (!dragRef.current) return;
    if (!finish) {
      pendingDrag.current = { x: clientX, y: clientY, shiftKey };
      if (dragFrame.current === null) dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = null;
        const pending = pendingDrag.current;
        pendingDrag.current = null;
        if (pending) computeEditedSymbolDrag(pending.x, pending.y, false, pending.shiftKey);
      });
      return;
    }
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
    pendingDrag.current = null;
    computeEditedSymbolDrag(clientX, clientY, true, shiftKey);
  }

  function computeEditedSymbolDrag(clientX: number, clientY: number, finish: boolean, shiftKey: boolean) {
    const drag = dragRef.current;
    const to = clientPoint(clientX, clientY);
    if (!drag || !to || tool !== 'none' || selected?.id !== drag.tag.id) return;
    if (Math.hypot(clientX - drag.clientX, clientY - drag.clientY) < 4) {
      if (finish) cancelEditDrag();
      return;
    }
    let delta = { x: to.x - drag.from.x, y: to.y - drag.from.y };
    const candidate = { x: drag.tag.position.x + delta.x, y: drag.tag.position.y + delta.y };
    const reference = findSnapPoint(candidate);
    const anchor = drag.tag.position;
    const directed = resolveDirection(anchor, candidate, reference, shiftKey);
    const final = directed ?? reference ?? candidate;
    delta = { x: final.x - anchor.x, y: final.y - anchor.y };
    if (drag.tag.gridStart && plane?.axis !== 'y') delta.y = 0;
    const translate = (p: Point2D) => ({ x: p.x + delta.x, y: p.y + delta.y });
    // Direct drag repositions the label, not its referenced IFC point.
    // Explicit Move (and grids) retain their existing whole-object semantics.
    const next = { ...drag.tag, position: translate(drag.tag.position),
      ...(drag.tag.gridStart && { gridStart: translate(drag.tag.gridStart) }) };
    if (!finish) {
      const indicated = directed ?? reference;
      const accepted = indicated && Math.hypot(indicated.x - next.position.x, indicated.y - next.position.y) < 1e-8;
      setCursor({ point: next.position, reference: accepted ? indicated : null });
      setDragPreviewTag(next);
    } else {
      saveMovedTag(next);
      resetDirection();
      dragRef.current = null;
      setDragPreviewTag(null);
      setCursor(null);
    }
  }

  function cancelEditDrag() {
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
    pendingDrag.current = null;
    dragRef.current = null;
    resetDirection();
    setCursor(null);
    setDragPreviewTag(null);
  }

  const resizeFrame = useRef<number | null>(null);
  const pendingResize = useRef<{ endpoint: 'start' | 'end'; x: number; y: number; shiftKey: boolean } | null>(null);
  useEffect(() => () => {
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current);
  }, []);

  function beginGridResize(endpoint: 'start' | 'end', clientX: number, clientY: number) {
    if (draft?.mode !== 'edit' || !draft.tag.gridStart) return;
    resizingRef.current = { tag: draft.tag, endpoint, clientX, clientY };
  }

  function resizeGridEndpoint(endpoint: 'start' | 'end', clientX: number, clientY: number, finish: boolean, shiftKey = false) {
    if (!resizingRef.current) return;
    if (!finish) {
      pendingResize.current = { endpoint, x: clientX, y: clientY, shiftKey };
      if (resizeFrame.current === null) resizeFrame.current = requestAnimationFrame(() => {
        resizeFrame.current = null;
        const pending = pendingResize.current;
        pendingResize.current = null;
        if (pending) computeGridResize(pending.endpoint, pending.x, pending.y, false, pending.shiftKey);
      });
      return;
    }
    if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = null;
    pendingResize.current = null;
    computeGridResize(endpoint, clientX, clientY, true, shiftKey);
  }

  function computeGridResize(endpoint: 'start' | 'end', clientX: number, clientY: number, finish: boolean, shiftKey: boolean) {
    if (!draft || draft.mode !== 'edit' || draftUse !== 'grid' || !draft.tag.gridStart || !plane) return;
    const position = clientPoint(clientX, clientY);
    if (!position) return;
    const resize = resizingRef.current;
    if (!resize || resize.endpoint !== endpoint) return;
    if (Math.hypot(clientX - resize.clientX, clientY - resize.clientY) < 4) {
      if (finish) { resizingRef.current = null; setCursor(null); }
      return;
    }
    const snapped = findSnapPoint(position);
    const anchor = endpoint === 'start' ? resize.tag.position : resize.tag.gridStart!;
    // The opposite end is the angle-lock reference; object snaps win only when
    // they lie on the active angular direction. Vertical grids stay vertical.
    const angled = resolveDirection(anchor, position, snapped, shiftKey);
    const adjusted = angled ?? snapped ?? position;
    const constrained = plane.axis === 'y' && !plane.customPlane
      ? adjusted : { x: resize.tag.position.x, y: adjusted.y };
    const accepted = snapped && Math.hypot(snapped.x - constrained.x, snapped.y - constrained.y) < 1e-8;
    const indicated = accepted ? snapped : angled && angularSnap !== 'off' ? constrained : null;
    const change = endpoint === 'start' ? { gridStart: constrained } : { position: constrained };
    const next = { ...draft.tag, ...change };
    if (!finish) {
      setCursor({ point: constrained, reference: indicated });
      setSession(current => current?.viewId === draft.viewId && current.tag.id === draft.tag.id
        ? { ...current, tag: { ...current.tag, ...change } } : current);
      return;
    }
    const original = resize.tag;
    resizingRef.current = null;
    setCursor(null);
    try {
      if (plane.axis === 'y' && !plane.customPlane) {
        const grid = gridFromPlan(next, plane);
        if (!grid) throw new Error('Invalid plan grid');
        saveProjectGrid(grid);
      } else {
        if (!view) return;
        const bottom = next.gridStart?.y;
        if (bottom === undefined || next.position.y - bottom <= 1e-8) throw new Error('Grid extents must not cross');
        saveGridViewExtents(view.id, next.id, { start: bottom, end: next.position.y });
      }
      setFailed(false);
      setSession({ ...draft, tag: next });
    } catch (error) {
      console.warn('Could not resize grid', error);
      setFailed(true);
      setSession({ ...draft, tag: original });
    }
  }

  function cancelGridResize() {
    if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = null;
    pendingResize.current = null;
    const original = resizingRef.current?.tag;
    resizingRef.current = null;
    setCursor(null);
    if (original) setSession(current => current ? { ...current, tag: original } : current);
  }

  return {
    selectById(id: string) {
      if (!view) return;
      useViewerStore.getState().setSelectedAnnotation2D(null);
      setSelectedTagId({ viewId: view.id, id });
    },
    gridStyles: annotationStyles?.filter(style => style.kind === 'grid') ?? [],
    gridStyleLocked: !!viewTypeIds?.grid,
    gridStyleId: viewTypeIds?.grid,
    canResizeGrid: draft?.mode === 'edit' && draftUse === 'grid' && !!draft.tag.gridStart,
    beginLeaderBaseDrag, dragLeaderBase, cancelLeaderBaseDrag, nudgeLeaderBase, toggleSelectedLeader,
    resizeGridEndpoint, beginGridResize, cancelGridResize, beginEditDrag, dragEditedSymbol, cancelEditDrag,
    selected, selectedUse, selectedKind, selectedStyles, selectedStyleLocked, selectedIfcTemplates, replaceSelectedIfcTemplate,
    selectedHostLabel, showHost, rehosting, hostHighlight, beginChangeHost,
    toggleHostHighlight() { if (tool === 'none' && selectedTarget) setShowHost(value => !value); },
    draggingSelectedTag: dragPreviewTag?.id ?? null,
    selectedStyleId: (selectedKind && viewTypeIds?.[selectedKind]) ?? selected?.appearanceId ?? 'original',
    editSelected, setSelectedStyle, clearSelection() { setSelectedTagId(null); },
    template, draftUse, placingFree: !!freeTemplate, use, firstPoint, symbolValue, mode, overrideText, modelLabel,
    setOverride(value: string) { setOverride(value); setMiss(false); },
    setSymbolValue(value: string) { setSymbolValue(value); setMiss(false); },
    selectTemplate(id: string) {
      setSelection({ id, projectId });
      setFirstPoint(null);
      setSymbolValue('');
      setOverride(null);
      setSession(null);
      setCursor(null);
      setMiss(false);
    },
    paperUnit: transform.scale * (scale || 100) / 1000,
    roomHighlight: roomHighlight?.ifcClass === 'IfcSpace' ? roomHighlight.polygons : undefined,
    active, items: items.filter(({ tag }) => {
      const source = templates.find(item => item.id === tag.templateId);
      const kind = source ? symbolUse(source) : 'ifc';
      const styleKind = ANNOTATION_STYLE_KINDS.find(value => value === kind);
      const id = (styleKind && viewTypeIds?.[styleKind]) ?? tag.appearanceId ?? tag.templateId;
      return drawingAnnotationVisible(view, `symbol:${kind}`, id);
    }).map(item => {
      const pending = leaderBasePreview;
      if (!pending || tool !== 'none' || pending.viewId !== view?.id || pending.projectId !== projectId
        || pending.id !== selected?.id || pending.id !== item.tag.id) return item;
      const offset = pending.offset, original = item.tag.anchorOffset;
      return { ...item, tag: { ...item.tag, anchorOffset: offset },
        anchor: { x: item.anchor.x + offset.x - original.x, y: item.anchor.y + offset.y - original.y } };
    }), preview, tool, choose, screen, draft, placing, fields, change, failed, miss, close,
    removeGrid(tag: DrawingElementTag) {
      const grid = grids.find(item => item.id === tag.id);
      if (!grid) return;
      try { saveProjectGrid(grid, true); close(); }
      catch (error) { console.warn('Could not delete grid', error); setFailed(true); }
    },
    canPlace: !!view && !!drawing,
    snapReference: placing || freeTemplate || !!dragRef.current || !!resizingRef.current || !!leaderBaseRef.current ? cursor?.reference : null,
    fontSize: Math.max(11, 2.5 * transform.scale * (scale || 100) / 1000),
    click,
    move(e: MouseEvent) {
      if (!active) return false;
      if (rehostSession) {
        const p = rehosting && e.buttons === 0 && (e.target as Element).tagName === 'CANVAS' ? point(e) : null;
        const hit = p && pickHost(p);
        setRehostHoverId(hit ? hit.id : undefined);
        if (hit && miss) setMiss(false);
        return true;
      }
      if (followsCursor) {
        // Toolbars/inputs are not drawing surfaces. Never place a ghost over them.
        const next = e.buttons === 0 && (e.target as Element).tagName === 'CANVAS' ? placementPoint(e) : null;
        setCursor(next);
        const hit = ifcPicking && next ? pickIfcTarget(next.point) : undefined;
        setRoomHoverId(hit?.id);
      } else setRoomHoverId(undefined);
      return true;
    },
    leave() {
      setRehostHoverId(undefined);
      setRoomHoverId(undefined);
      if (followsCursor) setCursor(null);
      else if (cursor?.reference) setCursor({ ...cursor, reference: null });
    },
    moveTag() {
      if (!draft) return;
      setCursor({ point: draft.tag.position, reference: null });
      setSession({ ...draft, mode: 'move' });
    },
    apply() { if (draft) commit(draft.tag.position); },
    remove() {
      if (!draft) return;
      const grid = grids.find(item => item.id === draft.tag.id);
      if (grid) {
        try { saveProjectGrid(grid, true); close(); }
        catch (error) { console.warn('Could not delete grid', error); setFailed(true); }
      } else if (save(tags => tags.filter(tag => tag.id !== draft.tag.id))) close();
    },
    clear() { return !view?.elementTags?.length || save(() => []); },
  };
}

export { DrawingElementTags } from './DrawingElementTagsOverlay';
