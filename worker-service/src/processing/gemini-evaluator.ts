import axios from 'axios';
import { EvaluationLabel, MatrixScores, SHARED_MATRIX_VERSION, computeFinalScore } from './evaluation-matrix';

export type NewsEvalInput = {
    companyName: string;
    title: string;
    url: string;
    snippet: string;
    outlet: string;
};

export type EvalOutput = {
    eventType: string;
    signalCategory: string;
    label: EvaluationLabel;
    summary: string;
    occurredAt: string | null;
    eventGroupKey: string;
    confidence: number;
    matrixScores: MatrixScores;
    finalScore: number;
    reasoning: string;
    model: string;
};

function normalizeLabel(input: string): EvaluationLabel {
    const val = (input || '').toLowerCase().trim();
    if (val === 'positive' || val === 'negative' || val === 'neutral' || val === 'irrelevant') {
        return val;
    }
    return 'neutral';
}

function normalizeScore(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(5, Math.round(value)));
}

function parseEvalResponse(text: string) {
    const parsed = JSON.parse(text);
    const matrixScores: MatrixScores = {
        distress_signal: normalizeScore(parsed?.matrixScores?.distress_signal),
        retrenchment_proximity: normalizeScore(parsed?.matrixScores?.retrenchment_proximity),
        impact_scope: normalizeScore(parsed?.matrixScores?.impact_scope),
        credibility: normalizeScore(parsed?.matrixScores?.credibility),
        timeliness: normalizeScore(parsed?.matrixScores?.timeliness),
        relevance: normalizeScore(parsed?.matrixScores?.relevance),
        positive_offset: normalizeScore(parsed?.matrixScores?.positive_offset)
    };
    return { parsed, matrixScores };
}

async function callGeminiJson(model: string, apiKey: string, payload: any, timeoutMs: number) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await axios.post(endpoint, payload, { timeout: timeoutMs });
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        throw new Error('Gemini response missing content');
    }
    return text;
}

function fallbackEval(base: {
    eventType: string;
    signalCategory: string;
    summary: string;
    groupKey: string;
    matrixScores: MatrixScores;
}): EvalOutput {
    return {
        eventType: base.eventType,
        signalCategory: base.signalCategory,
        label: 'neutral',
        summary: base.summary,
        occurredAt: null,
        eventGroupKey: base.groupKey,
        confidence: 0.35,
        matrixScores: base.matrixScores,
        finalScore: computeFinalScore(base.matrixScores),
        reasoning: 'GEMINI_API_KEY not configured; fallback neutral evaluation applied.',
        model: 'fallback-no-key'
    };
}

export async function evaluateNewsWithGemini(input: NewsEvalInput): Promise<EvalOutput> {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (!apiKey) {
        return fallbackEval({
            eventType: 'unknown',
            signalCategory: 'news_event',
            summary: `${input.title} (${input.outlet})`,
            groupKey: input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
            matrixScores: {
                distress_signal: 0,
                retrenchment_proximity: 0,
                impact_scope: 1,
                credibility: 2,
                timeliness: 2,
                relevance: 2,
                positive_offset: 0
            }
        });
    }

    const prompt = `
You are evaluating a COMPANY-LEVEL news signal for retrenchment early warning.
Company: ${input.companyName}
Title: ${input.title}
URL: ${input.url}
Snippet: ${input.snippet}
Outlet: ${input.outlet}

Return strict JSON only with fields:
{
  "eventType": "string",
  "signalCategory": "string",
  "label": "positive|neutral|negative|irrelevant",
  "summary": "string max 240 chars",
  "occurredAt": "ISO datetime or null",
  "eventGroupKey": "short normalized key for grouping same event across outlets",
  "confidence": 0..1,
  "matrixScores": {
    "distress_signal": 0..5,
    "retrenchment_proximity": 0..5,
    "impact_scope": 0..5,
    "credibility": 0..5,
    "timeliness": 0..5,
    "relevance": 0..5,
    "positive_offset": 0..5
  },
  "reasoning": "one short paragraph"
}`;

    const text = await callGeminiJson(model, apiKey, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    }, 30000);

    const { parsed, matrixScores } = parseEvalResponse(text);
    return {
        eventType: parsed?.eventType || 'unknown',
        signalCategory: parsed?.signalCategory || 'news_event',
        label: normalizeLabel(parsed?.label),
        summary: parsed?.summary || `${input.title} (${input.outlet})`,
        occurredAt: parsed?.occurredAt || null,
        eventGroupKey: parsed?.eventGroupKey || input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
        confidence: Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.5))),
        matrixScores,
        finalScore: computeFinalScore(matrixScores),
        reasoning: parsed?.reasoning || '',
        model: `${model}@${SHARED_MATRIX_VERSION}`
    };
}

export async function evaluateEgazettePdfWithGemini(input: {
    companyName: string;
    title: string;
    url: string;
    pdfBytes: Buffer;
}): Promise<EvalOutput> {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (!apiKey) {
        return fallbackEval({
            eventType: 'unknown',
            signalCategory: 'registry_notice',
            summary: `${input.title} (fallback evaluation)`,
            groupKey: input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
            matrixScores: {
                distress_signal: 0,
                retrenchment_proximity: 0,
                impact_scope: 1,
                credibility: 3,
                timeliness: 2,
                relevance: 2,
                positive_offset: 0
            }
        });
    }

    const prompt = `
You are evaluating a COMPANY-LEVEL eGazette PDF artifact for retrenchment early warning.
Company: ${input.companyName}
Title: ${input.title}
URL: ${input.url}

Task:
1) Determine if this gazette is relevant to company health/retrenchment risk.
2) If relevant, score deterioration vs positive relief.
3) Ignore unrelated legal notices/ads/noise as irrelevant.

Return strict JSON only:
{
  "eventType": "string",
  "signalCategory": "registry_notice",
  "label": "positive|neutral|negative|irrelevant",
  "summary": "string max 240 chars",
  "occurredAt": "ISO datetime or null",
  "eventGroupKey": "short normalized key",
  "confidence": 0..1,
  "matrixScores": {
    "distress_signal": 0..5,
    "retrenchment_proximity": 0..5,
    "impact_scope": 0..5,
    "credibility": 0..5,
    "timeliness": 0..5,
    "relevance": 0..5,
    "positive_offset": 0..5
  },
  "reasoning": "one short paragraph"
}`;

    const text = await callGeminiJson(model, apiKey, {
        contents: [{
            parts: [
                { text: prompt },
                { inlineData: { mimeType: 'application/pdf', data: input.pdfBytes.toString('base64') } }
            ]
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    }, 45000);

    const { parsed, matrixScores } = parseEvalResponse(text);
    return {
        eventType: parsed?.eventType || 'unknown',
        signalCategory: parsed?.signalCategory || 'registry_notice',
        label: normalizeLabel(parsed?.label),
        summary: parsed?.summary || `${input.title} (${input.url})`,
        occurredAt: parsed?.occurredAt || null,
        eventGroupKey: parsed?.eventGroupKey || input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
        confidence: Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.5))),
        matrixScores,
        finalScore: computeFinalScore(matrixScores),
        reasoning: parsed?.reasoning || '',
        model: `${model}@${SHARED_MATRIX_VERSION}`
    };
}

export async function evaluateAnnualReportPdfWithGemini(input: {
    companyName: string;
    title: string;
    url: string;
    snippet: string;
    pdfBytes: Buffer;
}): Promise<EvalOutput> {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (!apiKey) {
        return fallbackEval({
            eventType: 'annual_report',
            signalCategory: 'company_financial',
            summary: `${input.title} (fallback evaluation)`,
            groupKey: input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
            matrixScores: {
                distress_signal: 1,
                retrenchment_proximity: 1,
                impact_scope: 2,
                credibility: 4,
                timeliness: 3,
                relevance: 5,
                positive_offset: 1
            }
        });
    }

    const prompt = `
You are evaluating a COMPANY-LEVEL listed company annual report PDF for retrenchment early warning.
Company: ${input.companyName}
Title: ${input.title}
URL: ${input.url}
Snippet: ${input.snippet}

Task:
1) Analyze report financial/operational signals that affect retrenchment risk direction.
2) Return negative label for deterioration (e.g., revenue/margin/profit collapse, restructuring stress).
3) Return positive label for healthy expansion/improving fundamentals reducing risk.
4) This source is always relevant annual-report material.

Return strict JSON only:
{
  "eventType": "annual_report",
  "signalCategory": "company_financial",
  "label": "positive|neutral|negative",
  "summary": "string max 240 chars",
  "occurredAt": "ISO datetime or null",
  "eventGroupKey": "short normalized key",
  "confidence": 0..1,
  "matrixScores": {
    "distress_signal": 0..5,
    "retrenchment_proximity": 0..5,
    "impact_scope": 0..5,
    "credibility": 0..5,
    "timeliness": 0..5,
    "relevance": 0..5,
    "positive_offset": 0..5
  },
  "reasoning": "one short paragraph"
}`;

    const text = await callGeminiJson(model, apiKey, {
        contents: [{
            parts: [
                { text: prompt },
                { inlineData: { mimeType: 'application/pdf', data: input.pdfBytes.toString('base64') } }
            ]
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    }, 60000);

    const { parsed, matrixScores } = parseEvalResponse(text);
    const label = normalizeLabel(parsed?.label) === 'irrelevant' ? 'neutral' : normalizeLabel(parsed?.label);
    return {
        eventType: 'annual_report',
        signalCategory: 'company_financial',
        label,
        summary: parsed?.summary || `${input.title} (${input.url})`,
        occurredAt: parsed?.occurredAt || null,
        eventGroupKey: parsed?.eventGroupKey || input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
        confidence: Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.5))),
        matrixScores,
        finalScore: computeFinalScore(matrixScores),
        reasoning: parsed?.reasoning || '',
        model: `${model}@${SHARED_MATRIX_VERSION}`
    };
}

export async function evaluateRedditPostRelevancyWithGemini(input: {
    companyName: string;
    postTitle: string;
    postUrl: string;
    comments: string[];
}): Promise<{ relevant: boolean; confidence: number; reasoning: string; model: string }> {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (!apiKey) {
        return {
            relevant: true,
            confidence: 0.35,
            reasoning: 'GEMINI_API_KEY not configured; fallback assumes relevant.',
            model: 'fallback-no-key'
        };
    }

    const prompt = `
Determine if this Reddit post is relevant to company-level retrenchment risk monitoring.
Company: ${input.companyName}
Post title: ${input.postTitle}
Post URL: ${input.postUrl}
Comment samples:
${input.comments.slice(0, 20).map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return strict JSON:
{
  "relevant": true|false,
  "confidence": 0..1,
  "reasoning": "one short paragraph"
}`;

    const text = await callGeminiJson(model, apiKey, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    }, 30000);

    const parsed = JSON.parse(text);
    return {
        relevant: Boolean(parsed?.relevant),
        confidence: Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.5))),
        reasoning: parsed?.reasoning || '',
        model: `${model}@${SHARED_MATRIX_VERSION}`
    };
}

export async function evaluateRedditCommentSentimentWithGemini(input: {
    companyName: string;
    postTitle: string;
    postUrl: string;
    comments: string[];
}): Promise<EvalOutput> {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (!apiKey) {
        return fallbackEval({
            eventType: 'reddit_comment_sentiment',
            signalCategory: 'company_sentiment',
            summary: `${input.postTitle} (fallback evaluation)`,
            groupKey: input.postTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
            matrixScores: {
                distress_signal: 1,
                retrenchment_proximity: 1,
                impact_scope: 2,
                credibility: 2,
                timeliness: 3,
                relevance: 4,
                positive_offset: 1
            }
        });
    }

    const prompt = `
Evaluate commenter sentiment as a COMPANY-LEVEL signal.
Company: ${input.companyName}
Post title: ${input.postTitle}
Post URL: ${input.postUrl}
Comment samples:
${input.comments.slice(0, 120).map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return strict JSON:
{
  "eventType": "reddit_comment_sentiment",
  "signalCategory": "company_sentiment",
  "label": "positive|neutral|negative",
  "summary": "string max 240 chars",
  "occurredAt": "ISO datetime or null",
  "eventGroupKey": "short normalized key",
  "confidence": 0..1,
  "matrixScores": {
    "distress_signal": 0..5,
    "retrenchment_proximity": 0..5,
    "impact_scope": 0..5,
    "credibility": 0..5,
    "timeliness": 0..5,
    "relevance": 0..5,
    "positive_offset": 0..5
  },
  "reasoning": "one short paragraph"
}`;

    const text = await callGeminiJson(model, apiKey, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    }, 30000);

    const { parsed, matrixScores } = parseEvalResponse(text);
    const label = normalizeLabel(parsed?.label) === 'irrelevant' ? 'neutral' : normalizeLabel(parsed?.label);
    return {
        eventType: 'reddit_comment_sentiment',
        signalCategory: 'company_sentiment',
        label,
        summary: parsed?.summary || input.postTitle,
        occurredAt: parsed?.occurredAt || null,
        eventGroupKey: parsed?.eventGroupKey || input.postTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
        confidence: Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.5))),
        matrixScores,
        finalScore: computeFinalScore(matrixScores),
        reasoning: parsed?.reasoning || '',
        model: `${model}@${SHARED_MATRIX_VERSION}`
    };
}

export async function evaluateDataGovFileWithGemini(input: {
    title: string;
    url: string;
    agency: string;
    mimeType: string;
    fileBytes: Buffer;
}): Promise<EvalOutput & { impactedIndustries: string[]; reportMetadata: Record<string, unknown> }> {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const industries = [
        'Agriculture and Fishing',
        'Mining and Quarrying',
        'Manufacturing',
        'Electricity, Gas, Steam and Air-Conditioning Supply',
        'Water Supply; Sewerage, Waste Management and Remediation Activities',
        'Construction',
        'Wholesale and Retail Trade',
        'Accommodation and Food Service Activities',
        'Publishing, Broadcasting, and Content Production and Distribution Activities',
        'Telecommunications, Computer Programming, Consultancy, Computing Infrastructure, and Other Information Service Activities',
        'Financial and Insurance Activities',
        'Real Estate Activities',
        'Professional, Scientific and Technical Activities',
        'Administrative and Support Service Activities',
        'Public Administration and Defence',
        'Education',
        'Health and Social Services',
        'Arts, Sports and Recreation',
        'Other Service Activities'
    ];

    if (!apiKey) {
        const fallback = fallbackEval({
            eventType: 'industry_report',
            signalCategory: 'industry_macro',
            summary: `${input.title} (fallback evaluation)`,
            groupKey: input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
            matrixScores: {
                distress_signal: 1,
                retrenchment_proximity: 1,
                impact_scope: 2,
                credibility: 4,
                timeliness: 3,
                relevance: 4,
                positive_offset: 1
            }
        });
        return {
            ...fallback,
            impactedIndustries: [],
            reportMetadata: {
                about: 'Unable to evaluate report details without GEMINI_API_KEY'
            }
        };
    }

    const prompt = `
You are evaluating a Singapore data.gov.sg report as an INDUSTRY-LEVEL signal.
Title: ${input.title}
URL: ${input.url}
Agency: ${input.agency}

Choose impacted industries only from this list:
${industries.map((i) => `- ${i}`).join('\n')}

Task:
1) Determine which industries are affected.
2) Determine direction: negative, positive, or neutral.
3) Summarize what the report is about.

Return strict JSON only:
{
  "eventType": "industry_report",
  "signalCategory": "industry_macro",
  "label": "positive|neutral|negative|irrelevant",
  "summary": "string max 240 chars",
  "occurredAt": "ISO datetime or null",
  "eventGroupKey": "short normalized key",
  "confidence": 0..1,
  "impactedIndustries": ["..."],
  "reportMetadata": {
    "about": "short description",
    "key_metric": "optional",
    "period": "optional"
  },
  "matrixScores": {
    "distress_signal": 0..5,
    "retrenchment_proximity": 0..5,
    "impact_scope": 0..5,
    "credibility": 0..5,
    "timeliness": 0..5,
    "relevance": 0..5,
    "positive_offset": 0..5
  },
  "reasoning": "one short paragraph"
}`;

    const text = await callGeminiJson(model, apiKey, {
        contents: [{
            parts: [
                { text: prompt },
                { inlineData: { mimeType: input.mimeType, data: input.fileBytes.toString('base64') } }
            ]
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    }, 60000);

    const { parsed, matrixScores } = parseEvalResponse(text);
    const impactedIndustries: string[] = Array.isArray(parsed?.impactedIndustries)
        ? parsed.impactedIndustries.filter((v: unknown) => typeof v === 'string')
        : [];
    return {
        eventType: 'industry_report',
        signalCategory: 'industry_macro',
        label: normalizeLabel(parsed?.label),
        summary: parsed?.summary || input.title,
        occurredAt: parsed?.occurredAt || null,
        eventGroupKey: parsed?.eventGroupKey || input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80),
        confidence: Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.5))),
        matrixScores,
        finalScore: computeFinalScore(matrixScores),
        reasoning: parsed?.reasoning || '',
        model: `${model}@${SHARED_MATRIX_VERSION}`,
        impactedIndustries,
        reportMetadata: (parsed?.reportMetadata && typeof parsed.reportMetadata === 'object') ? parsed.reportMetadata : {}
    };
}
