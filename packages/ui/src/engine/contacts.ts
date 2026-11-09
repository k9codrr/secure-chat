import { blindContacts, finalizeContacts, normalizePhone } from "@veil/crypto";
import type { PublicUser } from "@veil/shared";
import { kvGet, kvSet } from "../lib/db";
import { isNative } from "../lib/platform";
import { ctx } from "./context";
import { primeUser, setLocalName } from "./users";
import { vaultWrite } from "./vault";

/**
 * Private contact discovery: phone numbers are blinded on-device (OPRF), the server evaluates
 * blinded points it can't invert, and matching happens on tokens. Raw numbers never leave the device.
 * People who aren't on Veil stay in the encrypted local store, and invitations go out through the
 * phone's own SMS or email app, so the server never sees who was invited.
 */

export interface PhoneContact {
  name: string;
  phones: string[];
  emails?: string[];
}

/** Someone from the address book who isn't on Veil yet. Stored on this device only. */
export interface InvitableContact {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  invitedAt?: number;
}

const INVITABLE_KEY = "contacts:invitable";

type ContactPicker = {
  select(props: string[], opts: { multiple: boolean }): Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]>;
  getProperties?(): Promise<string[]>;
};

const contactPicker = () => (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { contacts?: ContactPicker }).contacts);

/** iPhone browsers and desktop browsers have no contact picker: those import a .vcf file instead. */
export function canReadDeviceContacts() {
  return isNative() || !!contactPicker();
}

export async function readDeviceContacts(): Promise<PhoneContact[]> {
  if (isNative()) {
    const { Contacts } = await import("@capacitor-community/contacts");
    const perm = await Contacts.requestPermissions();
    if (perm.contacts !== "granted") throw new Error("Contacts permission denied");
    const r = await Contacts.getContacts({ projection: { name: true, phones: true, emails: true } });
    return r.contacts.map((c) => ({
      name: c.name?.display ?? [c.name?.given, c.name?.family].filter(Boolean).join(" "),
      phones: (c.phones ?? []).map((p) => p.number ?? "").filter(Boolean),
      emails: (c.emails ?? []).map((e) => e.address ?? "").filter(Boolean),
    }));
  }
  // Web: Contact Picker API (Chrome Android). The picker has a select-all, but the user chooses.
  const nav = contactPicker();
  if (!nav) throw new Error("Contact access isn't supported in this browser");
  const supported = (await nav.getProperties?.()) ?? ["name", "tel"];
  const picked = await nav.select(["name", "tel", "email"].filter((p) => supported.includes(p)), { multiple: true });
  return picked.map((p) => ({ name: p.name?.[0] ?? "", phones: p.tel ?? [], emails: p.email ?? [] }));
}

const DIAL_BY_REGION: Record<string, string> = { US: "1", CA: "1", GB: "44", IN: "91", DE: "49", FR: "33", ES: "34", IT: "39", BR: "55", MX: "52", AU: "61", AE: "971", SG: "65", PK: "92", BD: "880", NG: "234", ZA: "27" };
const DIAL_BY_TIMEZONE: Record<string, string> = { "Asia/Kolkata": "91", "Asia/Calcutta": "91", "Europe/London": "44", "Asia/Dubai": "971", "Asia/Singapore": "65", "Asia/Karachi": "92", "Asia/Dhaka": "880" };

/**
 * Country code for numbers saved without one: the user's own number, then the phone's time zone
 * (phone languages are often en-US everywhere), then its language region. Unknown returns "", which
 * skips matching for those numbers rather than guessing a wrong country.
 */
export function defaultCountryCode(): string {
  const own = ctx.me?.phoneNumber?.match(/^\+(91|1|44|971|65|92|880|49|33|34|39|55|52|61|234|27)/)?.[1];
  if (own) return own;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (DIAL_BY_TIMEZONE[tz]) return DIAL_BY_TIMEZONE[tz];
  const region = typeof navigator !== "undefined" ? new Intl.Locale(navigator.language).region : undefined;
  return (region && DIAL_BY_REGION[region]) || "";
}

export async function listInvitable(): Promise<InvitableContact[]> {
  const list = (await kvGet<InvitableContact[]>(INVITABLE_KEY)) ?? [];
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

export async function markInvited(id: string) {
  const list = (await kvGet<InvitableContact[]>(INVITABLE_KEY)) ?? [];
  await kvSet(INVITABLE_KEY, list.map((c) => (c.id === id ? { ...c, invitedAt: Date.now() } : c)));
}

export function inviteMessage(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  return `${ctx.me?.name || "A friend"} is inviting you to chat on Veil, a private end-to-end encrypted messenger. Join here: ${base}`;
}

export const INVITE_SUBJECT = "Join me on Veil";

export async function syncPhoneContacts(contacts: PhoneContact[], defaultCountryCode: string): Promise<{ matched: PublicUser[]; invitable: InvitableContact[] }> {
  const nameByPhone = new Map<string, string>();
  const onVeil = new Set<string>();
  for (const c of contacts) for (const p of c.phones) {
    const n = normalizePhone(p, defaultCountryCode);
    if (n) nameByPhone.set(n, c.name);
  }
  const phones = [...nameByPhone.keys()];
  const matched: PublicUser[] = [];
  for (let i = 0; i < phones.length; i += 1000) {
    const blinded = blindContacts(phones.slice(i, i + 1000));
    const { evaluated } = await ctx.api.contacts.discover(blinded.map((b) => b.blinded));
    const tokens = finalizeContacts(blinded, evaluated);
    const { matches } = await ctx.api.contacts.match([...tokens.keys()]);
    for (const m of matches) {
      const phone = tokens.get(m.token);
      if (phone) onVeil.add(phone);
      const local = phone ? nameByPhone.get(phone) : undefined;
      primeUser(m.user);
      if (local) {
        await setLocalName(m.user.id, local);
        vaultWrite("contact", m.user.id, { name: local });
      }
      matched.push(m.user);
    }
  }
  if (matched.length) await ctx.api.contacts.add(matched.map((u) => u.id));
  await kvSet("contacts:lastSync", Date.now());

  // Merge with earlier imports: the picker may return only some contacts each time.
  const known = new Map(((await kvGet<InvitableContact[]>(INVITABLE_KEY)) ?? []).map((c) => [c.id, c]));
  for (const c of contacts) {
    const normalized = c.phones.map((p) => normalizePhone(p, defaultCountryCode));
    const ids = normalized.filter((n): n is string => !!n);
    if (ids.some((n) => onVeil.has(n))) {
      for (const n of ids) known.delete(n);
      continue;
    }
    const phone = ids[0] ?? c.phones[0];
    const email = c.emails?.[0];
    const id = phone ?? email;
    if (!id) continue;
    known.set(id, { id, name: c.name || id, phone, email, invitedAt: known.get(id)?.invitedAt });
  }
  const invitable = [...known.values()];
  await kvSet(INVITABLE_KEY, invitable);
  return { matched, invitable };
}

export async function addContact(user: PublicUser, localName?: string) {
  await ctx.api.contacts.add([user.id]);
  if (localName) {
    await setLocalName(user.id, localName);
    vaultWrite("contact", user.id, { name: localName });
  }
}

export async function removeContact(userId: string) {
  await ctx.api.contacts.remove([userId]);
  await setLocalName(userId, undefined);
  vaultWrite("contact", userId, null);
}


export async function setBlocked(userId: string, block: boolean) {
  if (block) await ctx.api.users.block(userId);
  else await ctx.api.users.unblock(userId);
  const list = new Set((await kvGet<string[]>("blocked")) ?? []);
  if (block) list.add(userId);
  else list.delete(userId);
  await kvSet("blocked", [...list]);
  vaultWrite("settings", "blocked", [...list]);
}
