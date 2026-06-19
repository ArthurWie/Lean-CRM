// German status union. Phase 1 treats Status as a static fixture value;
// automatic derivation from interactions is Phase 2 (DATA-05).
export type Status =
  | "Neu"
  | "Offen"
  | "Im Gespräch"
  | "Termin"
  | "Kein Interesse"
  | "Tot"
  | "Geparkt";

// The ONE allowed manual status override (D-02): "Tot"/"Geparkt" are set by hand,
// not derived from any outcome, and are sticky. `null` = no override (derive normally).
export type ManualOverride = "Tot" | "Geparkt" | null;

// The newest interaction shaped for display (D-08 dated note: date · channel · bearbeiter
// + one-sentence text). Shared by the pure derivation module and the data layer.
export type DerivedNote = {
  datum: string;
  kanal: string;
  bearbeiter: string;
  notiz: string;
};
