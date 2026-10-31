import {
  Button,
  Form,
  FormLabel,
  FormMessage,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@moneytrap/ui";
import { type FormEvent, useEffect, useRef } from "react";

// UI-011. A viewer who may not see members gets a permission message, not an empty table.
export type MemberRole = "owner" | "admin" | "member";
export type Member = { id: string; name: string; email: string; role: MemberRole; status: "active" | "invited" };

const roleLabel: Record<MemberRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export function MembersView({
  state,
  members,
  canInvite,
  inviteOpen = false,
  inviteError,
  onInvite,
  onInviteSubmit,
}: {
  state: "ready" | "denied";
  members: Member[];
  canInvite: boolean;
  inviteOpen?: boolean;
  inviteError?: string | undefined;
  onInvite?: () => void;
  onInviteSubmit?: (input: { email: string; role: "admin" | "member" }) => void;
}) {
  const inviteEmailRef = useRef<HTMLInputElement>(null);
  // Opening the invite form moves focus into it, so a keyboard or screen reader user lands on the first field.
  useEffect(() => {
    if (inviteOpen) inviteEmailRef.current?.focus();
  }, [inviteOpen]);
  if (state === "denied") {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Members</h1>
        <p role="status">You do not have permission to view members of this organization.</p>
      </section>
    );
  }
  const handleInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const role = data.get("role") === "admin" ? "admin" : "member";
    onInviteSubmit?.({ email: String(data.get("email") ?? ""), role });
  };
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        {canInvite ? <Button onClick={onInvite}>Invite</Button> : null}
      </div>
      {inviteOpen ? (
        <Form onSubmit={handleInvite} className="max-w-sm rounded-md border p-4">
          <div className="space-y-1">
            <FormLabel htmlFor="invite-email">Email</FormLabel>
            <Input
              ref={inviteEmailRef}
              id="invite-email"
              name="email"
              type="email"
              autoComplete="off"
              required
              aria-invalid={inviteError !== undefined || undefined}
              aria-describedby={inviteError !== undefined ? "invite-error" : undefined}
            />
          </div>
          <div className="space-y-1">
            <FormLabel htmlFor="invite-role">Role</FormLabel>
            <select
              id="invite-role"
              name="role"
              className="h-9 w-full rounded-md border px-3 text-sm"
              defaultValue="member"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <FormMessage id="invite-error">{inviteError}</FormMessage>
          <Button type="submit">Send invite</Button>
        </Form>
      ) : null}
      <Table>
        <caption className="sr-only">Members of this organization</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell>{member.name}</TableCell>
              <TableCell>{member.email}</TableCell>
              <TableCell>{roleLabel[member.role]}</TableCell>
              <TableCell>{member.status}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {members.length === 0 ? <p className="text-sm">Invite a teammate to share access.</p> : null}
    </section>
  );
}
