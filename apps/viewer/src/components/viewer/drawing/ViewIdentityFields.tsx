/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { formatScaleFactorLabel } from '@ifc-lite/drawing-2d';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { drawingLineweightScales, type LineweightTable } from '@/lib/drawing/lineweight-table';
import { useTranslation } from '@/i18n';
import { isViewCodeAvailable, nextViewCode } from '@/lib/drawing/view-markers';
import { renameSavedSectionCut, savedViewKind, useSavedSectionCuts } from '@/store/savedSectionCutsStore';

export function ViewIdentityDialog({ name: initialName, code: initialCode, id, close, save, scale }: {
  name: string; code: string; id?: string; close: () => void; save: (name: string, code: string, scale?: number) => void; scale?: { value: number; table: LineweightTable };
}) {
  const { t } = useTranslation();
  const cuts = useSavedSectionCuts(s => s.cuts);
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [factor, setFactor] = useState(scale?.value);
  const [failed, setFailed] = useState(false);
  const valid = isViewCodeAvailable(code, cuts, id);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{t('section2d.views.identity')}</DialogTitle></DialogHeader>
      <form className="space-y-3" onSubmit={e => {
        e.preventDefault();
        if (!valid || !name.trim()) return;
        try { save(name.trim(), code.trim(), factor); close(); } catch { setFailed(true); }
      }}>
        <label className="block space-y-1 text-sm">{t('section2d.views.name')}
          <Input value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">{t('section2d.views.code')}
          <Input value={code} maxLength={24} onChange={e => setCode(e.target.value)} />
        </label>
        {scale && factor !== undefined && <ViewScaleSelect value={factor} table={scale.table} onChange={entry => setFactor(entry.factor)} />}
        {!valid && <p className="text-sm text-destructive">{t('section2d.views.codeConflict')}</p>}
        {failed && <p role="alert" className="text-sm text-destructive">{t('section2d.views.saveError')}</p>}
        <DialogFooter><Button type="submit" disabled={!valid || !name.trim()}>{t('section2d.views.save')}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function RenameViewIdentityDialog({ id, close }: { id: string; close: () => void }) {
  const views = useSavedSectionCuts(s => s.cuts);
  const view = views.find(candidate => candidate.id === id);
  if (!view) return null;
  return <ViewIdentityDialog
    id={id}
    name={view.name}
    code={view.code ?? nextViewCode(savedViewKind(view), views)}
    close={close}
    save={(name, code) => renameSavedSectionCut(id, name, code)}
  />;
}

export function ViewScaleSelect({ value, table, onChange }: {
  value: number; table: LineweightTable;
  onChange: (scale: ReturnType<typeof drawingLineweightScales>[number]) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const [custom, setCustom] = useState<string | null>(null);
  const factor = custom?.trim() ? Number(custom.trim().replace(',', '.')) : NaN;
  const valid = Number.isFinite(factor) && factor > 0;
  function applyCustom() {
    if (!valid) return;
    onChange({ factor, name: `1:${formatScaleFactorLabel(factor)}`, useCase: '' });
    setCustom(null);
  }
  const scales = drawingLineweightScales(table, value, []);
  const label = t('drawingUnderlay.lineweights.publicationScale');
  return <div className="grid gap-1 text-sm">
    <span>{label}</span>
    <Select value={custom === null ? String(value) : 'custom'} onValueChange={factor => {
      if (factor === 'custom') { setCustom(String(value)); return; }
      setCustom(null);
      const scale = scales.find(entry => String(entry.factor) === factor);
      if (scale) onChange(scale);
    }}>
      <SelectTrigger aria-label={label} className="[&>svg]:text-foreground [&>svg]:opacity-100"><SelectValue /></SelectTrigger>
      <SelectContent>
        {scales.map(({ factor, name }) => <SelectItem key={factor} value={String(factor)}>{name}</SelectItem>)}
        <SelectItem value="custom">{t('section2d.scale.custom')}</SelectItem>
      </SelectContent>
    </Select>
    {custom !== null && <div className="space-y-1">
      <label htmlFor={inputId} className="text-xs">{t('section2d.scale.factor')}</label>
      <div className="flex gap-1">
        <Input id={inputId} inputMode="decimal" value={custom} maxLength={24} onChange={event => setCustom(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); applyCustom(); }
          }} />
        <Button type="button" size="sm" disabled={!valid} onClick={applyCustom}>{t('section2d.views.save')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setCustom(null)}>{t('section2d.create.cancel')}</Button>
      </div>
    </div>}
  </div>;
}
