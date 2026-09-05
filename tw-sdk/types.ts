export type MediaKind = 'photo' | 'video' | 'gif' | 'round' | 'sticker' | 'voice' | 'music' | 'file';

export interface FoundItem {
  url?: string;
  kind: MediaKind;
  blob?: Blob;
  name?: string | null;
}

export interface PendingItem {
  key: string;
  bubble: Element | null;
  kind: MediaKind;
  at: number;
  name?: string | null;
}

export interface ScanResult {
  found: Map<string, FoundItem>;
  pending: PendingItem[];
  counts: Record<string, number>;
  stopped: boolean;
  at: number;
  exhausted: boolean;
}
