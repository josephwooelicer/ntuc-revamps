import fs from 'node:fs/promises';
import { evaluateNewsWithGemini } from './gemini-evaluator';

export type RawNewsRow = {
    title: string;
    url: string;
    snippet: string;
    outlet: string;
};

export type ParsedNewsSignal = {
    canonicalUrl: string;
    groupingKey: string;
    eventType: string;
    signalCategory: string;
    label: 'positive' | 'neutral' | 'negative' | 'irrelevant';
    summary: string;
    occurredAt: string | null;
    matrixScores: Record<string, number>;
    finalScore: number;
    parserConfidence: number;
    parserVersion: string;
    evaluatorModel: string;
    evaluatorReasoning: string;
    metadata: Record<string, unknown>;
};

const NEWS_PARSER_VERSION = 'news-parser-v1';

function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && line[i + 1] === '"') {
            current += '"';
            i++;
            continue;
        }
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === ',' && !inQuotes) {
            out.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    out.push(current);
    return out.map((v) => v.trim());
}

function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        if (parsed.pathname.endsWith('/')) {
            parsed.pathname = parsed.pathname.slice(0, -1);
        }
        return parsed.toString();
    } catch {
        return url.trim();
    }
}

export async function readNewsCsv(localPath: string): Promise<RawNewsRow[]> {
    const content = await fs.readFile(localPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length <= 1) {
        return [];
    }
    const rows: RawNewsRow[] = [];
    for (const line of lines.slice(1)) {
        const [title = '', url = '', snippet = '', outlet = ''] = parseCsvLine(line);
        if (!title || !url) {
            continue;
        }
        rows.push({ title, url, snippet, outlet });
    }
    return rows;
}

export async function parseNewsRows(
    companyName: string,
    rows: RawNewsRow[]
): Promise<ParsedNewsSignal[]> {
    const evaluated: ParsedNewsSignal[] = [];

    for (const row of rows) {
        const canonicalUrl = normalizeUrl(row.url);
        const evalResult = await evaluateNewsWithGemini({
            companyName,
            title: row.title,
            url: canonicalUrl,
            snippet: row.snippet,
            outlet: row.outlet
        });

        evaluated.push({
            canonicalUrl,
            groupingKey: evalResult.eventGroupKey || row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80),
            eventType: evalResult.eventType,
            signalCategory: evalResult.signalCategory,
            label: evalResult.label,
            summary: evalResult.summary,
            occurredAt: evalResult.occurredAt,
            matrixScores: evalResult.matrixScores,
            finalScore: evalResult.finalScore,
            parserConfidence: evalResult.confidence,
            parserVersion: NEWS_PARSER_VERSION,
            evaluatorModel: evalResult.model,
            evaluatorReasoning: evalResult.reasoning,
            metadata: {
                title: row.title,
                snippet: row.snippet,
                outlet: row.outlet
            }
        });
    }

    // Group near-duplicate events across outlets by event key and keep the highest-confidence item.
    const grouped = new Map<string, ParsedNewsSignal>();
    const outletsByGroup = new Map<string, Set<string>>();
    for (const signal of evaluated) {
        const key = `${signal.groupingKey}|${signal.canonicalUrl}`;
        const existing = grouped.get(key);
        if (!existing || signal.parserConfidence > existing.parserConfidence) {
            grouped.set(key, signal);
        }
        const outlets = outletsByGroup.get(key) || new Set<string>();
        const outlet = String((signal.metadata?.outlet as string) || '').trim();
        if (outlet) {
            outlets.add(outlet);
        }
        outletsByGroup.set(key, outlets);
    }

    return Array.from(grouped.entries()).map(([key, signal]) => ({
        ...signal,
        metadata: {
            ...signal.metadata,
            grouped_outlet_count: outletsByGroup.get(key)?.size || 0,
            grouped_outlets: Array.from(outletsByGroup.get(key) || [])
        }
    }));
}
