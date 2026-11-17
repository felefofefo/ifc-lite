/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useMemo, useState, type MouseEvent, type RefObject } from 'react';
import type { Drawing2D, Point2D } from '@ifc-lite/drawing-2d';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { snapDrawingAngle } from '@/lib/drawing/dimension-line';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { updateViewSettings, useSavedSectionCuts, type SavedSectionCut } from '@/store/savedSectionCutsStore';
import type { Annotation2DTool } from '@/store/slices/drawing2DSlice';
import { collectTagTargets, findTagTarget, pickTagTarget, readDrawingTags, resolveDrawingTag, tagFields,
  type DrawingElementTag, type ResolvedDrawingTag } from '@/lib/drawing/drawing-element-tags';

type Transform = { x: number; y: number; scale: number };
type Draft = { viewId: string; tag: DrawingElementTag; mode: 'new' | 'edit' | 'move' };

export function useDrawingTags({ view, drawing, transform, axis, container, tool, setTool, showHidden, scale }: {
  view: SavedSectionCut | undefined;
  drawing: Drawing2D | null;
  transform: Transform;
  axis: 'down' | 'front' | 'side';
  container: RefObject<HTMLDivElement | null>;
  tool: Annotation2DTool;
  setTool: (tool: Annotation2DTool) => void;
  showHidden: boolean;
  scale: number;
}) {
  const active = tool === 'tag';
  const [session, setSession] = useState<Draft | null>(null);
  const [cursor, setCursor] = useState<Point2D | null>(null);
  const [failed, setFailed] = useState(false);
  const [miss, setMiss] = useState(false);
  const models = useViewerStore(s => s.models);
  const mutationVersion = useViewerStore(s => s.mutationVersion);
  const draft = active && session?.viewId === view?.id ? session : null;
  const placing = !!draft && draft.mode !== 'edit';
  const stored = useMemo(() => readDrawingTags(view?.elementTags), [view?.elementTags]);
  const targets = useMemo(() => drawing && view && (active || stored.length)
    ? collectTagTargets(drawing, showHidden) : [], [drawing, view?.id, active, stored.length, showHidden, models, mutationVersion]);
  const items = useMemo(() => stored.flatMap(tag => {
    const target = findTagTarget(targets, tag);
    return target ? [resolveDrawingTag(tag, target)] : [];
  }), [stored, targets]);
  const target = draft ? findTagTarget(targets, draft.tag) : undefined;
  const fields = useMemo(() => target ? tagFields(target) : [], [target, mutationVersion]);
  const preview = draft && target ? resolveDrawingTag({
    ...draft.tag, position: placing && cursor ? cursor : draft.tag.position,
  }, target, fields) : null;

  useEffect(() => {
    setSession(current => active && current?.viewId === view?.id ? current : null);
    setCursor(null);
    setFailed(false);
    setMiss(false);
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

  function commit(position: Point2D) {
    if (!draft || !target) return;
    const next = { ...draft.tag, position };
    if (save(tags => tags.some(tag => tag.id === next.id)
      ? tags.map(tag => tag.id === next.id ? next : tag) : [...tags, next])) close();
  }

  function placementPoint(e: MouseEvent) {
    const p = point(e);
    return p && placing && e.shiftKey && draft?.tag.leader && preview
      ? snapDrawingAngle(preview.anchor, p) : p;
  }

  function click(e: MouseEvent): boolean {
    if (!active || e.button !== 0) return false;
    const p = placementPoint(e);
    if (!view || !drawing || !p) return true;
    if (placing) { commit(p); return true; }
    if (draft) return true;
    const hit = pickTagTarget(targets, p, 9 / transform.scale);
    const field = hit && tagFields(hit)[0];
    if (!hit || !field) { setMiss(true); return true; }
    setMiss(false);
    setCursor(p);
    setSession({ viewId: view.id, mode: 'new', tag: {
      id: globalThis.crypto?.randomUUID?.() ?? 'tag-' + Date.now() + '-' + Math.random(),
      globalId: hit.globalId, projectId: hit.projectId, fingerprint: hit.fingerprint,
      field: field.key, position: p, anchorOffset: { x: p.x - hit.center.x, y: p.y - hit.center.y }, leader: true,
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
    active, items, preview, tool, choose, screen, draft, placing, fields, change, failed, miss, close,
    canPlace: !!view && !!drawing,
    fontSize: Math.max(11, 2.5 * transform.scale * (scale || 100) / 1000),
    click,
    move(e: MouseEvent) { if (!active) return false; if (placing) setCursor(placementPoint(e)); return true; },
    moveTag() { if (draft) { setCursor(draft.tag.position); setSession({ ...draft, mode: 'move' }); } },
    apply() { if (draft) commit(draft.tag.position); },
    remove() { if (draft && save(tags => tags.filter(tag => tag.id !== draft.tag.id))) close(); },
    clear() { return !stored.length || save(() => []); },
  };
}

export function DrawingElementTags({ tags }: { tags: ReturnType<typeof useDrawingTags> }) {
  const { t } = useTranslation();
  const draft = tags.draft;
  const shown = tags.items.filter(item => item.tag.id !== draft?.tag.id);
  const hint = !tags.canPlace ? t('section2d.tags.saveView')
    : tags.placing ? t('section2d.tags.place')
    : draft ? t('section2d.tags.edit')
    : tags.miss ? t('section2d.tags.miss') : t('section2d.tags.pick');

  function paint(item: ResolvedDrawingTag, preview: boolean) {
    const { tag, text, anchor } = item;
    const p = tags.screen(tag.position), a = tags.screen(anchor);
    const interactive = !preview && tags.tool === 'none';
    return <g key={tag.id} className={preview ? 'text-primary' : 'text-foreground'}>
      {tag.leader && <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke="currentColor" strokeWidth={1} />}
      <text x={p.x} y={p.y} fill="currentColor" stroke="var(--paper, #fff)" strokeWidth={3}
        paintOrder="stroke" fontFamily="Arial, sans-serif" fontSize={tags.fontSize}
        textAnchor="middle" dominantBaseline="middle" role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? t('section2d.tags.editNamed', { name: text }) : undefined}
        className={interactive ? 'pointer-events-auto cursor-pointer hover:fill-primary focus-visible:fill-primary' : undefined}
        onMouseDown={interactive ? e => e.stopPropagation() : undefined}
        onClick={interactive ? e => { e.stopPropagation(); tags.choose(tag); } : undefined}
        onKeyDown={interactive ? e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tags.choose(tag); }
        } : undefined}>{text}</text>
    </g>;
  }

  return <>
    {!!(shown.length || tags.preview) && <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {shown.map(item => paint(item, false))}
      {tags.preview && paint(tags.preview, true)}
    </svg>}
    {tags.active && <div className="absolute left-3 top-3 z-10 grid w-72 max-w-[calc(100%-1.5rem)] gap-2 rounded-md border bg-background p-3 text-xs shadow-sm"
      onMouseDown={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <strong>{t('section2d.tools.tag')}</strong>
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={tags.close}>{t('section2d.tags.close')}</Button>
      </div>
      <p className="text-muted-foreground" role="status">{hint}</p>
      {draft && <>
        <div className="grid gap-1">
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
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.tag.leader} onChange={e => tags.change({ leader: e.currentTarget.checked })} />
          {t('section2d.tags.leader')}
        </label>
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
