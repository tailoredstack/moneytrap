import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InvitationView } from "./invitation-view";
import { type Member, MembersView } from "./members-view";

const members: Member[] = [
  { id: "m1", name: "Ana", email: "ana@example.com", role: "owner", status: "active" },
  { id: "m2", name: "Sam", email: "sam@example.com", role: "member", status: "invited" },
];

describe("MembersView (UI-011, UI-013, TP-W2-045)", () => {
  test("lists name, email, role, and status for each member", () => {
    const html = renderToStaticMarkup(<MembersView state="ready" members={members} canInvite />);
    for (const heading of ["Name", "Email", "Role", "Status"]) {
      expect(html).toContain(`>${heading}<`);
    }
    for (const value of ["Ana", "ana@example.com", "Owner", "active", "Sam", "Member", "invited"]) {
      expect(html).toContain(`>${value}<`);
    }
    expect(html).toContain("Invite");
  });

  test("an admin-less viewer sees a permission-denied state, not an empty list", () => {
    const html = renderToStaticMarkup(<MembersView state="denied" members={[]} canInvite={false} />);
    expect(html).toContain("You do not have permission to view members of this organization.");
    expect(html).not.toContain("Invite a teammate to share access.");
  });

  test("an organization with only its owner says how to invite a teammate", () => {
    const html = renderToStaticMarkup(<MembersView state="ready" members={[]} canInvite />);
    expect(html).toContain("Invite a teammate to share access.");
  });

  test("the invite button is hidden when the viewer cannot invite", () => {
    const html = renderToStaticMarkup(<MembersView state="ready" members={members} canInvite={false} />);
    expect(html).not.toContain(">Invite<");
  });
});

describe("InvitationView (UI-014, TP-W2-030)", () => {
  test("offers accept and decline for an invitation", () => {
    const html = renderToStaticMarkup(<InvitationView state="ready" orgName="Acme" memberRole="member" />);
    expect(html).toContain("Join Acme as Member");
    expect(html).toContain("Accept");
    expect(html).toContain("Decline");
  });

  test("an existing member is told so", () => {
    const html = renderToStaticMarkup(<InvitationView state="already-member" orgName="Acme" memberRole="member" />);
    expect(html).toContain("You&#x27;re already a member.");
  });

  test("an expired invitation says so and offers no accept", () => {
    const html = renderToStaticMarkup(<InvitationView state="expired" orgName="Acme" memberRole="member" />);
    expect(html).toContain("This invitation has expired.");
    expect(html).not.toContain(">Accept<");
  });
});

describe("MembersView invite form (UI-011)", () => {
  test("the invite button opens an email and role form", () => {
    const html = renderToStaticMarkup(
      <MembersView state="ready" members={members} canInvite inviteOpen onInviteSubmit={() => {}} />,
    );
    expect(html).toContain('for="invite-email"');
    expect(html).toContain('type="email"');
    expect(html).toContain('for="invite-role"');
    expect(html).toContain("Send invite");
  });

  test("no form is shown until the invite button opens it", () => {
    const html = renderToStaticMarkup(<MembersView state="ready" members={members} canInvite />);
    expect(html).not.toContain("Send invite");
  });

  test("an invite error is announced", () => {
    const html = renderToStaticMarkup(
      <MembersView state="ready" members={members} canInvite inviteOpen inviteError="Email is not valid" />,
    );
    expect(html).toContain("Email is not valid");
  });
});

describe("InvitationView declined (UI-014)", () => {
  test("a declined invitation says so and offers no accept", () => {
    const html = renderToStaticMarkup(<InvitationView state="declined" orgName="Acme" memberRole="member" />);
    expect(html).toContain("You declined this invitation.");
    expect(html).not.toContain(">Accept<");
  });
});
