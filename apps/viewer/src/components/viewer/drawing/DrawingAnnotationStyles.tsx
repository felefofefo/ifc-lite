/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { AREA_BOUNDARY_PATTERNS, ANNOTATION_FONTS, ANNOTATION_STYLE_KINDS, type AnnotationStyleKind, type AnnotationSymbolStyle, type NamedAnnotationStyle } from '@/lib/drawing/annotation-types';
import { renderTagSvg } from '@/lib/drawing/drawing-tag-svg';
import { DrawingFillControl } from './DrawingHatchSelect';
import { symbolUse } from '@/lib/drawing/drawing-tag-library';
import { LINEWEIGHT_PRESETS } from '@/lib/drawing/lineweight-table';
import { saveDrawingTagLibrary, useSavedSectionCuts } from '@/store/savedSectionCutsStore';

export function DrawingAnnotationStyles() {
  const { t } = useTranslation();
  const projectId = useSavedSectionCuts(state => state.projectId);
  const library = useSavedSectionCuts(state => state.tagLibrary);
  const [kind, setKind] = useState<AnnotationStyleKind>();
  const [draft, setDraft] = useState<NamedAnnotationStyle>();
  const [failed, setFailed] = useState(false);
  const style = draft?.style ?? {};
  const hasUnits = kind === 'level' || kind === 'spotElevation' || kind === 'slope';
  const units: NonNullable<AnnotationSymbolStyle['unit']>[] = kind === 'slope' ? ['%', '°'] : ['m', 'cm', 'mm'];
  const gridSymbols = library.templates.filter(symbol => symbolUse(symbol) === 'grid');
  const styles = library.annotationStyles ?? [];
  function gridPreviewMarker(slot: 'start' | 'end') {
    const id = slot === 'start' ? style.startSymbolId : style.endSymbolId;
    if (id === '' || (slot === 'start' && !id)) return null;
    const symbol = gridSymbols.find(item => item.id === id) ?? gridSymbols[0];
    if (!symbol) return null;
    try {
      const graphic = renderTagSvg(symbol.svg, new Map([['Grid', 'A']]));
      const x = slot === 'start' ? 34 : 206;
      return <image href={graphic.href} x={x - graphic.anchor.x * 3} y={30 - graphic.anchor.y * 3}
        width={graphic.width * 3} height={graphic.height * 3} />;
    } catch { return null; }
  }
  function select(group: AnnotationStyleKind, id?: string) {
    setKind(group);
    setFailed(false);
    const existing = styles.find(item => item.kind === group && item.id === id);
    setDraft(existing ? structuredClone(existing) : { id: crypto.randomUUID(), name: '', kind: group, style: {} });
  }
  function change(next: Partial<AnnotationSymbolStyle>) {
    setDraft(current => current && { ...current, style: { ...current.style, ...next } });
  }
  function save(next: typeof library): boolean {
    if (!projectId) return false;
    try { saveDrawingTagLibrary(projectId, next); setFailed(false); return true; }
    catch { setFailed(true); return false; }
  }
  return <>
    {ANNOTATION_STYLE_KINDS.map(group => {
      const choices = styles.filter(item => item.kind === group);
      const defaultId = library.defaultAnnotationStyles?.[group] ?? 'original';
      return <section key={group} className="space-y-2 border-t p-3 text-xs">
        <h3 className="font-medium">{t(`section2d.annotationKind.${group}`)}</h3>
        <label className="block" htmlFor={`annotation-default-${group}`}>{t('section2d.annotationStyles.defaultNew')}</label>
        <Select value={defaultId} disabled={!projectId} onValueChange={id => save({ ...library,
          defaultAnnotationStyles: { ...library.defaultAnnotationStyles, [group]: id === 'original' ? undefined : id } })}>
          <SelectTrigger id={`annotation-default-${group}`} className="h-8 min-w-0 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="original">{t('section2d.annotationStyles.fromSymbol')}</SelectItem>
            {choices.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={!projectId} onClick={() => select(group, defaultId === 'original' ? choices[0]?.id : defaultId)}>
          {t('section2d.dimensionStyle.manage')}
        </Button>
      </section>;
    })}
    {failed && !kind && <p className="px-3 text-xs text-destructive" role="alert">{t('section2d.views.saveError')}</p>}
    <Dialog open={!!kind} onOpenChange={open => { if (!open) { setKind(undefined); setFailed(false); } }}>
      {kind && draft && <DialogContent className="sm:max-w-xl" scrollBody>
        <DialogHeader>
          <DialogTitle>{t(`section2d.annotationKind.${kind}`)}</DialogTitle>
          <DialogDescription>{t('section2d.annotationStyles.libraryHelp')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {kind === 'grid' && <svg className="h-20 w-full rounded border bg-white" viewBox="0 0 240 60"
            role="img" aria-label={t('section2d.markerStyles.preview')}>
            <line x1={34} y1={30} x2={206} y2={30} stroke={style.color ?? '#000000'} />
            {gridPreviewMarker('start')}{gridPreviewMarker('end')}
          </svg>}
          <Select value={styles.some(item => item.id === draft.id) ? draft.id : 'new'}
            onValueChange={id => select(kind, id === 'new' ? undefined : id)}>
            <SelectTrigger aria-label={t('section2d.annotationStyles.title')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="new">{t('section2d.annotationStyles.new')}</SelectItem>
              {styles.filter(item => item.kind === kind).map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <form id="drawing-annotation-type" className="grid gap-3 sm:grid-cols-2" onSubmit={event => {
            event.preventDefault();
            const name = draft.name.trim();
            if (!name || styles.some(item => item.kind === kind && item.id !== draft.id && item.name.toLowerCase() === name.toLowerCase())) {
              setFailed(true); return;
            }
            const next = { ...draft, name, style: kind === 'cloud' ? { color: style.color, weight: style.weight ?? 'medium' } : style };
            const latest = useSavedSectionCuts.getState().tagLibrary;
            const items = latest.annotationStyles ?? [];
            if (save({ ...latest, annotationStyles: items.some(item => item.id === draft.id)
              ? items.map(item => item.id === draft.id ? next : item) : [...items, next] })) setKind(undefined);
          }}>
            <label className="grid gap-1 text-sm sm:col-span-2">{t('section2d.annotationStyles.name')}
              <Input required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
            </label>
            {kind === 'text' && <><div className="grid gap-1 text-sm">
              <label htmlFor="annotation-type-font">{t('section2d.annotationStyles.font')}</label>
              <Select value={style.font ?? 'inherit'} onValueChange={font => change({ font: ANNOTATION_FONTS.find(item => item === font) })}>
                <SelectTrigger id="annotation-type-font"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">{t('section2d.annotationStyles.fromSymbol')}</SelectItem>
                  {ANNOTATION_FONTS.map(font => <SelectItem key={font} value={font}>{t(`section2d.annotationStyles.font.${font}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="grid gap-1 text-sm">{t('section2d.dimensionStyle.textSize')}
              <Input type="number" min={0.5} max={12} step="any" value={style.textHeight ?? ''}
                placeholder={t('section2d.annotationStyles.fromSymbol')}
                onChange={event => change({ textHeight: event.target.value ? event.target.valueAsNumber : undefined })} />
            </label>
            </>}
             {kind === 'text' && <div className="grid gap-2 sm:col-span-2">
               <div className="flex flex-wrap gap-4 text-sm">
                 <label className="inline-flex items-center gap-2"><input type="checkbox" checked={style.bold === true}
                   onChange={event => change({ bold:event.target.checked })} />Bold</label>
                 <label className="inline-flex items-center gap-2"><input type="checkbox" checked={style.italic === true}
                   onChange={event => change({ italic:event.target.checked })} />Italic</label>
               </div>
               <label className="grid gap-1 text-sm">Alignment
                 <Select value={style.align ?? 'left'} onValueChange={align => change({ align: align as 'left'|'center'|'right' })}>
                   <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                     <SelectItem value="left">Left</SelectItem><SelectItem value="center">Center</SelectItem>
                     <SelectItem value="right">Right</SelectItem>
                   </SelectContent>
                 </Select>
               </label>
             </div>}
            {hasUnits && <>
              <div className="grid gap-1 text-sm">
                <label htmlFor="annotation-type-unit">{t('section2d.annotationStyles.unit')}</label>
                <Select value={style.unit ?? units[0]} onValueChange={unit => change({ unit: units.find(value => value === unit) })}>
                  <SelectTrigger id="annotation-type-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>{units.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <label className="grid gap-1 text-sm">{t('section2d.annotationStyles.precision')}
                <Input type="number" min={0} max={6} step={1} value={style.precision ?? ''} placeholder={kind === 'slope' ? '1' : '3'}
                  onChange={event => change({ precision: event.target.value ? event.target.valueAsNumber : undefined })} />
              </label>
            </>}
            {kind === 'grid' && <>
              {(['startSymbolId', 'endSymbolId'] as const).map(slot => <div key={slot} className="grid gap-1 text-sm">
                <label htmlFor={slot}>{t(slot === 'startSymbolId' ? 'section2d.annotationStyles.gridStart' : 'section2d.annotationStyles.gridEnd')}</label>
                <Select value={style[slot] === '' || (slot === 'startSymbolId' && !style[slot]) ? 'none' : style[slot] ?? 'original'}
                  onValueChange={id => change({ [slot]: id === 'original' ? undefined : id === 'none' ? '' : id })}>
                  <SelectTrigger id={slot}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('section2d.annotationStyles.none')}</SelectItem>
                    {slot === 'endSymbolId' && <SelectItem value="original">{t('section2d.annotationStyles.fromSymbol')}</SelectItem>}
                    {gridSymbols.map(symbol => <SelectItem key={symbol.id} value={symbol.id}>{symbol.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>)}
            </>}
            {kind === 'area' && <fieldset className="space-y-2 rounded-md border p-3 sm:col-span-2">
              <legend className="px-1 text-xs font-medium">Boundary</legend>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-xs">{t('drawingUnderlay.materials.lineType')}</span>
                  <Select value={style.boundaryPattern ?? 'inherit'} onValueChange={value =>
                    change({ boundaryPattern: AREA_BOUNDARY_PATTERNS.find(pattern => pattern === value) })}>
                    <SelectTrigger className="h-8 text-xs" aria-label={t('drawingUnderlay.materials.lineType')}><SelectValue /></SelectTrigger>
                    <SelectContent>{(['inherit', ...AREA_BOUNDARY_PATTERNS] as const).map(pattern =>
                      <SelectItem key={pattern} value={pattern}>{t(`drawingUnderlay.materials.lineType.${pattern}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className="text-xs">{t('section2d.markerStyles.lineWeight')}</span>
                  <Select value={style.weight ?? 'default'} onValueChange={value =>
                    change({ weight: LINEWEIGHT_PRESETS.find(weight => weight === value) })}>
                    <SelectTrigger className="h-8 text-xs" aria-label={t('section2d.markerStyles.lineWeight')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">{t('section2d.markerStyles.default')}</SelectItem>
                      {LINEWEIGHT_PRESETS.map(weight => <SelectItem key={weight} value={weight}>{t(`drawingUnderlay.lineweights.preset.${weight}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex items-center justify-between gap-2 text-xs">
                {t('section2d.markerStyles.lineColor')}
                <Input type="color" className="h-8 w-9 shrink-0 cursor-pointer p-1" value={style.color ?? '#2196f3'}
                  onChange={event => change({ color: event.target.value })} />
              </label>
            </fieldset>}
            {kind === 'area' && <fieldset className="space-y-2 rounded-md border p-3 sm:col-span-2">
              <legend className="px-1 text-xs font-medium">Fill</legend>
              {(['background', 'foreground'] as const).map(side => <DrawingFillControl key={side}
                background={side === 'background'} label={t(`drawingUnderlay.materials.${side}`)}
                paint={style.areaFill?.[side]}
                onChange={paint => change({ areaFill: { ...style.areaFill, [side]: paint } })} />)}
            </fieldset>}
            {(kind === 'grid' || kind === 'cloud') && <>
              <div className="grid gap-1 text-sm">
                <label htmlFor="annotation-grid-weight">{t('section2d.annotationStyles.weight')}</label>
                <Select value={style.weight ?? (kind === 'cloud' ? 'medium' : 'default')} onValueChange={weight => change({ weight: LINEWEIGHT_PRESETS.find(value => weight === value) })}>
                  <SelectTrigger id="annotation-grid-weight"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {kind !== 'cloud' && <SelectItem value="default">{t('section2d.markerStyles.default')}</SelectItem>}
                    {LINEWEIGHT_PRESETS.map(weight => <SelectItem key={weight} value={weight}>{t(`section2d.annotationStyles.weight.${weight}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>}
            {(kind === 'grid' || kind === 'text' || kind === 'cloud') &&
              <label className="grid gap-1 text-sm">{t('section2d.annotationStyles.color')}
                <Input type="color" className="w-16" value={style.color ?? (kind === 'cloud' ? '#e53935' : '#000000')}
                  onChange={event => change({ color: event.target.value })} />
              </label>}
          </form>
          {failed && <p className="text-xs text-destructive" role="alert">{t('section2d.annotationStyles.saveError')}</p>}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setKind(undefined)}>{t('section2d.create.cancel')}</Button>
          <Button type="submit" form="drawing-annotation-type">{t('section2d.views.save')}</Button>
        </DialogFooter>
      </DialogContent>}
    </Dialog>
  </>;
}
