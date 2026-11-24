/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import type { ResolvedDrawingTag } from '@/lib/drawing/drawing-element-tags';
import type { DrawingViewModel } from './useDrawingViewModel';

export function DrawingElementTags({ vm }: { vm: DrawingViewModel }) {
  const { t } = useTranslation();
  const tags = vm.tags;
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
    const editing = preview && draft?.mode === 'edit' && draft.tag.id === tag.id;
    const selected = !preview && tags.selected?.id === tag.id;
    const dragging = selected && tags.tool === 'none';
    const graphicElement = <g key={tag.id}
      className={dragging ? 'pointer-events-auto cursor-grab touch-none text-primary'
        : editing ? 'text-primary' : preview ? 'text-primary' : 'text-foreground'}
      onPointerDown={dragging ? event => {
        if (event.button !== 0 || !tags.beginEditDrag(event.clientX, event.clientY)) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
      } : undefined}
      onPointerMove={dragging ? event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.stopPropagation(); tags.dragEditedSymbol(event.clientX, event.clientY);
        }
      } : undefined}
      onPointerUp={dragging ? event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.stopPropagation(); tags.dragEditedSymbol(event.clientX, event.clientY, true);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } : undefined}
      onPointerCancel={dragging ? event => { event.stopPropagation(); tags.cancelEditDrag(); } : undefined}
      onLostPointerCapture={dragging ? () => tags.cancelEditDrag() : undefined}>
      {(tag.leader || tag.gridStart) && <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke={preview ? "currentColor" : style?.color ?? "currentColor"}
        strokeWidth={lineWidth === undefined ? 1 : Math.max(0.75, lineWidth * tags.paperUnit)} />}
      {editing && tag.gridStart && <line x1={a.x} y1={a.y} x2={p.x} y2={p.y}
        stroke="transparent" strokeWidth={14} pointerEvents="stroke" />}
      <g role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? `${t('section2d.tools.select')}: ${text}` : undefined}
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
      {preview && tags.canResizeGrid && draft?.tag.id === tag.id && (['start', 'end'] as const).map(endpoint => {
        const at = endpoint === 'start' ? a : p;
        return <circle key={endpoint} cx={at.x} cy={at.y} r={6} fill="var(--paper, #fff)"
          stroke="currentColor" strokeWidth={2} className="pointer-events-auto cursor-grab touch-none text-primary active:cursor-grabbing"
          role="button" tabIndex={0}
          aria-label={t(endpoint === 'start' ? 'section2d.grid.resizeStart' : 'section2d.grid.resizeEnd')}
          onMouseDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            tags.beginGridResize(endpoint, event.clientX, event.clientY);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            event.stopPropagation();
            tags.resizeGridEndpoint(endpoint, event.clientX, event.clientY, false, event.shiftKey);
          }}
          onPointerUp={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            event.stopPropagation();
            tags.resizeGridEndpoint(endpoint, event.clientX, event.clientY, true, event.shiftKey);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={event => {
            event.stopPropagation();
            tags.cancelGridResize();
          }} />;
      })}
    </g>;
    if (!interactive) return graphicElement;
    return <ContextMenu key={tag.id}>
      <ContextMenuTrigger asChild>{graphicElement}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => tags.choose(tag)}>{t('section2d.tools.select')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => tags.editSelected(tag)}>{t('section2d.tools.edit')}</ContextMenuItem>
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
    {tags.selected && !tags.active && <div role="toolbar" aria-label={t('section2d.tools.select')}
      className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-md border bg-background p-1 text-xs shadow-sm"
      onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
      <span className="max-w-36 truncate px-2 font-medium" title={tags.selected.field}>
        {t(`section2d.annotationKind.${tags.selectedKind ?? 'ifc'}`)}
      </span>
      {tags.selected && !tags.selected.free && tags.selectedIfcTemplates.length > 0 && <Select
        value={tags.selected.templateId ?? ''} onValueChange={tags.replaceSelectedIfcTemplate}>
        <SelectTrigger className="h-7 w-40 text-xs" aria-label="IFC tag template"><SelectValue placeholder="IFC tag" /></SelectTrigger>
        <SelectContent>{tags.selectedIfcTemplates.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
      </Select>}
      {tags.selectedKind && <Select disabled={tags.selectedStyleLocked} value={tags.selectedStyleId}
        onValueChange={tags.setSelectedStyle}>
        <SelectTrigger className="h-7 w-36 text-xs" aria-label={t('section2d.annotationStyles.title')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="original">{t('section2d.annotationStyles.fromSymbol')}</SelectItem>
          {tags.selectedStyles.map(style => <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>)}
        </SelectContent>
      </Select>}
      <Button size="sm" variant="ghost" onClick={() => tags.editSelected()}>{t('section2d.tools.edit')}</Button>
      <Button size="sm" variant="ghost" onClick={tags.clearSelection}>{t('section2d.tags.close')}</Button>
      {tags.failed && <span className="text-destructive" role="alert">{t('section2d.tags.writeFailed')}</span>}
    </div>}
    {draft && kind === 'grid' && draft.mode === 'edit' && <div role="toolbar" tabIndex={-1} aria-label={t('section2d.grid.edit')}
      className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-md border bg-background p-1 text-xs shadow-sm"
      onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
      <span className="px-2 font-medium">{t('section2d.annotationKind.grid')}</span>
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
      <Button size="sm" disabled={!draft.tag.field.trim()} onClick={tags.apply}>{t('section2d.views.save')}</Button>
      <Button size="sm" variant="ghost" onClick={tags.close}>{t('section2d.create.cancel')}</Button>
      {tags.failed && <span role="alert" className="px-2 text-xs text-destructive">{t('section2d.tags.writeFailed')}</span>}
    </div>}
    {draft && draft.mode === 'edit' && kind !== 'grid' && <div role="toolbar" aria-label={t('section2d.tags.edit')} tabIndex={-1}
      className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-md border bg-background p-1 text-xs shadow-sm"
      onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <span className="max-w-32 shrink-0 truncate px-2 font-medium">{t(`section2d.annotationKind.${kind ?? 'ifc'}`)}</span>
      {!draft.tag.svg && !draft.tag.templateId && <Select value={draft.tag.field} onValueChange={field => tags.change({ field })}>
        <SelectTrigger className="h-7 w-32 text-xs" aria-label={t('section2d.tags.field')}><SelectValue /></SelectTrigger>
        <SelectContent>
          {!tags.fields.some(field => field.key === draft.tag.field) &&
            <SelectItem value={draft.tag.field}>{t('section2d.tags.fieldMissing')}</SelectItem>}
          {tags.fields.map(field => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}
        </SelectContent>
      </Select>}
      {tags.mode && <Input className="h-7 w-20 shrink-0 text-xs" aria-label={t(tags.mode === 'slope' ? 'section2d.symbols.manualSlope' : 'section2d.symbols.manualElevation')}
        value={tags.overrideText} inputMode="decimal" maxLength={32}
        placeholder={tags.modelLabel ?? t('section2d.symbols.automaticValue')}
        onChange={event => tags.setOverride(event.currentTarget.value)} />}
      {!draft.tag.free && tags.selectedIfcTemplates.length > 0 && <Select
        value={draft.tag.templateId ?? ''} onValueChange={id => tags.change({ templateId:id, svg: undefined })}>
        <SelectTrigger className="h-7 w-32 text-xs" aria-label="IFC tag template"><SelectValue placeholder="IFC tag" /></SelectTrigger>
        <SelectContent>{tags.selectedIfcTemplates.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
      </Select>}
      {!draft.tag.free && <label className="flex shrink-0 items-center gap-1 px-1">
        <input type="checkbox" checked={draft.tag.leader} onChange={event => tags.change({ leader: event.currentTarget.checked })} />
        {t('section2d.tags.leader')}
      </label>}
      {tags.selectedKind && <Select disabled={tags.selectedStyleLocked}
        value={tags.selectedStyleLocked ? tags.selectedStyleId : draft.tag.appearanceId ?? 'original'}
        onValueChange={id => tags.change({ appearanceId: id === 'original' ? undefined : id })}>
        <SelectTrigger className="h-7 w-28 text-xs" aria-label={t('section2d.annotationStyles.title')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="original">{t('section2d.annotationStyles.fromSymbol')}</SelectItem>
          {tags.selectedStyles.map(style => <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>)}
        </SelectContent>
      </Select>}
      <Button size="sm" className="shrink-0" onClick={tags.apply}>{t('section2d.tags.apply')}</Button>
      <Button size="sm" variant="ghost" className="shrink-0" onClick={tags.close}>{t('section2d.tags.close')}</Button>
      {tags.failed && <span role="alert" className="px-2 text-xs text-destructive">{t('section2d.tags.writeFailed')}</span>}
    </div>}
    {tags.active && !(draft && draft.mode === 'edit') && <div role="toolbar" aria-label={t('section2d.tags.edit')} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); tags.close(); } }} className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-md border bg-background p-1 text-xs shadow-sm"
      onMouseDown={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <strong className="shrink-0 px-2">{kind && kind !== 'section' && kind !== 'elevation' ? t(`section2d.annotationKind.${kind}`) : t('section2d.tools.tag')}</strong>
      {kind === 'grid' && <Input className="h-7 w-20 text-xs" aria-label={t('section2d.symbols.gridName')}
        value={draft?.tag.field ?? tags.symbolValue} maxLength={32}
        onChange={event => draft ? tags.change({ field: event.currentTarget.value }) : tags.setSymbolValue(event.currentTarget.value)} />}
      {tags.mode && <Input className="h-7 w-28 text-xs" aria-label={t(tags.mode === 'slope' ? 'section2d.symbols.manualSlope' : 'section2d.symbols.manualElevation')}
        value={tags.overrideText} maxLength={32} inputMode="decimal"
        placeholder={tags.modelLabel ?? t('section2d.symbols.automaticValue')}
        onChange={event => tags.setOverride(event.currentTarget.value)} />}
      {draft && <>
        {draft.mode === 'edit' && tags.selectedKind && <Select disabled={tags.selectedStyleLocked}
          value={tags.selectedStyleLocked ? tags.selectedStyleId : draft.tag.appearanceId ?? 'original'}
          onValueChange={id => tags.change({ appearanceId: id === 'original' ? undefined : id })}>
          <SelectTrigger className="h-7 w-36 text-xs" aria-label={t('section2d.annotationStyles.title')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="original">{t('section2d.annotationStyles.fromSymbol')}</SelectItem>
            {tags.selectedStyles.map(style => <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>)}
          </SelectContent>
        </Select>}
        {!draft.tag.svg && !draft.tag.templateId && <div className="flex items-center gap-1">
          <label htmlFor="drawing-tag-field" className="sr-only">{t('section2d.tags.field')}</label>
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
          <Button size="sm" variant="ghost" className="text-destructive" onClick={tags.remove}>{t('section2d.tags.remove')}</Button>
        </div>}
      </>}
      <output className="min-w-0 max-w-52 flex-1 truncate text-muted-foreground" title={hint}>{hint}</output>
      <Button variant="ghost" size="sm" className="shrink-0" onClick={tags.close}>{t('section2d.tags.close')}</Button>
      {tags.failed && <p role="alert" className="text-destructive">{t('section2d.tags.writeFailed')}</p>}
    </div>}
  </>;
}
