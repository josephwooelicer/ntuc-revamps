import fs from 'node:fs/promises';
import { evaluateEgazettePdfWithGemini } from './gemini-evaluator';

export type ParsedEgazetteSignal = {
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

const EGAZETTE_PARSER_VERSION = 'egazette-parser-v1';

function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return url;
    }
}

export async function parseEgazettePdf(args: {
    companyName: string;
    localPath: string;
    sourceUrl: string;
    title: string;
}): Promise<ParsedEgazetteSignal> {
    const pdfBytes = await fs.readFile(args.localPath);
    const canonicalUrl = normalizeUrl(args.sourceUrl);

    const evalResult = await evaluateEgazettePdfWithGemini({
        companyName: args.companyName,
        title: args.title,
        url: canonicalUrl,
        pdfBytes
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
        parserVersion: EGAZETTE_PARSER_VERSION,
        evaluatorModel: evalResult.model,
        evaluatorReasoning: evalResult.reasoning,
        metadata: {
            title: args.title
        }
    };
}
