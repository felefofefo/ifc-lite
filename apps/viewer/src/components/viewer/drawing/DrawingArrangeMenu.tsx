/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Layers3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/i18n';
import type { DrawingArrangeAction } from '@/lib/drawing/drawing-arrange';

const actions = ['front', 'forward', 'backward', 'back'] as const satisfies readonly DrawingArrangeAction[];

export function DrawingArrangeMenu({ onArrange, disabled }: { onArrange?: (action: DrawingArrangeAction) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="toggle" disabled={disabled || !onArrange}
        aria-label={t('section2d.tools.arrange')} title={t('section2d.tools.arrange')}
        className="h-6 w-6 gap-1 rounded-md px-0 text-xs font-normal [&_svg]:size-3.5">
        <Layers3 className="shrink-0" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="center">
      <p className="px-2 py-1 text-xs text-muted-foreground">{t('section2d.tools.arrange.scope')}</p>
      {actions.map(action => <DropdownMenuItem key={action} onSelect={() => onArrange?.(action)}>
        {t(`section2d.tools.arrange.${action}`)}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
