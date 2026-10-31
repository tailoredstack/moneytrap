import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@moneytrap/ui";

// UI-011. A viewer who may not see members gets a permission message, not an empty table.
export type MemberRole = "owner" | "admin" | "member";
export type Member = { id: string; name: string; email: string; role: MemberRole; status: "active" | "invited" };

const roleLabel: Record<MemberRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export function MembersView({
  state,
  members,
  canInvite,
  onInvite,
}: {
  state: "ready" | "denied";
  members: Member[];
  canInvite: boolean;
  onInvite?: () => void;
}) {
  if (state === "denied") {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Members</h1>
        <p role="status">You do not have permission to view members of this organization.</p>
      </section>
    );
  }
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        {canInvite ? <Button onClick={onInvite}>Invite</Button> : null}
      </div>
      <Table>
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
