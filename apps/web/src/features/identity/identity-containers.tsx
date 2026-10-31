import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../../api/auth-client";
import { canManageMembers, inviteMember, rejectInvitation } from "../access/access-actions";
import { type InvitationState, InvitationView } from "../access/invitation-view";
import { type Member, MembersView } from "../access/members-view";
import { AccountSecurityView, type MfaSetup } from "./account-security-view";
import { clearStepUpPending, markStepUpPending } from "./challenge-marker";
import {
  acceptInvitation,
  enableTwoFactor,
  type RegistrationField,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  signIn,
  validateRegistration,
  verifyRecoveryCode,
  verifyTotpCode,
} from "./identity-actions";
import { loginViewState, registerViewState, resetViewState, stepUpViewState } from "./identity-view-state";
import { type LoginStatus, LoginView } from "./login-screen";
import { rateLimitMessage } from "./messages";
import {
  type RecoveryRequestStatus,
  RecoveryRequestView,
  ResetPasswordView,
  type ResetStatus,
} from "./recovery-screens";
import { type RegisterStatus, RegisterView } from "./register-screen";
import { safeReturnTo } from "./return-to";
import { SessionsView } from "./sessions-view";
import { type StepUpMode, type StepUpStatus, StepUpView } from "./step-up-screen";

// Each container owns the state of one screen and calls Better Auth through `authClient`. The views only render state.

export function RegisterScreen() {
  const [view, setView] = useState<{
    status: RegisterStatus;
    email: string;
    invalidField?: RegistrationField | undefined;
    message?: string | undefined;
  }>({
    status: "idle",
    email: "",
  });
  return (
    <RegisterView
      status={view.status}
      email={view.email}
      invalidField={view.invalidField}
      message={view.message}
      onSubmit={async ({ email, password }) => {
        // Field checks run first, so the first bad field is known without a server round trip.
        const problem = validateRegistration({ email, password });
        if (problem) {
          setView({ status: "invalid", email, invalidField: problem.field, message: problem.message });
          return;
        }
        setView({ status: "submitting", email });
        const outcome = await registerAccount(authClient, { email, password });
        setView(registerViewState(outcome, email));
      }}
    />
  );
}

export function LoginScreen({ returnTo }: { returnTo?: string | undefined }) {
  const navigate = useNavigate();
  const [view, setView] = useState<{ status: LoginStatus; email: string; retryAfterSeconds: number | null }>({
    status: "idle",
    email: "",
    retryAfterSeconds: null,
  });
  return (
    <LoginView
      status={view.status}
      email={view.email}
      retryAfterSeconds={view.retryAfterSeconds}
      onSubmit={async ({ email, password }) => {
        setView({ status: "submitting", email, retryAfterSeconds: null });
        const outcome = await signIn(authClient, { email, password });
        if (outcome.kind === "two-factor") {
          markStepUpPending();
          await navigate({
            href: `/step-up?mode=totp&returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`,
          });
          return;
        }
        if (outcome.kind === "ok") {
          await navigate({ href: safeReturnTo(returnTo) });
          return;
        }
        const next = loginViewState(outcome);
        setView({ email, retryAfterSeconds: next?.retryAfterSeconds ?? null, status: next?.status ?? "idle" });
      }}
    />
  );
}

export function StepUpScreen({ mode, returnTo }: { mode: StepUpMode; returnTo?: string | undefined }) {
  const navigate = useNavigate();
  const [view, setView] = useState<{
    status: StepUpStatus;
    wrongCount: number;
    message?: string | undefined;
    retryAfterSeconds: number | null;
  }>({ status: "idle", wrongCount: 0, retryAfterSeconds: null });
  return (
    <StepUpView
      returnTo={returnTo}
      status={view.status}
      mode={mode}
      wrongCount={view.wrongCount}
      message={view.message}
      retryAfterSeconds={view.retryAfterSeconds}
      onSubmit={async (code) => {
        setView((current) => ({ ...current, status: "submitting" }));
        const outcome =
          mode === "recovery" ? await verifyRecoveryCode(authClient, code) : await verifyTotpCode(authClient, code);
        if (outcome.kind === "challenge-expired") {
          clearStepUpPending();
          await navigate({ href: `/login?returnTo=${encodeURIComponent(`/step-up?mode=${mode}`)}` });
          return;
        }
        const next = stepUpViewState(outcome, view.wrongCount);
        if (!next) {
          clearStepUpPending();
          await navigate({ href: safeReturnTo(returnTo) });
          return;
        }
        setView(next);
      }}
    />
  );
}

export function RecoveryRequestScreen() {
  const [view, setView] = useState<{ status: RecoveryRequestStatus; retryAfterSeconds: number | null }>({
    status: "idle",
    retryAfterSeconds: null,
  });
  return (
    <RecoveryRequestView
      status={view.status}
      retryAfterSeconds={view.retryAfterSeconds}
      onSubmit={async (email) => {
        setView({ status: "submitting", retryAfterSeconds: null });
        const outcome = await requestPasswordReset(authClient, email);
        setView(
          outcome.kind === "sent"
            ? { status: "sent", retryAfterSeconds: null }
            : { status: "rate-limited", retryAfterSeconds: outcome.retryAfterSeconds },
        );
      }}
    />
  );
}

export function ResetPasswordScreen({ token }: { token: string }) {
  const [view, setView] = useState<{ status: ResetStatus; retryAfterSeconds: number | null }>({
    status: "idle",
    retryAfterSeconds: null,
  });
  return (
    <ResetPasswordView
      status={view.status}
      retryAfterSeconds={view.retryAfterSeconds}
      onSubmit={async ({ newPassword, confirmation }) => {
        if (newPassword !== confirmation) {
          setView({ status: "mismatch", retryAfterSeconds: null });
          return;
        }
        setView({ status: "submitting", retryAfterSeconds: null });
        const outcome = await resetPassword(authClient, { token, newPassword });
        setView(resetViewState(outcome));
      }}
    />
  );
}

export function SessionsScreen() {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [error, setError] = useState<string | undefined>(undefined);
  const sessions = useQuery({
    queryKey: ["identity", "sessions"],
    queryFn: async () => {
      const { data, error: listError } = await authClient.listSessions();
      if (listError || !data) throw new Error("sessions unavailable");
      return data;
    },
  });
  if (sessions.isError) return <SessionsView sessions={[]} error="Sessions could not be loaded. Try again." />;
  if (!sessions.data) return <p role="status">Loading sessions…</p>;
  const inUse = session.data?.session.token;
  const rows = sessions.data.map((item) => ({
    token: item.token,
    createdAt: new Date(item.createdAt).toISOString(),
    userAgent: item.userAgent ?? undefined,
    current: item.token === inUse,
  }));
  return (
    <SessionsView
      sessions={rows}
      error={error}
      onRevoke={async (token) => {
        const outcome = await revokeSession(authClient, token);
        if (outcome.kind === "failed") {
          setError("Could not end that session.");
          return;
        }
        setError(undefined);
        await queryClient.invalidateQueries({ queryKey: ["identity", "sessions"] });
      }}
    />
  );
}

export function AccountSecurityScreen() {
  const session = authClient.useSession();
  const sessions = useQuery({
    queryKey: ["identity", "sessions"],
    queryFn: async () => {
      const { data, error } = await authClient.listSessions();
      if (error) throw new Error("sessions unavailable");
      return data ?? [];
    },
  });
  const [setup, setSetup] = useState<MfaSetup | undefined>(undefined);
  const [savedCodes, setSavedCodes] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const mfaEnabled = Boolean(session.data?.user.twoFactorEnabled);
  return (
    <AccountSecurityView
      mfaEnabled={mfaEnabled}
      sessionCount={sessions.data?.length ?? 0}
      setup={setup}
      savedCodes={savedCodes}
      error={error}
      onSavedCodesChange={setSavedCodes}
      onStartSetup={async (password) => {
        const outcome = await enableTwoFactor(authClient, password);
        if (outcome.kind === "ok") setSetup({ totpURI: outcome.totpURI, backupCodes: outcome.backupCodes });
        else setError("Your password was not accepted.");
      }}
      onConfirm={async (code) => {
        const outcome = await verifyTotpCode(authClient, code);
        if (outcome.kind === "ok") {
          setSetup(undefined);
          setError(undefined);
          return;
        }
        setError(
          outcome.kind === "rate-limited" ? rateLimitMessage(outcome.retryAfterSeconds) : "That code is not valid.",
        );
      }}
    />
  );
}

export function MembersScreen() {
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteError, setInviteError] = useState<string | undefined>(undefined);
  const role = useQuery({
    queryKey: ["identity", "active-member-role"],
    queryFn: async () => {
      const { data } = await authClient.organization.getActiveMember();
      return data?.role ?? null;
    },
  });
  // Better Auth lets any member list members, so the role check here decides what the screen may show.
  const manager = canManageMembers(role.data);
  const membersQuery = useQuery({
    queryKey: ["identity", "members"],
    enabled: role.isSuccess && manager,
    queryFn: async () => {
      const { data, error } = await authClient.organization.listMembers();
      if (error || !data) throw new Error("members unavailable");
      const members: Member[] = data.members.map((member) => ({
        id: member.id,
        name: member.user.name,
        email: member.user.email,
        role: member.role === "owner" || member.role === "admin" ? member.role : "member",
        status: "active",
      }));
      return members;
    },
  });
  if (role.isPending) return <p role="status">Loading members…</p>;
  if (!manager) return <MembersView state="denied" members={[]} canInvite={false} />;
  if (membersQuery.isPending) return <p role="status">Loading members…</p>;
  if (membersQuery.isError) return <MembersView state="denied" members={[]} canInvite={false} />;
  return (
    <MembersView
      state="ready"
      members={membersQuery.data}
      canInvite
      inviteOpen={inviteOpen}
      inviteError={inviteError}
      onInvite={() => setInviteOpen(true)}
      onInviteSubmit={async (input) => {
        const outcome = await inviteMember(authClient, input);
        if (outcome.kind === "sent") {
          setInviteOpen(false);
          setInviteError(undefined);
          await queryClient.invalidateQueries({ queryKey: ["identity", "members"] });
          return;
        }
        setInviteError(outcome.kind === "invalid" ? outcome.message : "Something went wrong. Try again.");
      }}
    />
  );
}

export function InvitationScreen({ invitationId }: { invitationId: string }) {
  const navigate = useNavigate();
  const invitation = useQuery({
    queryKey: ["identity", "invitation", invitationId],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getInvitation({ query: { id: invitationId } });
      if (error || !data) throw new Error("invitation unavailable");
      const role = data.role === "admin" ? ("admin" as const) : ("member" as const);
      return { orgName: data.organizationName, role, expired: new Date(data.expiresAt) < new Date() };
    },
    retry: false,
  });
  const [state, setState] = useState<InvitationState | undefined>(undefined);
  if (invitation.isError) return <InvitationView state="expired" orgName="" memberRole="member" />;
  if (!invitation.data) return <p role="status">Loading invitation…</p>;
  const current: InvitationState = state ?? (invitation.data.expired ? "expired" : "ready");
  return (
    <InvitationView
      state={current}
      orgName={invitation.data.orgName}
      memberRole={invitation.data.role}
      onAccept={async () => {
        const outcome = await acceptInvitation(authClient, invitationId);
        if (outcome.kind === "ok") await navigate({ href: "/overview" });
        else if (outcome.kind === "already-member") setState("already-member");
        else if (outcome.kind === "expired") setState("expired");
      }}
      onDecline={async () => {
        const outcome = await rejectInvitation(authClient, invitationId);
        if (outcome.kind === "declined") setState("declined");
      }}
    />
  );
}
