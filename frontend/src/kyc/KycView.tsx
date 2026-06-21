import { useEffect, useMemo, useState } from "react";
import "./kyc.css";
import { fetchKycDatabase } from "../api";
import creditSuisseMark from "../assets/credit-suisse-mark.svg";

export interface KycBaseline {
  expected_business_model?: string;
  expected_activity_and_volumes?: string;
  risk_rating?: string;
  domain_registrar?: string;
  domain_nameservers?: string[];
  domain_registrant_org?: string;
}
export interface KycCompany {
  company_id: string;
  legal_name: string;
  domain?: string;
  legal_form?: string;
  jurisdiction?: string;
  company_status?: string;
  ownership?: string;
  kyc_baseline?: KycBaseline;
  key_personnel?: Record<string, string>;
}

const RISK_ORDER = ["Critical", "High", "Medium", "Low", "N/A"];

function riskLevel(rating?: string): string {
  const r = (rating ?? "").toLowerCase();
  if (r.includes("critical")) return "Critical";
  if (r.includes("high")) return "High";
  if (r.includes("medium")) return "Medium";
  if (r.includes("low")) return "Low";
  return "N/A";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// Per-domain logo overrides for brands where auto-fetch may fail (acquired/merged brands etc.)
const LOGO_OVERRIDE: Record<string, string> = {
  "credit-suisse.com": creditSuisseMark,
};

// Ordered list of logo URL factories to try in sequence until one succeeds.
function logoSources(domain: string): string[] {
  const override = LOGO_OVERRIDE[domain];
  return [
    ...(override ? [override] : []),
    `https://logo.clearbit.com/${domain}`,
    `https://www.google.com/s2/favicons?sz=256&domain=${domain}`,
  ];
}

function CompanyAvatar({
  domain,
  name,
  risk,
  size = "card",
}: {
  domain?: string;
  name: string;
  risk: string;
  size?: "card" | "modal";
}) {
  const sources = domain ? logoSources(domain) : [];
  const [attempt, setAttempt] = useState(0);
  const logoUrl = attempt < sources.length ? sources[attempt] : null;
  const cls = size === "modal" ? "kyc-panel-avatar" : "kyc-avatar";

  if (logoUrl) {
    return (
      <div className={`${cls} kyc-avatar-logo`}>
        <img
          src={logoUrl}
          alt={name}
          onError={() => setAttempt((a) => a + 1)}
        />
      </div>
    );
  }

  return (
    <div className={`${cls} kyc-avatar-${risk.toLowerCase()}`}>
      {initials(name)}
    </div>
  );
}

export function KycView() {
  const [companies, setCompanies] = useState<KycCompany[] | null>(null);
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState("All");
  const [selected, setSelected] = useState<KycCompany | null>(null);

  useEffect(() => {
    fetchKycDatabase().then(setCompanies);
  }, []);

  const stats = useMemo(() => {
    if (!companies) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    for (const c of companies) {
      const r = riskLevel(c.kyc_baseline?.risk_rating);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return counts;
  }, [companies]);

  const filtered = useMemo(() => {
    if (!companies) return [];
    const q = query.trim().toLowerCase();
    return companies.filter((c) => {
      const matchSearch =
        !q ||
        c.legal_name.toLowerCase().includes(q) ||
        (c.jurisdiction ?? "").toLowerCase().includes(q) ||
        (c.company_id ?? "").toLowerCase().includes(q);
      const matchRisk =
        riskFilter === "All" || riskLevel(c.kyc_baseline?.risk_rating) === riskFilter;
      return matchSearch && matchRisk;
    });
  }, [companies, query, riskFilter]);

  if (!companies) return <div className="empty">Loading onboarding data…</div>;

  return (
    <div className="kyc-root">
      {/* Header */}
      <div className="kyc-header">
        <div className="kyc-header-text">
          <h2 className="kyc-heading">Onboarding</h2>
          <p className="kyc-lead">KYC baselines captured at onboarding — the reference each drift signal is measured against.</p>
        </div>
        <div className="kyc-stats">
          <div className="kyc-stat-chip kyc-stat-all">
            <span className="kyc-stat-num">{companies.length}</span>
            <span className="kyc-stat-label">Total</span>
          </div>
          {RISK_ORDER.filter((r) => stats[r]).map((r) => (
            <div key={r} className={`kyc-stat-chip kyc-stat-${r.toLowerCase()}`}>
              <span className="kyc-stat-num">{stats[r]}</span>
              <span className="kyc-stat-label">{r}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="kyc-toolbar">
        <div className="kyc-risk-filters">
          {["All", ...RISK_ORDER.filter((r) => stats[r])].map((r) => (
            <button
              key={r}
              className={`kyc-filter-btn kyc-filter-${r.toLowerCase()} ${riskFilter === r ? "kyc-filter-on" : ""}`}
              onClick={() => setRiskFilter(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <input
          className="kyc-search"
          placeholder="Search company, jurisdiction, ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Grid */}
      <div className="kyc-body">
        <div className="kyc-grid">
          {filtered.length === 0 && (
            <p className="kyc-empty">No companies match your filters.</p>
          )}
          {filtered.map((c, i) => {
            const risk = riskLevel(c.kyc_baseline?.risk_rating);
            const people = Object.entries(c.key_personnel ?? {});
            const isSelected = selected?.company_id === c.company_id;
            return (
              <article
                key={c.company_id}
                className={`kyc-card kyc-card-${risk.toLowerCase()} ${isSelected ? "kyc-card-active" : ""}`}
                style={{ animationDelay: `${i * 35}ms` }}
                onClick={() => setSelected(isSelected ? null : c)}
              >
                <div className="kyc-card-top">
                  <CompanyAvatar domain={c.domain} name={c.legal_name} risk={risk} size="card" />
                  <div className="kyc-card-title">
                    <h3 className="kyc-name">{c.legal_name}</h3>
                    <div className="kyc-sub">
                      {[c.jurisdiction, c.legal_form].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span className={`kyc-risk kyc-risk-${risk.toLowerCase()}`}>{risk}</span>
                </div>

                {c.kyc_baseline?.expected_business_model && (
                  <p className="kyc-model">{c.kyc_baseline.expected_business_model}</p>
                )}

                <div className="kyc-card-footer">
                  {c.company_status && (
                    <span className={`kyc-status-badge ${c.company_status === "Active" ? "kyc-status-active" : "kyc-status-other"}`}>
                      {c.company_status}
                    </span>
                  )}
                  {c.domain && (
                    <a
                      className="kyc-domain"
                      href={`https://${c.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.domain} ↗
                    </a>
                  )}
                  {people.slice(0, 2).map(([role, name]) => (
                    <span key={role} className="kyc-person-chip">{role}: {name}</span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>

      </div>

      {/* Modal */}
      {selected && (
        <div className="kyc-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="kyc-modal" key={selected.company_id} onClick={(e) => e.stopPropagation()}>
            {/* Modal header */}
            <div className={`kyc-modal-head kyc-modal-head-${riskLevel(selected.kyc_baseline?.risk_rating).toLowerCase()}`}>
              <div className="kyc-modal-head-inner">
                <CompanyAvatar domain={selected.domain} name={selected.legal_name} risk={riskLevel(selected.kyc_baseline?.risk_rating)} size="modal" />
                <div>
                  <h2 className="kyc-panel-name">{selected.legal_name}</h2>
                  <div className="kyc-panel-sub">
                    {[selected.jurisdiction, selected.legal_form].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="kyc-modal-badges">
                  <span className={`kyc-risk kyc-risk-${riskLevel(selected.kyc_baseline?.risk_rating).toLowerCase()}`}>
                    {riskLevel(selected.kyc_baseline?.risk_rating)} Risk
                  </span>
                  {selected.company_status && (
                    <span className={`kyc-status-badge ${selected.company_status === "Active" ? "kyc-status-active" : "kyc-status-other"}`}>
                      {selected.company_status}
                    </span>
                  )}
                  <span className="kyc-panel-id">{selected.company_id}</span>
                </div>
              </div>
              <button className="kyc-panel-close" onClick={() => setSelected(null)}>✕</button>
            </div>

            {/* Modal body — two columns */}
            <div className="kyc-modal-body">
              <div className="kyc-modal-col">
                {selected.kyc_baseline?.expected_business_model && (
                  <PanelSection label="Business model" value={selected.kyc_baseline.expected_business_model} />
                )}
                {selected.kyc_baseline?.expected_activity_and_volumes && (
                  <PanelSection label="Expected activity & volumes" value={selected.kyc_baseline.expected_activity_and_volumes} />
                )}
                {selected.ownership && (
                  <PanelSection label="Ownership" value={selected.ownership} />
                )}
              </div>

              <div className="kyc-modal-col">
                {Object.keys(selected.key_personnel ?? {}).length > 0 && (
                  <div className="kyc-section">
                    <div className="kyc-section-label">Key personnel</div>
                    <div className="kyc-people-grid">
                      {Object.entries(selected.key_personnel ?? {}).map(([role, name]) => (
                        <div key={role} className="kyc-person-card">
                          <div className="kyc-person-role">{role}</div>
                          <div className="kyc-person-name">{name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.domain && (
                  <div className="kyc-section">
                    <div className="kyc-section-label">Domain</div>
                    <a className="kyc-domain-link" href={`https://${selected.domain}`} target="_blank" rel="noreferrer">
                      {selected.domain} ↗
                    </a>
                    {selected.kyc_baseline?.domain_registrar && (
                      <div className="kyc-domain-meta">Registrar: {selected.kyc_baseline.domain_registrar}</div>
                    )}
                    {selected.kyc_baseline?.domain_registrant_org && (
                      <div className="kyc-domain-meta">Registrant: {selected.kyc_baseline.domain_registrant_org}</div>
                    )}
                    {(selected.kyc_baseline?.domain_nameservers ?? []).length > 0 && (
                      <div className="kyc-ns-list">
                        {selected.kyc_baseline!.domain_nameservers!.map((ns) => (
                          <span key={ns} className="kyc-ns-chip">{ns}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PanelSection({ label, value }: { label: string; value: string }) {
  return (
    <div className="kyc-section">
      <div className="kyc-section-label">{label}</div>
      <div className="kyc-section-value">{value}</div>
    </div>
  );
}
