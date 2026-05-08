export interface CompressionResult {
  summary: string;
  removedCount: number;
  success: boolean;
  error?: string;
  ragEntriesAdded?: number;
}

export interface CompressionMetadata {
  count: number;
  lastCompressedAt: number;
  lastRatio: number;
  totalRemoved: number;
}

export interface RAGEntry {
  type: "code" | "data" | "error" | "decision";
  content: string;
  file?: string;
  tags?: string[];
  timestamp: number;
  confidence: "high" | "medium" | "stale";
}

export interface RAGFile {
  entries: Record<string, RAGEntry>;
  metadata: {
    createdAt: number;
    lastUpdatedAt: number;
    sessionId: string;
  };
}
