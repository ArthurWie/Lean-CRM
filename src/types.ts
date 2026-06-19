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
