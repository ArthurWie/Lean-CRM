// OS-shell contact actions (CONTACT-01/02/03). Each helper hands a single
// tel: / mailto: / https URL to the OS default handler via tauri-plugin-opener's
// openUrl — the URL leaves the embedded webview to the OS shell and NEVER
// navigates the webview (T-01-NAV / CONTACT-02).
//
// DATA-02: this module imports ONLY @tauri-apps/plugin-opener — no drizzle, no
// schema, no db client — so components may import it freely (the sql-boundary
// test stays green).
//
// T-01-INJ: every builder sanitizes/normalizes its input and only ever emits a
// tel:/mailto:/https scheme; no arbitrary scheme reaches the OS.
import { openUrl } from "@tauri-apps/plugin-opener";

// UI-SPEC Copywriting Contract — error-state body copy (problem + recovery).
const ERR_TEL =
  "Anruf konnte nicht gestartet werden. Prüfe, ob ein Telefon-Handler installiert ist.";
const ERR_MAIL =
  "E-Mail konnte nicht geöffnet werden. Prüfe, ob ein Mail-Programm installiert ist.";
const ERR_LINKEDIN =
  "LinkedIn konnte nicht geöffnet werden. Prüfe, ob ein Standard-Browser installiert ist.";

async function open(url: string, errorCopy: string): Promise<void> {
  try {
    await openUrl(url);
  } catch (e) {
    // Surface the UI-SPEC error copy (Pitfall 4) without crashing the row.
    console.error(errorCopy, e);
  }
}

// tel:+431234567 — strip every char except digits and a leading +.
export async function openTel(telefon: string): Promise<void> {
  const sanitized = telefon.replace(/[^\d+]/g, "");
  await open(`tel:${sanitized}`, ERR_TEL);
}

// mailto:<email> — the first/primary email is chosen by the caller (D-02).
export async function openMail(email: string): Promise<void> {
  await open(`mailto:${email}`, ERR_MAIL);
}

// Normalize to an https URL: pass a full http(s):// URL through unchanged,
// otherwise prefix https://. Only ever emits an https scheme.
export async function openLinkedIn(linkedin: string): Promise<void> {
  const url = /^https?:\/\//i.test(linkedin)
    ? linkedin
    : `https://${linkedin}`;
  await open(url, ERR_LINKEDIN);
}
