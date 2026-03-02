import { AGENT_TYPES } from '@agemon/shared';
import type { AgentType } from '@agemon/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

interface AgentSelectorProps {
  value: AgentType;
  onChange: (value: AgentType) => void;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  return (
    <div className="space-y-2">
      <Label>Agent</Label>
      <Select value={value} onValueChange={v => onChange(v as AgentType)}>
        <SelectTrigger className="h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AGENT_TYPES.map(agent => (
            <SelectItem key={agent} value={agent} className="min-h-[44px]">
              {agent}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
