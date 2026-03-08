"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AnyObj = Record<string, any>;
type View = "all" | "industry" | "company" | "settings" | "analysis" | "admin";

type UserOption = {
  id: string;
  label: string;
  role: "analyst" | "officer" | "admin";
};

const USER_OPTIONS: UserOption[] = [
  { id: "user-analyst-001", label: "Analyst", role: "analyst" },
  { id: "user-officer-001", label: "Officer", role: "officer" },
  { id: "user-admin-001", label: "Admin", role: "admin" }
];

const NAV: Array<{ href: string; label: string; view: View }> = [
  { href: "/", label: "Overview", view: "all" },
  { href: "/industry", label: "Industry", view: "industry" },
  { href: "/company", label: "Company", view: "company" },
  { href: "/settings", label: "Settings", view: "settings" },
  { href: "/analysis", label: "On-demand", view: "analysis" }
];

async function api(path: string, method = "GET", body?: AnyObj, userId?: string) {
  const response = await fetch(`/api/ews${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(userId ? { "x-user-id": userId } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err: any = new Error(payload.error || `Request failed: ${response.status}`);
    err.payload = payload;
    err.status = response.status;
    throw err;
  }
  return payload;
}

export function DashboardClient({ view }: { view: View }) {
  const [activeUserId, setActiveUserId] = useState(USER_OPTIONS[0].id);
  const activeUser = useMemo(() => USER_OPTIONS.find((u) => u.id === activeUserId) || USER_OPTIONS[0], [activeUserId]);

  const [me, setMe] = useState<AnyObj | null>(null);
  const [industryRows, setIndustryRows] = useState<AnyObj[]>([]);
  const [companyRows, setCompanyRows] = useState<AnyObj[]>([]);
  const [selectedCompanyScoreId, setSelectedCompanyScoreId] = useState<string>("");
  const [selectedCompanyExplanation, setSelectedCompanyExplanation] = useState<AnyObj | null>(null);
  const [overrideScore, setOverrideScore] = useState<string>("70");
  const [overrideReason, setOverrideReason] = useState<string>("Manual review adjustment");
  const [configs, setConfigs] = useState<AnyObj[]>([]);
  const [sourceSummaryRows, setSourceSummaryRows] = useState<AnyObj[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [sourceExtractionRows, setSourceExtractionRows] = useState<AnyObj[]>([]);
  const [selectedRawDocument, setSelectedRawDocument] = useState<AnyObj | null>(null);
  const [lastIngestionRun, setLastIngestionRun] = useState<AnyObj | null>(null);
  const [retrievalRunning, setRetrievalRunning] = useState<boolean>(false);
  const [clearRunning, setClearRunning] = useState<boolean>(false);
  const [onDemandQuery, setOnDemandQuery] = useState<string>("Hanbaobao");
  const [onDemandJob, setOnDemandJob] = useState<AnyObj | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  const retrievalHint = useMemo(() => {
    if (!retrievalRunning) return "";
    const sourceLabel =
      sourceSummaryRows.find((row) => row.id === selectedSourceId)?.name || selectedSourceId || "selected connector";
    return `Retrieval is running for ${sourceLabel}. Large pulls can take several minutes.`;
  }, [retrievalRunning, sourceSummaryRows, selectedSourceId]);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [meRes, industriesRes, companiesRes, configRes, sourceRes] = await Promise.all([
        api(`/api/v1/me?userId=${activeUserId}`, "GET", undefined, activeUserId),
        api("/api/v1/industries", "GET", undefined, activeUserId),
        api("/api/v1/companies", "GET", undefined, activeUserId),
        api("/api/v1/config", "GET", undefined, activeUserId),
        api("/api/v1/admin/extractions/summary", "GET", undefined, activeUserId).catch(() => ({ data: [] }))
      ]);

      setMe(meRes);
      setConfigs(configRes.data || []);
      setSourceSummaryRows(sourceRes.data || []);
      if (!selectedSourceId && sourceRes.data?.length) {
        setSelectedSourceId(sourceRes.data[0].id);
      }

      const indRows = await Promise.all(
        (industriesRes.data || []).map(async (industry: AnyObj) => {
          const scores = await api(`/api/v1/industries/${industry.id}/scores`, "GET", undefined, activeUserId);
          const latest = scores.data?.[0] || null;
          return { ...industry, latestScore: latest?.score_value ?? null, latestSnapshotId: latest?.id ?? null };
        })
      );
      setIndustryRows(indRows);

      const coRows = await Promise.all(
        (companiesRes.data || []).map(async (company: AnyObj) => {
          const scores = await api(`/api/v1/companies/${company.id}/scores?type=final`, "GET", undefined, activeUserId);
          const latest = scores.data?.[0] || null;
          return { ...company, latestFinalScore: latest?.score_value ?? null, latestSnapshotId: latest?.id ?? null };
        })
      );
      setCompanyRows(coRows);
      setSelectedCompanyScoreId(coRows.find((row) => row.latestSnapshotId)?.latestSnapshotId || "");
    } catch (err: any) {
      setError(err.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function loadExplanation(scoreSnapshotId: string) {
    if (!scoreSnapshotId) return;
    try {
      const result = await api(`/api/v1/scores/${scoreSnapshotId}/explanation`, "GET", undefined, activeUserId);
      setSelectedCompanyExplanation(result);
    } catch (err: any) {
      setError(err.message || "Failed to load evidence");
    }
  }

  async function submitOverride() {
    if (!selectedCompanyScoreId) return;
    try {
      await api(`/api/v1/scores/${selectedCompanyScoreId}/override`, "POST", {
        overriddenScore: Number(overrideScore),
        reason: overrideReason,
        actorUserId: activeUserId
      }, activeUserId);
      await loadAll();
    } catch (err: any) {
      setError(err.message || "Override failed");
    }
  }

  async function updateConfig(key: string, value: string, scope: string) {
    try {
      await api(`/api/v1/config/${key}`, "PUT", { value, scope, actorUserId: activeUserId }, activeUserId);
      await loadAll();
    } catch (err: any) {
      setError(err.message || "Config update failed");
    }
  }

  async function runOnDemand() {
    try {
      const created = await api("/api/v1/analysis/on-demand", "POST", { query: onDemandQuery, actorUserId: activeUserId }, activeUserId);
      const job = await api(`/api/v1/analysis/on-demand/${created.id}`, "GET", undefined, activeUserId);
      setOnDemandJob(job);
    } catch (err: any) {
      setError(err.message || "On-demand analysis failed");
    }
  }

  async function loadRunExtractions(ingestionRunId: string) {
    if (!ingestionRunId) return;
    try {
      const res = await api(
        `/api/v1/admin/extractions?ingestionRunId=${encodeURIComponent(ingestionRunId)}&limit=1000`,
        "GET",
        undefined,
        activeUserId
      );
      setSourceExtractionRows(res.data || []);
    } catch (err: any) {
      setError(err.message || "Failed to load extracted documents");
      setSourceExtractionRows([]);
    }
  }

  async function loadRawDocumentDebug(rawDocumentId: string) {
    try {
      const res = await api(
        `/api/v1/admin/extractions/raw-document/${encodeURIComponent(rawDocumentId)}`,
        "GET",
        undefined,
        activeUserId
      );
      setSelectedRawDocument(res);
    } catch (err: any) {
      setError(err.message || "Failed to load raw document payload");
      setSelectedRawDocument(null);
    }
  }

  async function triggerConnectorCall() {
    if (!selectedSourceId) {
      setError("Select a source first");
      return;
    }
    try {
      setRetrievalRunning(true);
      setError("");
      const run = await api(
        "/api/v1/ingestion/runs",
        "POST",
        {
          sourceId: selectedSourceId,
          runType: "on_demand",
          filters: {}
        },
        activeUserId
      );
      setLastIngestionRun(run.run || run);
      const runId = run?.run?.id || run?.id;
      if (runId) {
        await loadRunExtractions(runId);
      }
      const firstRawDocId = run?.run?.raw_documents?.[0]?.id;
      if (firstRawDocId) await loadRawDocumentDebug(firstRawDocId);
      await loadAll();
    } catch (err: any) {
      setError(err.message || "Failed to trigger connector call");
    } finally {
      setRetrievalRunning(false);
    }
  }

  async function clearSelectedSourceData() {
    if (!selectedSourceId) {
      setError("Select a source first");
      return;
    }
    const confirmed = window.confirm(
      `Clear all database and data-lake records for source "${selectedSourceId}"? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setClearRunning(true);
      setError("");
      await api(
        `/api/v1/admin/sources/${encodeURIComponent(selectedSourceId)}/clear`,
        "POST",
        { actorUserId: activeUserId },
        activeUserId
      );
      setLastIngestionRun(null);
      setSourceExtractionRows([]);
      setSelectedRawDocument(null);
      await loadAll();
    } catch (err: any) {
      setError(err.message || "Failed to clear source data");
    } finally {
      setClearRunning(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [activeUserId]);

  useEffect(() => {
    if (selectedCompanyScoreId) loadExplanation(selectedCompanyScoreId);
  }, [selectedCompanyScoreId]);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>NTUC EWS Dashboard</CardTitle>
              <CardDescription>Analyst/Officer workflows with role-gated actions and evidence drill-down</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Select value={activeUserId} onChange={(e) => setActiveUserId(e.target.value)} className="w-52">
                {USER_OPTIONS.map((u) => (
                  <option key={u.id} value={u.id}>{u.label} ({u.role})</option>
                ))}
              </Select>
              <Button variant="outline" onClick={loadAll}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{me?.email || "loading..."}</Badge>
              <Badge>{activeUser.role}</Badge>
              {loading ? <span>Loading data...</span> : null}
            </div>
            <div className="flex gap-2">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className={`rounded-md px-3 py-1 text-xs ${view === item.view ? "bg-primary text-white" : "bg-secondary"}`}>
                  {item.label}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {error ? <Card className="border-destructive/40"><CardContent className="flex items-center gap-2 pt-6 text-destructive"><AlertTriangle className="h-4 w-4" /><span>{error}</span></CardContent></Card> : null}

        {(view === "all" || view === "industry") ? (
          <Card>
            <CardHeader><CardTitle>Industry Dashboard</CardTitle><CardDescription>Monthly stress levels and gate status</CardDescription></CardHeader>
            <CardContent>
              <Table><TableHeader><TableRow><TableHead>Industry</TableHead><TableHead>Latest Risk</TableHead><TableHead>Gate</TableHead></TableRow></TableHeader>
                <TableBody>{industryRows.map((row) => <TableRow key={row.id}><TableCell>{row.name}</TableCell><TableCell>{row.latestScore ?? "N/A"}</TableCell><TableCell>{typeof row.latestScore === "number" && row.latestScore >= 60 ? <Badge>Open</Badge> : <Badge variant="secondary">Closed</Badge>}</TableCell></TableRow>)}</TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        {(view === "all" || view === "company") ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Company Dashboard</CardTitle><CardDescription>Weekly final scores and evidence selection</CardDescription></CardHeader>
              <CardContent>
                <Table><TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Industry</TableHead><TableHead>Final Score</TableHead><TableHead>Evidence</TableHead></TableRow></TableHeader>
                  <TableBody>{companyRows.map((row) => <TableRow key={row.id}><TableCell>{row.registered_name}</TableCell><TableCell>{row.industry_name || row.industry_id}</TableCell><TableCell>{row.latestFinalScore ?? "N/A"}</TableCell><TableCell><Button variant="outline" size="sm" disabled={!row.latestSnapshotId} onClick={() => setSelectedCompanyScoreId(row.latestSnapshotId)}>View</Button></TableCell></TableRow>)}</TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Evidence Drill-down</CardTitle><CardDescription>Top contributors sorted by impact for selected score snapshot</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {selectedCompanyExplanation?.snapshot ? (
                  <>
                    <div className="rounded-md border p-3 text-sm">
                      <p>Snapshot: {selectedCompanyExplanation.snapshot.id}</p><p>Type: {selectedCompanyExplanation.snapshot.score_type}</p><p>Score: {selectedCompanyExplanation.snapshot.score_value}</p><p>Delta: {selectedCompanyExplanation.explanation?.deltaSummary?.scoreDelta ?? 0}</p>
                    </div>
                    <ul className="space-y-2 text-sm">{(selectedCompanyExplanation.explanation?.orderedContributions || []).slice(0, 8).map((c: AnyObj, i: number) => <li key={`${c.signalId || "ctx"}-${i}`} className="rounded-md border p-3"><p className="font-medium">{c.category}</p><p className="text-muted-foreground">{c.explanation}</p>{c.evidence?.pointerUrl ? <p className="text-xs text-primary">{c.evidence.pointerUrl}</p> : null}</li>)}</ul>
                  </>
                ) : <p className="text-sm text-muted-foreground">Select a company row with score data.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Override Score</CardTitle><CardDescription>Writes audited override with role permission checks</CardDescription></CardHeader>
              <CardContent className="space-y-3"><Input value={overrideScore} onChange={(e) => setOverrideScore(e.target.value)} placeholder="Overridden score" /><Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Reason" /><Button onClick={submitOverride}>Apply Override</Button></CardContent>
            </Card>
          </div>
        ) : null}

        {(view === "all" || view === "settings") ? (
          <Card>
            <CardHeader><CardTitle>Settings</CardTitle><CardDescription>Config updates with role-gated permissions per scope</CardDescription></CardHeader>
            <CardContent>
              <Table><TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Scope</TableHead><TableHead>Value</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                <TableBody>{configs.map((cfg) => <TableRow key={cfg.key}><TableCell>{cfg.key}</TableCell><TableCell>{cfg.scope}</TableCell><TableCell>{String(cfg.parsedValue)}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => { const value = prompt(`New value for ${cfg.key}`, String(cfg.value)); if (value != null) updateConfig(cfg.key, value, cfg.scope); }}>Edit</Button></TableCell></TableRow>)}</TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        {(view === "all" || view === "analysis") ? (
          <Card>
            <CardHeader><CardTitle>On-demand Analysis</CardTitle><CardDescription>Trigger immediate ingestion, processing, scoring, and report generation</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2"><Input value={onDemandQuery} onChange={(e) => setOnDemandQuery(e.target.value)} placeholder="Company id, UEN, name or alias" /><Button onClick={runOnDemand}><Search className="mr-2 h-4 w-4" /> Run</Button></div>
              {onDemandJob ? <div className="rounded-md border p-3 text-sm"><p>Job: {onDemandJob.id}</p><p>Status: {onDemandJob.status}</p><p>Created: {onDemandJob.created_at}</p><p>Final score: {onDemandJob.report?.summary?.finalScore ?? "N/A"}</p>{onDemandJob.error ? <p className="text-destructive">{onDemandJob.error}</p> : null}</div> : null}
            </CardContent>
          </Card>
        ) : null}

        {view === "admin" ? (
          activeUser.role !== "admin" ? (
            <Card className="border-destructive/40">
              <CardContent className="pt-6 text-sm text-destructive">
                Admin access required. Switch to Admin user to troubleshoot connectors.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Connector Troubleshooting</CardTitle>
                  <CardDescription>Select connector and start retrieval</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-2">
                    <Select
                      value={selectedSourceId}
                      onChange={(e) => {
                        setSelectedSourceId(e.target.value);
                        setSourceExtractionRows([]);
                        setSelectedRawDocument(null);
                      }}
                    >
                      <option value="">Select source connector</option>
                      {sourceSummaryRows.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name} ({row.id}) - {row.access_mode}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button onClick={triggerConnectorCall} disabled={retrievalRunning}>
                    {retrievalRunning ? "Retrieving..." : "Start Retrieval"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={clearSelectedSourceData}
                    disabled={!selectedSourceId || retrievalRunning || clearRunning}
                  >
                    {clearRunning ? "Clearing..." : "Clear Source Data"}
                  </Button>
                  {retrievalRunning ? (
                    <p className="text-xs text-muted-foreground">
                      {retrievalHint}
                    </p>
                  ) : null}
                  {lastIngestionRun ? (
                    <p className="text-xs text-muted-foreground">
                      Last run: {lastIngestionRun.id} | status: {lastIngestionRun.status} | type: {lastIngestionRun.run_type}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Collected Data (Current Run)</CardTitle>
                  <CardDescription>Shows only documents from the latest retrieval run</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Published</TableHead>
                        <TableHead>Run</TableHead>
                        <TableHead>Debug</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sourceExtractionRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.title || row.external_id || row.id}</TableCell>
                          <TableCell>{row.published_at || "N/A"}</TableCell>
                          <TableCell>{row.ingestion_run_id}</TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => loadRawDocumentDebug(row.id)}>View Raw</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {!sourceExtractionRows.length ? (
                    <p className="text-xs text-muted-foreground">No run data yet. Start a retrieval to populate this panel.</p>
                  ) : null}
                  {selectedRawDocument ? (
                    <pre className="max-h-80 overflow-auto rounded-md bg-slate-100 p-3 text-xs">
                      {JSON.stringify(selectedRawDocument.rawObjectJson || selectedRawDocument.rawObjectText, null, 2)}
                    </pre>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )
        ) : null}
      </div>
    </main>
  );
}
