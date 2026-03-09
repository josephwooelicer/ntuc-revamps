import fs from 'node:fs/promises';
import {
    evaluateRedditCommentSentimentWithGemini,
    evaluateRedditPostRelevancyWithGemini
} from './gemini-evaluator';

export type RedditCommentRow = {
    author: string;
    body: string;
    score: string;
    createdUtc: string;
};

export type ParsedRedditSignal = {
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

const PARSER_VERSION = 'reddit-parser-v1';

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

export async function readRedditCommentsCsv(localPath: string): Promise<RedditCommentRow[]> {
    const content = await fs.readFile(localPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length <= 1) {
        return [];
    }
    const rows: RedditCommentRow[] = [];
    for (const line of lines.slice(1)) {
        const [author = '', body = '', score = '', createdUtc = ''] = parseCsvLine(line);
        if (!body) {
            continue;
        }
        rows.push({ author, body, score, createdUtc });
    }
    return rows;
}

export async function parseRedditCommentSentiment(args: {
    companyName: string;
    postTitle: string;
    postUrl: string;
    comments: RedditCommentRow[];
}): Promise<ParsedRedditSignal | null> {
    const canonicalUrl = normalizeUrl(args.postUrl);
    const sample = args.comments.slice(0, 120).map((c) => c.body).filter(Boolean);
    const relevancy = await evaluateRedditPostRelevancyWithGemini({
        companyName: args.companyName,
        postTitle: args.postTitle,
        postUrl: canonicalUrl,
        comments: sample
    });

    if (!relevancy.relevant) {
        return null;
    }

    const sentimentEval = await evaluateRedditCommentSentimentWithGemini({
        companyName: args.companyName,
        postTitle: args.postTitle,
        postUrl: canonicalUrl,
        comments: sample
    });

    return {
        canonicalUrl,
        groupingKey: sentimentEval.eventGroupKey || args.postTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80),
        eventType: sentimentEval.eventType,
        signalCategory: sentimentEval.signalCategory,
        label: sentimentEval.label,
        summary: sentimentEval.summary,
        occurredAt: sentimentEval.occurredAt,
        matrixScores: sentimentEval.matrixScores,
        finalScore: sentimentEval.finalScore,
        parserConfidence: Math.max(0, Math.min(1, (relevancy.confidence + sentimentEval.confidence) / 2)),
        parserVersion: PARSER_VERSION,
        evaluatorModel: sentimentEval.model,
        evaluatorReasoning: `${relevancy.reasoning}\n${sentimentEval.reasoning}`.trim(),
        metadata: {
            post_title: args.postTitle,
            comment_count: args.comments.length
        }
    };
}
