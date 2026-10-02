import {
  Activity, Baby, Bone, Brain, Candy, CarFront, CircleDot, Compass, Disc, Droplet, Flame, FlaskConical, Heart,
  HeartPulse, Info, Mountain, OctagonAlert, PawPrint, PersonStanding, ShieldAlert, Snowflake, Sun, Thermometer,
  ThermometerSnowflake, Tornado, TrainFront, TriangleAlert, Waves, Wind, Worm, Zap, type LucideIcon,
} from "lucide-react";
import type { Severity } from "../lib/types";

// Protocol card `icon` keys (content/protocol_cards/*.yaml) -> icons.
const CARD_ICONS: Record<string, LucideIcon> = {
  "heart-pulse": HeartPulse,
  child: PersonStanding,
  baby: Baby,
  lungs: Wind,
  droplet: Droplet,
  "thermometer-down": ThermometerSnowflake,
  allergy: ShieldAlert,
  heart: Heart,
  brain: Brain,
  zap: Zap,
  flame: Flame,
  spine: PersonStanding,
  sun: Sun,
  snowflake: Snowflake,
  waves: Waves,
  snake: Worm,
  flask: FlaskConical,
  bone: Bone,
  candy: Candy,
  wind: Wind,
  bolt: Zap,
  compass: Compass,
  quake: Activity,
  cyclone: Tornado,
  mountain: Mountain,
  paw: PawPrint,
  "car-fire": Flame,
  "car-crash": CarFront,
  brake: Disc,
  train: TrainFront,
  "car-water": Waves,
  thermometer: Thermometer,
  tyre: CircleDot,
};

export function CardIcon({ name, size = 28 }: { name: string; size?: number }) {
  const Icon = CARD_ICONS[name] ?? TriangleAlert;
  return <Icon size={size} aria-hidden="true" />;
}

const SEVERITY: Record<Severity, { Icon: LucideIcon; label: string }> = {
  critical: { Icon: OctagonAlert, label: "Critical" },
  urgent: { Icon: TriangleAlert, label: "Urgent" },
  routine: { Icon: Info, label: "Routine" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { Icon, label } = SEVERITY[severity] ?? SEVERITY.routine;
  return (
    <span className={`badge ${severity}`}>
      <Icon size={14} aria-hidden="true" /> {label}
    </span>
  );
}
