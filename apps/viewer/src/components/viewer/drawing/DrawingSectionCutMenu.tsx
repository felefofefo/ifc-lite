/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useState } from 'react';
import { ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RenameViewIdentityDialog } from './ViewIdentityFields';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/i18n';
import {
  applySavedSectionCut,
  removeSavedSectionCut,
  useSavedSectionCuts,
} from '@/store/savedSectionCutsStore';

export interface DrawingSectionCutMenuProps {
  /** The live cut's label, exactly as the header already formats it. */
  cutLabel: string;
  /** Visible trigger text when it should say more than `cutLabel` ("Cut plane: …"). */
  displayLabel?: string;
}

export function DrawingSectionCutMenu({ cutLabel, displayLabel }: DrawingSectionCutMenuProps) {
  const { t } = useTranslation();
  const cuts = useSavedSectionCuts((s) => s.cuts);
  const activeCutId = useSavedSectionCuts((s) => s.activeCutId);

  const [open, setOpen] = useState(false);
  const [renameId, setRenameId] = useState<string>();

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost" size="sm" className="h-6 min-w-0 gap-1 px-1.5 text-xs font-medium text-foreground tabular-nums"
            aria-label={t('section2d.savedCuts.menuLabel', { label: cutLabel })}
          >
            <span className="truncate">{displayLabel ?? cutLabel}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64"
          onCloseAutoFocus={event => { if (renameId) event.preventDefault(); }}>
          <DropdownMenuLabel className="text-xs">{t('section2d.savedCuts.savedGroup')}</DropdownMenuLabel>
          {cuts.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('section2d.savedCuts.empty')}</div>
          )}
          {cuts.map((cut) => (
            <div
              key={cut.id}
              data-testid="saved-section-cut-row"
              className="flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-accent"
            >
              <button
                type="button"
                title={t('section2d.savedCuts.applyTitle')}
                aria-current={activeCutId === cut.id ? 'true' : undefined}
                onClick={() => applySavedSectionCut(cut.id)}
                className="min-w-0 flex-1 truncate rounded-sm px-1 py-1 text-left text-xs"
              >
                {cut.name}
              </button>
              <button
                type="button"
                title={t('section2d.savedCuts.renameTitle')}
                onClick={() => { setOpen(false); setRenameId(cut.id); }}
                className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                title={t('section2d.savedCuts.deleteTitle')}
                onClick={() => removeSavedSectionCut(cut.id)}
                className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {renameId && <RenameViewIdentityDialog id={renameId} close={() => setRenameId(undefined)} />}
    </>
  );
}
