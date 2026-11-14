/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Quick access to saved views from the Section bar (#7545). */

import { useCallback, useState } from 'react';
import { Bookmark, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { useLiveTestId } from './SectionBarMeasure';
import { HudPopover, HudPopoverContent, HudPopoverTrigger } from '../../viewport-ui/hud';
import {
  applySavedSectionCut,
  removeSavedSectionCut,
  renameSavedSectionCut,
  useSavedSectionCuts,
} from '@/store/savedSectionCutsStore';

const ICON_BUTTON = 'rounded-sm p-1 text-muted-foreground hover:text-foreground';

export function SectionViewsMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const cuts = useSavedSectionCuts((s) => s.cuts);
  const activeCutId = useSavedSectionCuts((s) => s.activeCutId);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const triggerTestId = useLiveTestId('section-views');
  const focusOnMount = useCallback((el: HTMLInputElement | null) => el?.focus(), []);

  const commitRename = () => {
    if (renaming) renameSavedSectionCut(renaming.id, renaming.text);
    setRenaming(null);
  };

  return (
    <HudPopover open={open} onOpenChange={setOpen}>
      <HudPopoverTrigger asChild>
        <button
          type="button"
          title={t('sectionPlanes.views.title')}
          aria-label={t('sectionPlanes.views.label')}
          data-testid={triggerTestId}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent"
        >
          <Bookmark aria-hidden className="h-3.5 w-3.5" />
          {!compact && t('sectionPlanes.views.label')}
          <ChevronDown aria-hidden className="h-3 w-3 opacity-70" />
        </button>
      </HudPopoverTrigger>
      <HudPopoverContent align="end" side="bottom" className="w-64 space-y-1.5 p-2" data-testid="section-views-menu" aria-label={t('sectionPlanes.views.label')}>
        {cuts.length === 0 ? (
          <p className="px-1 text-2xs text-muted-foreground">{t('sectionPlanes.views.empty')}</p>
        ) : (
          <ul aria-label={t('sectionPlanes.views.listAria')} className="max-h-56 overflow-y-auto">
            {cuts.map((cut) => (
              <li key={cut.id} data-testid="section-view-row" className="flex items-center gap-1 rounded-sm px-0.5 hover:bg-accent">
                {renaming?.id === cut.id ? (
                  <input
                    ref={focusOnMount}
                    type="text"
                    value={renaming.text}
                    aria-label={t('sectionPlanes.views.renameAria')}
                    onChange={(e) => setRenaming({ id: cut.id, text: e.target.value })}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
                    onBlur={commitRename}
                    className="h-6 min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 text-xs text-foreground"
                  />
                ) : (
                  <button
                    type="button"
                    title={t('sectionPlanes.views.applyTitle', { count: cut.planes.length })}
                    aria-current={activeCutId === cut.id ? 'true' : undefined}
                    onClick={() => { applySavedSectionCut(cut.id); setOpen(false); }}
                    className={cn('min-w-0 flex-1 truncate rounded-sm px-1 py-1 text-left text-xs', activeCutId === cut.id && 'text-overlay-accent')}
                  >
                    {cut.name}
                    <span className="ml-1 text-2xs text-muted-foreground">{t('sectionPlanes.views.planeCount', { count: cut.planes.length })}</span>
                  </button>
                )}
                <button type="button" title={t('sectionPlanes.views.renameTitle')} aria-label={t('sectionPlanes.views.renameTitle')} onClick={() => setRenaming({ id: cut.id, text: cut.name })} className={ICON_BUTTON}>
                  <Pencil aria-hidden className="h-3 w-3" />
                </button>
                <button type="button" title={t('sectionPlanes.views.deleteTitle')} aria-label={t('sectionPlanes.views.deleteTitle')} onClick={() => removeSavedSectionCut(cut.id)} className={ICON_BUTTON}>
                  <Trash2 aria-hidden className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </HudPopoverContent>
    </HudPopover>
  );
}
