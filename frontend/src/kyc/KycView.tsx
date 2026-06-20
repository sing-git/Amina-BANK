// Onboarding view — the KYC database (docs/kyc_database.json): the baseline data
// captured for each client at onboarding. Read-only reference cards.
import { useEffect, useMemo, useState } from "react";
import "./kyc.css";
import { fetchKycDatabase } from "../api";

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

function riskClass(rating?: string): string {
  const r = (rating ?? "").toLowerCase();
  if (r.includes("critical")) return "kyc-risk-critical";
  if (r.includes("high")) return "kyc-risk-high";
  if (r.includes("medium")) return "kyc-risk-medium";
  if (r.includes("low")) return "kyc-risk-low";
  return "kyc-risk-na";
}

export function KycView() {
  const [companies, setCompanies] = useState<KycCompany[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchKycDatabase().then(setCompanies);
  }, []);

  const filtered = useMemo(() => {
    if (!companies) return [];
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.legal_name.toLowerCase().includes(q) ||
        (c.jurisdiction ?? "").toLowerCase().includes(q) ||
        (c.company_id ?? "").toLowerCase().includes(q),
    );
  }, [companies, query]);

  if (!companies) return <div className="empty">Loading onboarding data…</div>;

  return (
    <div className="kyc-root">
      <div className="kyc-bar">
        <div>
          <h2 className="kyc-heading">Onboarded companies</h2>
          <p className="kyc-lead">KYC baselines captured at onboarding — the reference each drift signal is measured against.</p>
        </div>
        <input
          className="kyc-search"
          placeholder="Search company, jurisdiction, ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="kyc-grid">
        {filtered.map((c) => {
          const b = c.kyc_baseline ?? {};
          const people = Object.entries(c.key_personnel ?? {});
          return (
            <article className="kyc-card" key={c.company_id}>
              <header className="kyc-card-head">
                <div>
                  <h3 className="kyc-name">{c.legal_name}</h3>
                  <div className="kyc-sub">
                    {[c.jurisdiction, c.legal_form].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {b.risk_rating && (
                  <span className={`kyc-risk ${riskClass(b.risk_rating)}`}>{b.risk_rating}</span>
                )}
              </header>

              <div className="kyc-statusrow">
                {c.company_status && <span className="kyc-status">{c.company_status}</span>}
                {c.domain && (
                  <a className="kyc-domain" href={`https://${c.domain}`} target="_blank" rel="noreferrer">
                    {c.domain} ↗
                  </a>
                )}
              </div>

              {b.expected_business_model && (
                <Field label="Expected business model" value={b.expected_business_model} />
              )}
              {b.expected_activity_and_volumes && (
                <Field label="Expected activity & volumes" value={b.expected_activity_and_volumes} />
              )}
              {c.ownership && <Field label="Ownership" value={c.ownership} />}

              {people.length > 0 && (
                <div className="kyc-field">
                  <div className="kyc-label">Key personnel</div>
                  <div className="kyc-people">
                    {people.map(([role, name]) => (
                      <span className="kyc-person" key={role}>
                        <b>{role}</b> {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

            </article>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="kyc-field">
      <div className="kyc-label">{label}</div>
      <div className="kyc-value">{value}</div>
    </div>
  );
}
