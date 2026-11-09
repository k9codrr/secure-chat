"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookUser, FileUp, Mail, MessageSquareText, RefreshCw, Send, UserPlus } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { directChatId, presenceLabel } from "@veil/shared";
import {
  cachedUser,
  canReadDeviceContacts,
  ctx,
  defaultCountryCode,
  displayName as profileName,
  ensureChat,
  INVITE_SUBJECT,
  inviteMessage,
  listInvitable,
  markInvited,
  readDeviceContacts,
  syncPhoneContacts,
  type InvitableContact,
  type PhoneContact,
} from "../engine";
import { emailHref, isEmail, isPhone, parseVCards, smsHref } from "../engine/contact-import";
import { useUI } from "../store/ui";
import { Avatar } from "../components/avatar";
import { Dialog } from "../components/overlays";
import { Button, EmptyState, GlassButton, IconButton, Input, ScreenHeader, Spinner } from "../components/primitives";
import { LiquidGlass } from "../components/liquid-glass";
import { SearchFill } from "../components/filled-icons";

const MAX_VCF_BYTES = 20 * 1024 * 1024;
/** The name saved in the user's address book wins over the contact's profile name. */
const displayName = (u: Parameters<typeof profileName>[0] & { id: string }) => profileName({ ...u, localName: cachedUser(u.id)?.localName });
const actionClass = "glass pressable flex h-10 w-10 items-center justify-center rounded-full text-accent";

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [to, setTo] = useState("");
  const value = to.trim();
  const href = isEmail(value) ? emailHref(value, INVITE_SUBJECT, inviteMessage()) : isPhone(value) ? smsHref(value, inviteMessage()) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Invite to Veil">
      <div className="space-y-3 p-1">
        <Input placeholder="Phone number or email" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />
        <p className="text-[13px] text-muted">This opens your own SMS or email app with the invitation ready to send. Veil never sees who you invite.</p>
        {href ? (
          <a href={href} onClick={onClose} className="block accent-fill rounded-xl bg-accent px-4 py-2.5 text-center text-sm font-medium text-accent-contrast">
            Send invitation
          </a>
        ) : (
          <span className="block rounded-xl bg-surface px-4 py-2.5 text-center text-sm text-muted">Enter a phone number or email</span>
        )}
      </div>
    </Dialog>
  );
}

export function ContactsScreen() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["contacts"], queryFn: () => ctx.api.contacts.list() });
  const invitable = useQuery({ queryKey: ["invitable"], queryFn: listInvitable });
  const { openChat, set } = useUI();
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sections = useMemo(() => {
    const list = (data?.contacts ?? []).filter((u) => !q || displayName(u).toLowerCase().includes(q.toLowerCase()) || u.username?.includes(q.toLowerCase()));
    list.sort((a, b) => displayName(a).localeCompare(displayName(b)));
    const online = list.filter((u) => u.presence?.online);
    const by = new Map<string, typeof list>();
    for (const u of list) {
      const L = displayName(u)[0]?.toUpperCase() ?? "#";
      const k = /[A-Z]/.test(L) ? L : "#";
      by.set(k, [...(by.get(k) ?? []), u]);
    }
    return { online, letters: [...by.entries()] };
  }, [data, q]);
  const toInvite = useMemo(() => (invitable.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())), [invitable.data, q]);

  async function importContacts(contacts: PhoneContact[]) {
    const { matched, invitable: rest } = await syncPhoneContacts(contacts, defaultCountryCode());
    toast(`${matched.length} on Veil, ${rest.length} to invite`);
    void qc.invalidateQueries({ queryKey: ["contacts"] });
    void qc.invalidateQueries({ queryKey: ["invitable"] });
  }

  async function sync() {
    // Without a contact picker (iPhone browsers, desktop), go straight to the file import.
    if (!canReadDeviceContacts()) {
      fileInput.current?.click();
      return;
    }
    setSyncing(true);
    try {
      await importContacts(await readDeviceContacts());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_VCF_BYTES) {
      toast.error("That file is too large to import");
      return;
    }
    setSyncing(true);
    try {
      const contacts = parseVCards(await file.text());
      if (!contacts.length) throw new Error("No contacts found in that file");
      await importContacts(contacts);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const invited = (c: InvitableContact) => {
    void markInvited(c.id).then(() => qc.invalidateQueries({ queryKey: ["invitable"] }));
  };

  const row = (u: NonNullable<typeof data>["contacts"][number]) => (
    <button
      key={u.id}
      onClick={async () => {
        await ensureChat(directChatId(u.id));
        openChat(directChatId(u.id));
      }}
      className="pressable flex w-full items-center gap-3 px-4 py-1.5 transition-colors hover:bg-surface/60"
    >
      <Avatar id={u.id} name={displayName(u)} mediaId={u.avatarMediaId} mediaKey={u.avatarKey} size={46} online={u.presence?.online} />
      <span className="min-w-0 flex-1 self-stretch border-b border-border py-1.5 text-left">
        <span className="block truncate text-[17px] font-semibold tracking-[-0.02em]">{displayName(u)}</span>
        <span className={u.presence?.online ? "block text-[14.5px] text-accent" : "block text-[14.5px] text-muted"}>{u.presence ? presenceLabel(u.presence) : ""}</span>
      </span>
    </button>
  );

  const inviteRow = (c: InvitableContact) => (
    <div key={c.id} data-testid="invite-row" className="flex items-center gap-3 px-4 py-2">
      <Avatar id={c.id} name={c.name} size={46} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{c.name}</span>
        <span className="block truncate text-[13px] text-muted">{c.invitedAt ? "Invited" : c.phone ?? c.email}</span>
      </span>
      {c.phone && (
        <a href={smsHref(c.phone, inviteMessage())} onClick={() => invited(c)} aria-label={`Invite ${c.name} by SMS`} className={actionClass}>
          <MessageSquareText className="h-5 w-5" />
        </a>
      )}
      {c.email && (
        <a href={emailHref(c.email, INVITE_SUBJECT, inviteMessage())} onClick={() => invited(c)} aria-label={`Invite ${c.name} by email`} className={actionClass}>
          <Mail className="h-5 w-5" />
        </a>
      )}
    </div>
  );

  const nothingYet = !data?.contacts.length && !invitable.data?.length;

  return (
    <div className="flex h-full flex-col bg-bg">
      <input ref={fileInput} type="file" accept=".vcf,text/vcard,text/x-vcard" className="hidden" data-testid="vcf-input" onChange={(e) => void onFile(e)} />
      <ScreenHeader
        left={
          <div className="glass flex h-11 items-center rounded-full px-0.5">
            <IconButton label="Find phone contacts" className="text-text" onClick={sync} disabled={syncing}>
              {syncing ? <Spinner className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
            </IconButton>
            <IconButton label="Import contacts file" className="text-text" onClick={() => fileInput.current?.click()} disabled={syncing}>
              <FileUp className="h-5 w-5" />
            </IconButton>
          </div>
        }
        title={<h1>Contacts</h1>}
        right={
          <>
            <GlassButton label="Invite to Veil" onClick={() => setInviteOpen(true)}>
              <Send className="h-5 w-5" />
            </GlassButton>
            <GlassButton label="Add contact" accent onClick={() => set({ newChat: "menu" })}>
              <UserPlus className="h-5 w-5" />
            </GlassButton>
          </>
        }
      >
        <LiquidGlass className="flex h-11 items-center gap-2 rounded-full px-4">
          <SearchFill className="h-[19px] w-[19px] text-muted" />
          <input className="h-full w-full min-w-0 bg-transparent text-[17px] outline-none placeholder:text-muted" placeholder="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} />
        </LiquidGlass>
      </ScreenHeader>
      <div className="flex-1 overflow-y-auto pb-28">
        {isLoading ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : nothingYet ? (
          <EmptyState
            icon={<BookUser className="h-8 w-8" />}
            title="No contacts yet"
            body="Find friends privately: phone numbers are matched with blinded tokens, so Veil never sees your address book. On iPhone, export your contacts as a .vcf file and import that."
            action={<Button className="mt-1" onClick={sync}>Find contacts</Button>}
          />
        ) : (
          <>
            {sections.online.length > 0 && !q && (
              <>
                <div className="px-5 pb-1.5 pt-3 text-[13px] uppercase tracking-[0.02em] text-muted">Online now</div>
                {sections.online.map(row)}
              </>
            )}
            {sections.letters.map(([letter, list]) => (
              <div key={letter}>
                <div className="sticky top-0 z-[1] bg-bg/85 px-5 py-1 text-[14px] font-semibold text-muted backdrop-blur-xl">{letter}</div>
                {list.map(row)}
              </div>
            ))}
            {toInvite.length > 0 && (
              <>
                <div className="px-5 pb-1.5 pt-4 text-[13px] uppercase tracking-[0.02em] text-muted">Invite to Veil</div>
                {toInvite.map(inviteRow)}
              </>
            )}
          </>
        )}
      </div>
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
