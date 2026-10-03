import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Layout } from "./components/Layout";
import { KEYS, usePersistent } from "./lib/store";
import { AskPage } from "./pages/Ask";
import { BookmarksPage } from "./pages/Bookmarks";
import { EmergencyGrid, ProtocolCardPage } from "./pages/Emergency";
import { GuidePage } from "./pages/Guide";
import { Home } from "./pages/Home";
import { DomainPage, LibraryPage } from "./pages/Library";
import { Onboarding } from "./pages/Onboarding";
import { PacksPage } from "./pages/Packs";
import { SearchPage } from "./pages/Search";
import { SettingsPage } from "./pages/Settings";
import { SuppliesPage } from "./pages/Supplies";
import { ToolsPage } from "./pages/Tools";
import { CompassPage } from "./pages/tools/Compass";
import { FlashlightPage } from "./pages/tools/Flashlight";
import { HandoverPage } from "./pages/tools/Handover";
import { LocationPage } from "./pages/tools/Location";
import { NumbersPage } from "./pages/tools/Numbers";
import { ObdPage } from "./pages/tools/Obd";
import { SosPage } from "./pages/tools/Sos";
import { TreePage } from "./pages/tools/Tree";
import { WarningLightsPage } from "./pages/tools/WarningLights";
import { WaterPage } from "./pages/tools/Water";
import { useData } from "./state/data";
import { useApplySettings } from "./state/settings";

function Loaded({ children }: { children: ReactNode }) {
  const { lib, error, reload } = useData();
  if (error)
    return (
      <div className="notice danger" role="alert">
        <div>
          <strong>Could not load the offline library.</strong>
          <p>{error}</p>
          <button className="btn" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!lib) return <p aria-busy="true">Loading offline library…</p>;
  return <>{children}</>;
}

function UpdatePrompt() {
  // App-shell updates are applied only when the user chooses (US-12.3).
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="notice" role="status" style={{ marginBottom: "1rem" }}>
      <div className="stack" style={{ flex: 1 }}>
        <span>A new version of ZeroSignal is ready. Update when it suits you - never mid-emergency.</span>
        <div className="row">
          <button className="btn primary" onClick={() => void updateServiceWorker(true)}>
            Update now
          </button>
          <button className="btn ghost" onClick={() => setNeedRefresh(false)}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

function FirstRun({ children }: { children: ReactNode }) {
  const [done, , ready] = usePersistent<boolean>(KEYS.onboarding, false);
  const { pathname } = useLocation();
  // Emergency cards are never blocked by onboarding.
  if (ready && !done && pathname === "/") return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export function App() {
  useApplySettings();
  const { pathname } = useLocation();

  if (pathname === "/onboarding")
    return (
      <Loaded>
        <Onboarding />
      </Loaded>
    );

  return (
    <Layout>
      <UpdatePrompt />
      <Loaded>
        <FirstRun>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/emergency" element={<EmergencyGrid />} />
            <Route path="/emergency/:id" element={<ProtocolCardPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/library/:domain" element={<DomainPage />} />
            <Route path="/guide/:id" element={<GuidePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/ask" element={<AskPage />} />
            <Route path="/bookmarks" element={<BookmarksPage />} />
            <Route path="/supplies" element={<SuppliesPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/tools/flashlight" element={<FlashlightPage />} />
            <Route path="/tools/sos" element={<SosPage />} />
            <Route path="/tools/compass" element={<CompassPage />} />
            <Route path="/tools/location" element={<LocationPage />} />
            <Route path="/tools/numbers" element={<NumbersPage />} />
            <Route path="/tools/tree/:id" element={<TreePage />} />
            <Route path="/tools/warning-lights" element={<WarningLightsPage />} />
            <Route path="/tools/obd" element={<ObdPage />} />
            <Route path="/tools/water" element={<WaterPage />} />
            <Route path="/tools/handover" element={<HandoverPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/packs" element={<PacksPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </FirstRun>
      </Loaded>
    </Layout>
  );
}
