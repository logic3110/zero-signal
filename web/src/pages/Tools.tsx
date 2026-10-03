import { ClipboardList, Compass, Droplets, Flashlight, GitBranch, Lightbulb, MapPin, MessageSquareText, Package, Phone, ScanSearch } from "lucide-react";
import { Link } from "react-router-dom";
import { useT } from "../lib/i18n";
import { useLib } from "../state/data";

/** Field tools - no AI, always available (E10). */
export function ToolsPage() {
  const t = useT();
  const lib = useLib();
  const tools = [
    { to: "/tools/flashlight", label: "SOS light", sub: "Torch, strobe, Morse SOS", Icon: Flashlight },
    { to: "/tools/sos", label: "SOS message", sub: "SMS your GPS position", Icon: MessageSquareText },
    { to: "/tools/location", label: "My location", sub: "Coordinates, plus code, altitude", Icon: MapPin },
    { to: "/tools/compass", label: "Compass", sub: "Mark and follow a bearing", Icon: Compass },
    { to: "/tools/numbers", label: "Emergency numbers", sub: "Local numbers and your contacts", Icon: Phone },
    { to: "/supplies", label: t("supplies"), sub: "Days of water, food, medicines", Icon: Package },
    { to: "/tools/water", label: "Water purification", sub: "Boil time and bleach drops", Icon: Droplets },
    { to: "/tools/handover", label: "Handover summary", sub: "Timeline for paramedics", Icon: ClipboardList },
    { to: "/tools/warning-lights", label: "Warning lights", sub: "Dashboard symbols", Icon: Lightbulb },
    { to: "/tools/obd", label: "OBD-II codes", sub: "Fault code lookup", Icon: ScanSearch },
  ];
  return (
    <div className="stack">
      <h1>{t("tools")}</h1>
      <div className="grid">
        {tools.map(({ to, label, sub, Icon }) => (
          <Link key={to} to={to} className="tile">
            <Icon aria-hidden="true" />
            {label}
            <span className="muted small">{sub}</span>
          </Link>
        ))}
        {lib.trees.map((tr) => (
          <Link key={tr.tree_id} to={`/tools/tree/${tr.tree_id}`} className="tile">
            <GitBranch aria-hidden="true" />
            {tr.title}
            <span className="muted small">Step-by-step</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
