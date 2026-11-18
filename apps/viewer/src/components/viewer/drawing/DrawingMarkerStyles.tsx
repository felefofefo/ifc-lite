/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { LINEWEIGHT_PRESETS, type LineweightRow } from '@/lib/drawing/lineweight-table';
import { markerLineDash, markerLineWidth, markerTraceLines } from '@/lib/drawing/view-markers';
import { DEFAULT_MARKER_END_LENGTH, DEFAULT_MARKER_LINE, MARKER_LINE_TYPES, type MarkerLineStyle, defaultMarkerStyleId, resolveMarkerHeads, symbolUse, type MarkerStyle } from '@/lib/drawing/drawing-tag-library';
import { saveDrawingTagLibrary, useSavedSectionCuts } from '@/store/savedSectionCutsStore';

const NEW = 'new';
const DEFAULT = 'default';
const NO_SYMBOL = 'none';

export function DrawingMarkerStyles({ kind, lineweights }: { kind: MarkerStyle['kind']; lineweights: LineweightRow }) {
  const { t } = useTranslation();
  const projectId = useSavedSectionCuts(s => s.projectId);
  const library = useSavedSectionCuts(s => s.tagLibrary);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  function setDefault(kind: MarkerStyle['kind'], value: string) {
    if (!projectId) return;
    const latest = useSavedSectionCuts.getState().tagLibrary;
    if (value !== DEFAULT && !latest.markerStyles?.some(style => style.id === value && style.kind === kind)) return;
    try {
      saveDrawingTagLibrary(projectId, {
        ...latest, defaultMarkerStyles: { ...latest.defaultMarkerStyles, [kind]: value === DEFAULT ? undefined : value },
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  return <section className="space-y-2 border-t p-3 text-xs">
    <h3 className="font-medium">{t(`section2d.annotationKind.${kind}`)}</h3>
      <div className="grid gap-1">
        <label htmlFor={`marker-default-${kind}`}>{t('section2d.annotationStyles.defaultNew')}</label>
        <Select value={defaultMarkerStyleId(library, kind) ?? DEFAULT} disabled={!projectId}
          onValueChange={value => setDefault(kind, value)}>
          <SelectTrigger id={`marker-default-${kind}`} className="h-8 min-w-0 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>{t('section2d.markerStyles.default')}</SelectItem>
            {library.markerStyles?.filter(style => style.kind === kind).map(style => (
              <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    {failed && <p role="alert" className="text-destructive">{t('section2d.markerStyles.saveFailed')}</p>}
    <Button variant="outline" size="sm" disabled={!projectId} onClick={() => setOpen(true)}>
      {t('section2d.dimensionStyle.manage')}
    </Button>
    {open && projectId && <MarkerStyleDialog key={projectId} kind={kind} projectId={projectId} lineweights={lineweights} close={() => setOpen(false)} />}
  </section>;
}

function MarkerStyleDialog({ kind, projectId, close, lineweights }: { kind: MarkerStyle['kind']; projectId: string; lineweights: LineweightRow; close: () => void }) {
  const { t } = useTranslation();
  const { templates, markerStyles = [] } = useSavedSectionCuts(s => s.tagLibrary);
  const cuts = useSavedSectionCuts(s => s.cuts);
  const [id, setId] = useState(NEW);
  const [line, setLine] = useState(DEFAULT_MARKER_LINE);
  const [name, setName] = useState('');
  const [symbolId, setSymbolId] = useState('');
  const [startSymbolId, setStartSymbolId] = useState('');
  const [reversed, setReversed] = useState(false);
  const [failed, setFailed] = useState(false);
  const symbols = templates.filter(template => symbolUse(template) === kind);
  const inUse = cuts.some(view => view.markerStyleId === id || view.annotationOptions?.styleIds?.[kind] === id);
  const duplicateName = markerStyles.some(item => item.id !== id && item.kind === kind && item.name.toLowerCase() === name.trim().toLowerCase());
  const hasSymbol = symbols.some(item => item.id === symbolId || (kind === 'section' && item.id === startSymbolId));
  const canSave = !!name.trim() && !duplicateName && (kind === 'section' || hasSymbol);
  const sampleCode = kind === 'section' ? 'C-01' : 'E-01';
  const sampleName = t(`section2d.views.type.${kind}`);
  const angle = reversed ? 90 : -90;
  const heads = useMemo(() => resolveMarkerHeads(templates, { styleId: id, kind, name: sampleName, code: sampleCode },
    [{ id, kind, name: sampleName, symbolId, startSymbolId }], angle),
  [templates, id, symbolId, startSymbolId, kind, sampleName, sampleCode, angle]);

  function select(nextId: string) {
    const style = markerStyles.find(item => item.id === nextId);
    setId(nextId);
    setName(style?.name ?? '');
    setLine(style?.line ?? DEFAULT_MARKER_LINE);
    setSymbolId(style?.symbolId ?? '');
    setStartSymbolId(style?.startSymbolId ?? '');
    setFailed(false);
  }

  function save(remove = false) {
    const current = useSavedSectionCuts.getState();
    if (remove ? id === NEW || current.cuts.some(view => view.markerStyleId === id || view.annotationOptions?.styleIds?.[kind] === id) : !canSave) return;
    const nextId = id === NEW
      ? globalThis.crypto?.randomUUID?.() ?? 'marker-style-' + Date.now() + '-' + Math.random()
      : id;
    const styles = current.tagLibrary.markerStyles ?? [];
    const style = { id: nextId, name: name.trim(), kind, symbolId,
      startSymbolId: kind === 'section' ? startSymbolId || undefined : undefined,
      line: kind === 'section' ? line : undefined };
    const next = remove ? styles.filter(item => item.id !== id)
      : id === NEW ? [...styles, style] : styles.map(item => item.id === id ? style : item);
    try {
      const library = { ...current.tagLibrary, markerStyles: next };
      saveDrawingTagLibrary(projectId, { ...library, defaultMarkerStyles: {
        section: defaultMarkerStyleId(library, 'section'), elevation: defaultMarkerStyleId(library, 'elevation'),
      } });
      close();
    } catch {
      setFailed(true);
    }
  }

  return <Dialog open onOpenChange={value => { if (!value) close(); }}>
    <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{t(`section2d.annotationKind.${kind}`)}</DialogTitle>
        <DialogDescription>{t('section2d.markerStyles.description')}</DialogDescription>
      </DialogHeader>
      <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-2">
          <MarkerStylePreview heads={heads} kind={kind} code={sampleCode} angle={angle} line={kind === 'section' ? line : undefined} lineweights={lineweights} label={t('section2d.markerStyles.preview')} />
          <Button type="button" variant="outline" size="sm" aria-pressed={reversed} onClick={() => setReversed(value => !value)}>
            {t('section2d.markerStyles.flipPreview')}
          </Button>
        </div>
        <div className="grid gap-3 text-xs">
          <Select value={id} onValueChange={select}>
            <SelectTrigger aria-label={t('section2d.markerStyles.title')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW}>{t('section2d.markerStyles.new')}</SelectItem>
              {markerStyles.filter(style => style.kind === kind).map(style => <SelectItem key={style.id} value={style.id}>
                {style.name}
              </SelectItem>)}
            </SelectContent>
          </Select>
          <label className="grid gap-1">
            <span>{t('section2d.markerStyles.name')}</span>
            <Input value={name} maxLength={80} onChange={event => setName(event.currentTarget.value)} />
          </label>
          {duplicateName && <p role="alert" className="text-destructive">{t('section2d.markerStyles.duplicateName')}</p>}
          {(kind === 'section' ? [
            { key: 'start', label: t('section2d.markerStyles.startSymbol'), value: startSymbolId, set: setStartSymbolId },
            { key: 'end', label: t('section2d.markerStyles.endSymbol'), value: symbolId, set: setSymbolId },
          ] : [
            { key: 'center', label: t('section2d.markerStyles.centerSymbol'), value: symbolId, set: setSymbolId },
          ]).map(field => (
            <div key={field.key} className="grid gap-1">
              <label htmlFor={`marker-symbol-${field.key}`}>{field.label}</label>
              <Select value={field.value || NO_SYMBOL} onValueChange={value => field.set(value === NO_SYMBOL ? '' : value)}>
                <SelectTrigger id={`marker-symbol-${field.key}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SYMBOL}>{t('section2d.markerStyles.noSymbol')}</SelectItem>
                  {symbols.map(item => <SelectItem value={item.id} key={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
          {kind === 'section' && <fieldset className="grid grid-cols-2 gap-2 rounded-md border p-2">
            <legend className="px-1 font-medium">{t('section2d.markerStyles.cutLine')}</legend>
            <Select value={line.extent} onValueChange={extent => setLine({ ...line, extent: extent === 'ends' ? 'ends' : 'full' })}>
              <SelectTrigger aria-label={t('section2d.markerStyles.cutLine')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">{t('section2d.markerStyles.fullLine')}</SelectItem>
                <SelectItem value="ends">{t('section2d.markerStyles.endsOnly')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={line.pattern} onValueChange={value => {
              const pattern = MARKER_LINE_TYPES.find(item => item === value);
              if (pattern) setLine({ ...line, pattern });
            }}>
              <SelectTrigger aria-label={t('section2d.markerStyles.linePattern')}><SelectValue /></SelectTrigger>
              <SelectContent>{MARKER_LINE_TYPES.map(pattern => (
                <SelectItem key={pattern} value={pattern}>{t(`section2d.markerStyles.pattern.${pattern}`)}</SelectItem>
              ))}</SelectContent>
            </Select>
            <Select value={line.weight} onValueChange={value => {
              const weight = LINEWEIGHT_PRESETS.find(item => item === value);
              if (weight) setLine({ ...line, weight });
            }}>
              <SelectTrigger aria-label={t('section2d.markerStyles.lineWeight')}><SelectValue /></SelectTrigger>
              <SelectContent>{LINEWEIGHT_PRESETS.map(weight => (
                <SelectItem key={weight} value={weight}>{t(`drawingUnderlay.lineweights.preset.${weight}`)}</SelectItem>
              ))}</SelectContent>
            </Select>
            <Input type="color" value={line.color} className="h-9"
              aria-label={t('section2d.markerStyles.lineColor')}
              onChange={event => setLine({ ...line, color: event.currentTarget.value })} />
            {line.extent === 'ends' && (['startLength', 'endLength'] as const).map(key => (
              <label key={key} className="grid min-w-0 gap-1">
                <span>{t(`section2d.markerStyles.${key}`)}</span>
                <Input type="number" min={0} step="any" key={id} defaultValue={line[key] ?? DEFAULT_MARKER_END_LENGTH}
                  onChange={event => {
                    const value = event.currentTarget.valueAsNumber;
                    setLine(current => ({ ...current, [key]: Number.isFinite(value) && value >= 0 ? value : undefined }));
                  }}
                  onBlur={event => { event.currentTarget.value = String(line[key] ?? DEFAULT_MARKER_END_LENGTH); }} />
              </label>
            ))}
          </fieldset>}
          {kind === 'elevation' && !symbols.length && <p className="text-muted-foreground">{t('section2d.markerStyles.noSymbols')}</p>}
          {failed && <p role="alert" className="text-destructive">{t('section2d.markerStyles.saveFailed')}</p>}
        </div>
      </div>
      <DialogFooter>
        {id !== NEW && <Button type="button" variant="ghost" disabled={inUse}
          onClick={() => save(true)}>{t('section2d.markerStyles.delete')}</Button>}
        <Button type="button" variant="outline" onClick={close}>{t('section2d.create.cancel')}</Button>
        <Button type="button" disabled={!canSave} onClick={() => save()}>{t('section2d.views.save')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function MarkerStylePreview({ heads, kind, code, angle, label, line, lineweights }: {
  heads: ReturnType<typeof resolveMarkerHeads>; kind: MarkerStyle['kind']; code: string; angle: number; label: string;
  line?: MarkerLineStyle; lineweights: LineweightRow;
}) {
  const y = 27;
  const start = 23, end = 79, center = (start + end) / 2;
  const art = heads.map(({ slot, graphic }) => {
    const x = slot === 'start' ? start : slot === 'end' ? end : center;
    const scale = Math.min(29 / graphic.width, 24 / graphic.height);
    const radius = Math.hypot(Math.max(Math.abs(graphic.anchor.x), Math.abs(graphic.width - graphic.anchor.x)),
      Math.max(Math.abs(graphic.anchor.y), Math.abs(graphic.height - graphic.anchor.y))) * scale;
    return { slot, graphic, x, scale, radius };
  });
  const minX = Math.min(0, ...art.map(item => item.x - item.radius - 3));
  const maxX = Math.max(102, ...art.map(item => item.x + item.radius + 3));
  const radiusY = Math.max(27, ...art.map(item => item.radius + 3));
  return <svg viewBox={`${minX} ${y - radiusY} ${maxX - minX} ${2 * radiusY}`}
    role="img" aria-label={label}
    className="block h-36 w-full rounded-md border bg-paper text-paper-ink sm:h-48">
    {markerTraceLines({ start: { x: start, y }, end: { x: end, y } }, 2, line).map(([a, b], index) => (
      <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={line?.color ?? 'currentColor'}
        strokeWidth={markerLineWidth(line, lineweights) * 2}
        strokeDasharray={markerLineDash(line, kind).map(value => value * 2).join(' ') || undefined} />
    ))}
    {art.length ? art.map(({ slot, graphic, x, scale }) => (
      <image key={slot} href={graphic.href}
        transform={`translate(${x} ${y}) rotate(${graphic.directional ? 0 : angle})`}
        x={-graphic.anchor.x * scale} y={-graphic.anchor.y * scale}
        width={graphic.width * scale} height={graphic.height * scale} />
    )) : <>
      <path transform={`translate(${center} ${y}) rotate(${angle})`}
        d="M0 0H16m-5-3 5 3-5 3" stroke="currentColor" strokeWidth={0.75} fill="none" />
      <text x={center} y={y + (angle > 0 ? 22 : -20)} textAnchor="middle" fontSize={4} fill="currentColor">{code}</text>
    </>}
  </svg>;
}
