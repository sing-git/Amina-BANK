// "Sonar" mark: a system pinging the public sphere and catching an anomaly
// (a detected KYC drift). Inline SVG so it inherits color via `currentColor`.
// Source artwork: assets/logo_sonar.svg.
export function SonarLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" stroke="currentColor" aria-hidden="true">
      {/* Central point — the bank / the system */}
      <circle cx="50" cy="75" r="4" fill="currentColor" />
      {/* Public scanning waves */}
      <path d="M 35 75 A 15 15 0 0 1 65 75" strokeWidth="4" strokeLinecap="round" />
      <path d="M 20 75 A 30 30 0 0 1 80 75" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
      <path d="M 5 75 A 45 45 0 0 1 95 75" strokeWidth="4" strokeLinecap="round" opacity="0.2" />
      {/* The anomaly — a detected KYC drift */}
      <circle cx="70" cy="40" r="6" fill="currentColor" />
      {/* Targeting line */}
      <path d="M 50 75 L 70 40" strokeWidth="2" strokeDasharray="4 4" />
    </svg>
  );
}
