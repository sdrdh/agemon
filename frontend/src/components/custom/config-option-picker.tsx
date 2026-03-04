import type { SessionConfigOption } from '@agemon/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ConfigOptionPickerProps {
  option: SessionConfigOption;
  onValueChange: (configId: string, value: string) => void;
  disabled?: boolean;
}

export function ConfigOptionPicker({ option, onValueChange, disabled }: ConfigOptionPickerProps) {
  if (option.type !== 'select' || option.options.length === 0) return null;

  return (
    <Select
      value={option.value}
      onValueChange={(v) => onValueChange(option.id, v)}
      disabled={disabled}
    >
      <SelectTrigger className="h-7 text-xs w-auto min-w-[80px] gap-1 rounded-full px-2.5">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {option.options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="min-h-[44px] text-sm">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
