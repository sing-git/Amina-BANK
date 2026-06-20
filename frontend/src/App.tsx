import { useEffect, useMemo, useState } from "react";
import type { Alert, AuditEntry, Cost } from "./types";
import { fetchAlerts, fetchAudit, postDecision, type DataSource } from "./api";
import { Bar, DirectionTag, driftArrow, humanize, RiskPill, ScoreMeter, SyntheticChip } from "./ui";

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function App() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cost, setCost] = useState<Cost | null>(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [signalDecisions, setSignalDecisions] = useState<Record<string, string>>({});
  const [signalNotes, setSignalNotes] = useState<Record<string, string>>({});
  const [view, setView] = useState<"queue" | "audit">("queue");
  const [source, setSource] = useState<DataSource>("demo");

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    fetchAlerts(source).then((r) => {
      const sorted = [...r.alerts].sort(
        (a, b) => RANK[a.composite.riskFlag] - RANK[b.composite.riskFlag],
      );
      setAlerts(sorted);
      setCost(r.cost);
      setLive(r.live);
      setLoading(false);
    });
  }, [source]);

  useEffect(() => {
    fetchAudit().then(setAudit);
  }, []);

  const current = useMemo(
    () => alerts.find((a) => a.baseline.clientId === selected) ?? null,
    [alerts, selected],
  );

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

  async function decideSignal(alert: Alert, signalId: string, category: string, action: "validate" | "dismiss") {
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
        <div className="brand">
          <span className="brand-mark">◆</span> AMINA · Risk Horizon
          <span className="brand-sub">Dynamic KYC-Drift Monitoring</span>
        </div>
        <div className="topbar-right">
          <span className="advisory">ADVISORY ONLY — a human approves every decision</span>
          <span className={`mode ${live ? "mode-live" : "mode-offline"}`}>
            {live ? "● backend live" : "○ offline (seed data)"}
          </span>
        </div>
      </header>

      <nav className="tabs">
        <button className={view === "queue" ? "tab tab-on" : "tab"} onClick={() => setView("queue")}>
          Alert Queue
        </button>
        <button className={view === "audit" ? "tab tab-on" : "tab"} onClick={() => setView("audit")}>
          Audit Log {audit.length ? `(${audit.length})` : ""}
        </button>
        <div className="source-toggle">
          <button className={source === "demo" ? "src src-on" : "src"} onClick={() => setSource("demo")}>
            Demo cases
          </button>
          <button className={source === "portfolio" ? "src src-on" : "src"} onClick={() => setSource("portfolio")}>
            Team portfolio
          </button>
        </div>
      </nav>

      {loading && <div className="empty">Loading…</div>}

      {!loading && view === "queue" && !current && (
        <Queue alerts={alerts} cost={cost} decided={decided} onOpen={setSelected} />
      )}

      {!loading && view === "queue" && current && (
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
      )}

      {!loading && view === "audit" && <AuditView audit={audit} />}
    </div>
  );
}

function Queue({
  alerts,
  cost,
  decided,
  onOpen,
}: {
  alerts: Alert[];
  cost: Cost | null;
  decided: Record<string, string>;
  onOpen: (id: string) => void;
}) {
  return (
    <main className="wrap">
      {cost && (
        <div className="cost-strip">
          <div>
            <span className="cost-num">{cost.calls}</span> LLM calls
          </div>
          <div>
            <span className="cost-num">${cost.totalUSD.toFixed(4)}</span> total
          </div>
          <div>
            <span className="cost-num">${cost.costPer1000USD.toFixed(2)}</span> / 1,000 analyses
          </div>
          <div className="cost-note">cheap filters first · LLM only on flagged cases</div>
        </div>
      )}
      <table className="queue">
        <thead>
          <tr>
            <th>Client</th>
            <th>Risk</th>
            <th>Score</th>
            <th>KYC drift</th>
            <th>Top signal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => {
            const top = a.composite.contributingSignals[0];
            return (
              <tr key={a.baseline.clientId} onClick={() => onOpen(a.baseline.clientId)}>
                <td>
                  <div className="client-name">{a.baseline.legalName}</div>
                  <div className="client-sub">
                    {a.baseline.jurisdiction} · {a.baseline.legalForm} <SyntheticChip />
                  </div>
                </td>
                <td>
                  <RiskPill flag={a.composite.riskFlag} />
                </td>
                <td style={{ minWidth: 120 }}>
                  <ScoreMeter score={a.composite.compositeScore} />
                </td>
                <td className="drift">{driftArrow(a.baseline.riskRating, a.composite.riskFlag)}</td>
                <td className="signal-cell">
                  {a.composite.hardGateTriggered
                    ? "Sanctions / PEP hit"
                    : top
                      ? humanize(top.category)
                      : "—"}
                </td>
                <td>
                  {decided[a.baseline.clientId] ? (
                    <span className={`decided decided-${decided[a.baseline.clientId]}`}>
                      {decided[a.baseline.clientId]}
                    </span>
                  ) : (
                    <span className="open-link">review →</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
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
  onSignalDecide: (a: Alert, signalId: string, category: string, action: "validate" | "dismiss") => void;
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
          <span>Onboarding risk: {b.riskRating}</span>
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
                    {signalDecisions[s.signalId] === "validate" ? "✓ validated" : "✗ dismissed"}
                  </span>
                ) : (
                  <>
                    <span className="sig-hitl-label">Analyst:</span>
                    <button className="sig-btn sig-validate" onClick={() => onSignalDecide(alert, s.signalId, s.category, "validate")}>
                      ✓ Validate
                    </button>
                    <button className="sig-btn sig-dismiss" onClick={() => onSignalDecide(alert, s.signalId, s.category, "dismiss")}>
                      ✗ Dismiss
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
