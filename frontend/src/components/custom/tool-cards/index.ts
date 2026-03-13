import type { FC } from 'react';
import { BashToolCard } from './bash-tool-card';
import { FileToolCard } from './file-tool-card';
import { SearchToolCard } from './search-tool-card';
import { GenericToolCard } from './generic-tool-card';
import type { ToolCardContentProps } from './tool-card-shell';

export { ToolCardShell } from './tool-card-shell';
export type { ToolCardContentProps } from './tool-card-shell';

export const TOOL_CARD_MAP: Record<string, FC<ToolCardContentProps>> = {
  Bash: BashToolCard,
  bash: BashToolCard,
  Read: FileToolCard,
  Edit: FileToolCard,
  Write: FileToolCard,
  Grep: SearchToolCard,
  Glob: SearchToolCard,
  WebSearch: SearchToolCard,
  web_search: SearchToolCard,
};

export function getToolCardComponent(kind: string): FC<ToolCardContentProps> {
  return TOOL_CARD_MAP[kind] ?? GenericToolCard;
}
