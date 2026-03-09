import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateDataGovFileWithGemini } from './gemini-evaluator';

export type ParsedDataGovSignal = {
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
    impactedIndustries: string[];
    metadata: Record<string, unknown>;
};

const PARSER_VERSION = 'data-gov-parser-v1';

function mimeTypeFromFile(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') return 'application/pdf';
    if (ext === '.csv') return 'text/csv';
    if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return 'application/octet-stream';
}

function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return url;
    }
}

export async function parseDataGovDocument(args: {
    localPath: string;
    sourceUrl: string;
    title: string;
    agency?: string | null;
}): Promise<ParsedDataGovSignal> {
    const fileBytes = await fs.readFile(args.localPath);
    const mimeType = mimeTypeFromFile(args.localPath);
    const canonicalUrl = normalizeUrl(args.sourceUrl);
    const evalResult = await evaluateDataGovFileWithGemini({
        title: args.title,
        url: canonicalUrl,
        agency: args.agency || '',
        mimeType,
        fileBytes
    });

    return {
        canonicalUrl,
        groupingKey: evalResult.eventGroupKey || args.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80),
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
        impactedIndustries: evalResult.impactedIndustries,
        metadata: {
            agency: args.agency || null,
            report_metadata: evalResult.reportMetadata
        }
    };
}
