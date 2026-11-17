/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useMemo, useState, type MouseEvent, type RefObject } from 'react';
import type { Drawing2D, Point2D } from '@ifc-lite/drawing-2d';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isPlacedSymbol, symbolFitsView, symbolUse } from '@/lib/drawing/drawing-tag-library';
import { useDrawingDirection, type AngularSnap } from '@/hooks/useDrawingDirection';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { updateViewSettings, useSavedSectionCuts, type SavedSectionCut } from '@/store/savedSectionCutsStore';
import type { Annotation2DTool } from '@/store/slices/drawing2DSlice';
import { collectTagTargets, drawingHeight, findTagTarget, measureDrawingSymbol, measurementLabel, pickTagTarget, readDrawingTags, resolveDrawingTag, resolveFreeSymbol, tagFields,
  type DrawingElementTag, type ResolvedDrawingTag } from '@/lib/drawing/drawing-element-tags';

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


export function useDrawingTags({ view, drawing, transform, axis, container, tool, setTool, showHidden, scale, findSnapPoint, angularSnap }: {
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
  findSnapPoint: (point: Point2D) => Point2D | null;
}) {
  const active = tool === 'tag';
  const [session, setSession] = useState<Draft | null>(null);
  const [cursor, setCursor] = useState<{ point: Point2D; reference: Point2D | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [miss, setMiss] = useState(false);
  const [symbolValue, setSymbolValue] = useState('');
  const [override, setOverride] = useState<string | null>(null);
  const [firstPoint, setFirstPoint] = useState<Point2D | null>(null);
  const [selection, setSelection] = useState<{ projectId?: string; id: string }>();
  const projectId = useSavedSectionCuts(s => s.projectId);
  const templates = useSavedSectionCuts(s => s.tagLibrary.templates);
  const template = selection?.projectId === projectId ? templates.find(item => item.id === selection?.id) : undefined;
  const models = useViewerStore(s => s.models);
  const mutationVersion = useViewerStore(s => s.mutationVersion);
  const draft = active && session?.viewId === view?.id ? session : null;
  const placing = !!draft && draft.mode !== 'edit';
  const use = template && symbolUse(template);
  const draftTemplate = draft && templates.find(item => item.id === draft.tag.templateId);
  const draftUse = draftTemplate && symbolUse(draftTemplate);
  const freeTemplate = active && !draft && template && use && isPlacedSymbol(use) && symbolFitsView(use, axis)
    ? template : undefined;
  const plane = drawing?.config.plane;
  const cursorPoint = cursor?.point;
  const measurementKind = draft ? draftUse : freeTemplate && use;
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
    if (kind === 'grid') { tag.field = symbolValue.trim(); tag.gridStart = firstPoint ?? undefined; }
    if (kind === 'level') tag.field = drawingHeight(plane, cursorPoint).toFixed(3) + ' m';
    if (isMeasurement(kind)) tag.field = label ?? '—';
    return resolveFreeSymbol(tag, templates);
  }, [freeTemplate, cursorPoint, plane, templates, symbolValue, firstPoint, label]);
  const { resolve: resolveDirection } = useDrawingDirection(placing && draft.tag.leader ? draft : null, angularSnap);
  const stored = useMemo(() => readDrawingTags(view?.elementTags), [view?.elementTags]);
  const targets = useMemo(() => drawing && view && (active || stored.length)
    ? collectTagTargets(drawing, showHidden) : [], [drawing, view?.id, active, stored.length, showHidden, models, mutationVersion]);
  const items = useMemo(() => stored.flatMap(tag => {
    if (tag.free) {
      const measurement = tag.measurement;
      const value = measurement && measureDrawingSymbol(measurement.kind, drawing, tag.position, measurement.tolerance);
      const item = resolveFreeSymbol(measurement && drawing ? { ...tag, field: value ?? '—' } : tag, templates);
      return item ? [item] : [];
    }
    const target = findTagTarget(targets, tag);
    return target ? [resolveDrawingTag(tag, target, undefined, templates)] : [];
  }), [stored, targets, templates, drawing]);
  const target = draft ? findTagTarget(targets, draft.tag) : undefined;
  const fields = useMemo(() => target ? tagFields(target) : [], [target, mutationVersion]);
  const resolvedDraft = useMemo(() => {
    if (!draft) return previewFree;
    if (draft.tag.free) {
      const tag = draft.tag;
      if (mode) return resolveFreeSymbol({ ...tag, position: measuredPoint ?? tag.position,
        field: label ?? '—' }, templates);
      if (!placing || !cursorPoint) return resolveFreeSymbol(tag, templates);
      const gridStart = tag.gridStart && { x: tag.gridStart.x + cursorPoint.x - tag.position.x,
        y: tag.gridStart.y + cursorPoint.y - tag.position.y };
      const field = draftUse === 'level' && plane ? drawingHeight(plane, cursorPoint).toFixed(3) + ' m' : tag.field;
      return resolveFreeSymbol({ ...tag, position: cursorPoint, gridStart, field }, templates);
    }
    return target ? resolveDrawingTag(draft.tag, target, fields, templates) : null;
  }, [draft, target, fields, templates, previewFree, placing, cursorPoint, draftUse, plane, mode, measuredPoint, label, overrideText]);
  const preview = resolvedDraft && (placing || freeTemplate) && cursor
    ? { ...resolvedDraft, tag: { ...resolvedDraft.tag, position: cursor.point } }
    : freeTemplate ? null : resolvedDraft;

  useEffect(() => {
    setSession(current => active && current?.viewId === view?.id ? current : null);
    setCursor(null);
    setFailed(false);
    setMiss(false);
    setFirstPoint(null);
    setSymbolValue('');
    setOverride(null);
  }, [active, view?.id]);

  const screenX = axis === 'side' ? -transform.scale : transform.scale;
  const screenY = axis === 'down' ? transform.scale : -transform.scale;
  const screen = (p: Point2D) => ({ x: p.x * screenX + transform.x, y: p.y * screenY + transform.y });
  function point(e: MouseEvent): Point2D | null {
    const rect = container.current?.getBoundingClientRect();
    if (!rect || transform.scale <= 0) return null;
    return { x: (e.clientX - rect.left - transform.x) / screenX,
      y: (e.clientY - rect.top - transform.y) / screenY };
  }

  function save(update: (tags: DrawingElementTag[]) => DrawingElementTag[]): boolean {
    if (!view) return false;
    const state = useSavedSectionCuts.getState();
    const latest = state.cuts.find(item => item.id === view.id);
    if (!latest || state.activeCutId !== view.id) return false;
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
    setTool('none');
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
    if (draft.tag.gridStart) {
      next.gridStart = { x: draft.tag.gridStart.x + position.x - draft.tag.position.x,
        y: draft.tag.gridStart.y + position.y - draft.tag.position.y };
    }
    if (save(tags => tags.some(tag => tag.id === next.id)
      ? tags.map(tag => tag.id === next.id ? next : tag) : [...tags, next])) close();
  }

  function placementPoint(e: MouseEvent) {
    const p = point(e);
    if (!p) return null;
    const reference = placing || freeTemplate ? findSnapPoint(p) : null;
    const anchor = placing && draft?.tag.leader && preview ? preview.anchor : null;
    return { point: resolveDirection(anchor, p, reference, e.shiftKey) ?? p, reference };
  }

  function click(e: MouseEvent): boolean {
    if (!active || e.button !== 0) return false;
    const p = placementPoint(e)?.point;
    if (!view || !drawing || !p) return true;
    if (placing) { commit(p); return true; }
    if (draft) return true;
    if (!template) return true;
    if (freeTemplate) {
      const id = globalThis.crypto?.randomUUID?.() ?? 'symbol-' + Date.now() + '-' + Math.random();
      const tag = freeSymbol(id, freeTemplate.id, p);
      const kind = symbolUse(freeTemplate);
      if (kind === 'level') tag.field = drawingHeight(drawing.config.plane, p).toFixed(3) + ' m';
      if (isMeasurement(kind) && !setMeasurement(tag, kind)) return true;
      if (kind === 'grid') {
        if (!symbolValue.trim()) { setMiss(true); return true; }
        if (!firstPoint) { setFirstPoint(p); setMiss(false); return true; }
        if (Math.hypot(p.x - firstPoint.x, p.y - firstPoint.y) < 1e-8) return true;
        tag.field = symbolValue.trim();
        tag.gridStart = firstPoint;
      }
      if (save(tags => [...tags, tag])) close();
      return true;
    }
    if (symbolUse(template) !== 'ifc') return true;
    const hit = pickTagTarget(targets.filter(item => template.classes.includes(item.ifcClass)), p, 9 / transform.scale);
    const field = hit && tagFields(hit)[0];
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
    setTool('tag');
    setSession({ viewId: view.id, tag, mode: 'edit' });
  }

  function change(patch: Partial<Pick<DrawingElementTag, 'field' | 'leader'>>) {
    if (draft) setSession({ ...draft, tag: { ...draft.tag, ...patch } });
  }

  return {
    template, placingFree: !!freeTemplate, use, firstPoint, symbolValue, mode, overrideText, modelLabel,
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
    active, items, preview, tool, choose, screen, draft, placing, fields, change, failed, miss, close,
    canPlace: !!view && !!drawing,
    snapReference: placing || freeTemplate ? cursor?.reference : null,
    fontSize: Math.max(11, 2.5 * transform.scale * (scale || 100) / 1000),
    click,
    move(e: MouseEvent) { if (!active) return false; if (placing || freeTemplate) setCursor(placementPoint(e)); return true; },
    leave() {
      if (freeTemplate) setCursor(null);
      else if (cursor?.reference) setCursor({ ...cursor, reference: null });
    },
    moveTag() {
      if (!draft) return;
      setCursor({ point: draft.tag.position, reference: null });
      setSession({ ...draft, mode: 'move' });
    },
    apply() { if (draft) commit(draft.tag.position); },
    remove() { if (draft && save(tags => tags.filter(tag => tag.id !== draft.tag.id))) close(); },
    clear() { return !stored.length || save(() => []); },
  };
}

export function DrawingElementTags({ tags }: { tags: ReturnType<typeof useDrawingTags> }) {
  const { t } = useTranslation();
  const draft = tags.draft;
  const snap = tags.snapReference && tags.screen(tags.snapReference);
  const shown = tags.items.filter(item => item.tag.id !== draft?.tag.id);
  const hint = !tags.canPlace ? t('section2d.tags.saveView')
    : tags.mode && tags.miss
      ? t(tags.overrideText.trim() ? 'section2d.symbols.enterValue' : 'section2d.symbols.measurementMissing')
    : tags.placingFree && tags.miss ? t('section2d.symbols.enterValue')
    : tags.placingFree && tags.use === 'grid'
      ? t(tags.firstPoint ? 'section2d.symbols.secondPoint' : 'section2d.symbols.firstPoint')
    : tags.placingFree || draft?.tag.free ? t(tags.placing || !draft ? 'section2d.symbols.place' : 'section2d.symbols.edit')
    : tags.placing ? t((draft?.tag.svg || draft?.tag.templateId) ? 'section2d.tags.placeSvg' : 'section2d.tags.place')
    : draft ? t('section2d.tags.edit')
    : tags.miss ? t('section2d.tagLibrary.targetMiss') : t('section2d.tags.pick');

  function paint(item: ResolvedDrawingTag, preview: boolean) {
    const { tag, text, anchor, graphic } = item;
    const p = tags.screen(tag.position), a = tags.screen(anchor);
    const interactive = !preview && tags.tool === 'none';
    return <g key={tag.id} className={preview ? 'text-primary' : 'text-foreground'}>
      {(tag.leader || tag.gridStart) && <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke="currentColor" strokeWidth={1} />}
      <g role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? t('section2d.tags.editNamed', { name: text }) : undefined}
        className={interactive ? 'pointer-events-auto cursor-pointer hover:fill-primary focus-visible:fill-primary' : undefined}
        onMouseDown={interactive ? e => e.stopPropagation() : undefined}
        onClick={interactive ? e => { e.stopPropagation(); tags.choose(tag); } : undefined}
        onKeyDown={interactive ? e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tags.choose(tag); }
        } : undefined}>
        {graphic ? (
          <image href={graphic.href} x={p.x - graphic.anchor.x * tags.paperUnit}
            y={p.y - graphic.anchor.y * tags.paperUnit}
            width={graphic.width * tags.paperUnit} height={graphic.height * tags.paperUnit} />
        ) : (
          <text x={p.x} y={p.y} fill="currentColor" stroke="var(--paper, #fff)" strokeWidth={3}
            paintOrder="stroke" fontFamily="Arial, sans-serif" fontSize={tags.fontSize}
            textAnchor="middle" dominantBaseline="middle">{text}</text>
        )}
      </g>
    </g>;
  }

  return <>
    {!!(shown.length || tags.preview) && <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {shown.map(item => paint(item, false))}
      {tags.preview && paint(tags.preview, true)}
      {snap && <g aria-hidden="true" transform={`translate(${snap.x} ${snap.y})`} fill="none" stroke="#4CAF50" strokeWidth={1.5}>
        <path d="M -12 0 H 12 M 0 -12 V 12" />
        <circle r={6} />
      </g>}
    </svg>}
    {tags.active && <div className="absolute left-3 top-3 z-10 grid w-72 max-w-[calc(100%-1.5rem)] gap-2 rounded-md border bg-background p-3 text-xs shadow-sm"
      onMouseDown={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <strong>{t(tags.placingFree || draft?.tag.free ? 'section2d.symbols.free' : 'section2d.tools.tag')}</strong>
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={tags.close}>{t('section2d.tags.close')}</Button>
      </div>
      <p className="text-muted-foreground" role="status">{hint}</p>
      {tags.placingFree && tags.use === 'grid' && <label className="grid gap-1">
        {t('section2d.symbols.gridName')}
        <Input className="h-8 text-xs" value={tags.symbolValue} maxLength={32}
          onChange={event => tags.setSymbolValue(event.currentTarget.value)} />
      </label>}
      {tags.mode && <label className="grid gap-1">
        {t(tags.mode === 'slope' ? 'section2d.symbols.manualSlope' : 'section2d.symbols.manualElevation')}
        <Input className="h-8 text-xs" value={tags.overrideText} maxLength={32} inputMode="decimal"
          placeholder={tags.modelLabel ?? t('section2d.symbols.automaticValue')}
          onChange={event => tags.setOverride(event.currentTarget.value)} />
      </label>}
      {!draft && tags.template && <p className="truncate font-medium">{tags.template.name}</p>}
      {draft && <>
        {!draft.tag.svg && !draft.tag.templateId && <div className="grid gap-1">
          <label htmlFor="drawing-tag-field">{t('section2d.tags.field')}</label>
          <Select value={draft.tag.field} onValueChange={field => tags.change({ field })}>
            <SelectTrigger id="drawing-tag-field" className="h-8 min-w-0 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="max-w-[min(28rem,calc(100vw-2rem))]">
              {!tags.fields.some(field => field.key === draft.tag.field) &&
                <SelectItem value={draft.tag.field}>{t('section2d.tags.fieldMissing')}</SelectItem>}
              {tags.fields.map(field => (
                <SelectItem key={field.key} value={field.key} title={field.label}>{field.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>}
        {!draft.tag.free && <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.tag.leader} onChange={e => tags.change({ leader: e.currentTarget.checked })} />
          {t('section2d.tags.leader')}
        </label>}
        {draft.mode === 'edit' && <div className="flex flex-wrap gap-1">
          <Button size="sm" onClick={tags.apply}>{t('section2d.tags.apply')}</Button>
          <Button size="sm" variant="outline" onClick={tags.moveTag}>{t('section2d.tags.move')}</Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={tags.remove}>{t('section2d.tags.remove')}</Button>
        </div>}
      </>}
      {tags.failed && <p role="alert" className="text-destructive">{t('section2d.tags.writeFailed')}</p>}
    </div>}
  </>;
}
