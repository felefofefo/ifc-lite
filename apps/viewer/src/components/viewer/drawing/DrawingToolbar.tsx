/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Cloud, Hexagon, Maximize2, MoreHorizontal, MousePointer2, Pin, PinOff, Ruler, Settings2, Trash2, Type, ZoomIn, ZoomOut } from 'lucide-react';
import type { Annotation2DTool } from '@/store/slices/drawing2DSlice';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/i18n';
import type { TranslationKey } from '@/i18n/en';
import { DrawerToggle, IconAction, ToolSegment, ToolbarDivider } from './DrawingToolbarControls';

export type DrawingWidthTier = 'wide' | 'compact' | 'narrow';

const TOOLS: ReadonlyArray<{ tool: Annotation2DTool; icon: typeof Ruler; labelKey: TranslationKey }> = [
  { tool: 'none', icon: MousePointer2, labelKey: 'section2d.tools.select' },
  { tool: 'measure', icon: Ruler, labelKey: 'section2d.tools.distance' },
  { tool: 'polygon-area', icon: Hexagon, labelKey: 'section2d.tools.area' },
  { tool: 'text', icon: Type, labelKey: 'section2d.tools.text' },
  { tool: 'cloud', icon: Cloud, labelKey: 'section2d.tools.cloud' },
];

export interface DrawingToolbarProps {
  view3D?: boolean;
  tier: DrawingWidthTier;
  activeTool: Annotation2DTool;
  onSelectTool: (tool: Annotation2DTool) => void;
  /** The Select tool's tooltip: how to pan and zoom (was a permanent hint line). */
  selectHint: string;
  hasMarkup: boolean;
  onClearMarkup: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  pinned: boolean;
  onTogglePinned: () => void;
}

export function DrawingToolbar(p: DrawingToolbarProps) {
  const { t } = useTranslation();
  const showLabels = p.tier === 'wide';
  const narrow = p.tier === 'narrow';
  const pinLabel = p.pinned ? t('section2d.pin.unpinTitle') : t('section2d.pin.pinTitle');

  const toolbarClass = 'flex shrink-0 flex-wrap items-center gap-x-1 gap-y-1 border-b px-2 py-1';
  const settingsLabel = t('section2d.inspector.viewSettings');
  const settingsButton = (
    <DrawerToggle icon={Settings2} label={settingsLabel} tip={settingsLabel}
      open={p.settingsOpen} active={false} showLabel={!narrow} onToggle={p.onToggleSettings}
    />
  );
  if (p.view3D) return <div className={toolbarClass}>{settingsButton}</div>;

  return (
    <div className={toolbarClass}>
      <div role="radiogroup" aria-label={t('section2d.tools.group')} className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
        {TOOLS.map(({ tool, icon, labelKey }) => (
          <ToolSegment
            key={tool} icon={icon} label={t(labelKey)} tip={tool === 'none' ? p.selectHint : undefined}
            active={p.activeTool === tool} showLabel={showLabels} onSelect={() => p.onSelectTool(tool)}
          />
        ))}
      </div>
      {p.hasMarkup && !narrow && (
        <IconAction icon={Trash2} label={t('section2d.annotations.clear')} onClick={p.onClearMarkup} />
      )}

      <ToolbarDivider />

      {settingsButton}

      <div className="ml-auto inline-flex items-center gap-0.5">
        {!narrow && <IconAction icon={ZoomOut} label={t('section2d.zoom.out')} onClick={p.onZoomOut} />}
        {!narrow && (
          <span className="w-11 text-center text-xs tabular-nums text-muted-foreground" aria-label={t('section2d.zoom.level', { percent: p.zoomPercent })}>
            {p.zoomPercent}%
          </span>
        )}
        {!narrow && <IconAction icon={ZoomIn} label={t('section2d.zoom.in')} onClick={p.onZoomIn} />}
        <IconAction icon={Maximize2} label={t('section2d.zoom.fit')} text={showLabels ? t('section2d.zoom.fitShort') : undefined} onClick={p.onFit} />
        {!narrow && <IconAction icon={p.pinned ? Pin : PinOff} label={pinLabel} pressed={p.pinned} onClick={p.onTogglePinned} />}
        {narrow && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="h-6 w-6 text-muted-foreground [&_svg]:size-3.5" aria-label={t('section2d.more')}>
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 text-xs">
              <DropdownMenuCheckboxItem checked={p.pinned} onCheckedChange={p.onTogglePinned} className="text-xs">
                <Pin className="mr-2 h-3.5 w-3.5" />{t('section2d.pin.label')}
              </DropdownMenuCheckboxItem>
              {p.hasMarkup && (
                <DropdownMenuItem onClick={p.onClearMarkup} className="text-xs">
                  <Trash2 className="mr-2 h-3.5 w-3.5" />{t('section2d.annotations.clear')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
