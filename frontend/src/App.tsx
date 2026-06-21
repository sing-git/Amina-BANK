import { useEffect, useMemo, useState } from "react";
import type { Alert, AuditEntry } from "./types";
import { fetchAlerts, fetchAudit, postDecision, type DataSource } from "./api";
import { Bar, DirectionTag, driftArrow, humanize, RiskPill, ScoreMeter, SyntheticChip } from "./ui";
import { ClustersView } from "./clusters/ClustersView";
import { SourcesIntelView } from "./sources/SourcesIntelView";
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
  const [source, setSource] = useState<DataSource>("demo");

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    fetchAlerts(source).then((r) => {
      const sorted = [...r.alerts].sort(
        (a, b) => RANK[a.composite.riskFlag] - RANK[b.composite.riskFlag],
      );
      setAlerts(sorted);
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
      {/* ── Topbar ── */}
      <header className="topbar">
        <div className="topbar-left" />
        <div className="topbar-center">
          <div className="brand-title-row">
            <SonarLogo className="brand-sonar" />
            <h1 className="brand-name">Risk Horizon</h1>
          </div>
        </div>
        <div className="topbar-right">
          {view !== "clusters" && view !== "sources" && view !== "kyc" && (
            <div className="data-source-toggle">
              <button className={source === "demo" ? "ds-btn ds-btn-on" : "ds-btn"} onClick={() => setSource("demo")}>
                Demo cases
              </button>
              <button className={source === "portfolio" ? "ds-btn ds-btn-on" : "ds-btn"} onClick={() => setSource("portfolio")}>
                Team portfolio
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Body: sidenav + content ── */}
      <div className="app-body">
        <nav className="sidenav">
          <NavItem icon={<IconBell />}    label="Alert Queue" active={view === "queue"}    onClick={() => setView("queue")} />
          <NavItem icon={<IconNetwork />} label="Clusters"    active={view === "clusters"} onClick={() => setView("clusters")} />
          <NavItem icon={<IconGrid />}    label="Sources"     active={view === "sources"}  onClick={() => setView("sources")} />
          <NavItem icon={<IconUser />}    label="Onboarding"  active={view === "kyc"}      onClick={() => setView("kyc")} />
          <NavItem icon={<IconClock />}   label="Audit Log"   active={view === "audit"}    onClick={() => setView("audit")}
            badge={audit.length || undefined} />
        </nav>

        <div className="app-content">
          {view === "clusters" && <ClustersView />}
          {view === "sources"  && <SourcesIntelView />}
          {view === "kyc"      && <KycView />}

          {loading && view !== "clusters" && view !== "sources" && view !== "kyc" && (
            <div className="empty">Loading…</div>
          )}

          {!loading && view === "queue" && (
            <div className={`queue-layout ${current ? "queue-layout-split" : ""}`}>
              <aside className={`queue-side ${current ? "queue-side-narrow" : "queue-side-full"}`}>
                <Queue alerts={alerts} decided={decided} onOpen={setSelected} selectedId={selected} />
              </aside>
              {current && (
                <div className="queue-main">
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
                </div>
              )}
            </div>
          )}

          {!loading && view === "audit" && <AuditView audit={audit} />}

          <footer className="site-footer">
            <div className="site-footer-inner">
              <img className="footer-logo" src={aminaLogo} alt="AMINA" />
              <span className="footer-text">Risk Horizon is powered by AMINA Bank's AI compliance infrastructure.</span>
              <span className="footer-copy">&copy; {new Date().getFullYear()} AMINA Group AG</span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

/* ── Sidenav helpers ─────────────────────────────────────────────── */
function NavItem({ icon, label, active, onClick, badge }: {
  icon: React.ReactNode; label: string; active: boolean;
  onClick: () => void; badge?: number;
}) {
  return (
    <button className={`sidenav-item ${active ? "sidenav-item-on" : ""}`} onClick={onClick}>
      <span className="sidenav-icon">{icon}</span>
      <span className="sidenav-label">{label}</span>
      {badge ? <span className="sidenav-badge">{badge}</span> : null}
    </button>
  );
}

const IconBell = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
  </svg>
);
const IconNetwork = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
    <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92c0-1.61-1.31-2.92-2.92-2.92z"/>
  </svg>
);
const IconUser = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v1c0 .55.45 1 1 1h14c.55 0 1-.45 1-1v-1c0-2.66-5.33-4-8-4z"/>
  </svg>
);
const IconClock = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
    <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z"/>
  </svg>
);
const IconGrid = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
    <path d="M3 3h7v7H3V3zm0 11h7v7H3v-7zm11-11h7v7h-7V3zm0 11h7v7h-7v-7z"/>
  </svg>
);

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
  return (
    <>
      <div className="queue-page-head">
        <h2 className="queue-page-title">Alert Queue</h2>
        <span className="queue-page-count">{alerts.length} client{alerts.length !== 1 ? "s" : ""}</span>
      </div>
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
                {a.composite.hardGateTriggered
                  ? "Sanctions / PEP hit"
                  : top
                    ? humanize(top.category)
                    : "—"}
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
    </>
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
        <div className="detail-avatar" data-risk={c.riskFlag}>
          {b.legalName.split(/\s+/).slice(0,2).map((w: string) => w[0]).join("").toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>
            {b.legalName} <SyntheticChip />
          </h1>
          <div className="client-sub">
            {b.jurisdiction} · {b.legalForm} · onboarded {b.onboardingDate}
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
