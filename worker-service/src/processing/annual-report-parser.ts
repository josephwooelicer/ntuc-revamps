import fs from 'node:fs/promises';
import axios from 'axios';
import { evaluateAnnualReportPdfWithGemini } from './gemini-evaluator';

export type AnnualReportRow = {
    title: string;
    url: string;
    snippet: string;
    source: string;
    query: string;
};

export type ParsedAnnualReportSignal = {
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

const PARSER_VERSION = 'annual-report-parser-v1';

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

export async function readAnnualReportCsv(localPath: string): Promise<AnnualReportRow[]> {
    const content = await fs.readFile(localPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length <= 1) {
        return [];
    }
    const rows: AnnualReportRow[] = [];
    for (const line of lines.slice(1)) {
        const [title = '', url = '', snippet = '', source = '', query = ''] = parseCsvLine(line);
        if (!title || !url) {
            continue;
        }
        rows.push({ title, url, snippet, source, query });
    }
    return rows;
}

export async function parseAnnualReportRows(
    companyName: string,
    rows: AnnualReportRow[]
): Promise<ParsedAnnualReportSignal[]> {
    const results: ParsedAnnualReportSignal[] = [];

    for (const row of rows) {
        const canonicalUrl = normalizeUrl(row.url);
        try {
            const response = await axios.get(canonicalUrl, {
                responseType: 'arraybuffer',
                timeout: 45000
            });
            const pdfBytes = Buffer.from(response.data);
            const evalResult = await evaluateAnnualReportPdfWithGemini({
                companyName,
                title: row.title,
                url: canonicalUrl,
                snippet: row.snippet,
                pdfBytes
            });

            results.push({
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
                parserVersion: PARSER_VERSION,
                evaluatorModel: evalResult.model,
                evaluatorReasoning: evalResult.reasoning,
                metadata: {
                    title: row.title,
                    snippet: row.snippet,
                    source: row.source,
                    query: row.query
                }
            });
        } catch (error: any) {
            // Keep processing next report links.
        }
    }

    return results;
}
