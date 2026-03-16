import { Badge } from '@/components/ui/badge';

interface SectionHeaderProps {
  title: string;
  count: number;
  colorClass: string; // e.g. 'text-warning', 'text-success', 'text-muted-foreground'
}

export function SectionHeader({ title, count, colorClass }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-2">
      <h2 className={`text-sm font-semibold ${colorClass}`}>{title}</h2>
      <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
        {count}
      </Badge>
    </div>
  );
}
