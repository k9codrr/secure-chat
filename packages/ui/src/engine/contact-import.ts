/** Pure helpers for importing contacts from a .vcf file and building invitation links. */

export interface ImportedContact {
  name: string;
  phones: string[];
  emails: string[];
}

function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const hex = value.slice(i + 1, i + 3);
    if (value[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(value[i]));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const unescapeValue = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/** Parses the vCard 2.1/3.0/4.0 files phones export. Contacts without a number or email are dropped. */
export function parseVCards(text: string): ImportedContact[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: ImportedContact[] = [];
  let card: (ImportedContact & { structured: string }) | null = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (/QUOTED-PRINTABLE/i.test(line)) {
      // Quoted-printable values continue on the next line after a trailing "=".
      while (line.endsWith("=") && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i];
    }
    const m = line.match(/^(?:[^.:;]+\.)?([A-Za-z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const key = m[1].toUpperCase();
    const raw = /QUOTED-PRINTABLE/i.test(m[2]) ? decodeQuotedPrintable(m[3]) : m[3];

    if (key === "BEGIN" && raw.trim().toUpperCase() === "VCARD") {
      card = { name: "", phones: [], emails: [], structured: "" };
    } else if (card && key === "END") {
      const name = card.name || card.structured;
      if (card.phones.length || card.emails.length) out.push({ name: name || card.phones[0] || card.emails[0], phones: card.phones, emails: card.emails });
      card = null;
    } else if (card && key === "FN") {
      card.name = unescapeValue(raw);
    } else if (card && key === "N") {
      const [family = "", given = ""] = raw.split(";");
      card.structured = unescapeValue(`${given} ${family}`);
    } else if (card && key === "TEL") {
      const tel = unescapeValue(raw).replace(/^tel:/i, "");
      if (tel) card.phones.push(tel);
    } else if (card && key === "EMAIL") {
      const email = unescapeValue(raw);
      if (email) card.emails.push(email);
    }
  }
  return out;
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
export const isPhone = (s: string) => /^\+?[\d\s().-]{7,20}$/.test(s.trim());

/** Opens the phone's own messaging app with the invitation ready to send. */
export function smsHref(phone: string, message: string): string {
  return `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(message)}`;
}

/** Opens the user's own email app with the invitation ready to send. */
export function emailHref(email: string, subject: string, message: string): string {
  return `mailto:${encodeURIComponent(email.trim()).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}
