# Amina-BANK

## Challenge Title

**Dynamic Risk Profiling System (Real-Time Intelligence)**

## Introduction

### Problem Description

Design and build an AI-powered Dynamic Risk Profiling System that monitors real-time public information and combines it with internal KYC and AML transaction screening data to detect potential financial risks early, while ensuring strong guardrails, compliance, and model reliability. The system should not only detect immediate fraud signals but also monitor slow, structural changes in customers or counterparties that invalidate previous KYC assumptions (KYC drift).

### Case Introduction

The challenge explores how AI can support proactive risk monitoring in a regulated banking environment while ensuring security, explainability, and strong governance. At its core is a real-time risk intelligence engine that continuously monitors public signals — news and public-domain information, corporate events, legal or regulatory signals, sanctions and adverse media, and market or operational risks — and combines them with internal inputs such as KYC data, customer profiles, AML transaction screening, risk ratings, and internal monitoring signals. From these inputs it generates early risk alerts, fraud warnings, risk scoring, compliance insights, and actionable recommendations.

## Potential Users *(Optional)*

[Describe who the solution should be tailored for.]

## Use Cases

Reference risk signals and the flags a strong system should raise (examples):

| Signal | Expected Flag |
|---|---|
| Sudden spike in negative news about a corporate client | High Reputational Risk |
| High-value cross-border transfers inconsistent with history | Behavioral Anomaly – Potential Money Mule |
| Multiple linked entities, low activity, sudden large flows | Structuring / Layering Risk |
| Legal entity name change | Entity Identity Change – Re-KYC Required |
| Domain switch or significant website content change | Business Activity Change Signal |
| Public pivot (e.g. SaaS startup → crypto trading) | Material Business Model Change |
| Jurisdiction move or change of legal form (e.g. GmbH → offshore) | Structural Risk Change |
| New shareholders or beneficial owners appear | Ownership Change – KYC Drift |
| Large funding round or rapid geographic expansion | Scale Risk Change |
| Previously dormant company begins high transaction volume | Dormancy Break – Suspicious Activation |

Each flag should be paired with a recommended action, such as triggering enhanced due diligence, escalating to compliance review, refreshing KYC, re-screening against sanctions/PEP lists, or opening an AML investigation.

## Expected Outcome

A working AI system built around a two-layer approach:

- **Layer 1 — Public Real-Time Intelligence (non-sensitive, primary focus):** capture a wide range of signals from public sources (news, domain changes, funding announcements, company websites and scraping, Crunchbase / funding news, government registries where accessible, sanctions lists, adverse media, registry/legal updates).
- **Layer 2 — Simulated Internal Bank Intelligence (sensitive):** pick a real public company/startup and define a baseline KYC profile as if the bank had onboarded them (expected business model, expected activity and transaction volumes, risk rating), then use it to narrow down the public signals.

Teams must also design a security and governance framework, including: data separation between public and internal data, encryption, secure APIs, role-based access control, data masking, and audit logs; model guardrails such as human-in-the-loop validation, explainable AI, confidence scores, source citations, output restrictions, and bias/hallucination checks; and a decision-governance layer with risk approval workflows, compliance review, manual validation, escalation, and approval checkpoints.

## Technology *(Optional)*

### Available Technology

Public sources participants can draw on include news and public-domain information, company websites (with scraping), Crunchbase / funding news, government registries (where accessible), sanctions lists (OFAC, EU), and adverse media.

### Expected or Suggested Tech Stack

No specific stack is required. Because cost awareness is part of the challenge, a staged, cost-aware pipeline is recommended: Stage 1 — cheap filtering (rules, embeddings, small model); Stage 2 — LLM reasoning for high-risk cases only; Stage 3 — deep analysis for escalated alerts. Teams must track approximate token usage per workflow, estimate cost per 1,000 analyses/alerts, and show where lightweight (cheap, fast) versus heavy (deep reasoning) models are used.

## Challenge Slides

[Add link to the challenge introduction slides.]

## Resources & Further Information

### Relevant Links

[Add relevant links here.]

### Additional Information

Guardrails are central to this challenge: models must not make incorrect assumptions or unsafe decisions, no sensitive data should leak, and access must remain controlled and compliant. Cost efficiency is explicitly evaluated, so teams should be deliberate about model selection across the pipeline.

## Judging Criteria

| Category | What Good Looks Like | Weight |
|---|---|---|
| AI Intelligence Quality | Accurate flags, strong reasoning, useful insights | 25% |
| Cost Efficiency | Smart model usage, efficient pipelines | 20% |
| UX & Explainability | Clear alerts, intuitive UI, human-readable reasoning | 20% |
| Compliance & Safety | Guardrails, explainability, auditability | 20% |
| Engineering & Architecture | Scalable design, modular pipelines, robustness | 15% |

## Point of Contact

### Contact Person(s)

[Add name(s) of point(s) of contact.]

### Availability

[Add availability during the event, for example agenda if in person, or email/contact details if remote support is available throughout the weekend.]

## Prize

The winning team members will each receive:

[Describe the prize, for example an opportunity to present the solution to management.]
