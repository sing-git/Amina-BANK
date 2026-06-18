# Amina-BANK

## Challenge Title

**Dynamic Risk Profiling System (Real-Time Intelligence)**

## Introduction

### Problem Description

Institutional financial services face a growing challenge: detecting unusual financial behavior and risk signals early enough to act. While banks hold rich internal data through KYC and AML processes, the signals that matter most often emerge first in the public domain — in news, corporate registries, funding announcements, and adverse media. This challenge asks teams to build a predictive AI system that combines real-time public intelligence with internal KYC and AML data to detect financial risks early, in a secure and compliant manner.

### Case Introduction

The challenge explores how AI can support proactive risk monitoring in a regulated banking environment while ensuring security, explainability, and strong governance. At its core is a real-time risk intelligence engine that continuously monitors public signals — news and public-domain information, corporate events, legal or regulatory developments, sanctions and adverse media, and market or operational risks — and combines them with internal inputs such as KYC data, customer profiles, AML transaction screening, risk ratings, and internal monitoring signals. From these inputs it generates early risk alerts, fraud warnings, risk scoring, compliance insights, and actionable recommendations.

A key focus is **KYC Drift Detection**: the system should not only detect immediate fraud signals, but also monitor slow, structural changes in customers or counterparties that invalidate previous KYC assumptions.

## Potential Users
Compliance, AML, and KYC teams in a regulated banking context, as well as risk officers responsible for ongoing customer due diligence and transaction monitoring.

## Use Cases

Reference risk signals and expected flags — examples of what a strong system should detect:

| Signal | Expected Flag | Recommended Action |
|---|---|---|
| Sudden spike in negative news about a corporate client | High Reputational Risk | Trigger enhanced due diligence; escalate to compliance review |
| High-value cross-border transfers inconsistent with historical behaviour | Behavioural Anomaly – Potential Money Mule | Monitor transactions; flag for AML analyst review |
| Multiple linked entities, low activity, sudden large flows | Structuring / Layering Risk | Trigger AML investigation |
| Legal entity name change | Entity Identity Change – Re-KYC Required | Trigger KYC refresh; re-evaluate risk category |
| Domain switch or significant website content change | Business Activity Change Signal | Re-analyse website content; compare vs. original onboarding data |
| Public pivot (e.g. SaaS startup → crypto trading) | Material Business Model Change | Update risk classification; escalate for compliance review |
| Jurisdiction move or change of legal form (e.g. GmbH → offshore) | Structural Risk Change | Trigger enhanced due diligence; re-check beneficial ownership |
| New shareholders or beneficial owners appear | Ownership Change – KYC Drift | Full ownership verification; re-screen against sanctions/PEP lists |
| Large funding round or rapid geographic expansion | Scale Risk Change | Reassess transaction monitoring thresholds; update activity profile |
| Previously dormant company begins high transaction volume | Dormancy Break – Suspicious Activation | Trigger AML review; validate business legitimacy |

## Expected Outcome

A working AI system built around a two-layer approach:

**Layer 1 — Public Real-Time Intelligence (non-sensitive, primary focus):** capture a wide range of signals from public sources — news and adverse media, domain changes, funding announcements, company websites and scraping, Crunchbase and funding news, government registries where accessible, sanctions lists (OFAC, EU), adverse media screening, and registry and legal updates.

**Layer 2 — Simulated Internal Bank Intelligence (sensitive):** pick a real public company or startup and define a baseline KYC profile as if the bank had onboarded them (expected business model, expected activity and transaction volumes, risk rating). Use it to narrow down and contextualise the public signals from Layer 1.

Teams must also design a security and governance framework across three layers:
- **Data Security:** data separation between public and internal data, encryption, secure APIs, role-based access control, data masking, and audit logs.
- **Model Guardrails:** human-in-the-loop validation, explainable AI, confidence scores, source citations, output restrictions, and bias and hallucination checks.
- **Decision Governance:** risk approval workflows, compliance review, manual validation, escalation processes, and approval checkpoints.

## Technology

### Available Technology

Public sources participants can draw on:
- News and adverse media: Google News RSS, GDELT Project, NewsAPI, Mediastack API
- Sanctions and watchlists: OFAC, EU Financial Sanctions Database, UN Security Council, OpenSanctions (aggregated — recommended)
- Corporate registry and ownership data: GLEIF LEI Database, UK Companies House API, OpenCorporates, Swiss ZEFIX Registry
- Funding and startup intelligence: Crunchbase (primary), Wellfound, PitchBook, Tracxn
- Website and domain monitoring: WHOIS ICANN Lookup, SecurityTrails, Wayback Machine, Diffbot, Firecrawl

### Expected or Suggested Tech Stack

No specific stack is required. Because cost awareness is a core part of the challenge, a staged pipeline is recommended:

- Stage 1 — cheap filtering (rules, embeddings, small model)
- Stage 2 — LLM reasoning for high-risk cases only
- Stage 3 — deep analysis for escalated alerts

Teams must track approximate token usage per workflow, estimate cost per 1,000 analyses or alerts, and demonstrate where lightweight versus heavy models are used.

## Challenge Slides

[Add link to the challenge introduction slides.]

## Resources & Further Information

### Relevant Links

**News & Adverse Media**
- [Google News RSS](https://news.google.com)
- [GDELT Project](https://www.gdeltproject.org)
- [NewsAPI](https://newsapi.org)
- [Mediastack API](https://mediastack.com)

**Sanctions & Watchlists**
- [OFAC Sanctions List Service](https://ofac.treasury.gov/sanctions-list-service)
- [EU Financial Sanctions Database](https://webgate.ec.europa.eu/fsd/fsf/)
- [UN Security Council Sanctions Lists](https://www.un.org/securitycouncil/sanctions/information)
- [OpenSanctions](https://www.opensanctions.org) *(aggregated — recommended)*

**Corporate Registry & Ownership Data**
- [GLEIF LEI Database](https://www.gleif.org/en/lei-data)
- [UK Companies House API](https://developer.company-information.service.gov.uk)
- [OpenCorporates](https://opencorporates.com)
- [Swiss ZEFIX Registry](https://www.zefix.ch)

**Funding & Startup Intelligence**
- [Crunchbase](https://www.crunchbase.com) *(primary source)*
- [Wellfound](https://wellfound.com)
- [PitchBook](https://pitchbook.com)
- [Tracxn](https://tracxn.com)

**Website & Domain Monitoring**
- [WHOIS Lookup ICANN](https://lookup.icann.org)
- [SecurityTrails](https://securitytrails.com)
- [Wayback Machine](https://web.archive.org)
- [Diffbot](https://www.diffbot.com)
- [Firecrawl](https://firecrawl.dev)

### Additional Information

Guardrails are central to this challenge: models must not make incorrect assumptions or unsafe decisions, no sensitive data should leak, and access must remain controlled and compliant. Cost efficiency is explicitly evaluated — teams should be deliberate about model selection at each stage of the pipeline.

## Judging Criteria

| Criterion | Description | Weight |
|---|---|---|
| AI Intelligence Quality | Accurate flags, strong reasoning, useful insights | 25% |
| Cost Efficiency | Smart model usage, efficient pipelines | 20% |
| UX & Explainability | Clear alerts, intuitive UI, human-readable reasoning | 20% |
| Compliance & Safety | Guardrails, explainability, auditability | 20% |
| Engineering & Architecture | Scalable design, modular pipelines, robustness | 15% |

## Point of Contact

### Contact Person(s)

| Name | Role |
|---|---|
| Jürgen Hofbauer |  Business Lead |
| Marcin Nowrot |  Technical Support |

### Availability

In person throughout the event (SwissHacks, Zurich, 19 to 21 June 2026). Mentors will be on-site on the evening of 19 June after the presentations, and on 20 June from 9:00 to 12:00.

## Prize

The winning team will be invited to present their solution at AMINA Bank's offices and network with the team.
