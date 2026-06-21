import { useEffect, useMemo, useState } from "react";
import type { Alert, AuditEntry, RiskFlag } from "./types";
import { fetchAlerts, fetchAudit, postDecision } from "./api";
import {
  Bar,
  DirectionTag,
  driftArrow,
  humanize,
  MethodTag,
  QueueSummary,
  RiskPill,
  ScoreMeter,
  SyntheticChip,
} from "./ui";
import { ClustersView } from "./clusters/ClustersView";
import { SourcesView } from "./sources/SourcesView";
import { KycView } from "./kyc/KycView";
import aminaLogo from "../assets/AminaBank_logo.png";
import { SonarLogo } from "./SonarLogo";

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function App() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [signalDecisions, setSignalDecisions] = useState<Record<string, string>>({});
  const [signalNotes, setSignalNotes] = useState<Record<string, string>>({});
  const [view, setView] = useState<"queue" | "audit" | "clusters" | "sources" | "kyc">("queue");
  const [live, setLive] = useState(false);
  const [dataSource, setDataSource] = useState<string | undefined>(undefined);
  // queue filtering
  const [riskFilter, setRiskFilter] = useState<RiskFlag | "all">("all");
  const [query, setQuery] = useState("");
  const [fraudOnly, setFraudOnly] = useState(false);

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    fetchAlerts("portfolio").then((r) => {
      const sorted = [...r.alerts].sort(
        (a, b) => RANK[a.composite.riskFlag] - RANK[b.composite.riskFlag],
      );
      setAlerts(sorted);
      setLive(r.live);
      setDataSource(r.source);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    fetchAudit().then(setAudit);
  }, []);

  const current = useMemo(
    () => alerts.find((a) => a.baseline.clientId === selected) ?? null,
    [alerts, selected],
  );

  // Filtered view for the queue list ONLY — `current` stays on the full `alerts` array so
  // filtering a selected client out of the list doesn't blank the open detail pane.
  const visibleAlerts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return alerts.filter(
      (a) =>
        (riskFilter === "all" || a.composite.riskFlag === riskFilter) &&
        (!fraudOnly || a.composite.contributingSignals.some((s) => s.isFraudTypology)) &&
        (!q || a.baseline.legalName.toLowerCase().includes(q)),
    );
  }, [alerts, riskFilter, fraudOnly, query]);

  async function decide(alert: Alert, action: "approve" | "reject" | "escalate") {
    const detail = window.prompt(`Optional note for "${action}" on ${alert.baseline.legalName}:`) ?? "";
    const { entry } = await postDecision({
      clientId: alert.baseline.clientId,
      actor: "demo-analyst",
      action,
      detail,
    });
    if (entry) setAudit((a) => [entry, ...a]);
    setDecided((d) => ({ ...d, [alert.baseline.clientId]: action }));
  }

  async function decideSignal(
    alert: Alert,
    signalId: string,
    category: string,
    action: "approve" | "reject" | "escalate",
  ) {
    const { entry } = await postDecision({
      clientId: alert.baseline.clientId,
      actor: "demo-analyst",
      action: `signal-${action}`,
      detail: `${category} [${signalId}]`,
    });
    if (entry) setAudit((a) => [entry, ...a]);
    setSignalDecisions((d) => ({ ...d, [signalId]: action }));
  }

  async function noteSignal(alert: Alert, signalId: string, category: string) {
    const note = window.prompt("Add an analyst note for this signal:");
    if (!note) return;
    const { entry } = await postDecision({
      clientId: alert.baseline.clientId,
      actor: "demo-analyst",
      action: "signal-note",
      detail: `${category} [${signalId}]: ${note}`,
    });
    if (entry) setAudit((a) => [entry, ...a]);
    setSignalNotes((n) => ({ ...n, [signalId]: note }));
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="advisory">ADVISORY ONLY — a human approves every decision</span>
        </div>
        <div className="brand">
          <div className="brand-title-row">
            <SonarLogo className="brand-sonar" />
            <h1 className="brand-name">Risk Horizon</h1>
          </div>
        </div>
        <div className="topbar-right">
          <img className="brand-logo" src={aminaLogo} alt="AMINA" />
        </div>
      </header>

      <nav className="tabs">
        <button className={view === "queue" ? "tab tab-on" : "tab"} onClick={() => setView("queue")}>
          Alert Queue
        </button>
        <button className={view === "clusters" ? "tab tab-on" : "tab"} onClick={() => setView("clusters")}>
          Clusters
        </button>
        <button className={view === "sources" ? "tab tab-on" : "tab"} onClick={() => setView("sources")}>
          Sources
        </button>
        <button className={view === "kyc" ? "tab tab-on" : "tab"} onClick={() => setView("kyc")}>
          Onboarding
        </button>
        <button className={view === "audit" ? "tab tab-on" : "tab"} onClick={() => setView("audit")}>
          Audit Log {audit.length ? `(${audit.length})` : ""}
        </button>
      </nav>

      {view === "clusters" && <ClustersView />}

      {view === "sources" && <SourcesView />}

      {view === "kyc" && <KycView />}

      {loading && view !== "clusters" && view !== "sources" && view !== "kyc" && (
        <div className="empty">Loading…</div>
      )}

      {!loading && view === "queue" && (
        <>
          <QueueSummary alerts={alerts} live={live} source={dataSource} />
          <div className="queue-split">
            <aside className="queue-side">
              <QueueControls
                riskFilter={riskFilter}
                setRiskFilter={setRiskFilter}
                query={query}
                setQuery={setQuery}
                fraudOnly={fraudOnly}
                setFraudOnly={setFraudOnly}
                shown={visibleAlerts.length}
                total={alerts.length}
              />
              <Queue alerts={visibleAlerts} decided={decided} onOpen={setSelected} selectedId={selected} />
            </aside>
            <div className="queue-main">
              {current ? (
                <Detail
                  alert={current}
                  decided={decided[current.baseline.clientId]}
                  signalDecisions={signalDecisions}
                  signalNotes={signalNotes}
                  onSignalDecide={decideSignal}
                  onSignalNote={noteSignal}
                  onBack={() => setSelected(null)}
                  onDecide={decide}
                />
              ) : (
                <div className="empty">Select a client to review</div>
              )}
            </div>
          </div>
        </>
      )}

      {!loading && view === "audit" && <AuditView audit={audit} />}
    </div>
  );
}

const RISK_FILTERS: Array<RiskFlag | "all"> = ["all", "critical", "high", "medium", "low"];

function QueueControls({
  riskFilter,
  setRiskFilter,
  query,
  setQuery,
  fraudOnly,
  setFraudOnly,
  shown,
  total,
}: {
  riskFilter: RiskFlag | "all";
  setRiskFilter: (f: RiskFlag | "all") => void;
  query: string;
  setQuery: (q: string) => void;
  fraudOnly: boolean;
  setFraudOnly: (b: boolean) => void;
  shown: number;
  total: number;
}) {
  return (
    <div className="queue-controls">
      <div className="queue-filters">
        {RISK_FILTERS.map((f) => (
          <button
            key={f}
            className={riskFilter === f ? "src src-on" : "src"}
            onClick={() => setRiskFilter(f)}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button className={fraudOnly ? "src src-on" : "src"} onClick={() => setFraudOnly(!fraudOnly)}>
          ⚠ Fraud only
        </button>
      </div>
      <input
        className="queue-search"
        type="text"
        placeholder="Search client…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {shown !== total && <div className="queue-shown">{shown} of {total} shown</div>}
    </div>
  );
}

function Queue({
  alerts,
  decided,
  onOpen,
  selectedId,
}: {
  alerts: Alert[];
  decided: Record<string, string>;
  onOpen: (id: string) => void;
  selectedId: string | null;
}) {
  if (alerts.length === 0) {
    return <div className="empty">No clients match these filters.</div>;
  }
  return (
    <table className="queue">
      <thead>
        <tr>
          <th>Client</th>
          <th>Risk</th>
          <th>Score</th>
          <th>Flags</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {alerts.map((a) => {
          const top = a.composite.contributingSignals[0];
          const id = a.baseline.clientId;
          const sel = id === selectedId;
          const dec = decided[id];
          const sigCount = a.composite.contributingSignals.length;
          const neutralCount = a.composite.neutralSignals.length;
          const hasFraud = a.composite.contributingSignals.some((s) => s.isFraudTypology);
          return (
            <tr key={id} className={sel ? "qrow-on" : ""} onClick={() => onOpen(id)}>
              <td>
                <div className="client-name">{a.baseline.legalName}</div>
                <div className="client-sub">
                  {a.baseline.jurisdiction} · {a.baseline.legalForm} <SyntheticChip />
                  <span className="qrow-drift">{driftArrow(a.baseline.riskRating, a.composite.riskFlag)}</span>
                </div>
              </td>
              <td>
                <RiskPill flag={a.composite.riskFlag} />
              </td>
              <td style={{ minWidth: 110 }}>
                <ScoreMeter score={a.composite.compositeScore} />
              </td>
              <td className="signal-cell">
                <div>
                  {a.composite.hardGateTriggered
                    ? "Sanctions / PEP hit"
                    : top
                      ? humanize(top.category)
                      : neutralCount > 0
                        ? `0 risk · ${neutralCount} reviewed`
                        : "—"}
                </div>
                <div className="qrow-badges">
                  {sigCount > 0 && <span className="qrow-count">{sigCount} signal{sigCount > 1 ? "s" : ""}</span>}
                  {hasFraud && <span className="fraud-badge">⚠ FRAUD / AML</span>}
                  {a.jury && <span className="chip-stage" title="Adversarial jury ran">⚖ jury</span>}
                  {a.deepAnalysis && <span className="chip-stage" title="Stage 3 deep analysis">S3</span>}
                </div>
              </td>
              <td>
                {dec ? (
                  <span className={`decided decided-${dec}`}>{dec}</span>
                ) : (
                  <span className="open-link">{sel ? "viewing" : "review →"}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Detail({
  alert,
  decided,
  signalDecisions,
  signalNotes,
  onSignalDecide,
  onSignalNote,
  onBack,
  onDecide,
}: {
  alert: Alert;
  decided?: string;
  signalDecisions: Record<string, string>;
  signalNotes: Record<string, string>;
  onSignalDecide: (a: Alert, signalId: string, category: string, action: "approve" | "reject" | "escalate") => void;
  onSignalNote: (a: Alert, signalId: string, category: string) => void;
  onBack: () => void;
  onDecide: (a: Alert, action: "approve" | "reject" | "escalate") => void;
}) {
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
  const b = alert.baseline;
  const c = alert.composite;

  return (
    <main className="wrap detail">
      <button className="back" onClick={onBack}>
        ← Queue
      </button>

      <div className="detail-head">
        <div>
          <h1>
            {b.legalName} <SyntheticChip />
          </h1>
          <div className="client-sub">
            {b.jurisdiction} · {b.legalForm} · onboarded {b.onboardingDate} · generated by{" "}
            {b.generatedBy ?? "—"}
          </div>
        </div>
        <div className="detail-score">
          <RiskPill flag={c.riskFlag} />
          <ScoreMeter score={c.compositeScore} />
        </div>
      </div>

      {c.hardGateTriggered && (
        <div className="hardgate">⛔ SANCTIONS / PEP MATCH — {c.hardGateReason}</div>
      )}

      {alert.sanctionsReview && (
        <div className="review-queue">
          ⚠ SANCTIONS REVIEW PENDING — {alert.sanctionsReview.note}
          <ul>
            {alert.sanctionsReview.candidates.map((cand, i) => (
              <li key={i}>
                "{cand.name}" ≈ <b>{cand.matchedEntity}</b> (score {cand.score}, {cand.source}) — verify identity
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="card">
        <h3>Declared business (onboarding baseline)</h3>
        <p className="declared">{b.declaredBusinessDescription}</p>
        <div className="kv">
          <span>Expected monthly volume: ${b.expectedMonthlyVolumeUSD.toLocaleString()}</span>
          {b.expectedMonthlyTxCount != null && (
            <span>Expected monthly tx count: {b.expectedMonthlyTxCount.toLocaleString()}</span>
          )}
          <span>Onboarding risk: {b.riskRating}</span>
          {b.expectedCounterpartyRegions && b.expectedCounterpartyRegions.length > 0 && (
            <span>Expected regions: {b.expectedCounterpartyRegions.join(", ")}</span>
          )}
          <span>
            UBOs: {b.ubos.map((u) => `${u.name} (${u.ownershipPct}%${u.isPEP ? ", PEP" : ""})`).join(", ")}
          </span>
        </div>
      </section>

      {c.contributingSignals.length > 0 && (
        <section>
          <h3 className="sec-title">Contributing signals</h3>
          {c.contributingSignals.map((s) => (
            <div className="card signal" key={s.signalId}>
              <div className="signal-top">
                <strong>{humanize(s.category)}</strong>
                <DirectionTag direction={s.direction} />
                <MethodTag method={s.method} />
                {s.isFraudTypology && <span className="fraud-badge">⚠ FRAUD / AML</span>}
              </div>
              <p className="rationale">{s.rationale}</p>
              {s.suggestedAction && (
                <div className="action">▶ Recommended: {s.suggestedAction}</div>
              )}
              <div className="bars">
                <label>Magnitude {s.magnitude}</label>
                <Bar value={s.magnitude} max={100} kind="mag" />
                <label>Confidence {Math.round(s.confidence * 100)}%</label>
                <Bar value={s.confidence} max={1} kind="conf" />
              </div>
              <div className="cites">
                {s.sourceCitations.map((url) => (
                  <button
                    key={url}
                    className="cite"
                    onClick={() => setOpenEvidence(openEvidence === s.signalId ? null : s.signalId)}
                  >
                    🔗 {url}
                  </button>
                ))}
              </div>
              {openEvidence === s.signalId && alert.evidenceBySignal[s.signalId] && (
                <div className="evidence">
                  {alert.evidenceBySignal[s.signalId].map((e, i) => (
                    <div key={i} className="evidence-item">
                      <div className="evidence-url">{e.sourceUrl}</div>
                      <div>{e.text}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="signal-hitl">
                {signalDecisions[s.signalId] ? (
                  <span className={`sig-decided sig-${signalDecisions[s.signalId]}`}>
                    {signalDecisions[s.signalId] === "approve"
                      ? "✓ approved"
                      : signalDecisions[s.signalId] === "reject"
                        ? "✗ rejected"
                        : "↑ escalated"}
                  </span>
                ) : (
                  <>
                    <span className="sig-hitl-label">Analyst:</span>
                    <button className="sig-btn sig-approve" onClick={() => onSignalDecide(alert, s.signalId, s.category, "approve")}>
                      ✓ Approve
                    </button>
                    <button className="sig-btn sig-reject" onClick={() => onSignalDecide(alert, s.signalId, s.category, "reject")}>
                      ✗ Reject
                    </button>
                    <button className="sig-btn sig-escalate" onClick={() => onSignalDecide(alert, s.signalId, s.category, "escalate")}>
                      ↑ Escalate
                    </button>
                  </>
                )}
                <button className="sig-btn sig-note" onClick={() => onSignalNote(alert, s.signalId, s.category)}>
                  ✎ Note
                </button>
              </div>
              {signalNotes[s.signalId] && <div className="sig-note-text">📝 {signalNotes[s.signalId]}</div>}
            </div>
          ))}
        </section>
      )}

      {c.neutralSignals.length > 0 && (
        <section>
          <h3 className="sec-title muted">Threshold-refresh updates (not risk-increasing)</h3>
          {c.neutralSignals.map((s) => (
            <div className="card signal neutral" key={s.signalId}>
              <div className="signal-top">
                <strong>{humanize(s.category)}</strong>
                <DirectionTag direction={s.direction} />
              </div>
              <p className="rationale">{s.rationale}</p>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h3>Pipeline trace</h3>
        <ol className="trace">
          {alert.stageTrace.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      </section>

      {alert.jury && (
        <section className="card jury">
          <h3>
            Adversarial jury — verdict:{" "}
            <span className={`jury-verdict jury-${alert.jury.verdict}`}>
              {alert.jury.verdict.replace(/_/g, " ")} ({Math.round(alert.jury.confidence * 100)}%)
            </span>
          </h3>
          <div className="jury-cols">
            <div className="jury-col jury-pros">
              <div className="jury-label">⚖ Prosecution (risk is real)</div>
              <p>{alert.jury.prosecutionArgument}</p>
            </div>
            <div className="jury-col jury-def">
              <div className="jury-label">🛡 Defense (benign explanation)</div>
              <p>{alert.jury.defenseArgument}</p>
            </div>
          </div>
          <div className="jury-judge">
            <div className="jury-label">👨‍⚖️ Judge</div>
            <p>{alert.jury.judgeReasoning}</p>
            <div className="rec">Recommended: {alert.jury.recommendedAction}</div>
          </div>
        </section>
      )}

      {alert.deepAnalysis && (
        <section className="card deep">
          <h3>Stage 3 — deep analysis (Sonnet)</h3>
          <p>{alert.deepAnalysis.summary}</p>
          <details>
            <summary>Full reasoning chain</summary>
            <p className="rationale">{alert.deepAnalysis.fullReasoningChain}</p>
          </details>
          <div className="rec">Recommended action: {alert.deepAnalysis.recommendedAction}</div>
        </section>
      )}

      <div className="decision-bar">
        {decided ? (
          <span className={`decided decided-${decided}`}>Decision recorded: {decided}</span>
        ) : (
          <>
            <span className="decision-label">Human-in-the-loop — explicit action required:</span>
            <button className="btn btn-approve" onClick={() => onDecide(alert, "approve")}>
              Approve
            </button>
            <button className="btn btn-reject" onClick={() => onDecide(alert, "reject")}>
              Reject
            </button>
            <button className="btn btn-escalate" onClick={() => onDecide(alert, "escalate")}>
              Escalate
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function AuditView({ audit }: { audit: AuditEntry[] }) {
  return (
    <main className="wrap">
      <h3 className="sec-title">Immutable audit trail</h3>
      {audit.length === 0 ? (
        <div className="empty">No decisions recorded yet. Review an alert and approve/reject/escalate.</div>
      ) : (
        <table className="queue">
          <thead>
            <tr>
              <th>Time</th>
              <th>Client</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((e, i) => (
              <tr key={i}>
                <td className="mono">{e.ts}</td>
                <td>{e.clientId}</td>
                <td>{e.actor}</td>
                <td>
                  <span className={`decided decided-${e.action}`}>{e.action}</span>
                </td>
                <td>{e.detail || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
