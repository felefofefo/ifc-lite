/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState } from 'react';
import { Layers, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { useDrawingPatterns } from '@/hooks/useDrawingPatterns';
import { materialSettingsFile, readMaterialSettingsFile } from '@/lib/drawing/publication-settings-file';
import type { useDrawingMaterials } from '@/hooks/useDrawingMaterials';
import { hasHatchPaint, materialNames, reassignMaterialHatches, type MaterialHatchStyle } from '@/lib/drawing/material-hatches';
import { DrawingSettingsTransfer } from './DrawingSettingsTransfer';
import { DrawingFillControl } from './DrawingHatchSelect';

type MaterialSettings = ReturnType<typeof useDrawingMaterials>;

export function DrawingMaterials({ settings, compact }: { settings: MaterialSettings; compact?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon-xs' : 'sm'}
          className={compact ? undefined : 'h-7 px-2 text-xs'} aria-label={t('drawingUnderlay.materials.button')}>
          {compact ? <Layers className="h-3.5 w-3.5" /> : t('drawingUnderlay.materials.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('drawingUnderlay.materials.title')}</DialogTitle>
          <DialogDescription>{t('drawingUnderlay.materials.description')}</DialogDescription>
        </DialogHeader>
        {open && <MaterialHatchesEditor key={settings.projectId ?? 'session'} settings={settings} close={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function MaterialHatchesEditor({ settings, close }: { settings: MaterialSettings; close: () => void }) {
  const { t } = useTranslation();
  const models = useViewerStore((state) => state.models);
  const legacyStore = useViewerStore((state) => state.ifcDataStore);
  const [search, setSearch] = useState('');
  const [face, setFace] = useState<'cut' | 'surface'>('cut');
  const [hatches, setHatches] = useState(settings.hatches);
  const [joinUnassigned, setJoinUnassigned] = useState(settings.joinUnassigned);
  const patternLibrary = useDrawingPatterns();
  const [importedPatterns, setImportedPatterns] = useState<typeof patternLibrary.patterns>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const patterns = [...new Map([...patternLibrary.patterns, ...importedPatterns].map(pattern => [pattern.id, pattern])).values()];
  const [saveError, setSaveError] = useState(false);
  const names = useMemo(() => {
    const stores = [...models.values()].flatMap((model) => model.ifcDataStore ? [model.ifcDataStore] : []);
    return materialNames(stores.length ? stores : legacyStore ? [legacyStore] : []);
  }, [models, legacyStore]);
  const matches = (name: string) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const visible = names.filter(matches);
  const existing = new Set(names);
  const missing = Object.keys(hatches).filter(name => !existing.has(name) && matches(name)).sort();
  return (
    <div className="space-y-3">
      <DrawingSettingsTransfer filename="ifc-lite-materials.json" getData={() => materialSettingsFile(hatches, patterns, joinUnassigned)}
        onImport={raw => {
          const incoming = readMaterialSettingsFile(raw);
          setHatches(current => ({ ...current, ...incoming.materials }));
          if (incoming.joinUnassigned !== undefined) setJoinUnassigned(incoming.joinUnassigned);
          setImportedPatterns(current => [...new Map([...current, ...incoming.patterns].map(pattern => [pattern.id, pattern])).values()]);
        }} />
      <Checkbox checked={joinUnassigned} onCheckedChange={setJoinUnassigned}
        label={t('drawingUnderlay.materials.joinUnassigned')} />
      <Tabs value={face} onValueChange={(value) => setFace(value === 'surface' ? 'surface' : 'cut')}>
        <TabsList aria-label={t('drawingUnderlay.materials.title')}>
          <TabsTrigger value="cut">{t('drawingUnderlay.materials.cut')}</TabsTrigger>
          <TabsTrigger value="surface">{t('drawingUnderlay.materials.surface')}</TabsTrigger>
        </TabsList>
        <TabsContent value={face} className="space-y-3">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} type="search"
            placeholder={t('drawingUnderlay.materials.search')} aria-label={t('drawingUnderlay.materials.search')} />
          {visible.length ? (
            <div className="max-h-[50vh] divide-y overflow-auto rounded-md border">
              {visible.map((name) => {
                const style = Object.hasOwn(hatches, name) ? hatches[name] : undefined;
                const paints = face === 'surface' ? style?.surface : style;
                return (
                  <div key={name} className="space-y-2 px-3 py-2">
                    <div className="break-words text-sm">{name}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(['background', 'foreground'] as const).map((side) => (
                        <DrawingFillControl key={side} background={side === 'background'} label={t(`drawingUnderlay.materials.${side}`)} paint={paints?.[side]} patterns={patterns}
                          onChange={(paint) => setHatches((current) => {
                            const next = { ...current };
                            const prior = Object.hasOwn(current, name) ? current[name] : undefined;
                            const sidePaint = paint.pattern || paint.color ? paint : undefined;
                            const surface = { ...prior?.surface, [side]: sidePaint };
                            const value: MaterialHatchStyle = face === 'surface'
                              ? { ...prior, surface: hasHatchPaint(surface) ? surface : undefined }
                              : { ...prior, [side]: sidePaint };
                            if (value.foreground || value.background || value.surface) next[name] = value;
                            else delete next[name];
                            return next;
                          })} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="py-3 text-sm text-muted-foreground">{t(names.length ? 'drawingUnderlay.materials.noResults' : 'drawingUnderlay.materials.empty')}</p>}
        </TabsContent>
      </Tabs>
      {missing.length > 0 && <ul className="divide-y rounded-md border">
        {missing.map(name => {
          const target = Object.hasOwn(targets, name) ? targets[name] : '';
          return <li key={name} className="space-y-2 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 break-words text-sm">{name}</span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t('drawingUnderlay.materials.missing')}</span>
              <Button type="button" variant="ghost" size="icon-xs" title={t('drawingUnderlay.materials.deleteMissing')}
                aria-label={t('drawingUnderlay.materials.deleteMissing')} onClick={() => setHatches(current => reassignMaterialHatches(current, name))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {names.length > 0 && <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Select value={target} onValueChange={value => setTargets(current => ({ ...current, [name]: value }))}>
                <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label={t('drawingUnderlay.materials.reassign')}>
                  <SelectValue placeholder={t('drawingUnderlay.materials.reassign')} />
                </SelectTrigger>
                <SelectContent className="max-w-[min(26rem,85vw)]">
                  {names.map(material => <SelectItem key={material} value={material}>{material}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" variant="outline" disabled={!existing.has(target)}
                onClick={() => setHatches(current => reassignMaterialHatches(current, name, target))}>
                {t('drawingUnderlay.materials.reassignConfirm')}
              </Button>
            </div>}
          </li>;
        })}
      </ul>}
      {saveError && <p role="alert" className="text-sm text-destructive">{t('drawingUnderlay.materials.saveError')}</p>}
      <DialogFooter>
        <Button onClick={() => {
          try {
            if (importedPatterns.length) patternLibrary.save(patterns);
            settings.save(hatches, joinUnassigned);
            close();
          } catch (error) {
            console.warn('Could not save drawing material hatches', error);
            setSaveError(true);
          }
        }}>{t('drawingUnderlay.lineweights.save')}</Button>
      </DialogFooter>
    </div>
  );
}
