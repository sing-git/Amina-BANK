// Sources tab — fetches the three intelligence feeds (news / sanctions / corporate registry),
// aggregates their geographic provenance, and renders the world map. Reuses the existing api.ts
// fetchers (each with a bundled offline fallback), so it renders even without the backend.
import { useEffect, useMemo, useState } from "react";
import { fetchDriftSignals, fetchSanctionsFlags, fetchRegistryDrift } from "../api";
import type { RawCompany, SanctionFlag, RegistryDriftEntry } from "../clusters/graph";
import { buildSourceMap } from "./sourceGeo";
import WorldMap from "./WorldMap";

export function SourcesView() {
  const [companies, setCompanies] = useState<RawCompany[]>([]);
  const [flags, setFlags] = useState<SanctionFlag[]>([]);
  const [registry, setRegistry] = useState<RegistryDriftEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([fetchDriftSignals(), fetchSanctionsFlags(), fetchRegistryDrift()]).then(
      ([c, f, r]) => {
        setCompanies(c);
        setFlags(f);
        setRegistry(r);
        setReady(true);
      },
    );
  }, []);

  const { points, regions } = useMemo(
    () => buildSourceMap(companies, flags, registry),
    [companies, flags, registry],
  );

  if (!ready) return <div className="empty">Loading sources…</div>;
  return <WorldMap points={points} regions={regions} />;
}
