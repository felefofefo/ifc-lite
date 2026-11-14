/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function DrawingSettingSwitch({ label, checked, onCheckedChange, title }: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  title?: string;
}) {
  const id = useId();
  return (
    <div title={title} className="flex min-h-8 items-center justify-between gap-2 rounded-md px-2 hover:bg-muted/50 focus-within:bg-muted/50">
      <Label htmlFor={id} className="flex min-h-8 flex-1 cursor-pointer items-center text-xs">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
