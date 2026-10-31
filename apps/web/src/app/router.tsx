import { Toaster } from "@moneytrap/ui";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
  redirect,
} from "@tanstack/react-router";
import {
  AccountSecurityScreen,
  InvitationScreen,
  LoginScreen,
  MembersScreen,
  RecoveryRequestScreen,
  RegisterScreen,
  ResetPasswordScreen,
  StepUpScreen,
} from "../features/identity/identity-containers";
import { stepUpRedirect } from "../features/identity/return-to";
import { AppShell } from "./app-shell";

const overviewStatuses = ["all", "active", "paused"] as const;
export type OverviewStatus = (typeof overviewStatuses)[number];
export type OverviewSearch = { page: number; status: OverviewStatus };

// Search params come from the URL as strings. Parse them once here so route code gets typed values.
export function parseOverviewSearch(input: Record<string, unknown>): OverviewSearch {
  const page = input.page === undefined ? 1 : Number(input.page);
  if (!Number.isInteger(page) || page < 1) throw new Error("page must be a positive integer");
  const status = input.status === undefined ? "all" : input.status;
  if (!overviewStatuses.includes(status as OverviewStatus)) throw new Error("unknown status");
  return { page, status: status as OverviewStatus };
}

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
      <Toaster />
    </AppShell>
  ),
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/overview",
  validateSearch: parseOverviewSearch,
  component: function Overview() {
    const search = overviewRoute.useSearch();
    return (
      <h1 className="text-xl font-semibold">
        Overview (page {search.page}, {search.status})
      </h1>
    );
  },
});

// Identity screens (SKELETONS §1). Search params are parsed here so each screen gets typed values.
function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

const registerRoute = createRoute({ getParentRoute: () => rootRoute, path: "/register", component: RegisterScreen });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (input: Record<string, unknown>) => ({ returnTo: optionalString(input, "returnTo") }),
  component: function Login() {
    const search = loginRoute.useSearch();
    return <LoginScreen returnTo={search.returnTo} />;
  },
});

const stepUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/step-up",
  validateSearch: (input: Record<string, unknown>) => ({
    challenge: input.challenge === "1",
    mode: input.mode === "recovery" ? ("recovery" as const) : ("totp" as const),
    returnTo: optionalString(input, "returnTo"),
  }),
  // Without a sign-in waiting for a second factor, the code cannot be matched. Send the user to login first.
  beforeLoad: ({ search }) => {
    const target = stepUpRedirect({ challenge: search.challenge, mode: search.mode });
    if (target) throw redirect({ href: target });
  },
  component: function StepUp() {
    const search = stepUpRoute.useSearch();
    return <StepUpScreen mode={search.mode} returnTo={search.returnTo} />;
  },
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: RecoveryRequestScreen,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  validateSearch: (input: Record<string, unknown>) => ({ token: optionalString(input, "token") ?? "" }),
  component: function ResetPassword() {
    const search = resetPasswordRoute.useSearch();
    return <ResetPasswordScreen token={search.token} />;
  },
});

const accountSecurityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account/security",
  component: AccountSecurityScreen,
});

const membersRoute = createRoute({ getParentRoute: () => rootRoute, path: "/org/members", component: MembersScreen });

const invitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$invitationId",
  component: function Invitation() {
    const { invitationId } = invitationRoute.useParams();
    return <InvitationScreen invitationId={invitationId} />;
  },
});

const routeTree = rootRoute.addChildren([
  overviewRoute,
  registerRoute,
  loginRoute,
  stepUpRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  accountSecurityRoute,
  membersRoute,
  invitationRoute,
]);

// Pass a browser history from the entry point. Memory history keeps tests and SSR-free imports safe.
export function createAppRouter(history: RouterHistory = createMemoryHistory({ initialEntries: ["/overview"] })) {
  return createRouter({ routeTree, history });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
