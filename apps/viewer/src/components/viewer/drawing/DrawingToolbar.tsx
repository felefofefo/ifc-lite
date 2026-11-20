/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ChevronDown, Cloud, Hexagon, Maximize2, MoreHorizontal, MousePointer2, Move, Scissors, Copy, ClipboardPaste, Pin, PinOff, Ruler, Trash2, Type, ZoomIn, ZoomOut, Tag } from 'lucide-react';
import { DIMENSION_TYPES, type DimensionType } from '@/lib/drawing/dimension-line';
import type { Annotation2DTool } from '@/store/slices/drawing2DSlice';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/i18n';
import type { TranslationKey } from '@/i18n/en';
import { IconAction, ToolSegment, ToolbarDivider } from './DrawingToolbarControls';

export type DrawingWidthTier = 'wide' | 'compact' | 'narrow';

const TOOLS: ReadonlyArray<{ tool: Annotation2DTool; icon: typeof Ruler; labelKey: TranslationKey }> = [
  { tool: 'measure', icon: Ruler, labelKey: 'section2d.tools.distance' },
  { tool: 'polygon-area', icon: Hexagon, labelKey: 'section2d.tools.area' },
  { tool: 'text', icon: Type, labelKey: 'section2d.tools.text' },
  { tool: 'cloud', icon: Cloud, labelKey: 'section2d.tools.cloud' },
];

const DIMENSION_LABELS = {
  aligned: 'section2d.tools.dimensionAligned',
  horizontal: 'section2d.tools.dimensionHorizontal',
  vertical: 'section2d.tools.dimensionVertical',
  angular: 'section2d.tools.dimensionAngular',
  radius: 'section2d.tools.dimensionRadius',
  diameter: 'section2d.tools.dimensionDiameter',
} as const;

export interface DrawingToolbarProps {
  view3D?: boolean;
  tier: DrawingWidthTier;
  activeTool: Annotation2DTool;
  onSelectTool: (tool: Annotation2DTool) => void;
  onOpenTags: () => void;
  canEdit: boolean;
  canCopy: boolean;
  canDelete: boolean;
  canCut: boolean;
  canPaste: boolean;
  onMove: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  dimensionType: DimensionType;
  onSelectDimensionType: (type: DimensionType) => void;
  /** The Select tool's tooltip: how to pan and zoom (was a permanent hint line). */
  selectHint: string;
  hasMarkup: boolean;
  onClearMarkup: () => void;
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
  if (p.view3D) return null;

  return (
    <div className={toolbarClass}>
      <div className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
        <div role="radiogroup" aria-label={t('section2d.tools.editGroup')} className="inline-flex items-center gap-0.5">
          <ToolSegment icon={MousePointer2} label={t('section2d.tools.select')} tip={p.selectHint}
            active={p.activeTool === 'none'} showLabel={showLabels} onSelect={() => p.onSelectTool('none')} />
          <ToolSegment icon={Move} label={t('section2d.tools.move')}
            active={p.activeTool === 'move'} disabled={!p.canEdit && p.activeTool !== 'move'}
            showLabel={showLabels} onSelect={p.onMove} />
        </div>
        <IconAction icon={Scissors} label={t('section2d.tools.cut')} disabled={!p.canCut} onClick={p.onCut} />
        <IconAction icon={Copy} label={t('section2d.tools.copy')} disabled={!p.canCopy} onClick={p.onCopy} />
        <IconAction icon={ClipboardPaste} label={t('section2d.tools.paste')} disabled={!p.canPaste} onClick={p.onPaste} />
        <IconAction icon={Trash2} label={t('section2d.tools.delete')} disabled={!p.canDelete} onClick={p.onDelete} />
      </div>
      <ToolbarDivider />
      <div className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
        <div role="radiogroup" aria-label={t('section2d.tools.group')} className="inline-flex items-center gap-0.5">
          {TOOLS.map(({ tool, icon, labelKey }) => tool === 'measure' ? (
            <div key={tool} className="inline-flex shrink-0 items-center">
              <ToolSegment
                icon={icon} label={t(labelKey)} tip={t(DIMENSION_LABELS[p.dimensionType])}
                active={p.activeTool === tool} showLabel={showLabels}
                onSelect={() => p.onSelectTool(tool)} className="rounded-r-none"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="toggle" size="icon-xs"
                    className="h-6 w-5 rounded-l-none border-l border-border px-0"
                    aria-label={t('section2d.tools.dimensionType')}>
                    <ChevronDown aria-hidden="true" className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup value={p.dimensionType}>
                    {DIMENSION_TYPES.map(type => (
                      <DropdownMenuRadioItem key={type} value={type} checkmark onSelect={() => p.onSelectDimensionType(type)}>
                        {t(DIMENSION_LABELS[type])}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <ToolSegment
              key={tool} icon={icon} label={t(labelKey)}
              active={p.activeTool === tool} showLabel={showLabels} onSelect={() => p.onSelectTool(tool)}
            />
          ))}
        </div>
        <IconAction icon={Tag} label={t('section2d.tagLibrary.title')} text={showLabels ? t('section2d.tagLibrary.button') : undefined}
          pressed={p.activeTool === 'tag'} onClick={p.onOpenTags} />
      </div>
      <ToolbarDivider />

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
        {p.hasMarkup && !narrow && <IconAction icon={Trash2} label={t('section2d.annotations.clear')} onClick={p.onClearMarkup} />}
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
