/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useState, type ReactNode } from 'react';
import { Copy, Ellipsis, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDialogs } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DrawingSettingSwitch } from './DrawingSettingSwitch';
import { useTranslation } from '@/i18n';
import type { useDrawingDimensionStyle } from '@/hooks/useDrawingDimensionStyle';
import { ARCHITECTURAL_DIMENSION_TYPE, DEFAULT_DIMENSION_STYLE, DIMENSION_SIZE_FIELDS, DIMENSION_TERMINATORS, DIMENSION_UNITS,
  DIMENSION_FONTS, applyDimensionSizeEdits, formatDimensionLabel, styledDimension, type DimensionSizeField, type NamedDimensionStyle } from '@/lib/drawing/dimension-style';
import { LINEWEIGHT_PRESETS, type LineweightRow } from '@/lib/drawing/lineweight-table';
import { formatDistance } from '../tools/formatDistance';

const SIZE_LABELS = {
  textMm: 'section2d.dimensionStyle.textSize',
  strokeMm: 'section2d.dimensionStyle.stroke',
  tickMm: 'section2d.dimensionStyle.markSize',
  labelGapMm: 'section2d.dimensionStyle.labelGap',
  extensionMm: 'section2d.dimensionStyle.extension',
} as const;

interface Props {
  settings: ReturnType<typeof useDrawingDimensionStyle>;
  unitOverrides: Record<string, string>;
  lineweights?: LineweightRow;
  selection?: { typeId?: string; assign: (id: string) => void };
  labelEdit?: { id: string; angle: number; hasOffset: boolean; rotate: (angle: number) => void; resetPosition: () => void };
}

export function DrawingDimensionStyles({ settings, unitOverrides, lineweights, selection, labelEdit }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [defaultSaveFailed, setDefaultSaveFailed] = useState(false);
  const types = settings.library.types;
  const selectedId = types.find(type => type.id === selection?.typeId)?.id ?? ARCHITECTURAL_DIMENSION_TYPE;

  return (
    <section className="space-y-3 border-t p-3">
      <h3 className="text-xs font-medium">{t('section2d.dimensionStyle.title')}</h3>
      <div className="space-y-1">
        <Label htmlFor="dimension-current-type" className="text-xs">
          {t(selection ? 'section2d.dimensionStyle.selectedType' : 'section2d.dimensionStyle.defaultType')}
        </Label>
        <Select value={selection ? selectedId : settings.library.defaultId} onValueChange={id => {
          if (selection) selection.assign(id);
          else {
            try {
              settings.save({ ...settings.library, defaultId: id });
              setDefaultSaveFailed(false);
            } catch (error) {
              console.warn('Could not save the default dimension type', error);
              setDefaultSaveFailed(true);
            }
          }
        }}>
          <SelectTrigger id="dimension-current-type" className="h-8 min-w-0 text-xs"><SelectValue /></SelectTrigger>
          <DimensionTypeOptions types={types} />
        </Select>
      </div>
      {defaultSaveFailed && <p role="alert" className="text-sm text-destructive">{t('section2d.dimensionStyle.saveFailed')}</p>}
      {labelEdit && <div className="space-y-2 rounded-md border p-2.5">
        <h4 className="text-xs font-medium">{t('section2d.dimensionStyle.selectedText')}</h4>
        <div className="flex items-center gap-2">
          <Label className="flex-1 text-xs" htmlFor="dimension-text-angle">{t('section2d.dimensionStyle.textAngle')}</Label>
          <Input key={`${labelEdit.id}:${labelEdit.angle}`} id="dimension-text-angle" className="h-8 w-20 text-right tabular-nums"
            type="number" step="any" defaultValue={labelEdit.angle} onBlur={event => {
              const angle = event.currentTarget.valueAsNumber;
              if (Number.isFinite(angle) && angle % 360 !== labelEdit.angle) labelEdit.rotate(angle % 360);
              else event.currentTarget.value = String(labelEdit.angle);
            }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          <Button type="button" size="icon-xs" variant="ghost" disabled={labelEdit.angle === 0}
            title={t('section2d.dimensionStyle.resetRotation')} aria-label={t('section2d.dimensionStyle.resetRotation')}
            onClick={() => labelEdit.rotate(0)}><RotateCcw className="size-3.5" /></Button>
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={!labelEdit.hasOffset} onClick={labelEdit.resetPosition}>
          {t('section2d.dimensionStyle.resetPosition')}
        </Button>
      </div>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">{t('section2d.dimensionStyle.manage')}</Button>
        </DialogTrigger>
        <DialogContent scrollBody className="gap-3 p-4 sm:max-w-3xl sm:p-6">
          <DialogHeader>
            <DialogTitle>{t('section2d.dimensionStyle.manage')}</DialogTitle>
            <DialogDescription>{t('section2d.dimensionStyle.description')}</DialogDescription>
          </DialogHeader>
          {open && <DimensionStyleForm key={settings.projectId} settings={settings}
            unitOverrides={unitOverrides} lineweights={lineweights} selection={selection} initialTypeId={selection ? selectedId : settings.library.defaultId}
            close={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DimensionTypeOptions({ types }: { types: NamedDimensionStyle[] }) {
  const { t } = useTranslation();
  return <SelectContent>{types.map(type => <SelectItem key={type.id} value={type.id}>
    {type.id === ARCHITECTURAL_DIMENSION_TYPE ? t('section2d.dimensionStyle.architectural') : type.name}
  </SelectItem>)}</SelectContent>;
}

function DimensionStyleForm({ settings, unitOverrides, lineweights, selection, initialTypeId, close }: Props & { initialTypeId: string; close: () => void }) {
  const { t } = useTranslation();
  const { confirmDialog, promptDialog } = useDialogs();
  const [invalidName, setInvalidName] = useState(false);
  const [editId, setEditId] = useState(initialTypeId);
  const current = settings.library.types.find(type => type.id === editId) ?? settings.library.types[0];
  const [draft, setDraft] = useState(current.style);
  const [duplicating, setDuplicating] = useState(false);
  const [copyName, setCopyName] = useState('');
  const [sizes, setSizes] = useState<Partial<Record<DimensionSizeField, string>>>({});
  const [saveFailed, setSaveFailed] = useState(false);
  const { style, invalid } = applyDimensionSizeEdits(draft, sizes);
  const changed = invalid.length > 0 || JSON.stringify(style) !== JSON.stringify(current.style);

  async function selectType(id: string) {
    const next = settings.library.types.find(type => type.id === id);
    if (!next || next.id === current.id) return;
    if ((changed || copyName.trim()) && !await confirmDialog({
      description: t('section2d.dimensionStyle.discardChanges'),
      confirmLabel: t('section2d.dimensionStyle.discard'),
    })) return;
    setEditId(next.id);
    setInvalidName(false);
    setDraft(next.style);
    setSizes({});
    setCopyName('');
    setDuplicating(false);
    setSaveFailed(false);
  }

  const preview = styledDimension({ x: 14, y: 25 }, { x: 86, y: 25 }, [{ x: 14, y: 39 }, { x: 86, y: 39 }], style, 1, undefined, lineweights);
  const ink = style.lineColor ?? 'currentColor';
  const label = formatDimensionLabel(3.4, style, (distance, precision, showUnit) =>
    formatDistance(distance, unitOverrides, precision, showUnit));
  const name = copyName.trim();
  const duplicateName = !!name && settings.library.types.some(type =>
    (type.id === ARCHITECTURAL_DIMENSION_TYPE ? t('section2d.dimensionStyle.architectural') : type.name).toLowerCase() === name.toLowerCase());
  const canSave = invalid.length === 0 && (duplicating ? !!name && !duplicateName : changed);

  function save() {
    if (!canSave) return;
    try {
      if (duplicating) {
        const id = globalThis.crypto?.randomUUID?.() ?? `type-${Date.now()}-${Math.random()}`;
        settings.save({ ...settings.library, types: [...settings.library.types, { id, name, style }] });
        selection?.assign(id);
      } else {
        settings.save({ ...settings.library, types: settings.library.types.map(type =>
          type.id === current.id ? { ...type, style } : type) });
      }
      close();
    } catch (error) {
      console.warn('Could not save the dimension style', error);
      setSaveFailed(true);
    }
  }

  async function renameType() {
    if (current.id === ARCHITECTURAL_DIMENSION_TYPE) return;
    setInvalidName(false);
    const next = (await promptDialog({
      title: t('section2d.dimensionStyle.renameType'),
      description: t('section2d.dimensionStyle.copyName'),
      defaultValue: current.name,
    }))?.trim();
    if (next === undefined || next === current.name) return;
    const taken = settings.library.types.some(type => type.id !== current.id &&
      (type.id === ARCHITECTURAL_DIMENSION_TYPE
        ? t('section2d.dimensionStyle.architectural') : type.name).toLowerCase() === next.toLowerCase());
    if (!next || next.length > 80 || taken) {
      setInvalidName(true);
      return;
    }
    try {
      settings.save({ ...settings.library, types: settings.library.types.map(type =>
        type.id === current.id ? { ...type, name: next } : type) });
      setSaveFailed(false);
    } catch (error) {
      console.warn('Could not rename dimension type', error);
      setSaveFailed(true);
    }
  }

  async function deleteType() {
    if (current.id === ARCHITECTURAL_DIMENSION_TYPE || !await confirmDialog({
      title: t('section2d.dimensionStyle.deleteType'),
      description: t('section2d.dimensionStyle.deleteTypeDescription', { name: current.name }),
      confirmLabel: t('section2d.dimensionStyle.deleteType'),
      destructive: true,
    })) return;
    try {
      settings.save({
        types: settings.library.types.filter(type => type.id !== current.id),
        defaultId: settings.library.defaultId === current.id
          ? ARCHITECTURAL_DIMENSION_TYPE : settings.library.defaultId,
      });
      close();
    } catch (error) {
      console.warn('Could not delete dimension type', error);
      setSaveFailed(true);
    }
  }

  const sizeField = (field: DimensionSizeField) => (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs" htmlFor={`dimension-${field}`}>{t(SIZE_LABELS[field])}</Label>
      <Input id={`dimension-${field}`} className="h-8 tabular-nums" required type="number" {...DIMENSION_SIZE_FIELDS[field]}
        value={sizes[field] ?? draft[field]} aria-invalid={invalid.includes(field)}
        onChange={event => setSizes(sizes => ({ ...sizes, [field]: event.target.value }))} />
    </div>
  );
  const markLabels = {
    tick: 'section2d.dimensionStyle.tick', arrow: 'section2d.dimensionStyle.arrow',
    filledArrow: 'section2d.dimensionStyle.filledArrow', dot: 'section2d.dimensionStyle.dot',
    circle: 'section2d.dimensionStyle.circle', bar: 'section2d.dimensionStyle.bar', none: 'section2d.dimensionStyle.noMark',
  } as const;
  const markField = (field: 'startTerminator' | 'endTerminator') => (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs" htmlFor={field}>
        {t(field === 'startTerminator' ? 'section2d.dimensionStyle.startMark' : 'section2d.dimensionStyle.endMark')}
      </Label>
      <Select value={draft[field]} onValueChange={value => {
        const mark = DIMENSION_TERMINATORS.find(mark => mark === value);
        if (mark) setDraft({ ...draft, [field]: mark });
      }}>
        <SelectTrigger id={field} className="h-8"><SelectValue /></SelectTrigger>
        <SelectContent>{DIMENSION_TERMINATORS.map(mark => <SelectItem key={mark} value={mark}>{t(markLabels[mark])}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
  const colorField = (field: 'lineColor' | 'textColor') => {
    const name = t(field === 'lineColor' ? 'section2d.dimensionStyle.lineColor' : 'section2d.dimensionStyle.textColor');
    return (
      <div className="col-span-full flex items-center justify-between gap-2">
        <Label className="text-xs" htmlFor={field}>{name}</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">{draft[field] ?? t('section2d.dimensionStyle.automatic')}</span>
          <Input id={field} className="h-8 w-9 shrink-0 cursor-pointer p-1" type="color"
            value={draft[field] ?? '#000000'} onChange={event => setDraft({ ...draft, [field]: event.target.value })} />
          <Button type="button" size="icon-xs" variant="ghost" disabled={!draft[field]}
            title={t('section2d.dimensionStyle.resetColor', { label: name })}
            aria-label={t('section2d.dimensionStyle.resetColor', { label: name })}
            onClick={() => setDraft({ ...draft, [field]: null })}><RotateCcw className="size-3.5" /></Button>
        </div>
      </div>
    );
  };

  return (
    <form className="flex min-h-0 flex-1 flex-col gap-3" onSubmit={event => { event.preventDefault(); save(); }}>
      <div className="flex shrink-0 items-center gap-2">
        <Select value={current.id} onValueChange={selectType}>
          <SelectTrigger className="min-w-0 flex-1" aria-label={t('section2d.dimensionStyle.type')}><SelectValue /></SelectTrigger>
          <DimensionTypeOptions types={settings.library.types} />
        </Select>
        <Button type="button" size="sm" variant="outline" aria-expanded={duplicating}
          onClick={() => { setDuplicating(!duplicating); setCopyName(''); }}>
          <Copy className="size-3.5" />{t('section2d.dimensionStyle.duplicateAction')}
        </Button>
        {current.id !== ARCHITECTURAL_DIMENSION_TYPE && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon-xs" variant="outline" disabled={duplicating}
              aria-label={t('section2d.dimensionStyle.typeActions')}>
              <Ellipsis className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void renameType()}>
              <Pencil className="size-4" />{t('section2d.dimensionStyle.renameType')}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onSelect={() => void deleteType()}>
              <Trash2 className="size-4" />{t('section2d.dimensionStyle.deleteType')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      {duplicating && <div className="shrink-0 space-y-1.5 rounded-md border bg-muted/40 p-2.5">
        <Label className="text-xs" htmlFor="dimension-copy-name">{t('section2d.dimensionStyle.copyName')}</Label>
        <Input id="dimension-copy-name" className="h-8" required maxLength={80} value={copyName} aria-invalid={duplicateName}
          onChange={event => setCopyName(event.target.value)} />
        {duplicateName && <p className="text-xs text-destructive">{t('section2d.dimensionStyle.duplicateName')}</p>}
      </div>}
      {invalidName && <p role="alert" className="text-xs text-destructive">
        {t('section2d.dimensionStyle.invalidTypeName')}
      </p>}
      <DialogBody>
        <div className="grid items-start gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {preview && <svg viewBox="0 0 100 48" className="block h-36 w-full rounded-md border bg-paper text-paper-ink md:sticky md:top-0 md:h-48"
            role="img" aria-label={t('section2d.dimensionStyle.preview')}>
            <g stroke={ink} strokeWidth={preview.lineWidth}>
              {preview.strokes.map(([from, to], i) => <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />)}
              {preview.circles.map(({ center, radius, filled }, i) =>
                <circle key={i} cx={center.x} cy={center.y} r={radius} stroke={filled ? 'none' : ink} fill={filled ? ink : 'none'} />)}
              {preview.triangles.map((triangle, i) =>
                <polygon key={i} points={triangle.map(point => `${point.x},${point.y}`).join(' ')} stroke="none" fill={ink} />)}
            </g>
            <text x={preview.label.x} y={preview.label.y} textAnchor="middle" dominantBaseline="middle"
              fontFamily={DIMENSION_FONTS[style.fontFamily]} fontSize={preview.textSize} fill={style.textColor ?? 'currentColor'}>{label}</text>
          </svg>}
          <div className="min-w-0 space-y-3">
            <StyleGroup title={t('section2d.dimensionStyle.linesGroup')}>
              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs" htmlFor="dimension-weight">{t('section2d.dimensionStyle.stroke')}</Label>
                <Select value={draft.lineweight ?? 'light'} onValueChange={value => {
                  const lineweight = LINEWEIGHT_PRESETS.find(preset => preset === value);
                  if (lineweight) setDraft({ ...draft, lineweight });
                }}>
                  <SelectTrigger id="dimension-weight" className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>{LINEWEIGHT_PRESETS.map(preset => (
                    <SelectItem key={preset} value={preset}>{t(`drawingUnderlay.lineweights.preset.${preset}`)}</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>{sizeField('extensionMm')}
              {markField('startTerminator')}{markField('endTerminator')}
              {sizeField('tickMm')}{colorField('lineColor')}
            </StyleGroup>
            <StyleGroup title={t('section2d.dimensionStyle.textGroup')}>
              {sizeField('textMm')}{sizeField('labelGapMm')}{colorField('textColor')}
              <div className="col-span-full space-y-1.5">
                <Label className="text-xs" htmlFor="dimension-font">{t('section2d.dimensionStyle.font')}</Label>
                <Select value={draft.fontFamily} onValueChange={value => {
                  if (Object.hasOwn(DIMENSION_FONTS, value)) {
                    setDraft({ ...draft, fontFamily: value as keyof typeof DIMENSION_FONTS });
                  }
                }}>
                  <SelectTrigger id="dimension-font" className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.keys(DIMENSION_FONTS).map(font =>
                    <SelectItem key={font} value={font}>{font}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </StyleGroup>
            <StyleGroup title={t('section2d.dimensionStyle.unit')}>
              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs" htmlFor="dimension-unit">{t('section2d.dimensionStyle.unit')}</Label>
                <Select value={draft.unit} onValueChange={value => {
                  const unit = DIMENSION_UNITS.find(unit => unit === value);
                  if (unit) setDraft({ ...draft, unit });
                }}>
                  <SelectTrigger id="dimension-unit" className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>{DIMENSION_UNITS.map(unit => <SelectItem key={unit} value={unit}>
                    {unit === 'project' ? t('section2d.dimensionStyle.projectUnit') : unit}
                  </SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs" htmlFor="dimension-precision">{t('section2d.dimensionStyle.precision')}</Label>
                <Select value={draft.decimalPlaces === null ? 'automatic' : String(draft.decimalPlaces)}
                  onValueChange={value => setDraft({ ...draft, decimalPlaces: value === 'automatic' ? null : Number(value) })}>
                  <SelectTrigger id="dimension-precision" className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">{t('section2d.dimensionStyle.automatic')}</SelectItem>
                    {[0, 1, 2, 3, 4, 5, 6].map(digits => <SelectItem key={digits} value={String(digits)}>{digits}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-full">
                <DrawingSettingSwitch label={t('section2d.dimensionStyle.showUnit')} checked={draft.showUnit}
                  onCheckedChange={showUnit => setDraft({ ...draft, showUnit })} />
              </div>
            </StyleGroup>
          </div>
        </div>
      </DialogBody>
      {saveFailed && <p role="alert" className="text-sm text-destructive">{t('section2d.dimensionStyle.saveFailed')}</p>}
      <DialogFooter className="shrink-0 gap-2 border-t pt-3 sm:space-x-0">
        <Button type="button" size="sm" variant="ghost" className="sm:mr-auto"
          onClick={() => { setDraft(DEFAULT_DIMENSION_STYLE); setSizes({}); }}>
          {t('section2d.dimensionStyle.reset')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={close}>{t('section2d.create.cancel')}</Button>
        <Button type="submit" size="sm" disabled={!canSave}>
          {t(duplicating ? 'section2d.dimensionStyle.duplicate' : 'section2d.dimensionStyle.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function StyleGroup({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="min-w-0 rounded-md border p-3">
    <legend className="sr-only">{title}</legend>
    <div aria-hidden="true" className="mb-2 text-xs font-medium">{title}</div>
    <div className="grid grid-cols-2 items-start gap-2.5">{children}</div>
  </fieldset>;
}
