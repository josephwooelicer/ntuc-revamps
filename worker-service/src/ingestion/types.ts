export interface IngestionRange {
    start: Date;
    end: Date;
}

export interface RawDocument {
    id: string; // hash of sourceId + externalId or URL
    sourceId: string;
    externalId?: string;
    publishedAt?: string;
    fetchedAt: string;
    title: string;
    url: string;
    content: string | Buffer;
    metadata?: Record<string, any>;
}

export interface IngestionResult {
    documents: RawDocument[];
    records?: any[];
    cursor?: string;
}

export interface Connector {
    id: string;
    pull(
        range?: IngestionRange,
        cursor?: string,
        options?: Record<string, any>,
        onDocument?: (doc: RawDocument) => Promise<void>,
        onRecord?: (record: any) => Promise<void>
    ): Promise<IngestionResult>;
}

export interface Source {
    id: string;
    name: string;
    sourceType: string;
    accessMode: string;
    category: string;
    reliabilityWeight: number;
    supportsBackfill: boolean;
    isActive: boolean;
}
