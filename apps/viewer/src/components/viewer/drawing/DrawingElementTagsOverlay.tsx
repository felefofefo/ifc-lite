/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useDialogs } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import type { ResolvedDrawingTag } from '@/lib/drawing/drawing-element-tags';
import type { useDrawingTags } from './DrawingElementTags';

export function DrawingElementTags({ tags }: { tags: ReturnType<typeof useDrawingTags> }) {
  const { t } = useTranslation();
  const { confirmDialog } = useDialogs();
  const draft = tags.draft;
  const snap = tags.snapReference && tags.screen(tags.snapReference);
  const shown = tags.items.filter(item => item.tag.id !== draft?.tag.id);
  const kind = tags.draftUse ?? tags.use;
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
    const { tag, text, anchor, graphic, startGraphic, hideEnd, style, lineWidth } = item;
    const p = tags.screen(tag.position), a = tags.screen(anchor);
    const interactive = !preview && tags.tool === 'none';
    const graphicElement = <g key={tag.id} className={preview ? 'text-primary' : 'text-foreground'}>
      {(tag.leader || tag.gridStart) && <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke={preview ? "currentColor" : style?.color ?? "currentColor"}
        strokeWidth={lineWidth === undefined ? 1 : Math.max(0.75, lineWidth * tags.paperUnit)} />}
      <g role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? t('section2d.tags.editNamed', { name: text }) : undefined}
        className={interactive ? 'pointer-events-auto cursor-pointer hover:fill-primary focus-visible:fill-primary' : undefined}
        onMouseDown={interactive ? e => e.stopPropagation() : undefined}
        onClick={interactive ? e => { e.stopPropagation(); tags.choose(tag); } : undefined}
        onKeyDown={interactive ? e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); tags.choose(tag); }
        } : undefined}>
        {interactive && tag.gridStart && <line x1={a.x} y1={a.y} x2={p.x} y2={p.y}
          stroke="transparent" strokeWidth={12} pointerEvents="stroke" />}
        {startGraphic && <image href={startGraphic.href}
          x={a.x - startGraphic.anchor.x * tags.paperUnit} y={a.y - startGraphic.anchor.y * tags.paperUnit}
          width={startGraphic.width * tags.paperUnit} height={startGraphic.height * tags.paperUnit} />}
        {!hideEnd && (graphic ? (
          <image href={graphic.href} x={p.x - graphic.anchor.x * tags.paperUnit}
            y={p.y - graphic.anchor.y * tags.paperUnit}
            width={graphic.width * tags.paperUnit} height={graphic.height * tags.paperUnit} />
        ) : (
          <text x={p.x} y={p.y} fill="currentColor" stroke="var(--paper, #fff)" strokeWidth={3}
            paintOrder="stroke" fontFamily={style?.font ?? "Arial, sans-serif"} fontSize={style?.textHeight ? style.textHeight * tags.paperUnit : tags.fontSize}
            textAnchor="middle" dominantBaseline="middle">{text}</text>
        ))}
      </g>
    </g>;
    if (!interactive || !tag.gridStart) return graphicElement;
    return <ContextMenu key={tag.id}>
      <ContextMenuTrigger asChild>{graphicElement}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => tags.choose(tag)}>{t('section2d.grid.edit')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => tags.choose(tag, 'move')}>{t('section2d.tags.move')}</ContextMenuItem>
        <ContextMenuItem onSelect={async () => {
          if (await confirmDialog({ description: t('section2d.grid.deleteEverywhere'), destructive: true })) tags.removeGrid(tag);
        }}>{t('section2d.tags.remove')}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>;
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
    {draft && kind === 'grid' && draft.mode === 'edit' && <div role="toolbar" tabIndex={-1} aria-label={t('section2d.grid.edit')}
      className="absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-md border bg-background p-1 shadow-sm"
      onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
      <Input aria-label={t('section2d.symbols.gridName')} className="h-7 w-20 text-xs" value={draft.tag.field} maxLength={32}
        onChange={event => tags.change({ field: event.target.value })}
        onKeyDown={event => { if (event.key === 'Enter' && draft.tag.field.trim()) tags.apply(); }} />
      <Select disabled={tags.gridStyleLocked} value={tags.gridStyleId ?? draft.tag.appearanceId ?? 'original'}
        onValueChange={id => tags.change({ appearanceId: id === 'original' ? undefined : id })}>
        <SelectTrigger className="h-7 w-36 text-xs" aria-label={t('section2d.annotationStyles.title')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="original">{t('section2d.annotationStyles.fromSymbol')}</SelectItem>
          {tags.gridStyles.map(style => <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" variant="ghost" disabled={!draft.tag.field.trim()} onClick={tags.apply}>{t('section2d.views.save')}</Button>
      <Button size="sm" variant="ghost" onClick={tags.moveTag}>{t('section2d.grid.edit')}</Button>
      <Button size="sm" variant="ghost" onClick={tags.close}>{t('section2d.create.cancel')}</Button>
      {tags.failed && <span role="alert" className="px-2 text-xs text-destructive">{t('section2d.tags.writeFailed')}</span>}
    </div>}
    {tags.active && !(draft && kind === 'grid' && draft.mode === 'edit') && <div role="toolbar" aria-label={t('section2d.tags.edit')} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); tags.close(); } }} className="absolute left-3 top-3 z-10 grid w-72 max-w-[calc(100%-1.5rem)] gap-2 rounded-md border bg-background p-3 text-xs shadow-sm"
      onMouseDown={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <strong>{kind && kind !== 'section' && kind !== 'elevation' ? t(`section2d.annotationKind.${kind}`) : t('section2d.tools.tag')}</strong>
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={tags.close}>{t('section2d.tags.close')}</Button>
      </div>
      <output className="text-muted-foreground">{hint}</output>
      {kind === 'grid' && <label className="grid gap-1">
        {t('section2d.symbols.gridName')}
        <Input className="h-8 text-xs" value={draft?.tag.field ?? tags.symbolValue} maxLength={32}
          onChange={event => draft ? tags.change({ field: event.currentTarget.value }) : tags.setSymbolValue(event.currentTarget.value)} />
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
          <Button size="sm" disabled={kind === 'grid' && !draft.tag.field.trim()} onClick={tags.apply}>{t('section2d.tags.apply')}</Button>
          <Button size="sm" variant="outline" onClick={tags.moveTag}>{t('section2d.tags.move')}</Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={tags.remove}>{t('section2d.tags.remove')}</Button>
        </div>}
      </>}
      {tags.failed && <p role="alert" className="text-destructive">{t('section2d.tags.writeFailed')}</p>}
    </div>}
  </>;
}
