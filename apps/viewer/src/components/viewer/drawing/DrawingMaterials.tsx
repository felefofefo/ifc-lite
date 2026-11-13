/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import type { useDrawingMaterials } from '@/hooks/useDrawingMaterials';
import { hasHatchPaint, materialNames, type MaterialHatchStyle } from '@/lib/drawing/material-hatches';
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
  const [saveError, setSaveError] = useState(false);
  const names = useMemo(() => {
    const stores = [...models.values()].flatMap((model) => model.ifcDataStore ? [model.ifcDataStore] : []);
    return materialNames(stores.length ? stores : legacyStore ? [legacyStore] : []);
  }, [models, legacyStore]);
  const visible = names.filter((name) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return (
    <div className="space-y-3">
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
                        <DrawingFillControl key={side} background={side === 'background'} label={t(`drawingUnderlay.materials.${side}`)} paint={paints?.[side]}
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
      {saveError && <p role="alert" className="text-sm text-destructive">{t('drawingUnderlay.materials.saveError')}</p>}
      <DialogFooter>
        <Button onClick={() => {
          try {
            settings.save(hatches);
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
