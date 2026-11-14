/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useRef, useState } from 'react';
import { Copy, Pencil, Trash2, Upload } from 'lucide-react';
import { DrawingPatternSwatch } from './DrawingPatternSwatch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDialogs } from '@/components/ui/confirm-dialog';
import { useTranslation } from '@/i18n';
import { useDrawingPatterns } from '@/hooks/useDrawingPatterns';
import { editPattern, mergeImportedPatterns, parsePat, patternRepeatScale, type ImportedPattern } from '@/lib/drawing/pattern-library';

export function DrawingPatterns() {
  const { t } = useTranslation();
  const { patterns, save } = useDrawingPatterns();
  const { confirmDialog } = useDialogs();
  const fileInput = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  const [editor, setEditor] = useState<{ pattern: ImportedPattern; duplicate: boolean }>();
  const [name, setName] = useState('');
  const [factor, setFactor] = useState('');
  const [invalid, setInvalid] = useState(false);
  function openEditor(pattern: ImportedPattern, duplicate: boolean) {
    setName(duplicate ? t('section2d.views.copyName', { name: pattern.name }).slice(0, 80) : pattern.name);
    setFactor(String(patternRepeatScale(pattern)));
    setInvalid(false);
    setEditor({ pattern, duplicate });
  }
  function apply(next: ImportedPattern[]) {
    save(next);
    setFailed(false);
  }
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-medium">{t('section2d.patterns.custom')}</h3>
      <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => fileInput.current?.click()}>
        <Upload className="h-3.5 w-3.5" />{t('section2d.patterns.import')}
      </Button>
      <input ref={fileInput} type="file" accept=".pat" hidden onChange={async e => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (!file) return;
        try {
          if (file.size > 256_000) throw new Error('PAT size limit.');
          apply(mergeImportedPatterns(patterns, parsePat(await file.text())));
        } catch (error) { console.warn('Could not import hatch patterns', error); setFailed(true); }
      }} />
    </div>
    {patterns.length ? <ul className="divide-y rounded-md border">
      {patterns.map(pattern => <li key={pattern.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
        <DrawingPatternSwatch pattern={pattern} />
        <div className="min-w-0 flex-1">
          <div title={pattern.name} className="truncate font-medium">{pattern.name}</div>
          <div className="tabular-nums text-muted-foreground">{`×${patternRepeatScale(pattern)}`}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="icon-xs" variant="ghost" title={t('section2d.patterns.edit')} aria-label={t('section2d.patterns.edit')} onClick={() => openEditor(pattern, false)}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="icon-xs" variant="ghost" title={t('section2d.patterns.duplicate')} aria-label={t('section2d.patterns.duplicate')} onClick={() => openEditor(pattern, true)}><Copy className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="icon-xs" variant="ghost" title={t('section2d.patterns.remove')} aria-label={t('section2d.patterns.remove')} onClick={async () => {
            if (!await confirmDialog({ description: t('section2d.patterns.confirmRemove', { name: pattern.name }), destructive: true })) return;
            try { apply(patterns.filter(p => p.id !== pattern.id)); } catch (error) { console.warn('Could not remove hatch pattern', error); setFailed(true); }
          }}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </li>)}
    </ul> : <p className="rounded-md border border-dashed p-3 text-muted-foreground">{t('section2d.patterns.empty')}</p>}
    {failed && <p role="alert" className="text-destructive">{t('section2d.patterns.error')}</p>}
    {editor && <Dialog open onOpenChange={open => { if (!open) setEditor(undefined); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{t(editor.duplicate ? 'section2d.patterns.duplicate' : 'section2d.patterns.edit')}</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={event => {
          event.preventDefault();
          try {
            apply(editPattern(patterns, editor.pattern.id, name, Number(factor.trim().replace(',', '.')), editor.duplicate));
            setEditor(undefined);
          } catch (error) { console.warn('Could not edit hatch pattern', error); setInvalid(true); }
        }}>
          <label className="block space-y-1 text-xs">{t('section2d.patterns.name')}<Input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
          <label className="block space-y-1 text-xs">{t('section2d.patterns.scale')}<Input value={factor} inputMode="decimal" onChange={e => setFactor(e.target.value)} /></label>
          {invalid && <p role="alert" className="text-xs text-destructive">{t('section2d.patterns.invalid')}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditor(undefined)}>{t('section2d.create.cancel')}</Button>
            <Button type="submit">{t('drawingUnderlay.lineweights.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>}
  </div>;
}
