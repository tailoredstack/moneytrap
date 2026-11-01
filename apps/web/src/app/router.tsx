import { Toaster } from "@moneytrap/ui";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
  redirect,
} from "@tanstack/react-router";
import { ClickReportScreen } from "../features/analytics/click-report-containers";
import { isStepUpPending } from "../features/identity/challenge-marker";
import {
  AccountSecurityScreen,
  InvitationScreen,
  LoginScreen,
  MembersScreen,
  RecoveryRequestScreen,
  RegisterScreen,
  ResetPasswordScreen,
  SessionsScreen,
  StepUpScreen,
} from "../features/identity/identity-containers";
import { stepUpRedirect } from "../features/identity/return-to";
import { redirectSignedInVisitor } from "../features/landing/landing-guard";
import { LandingScreen } from "../features/landing/landing-screen";
import { isSignedIn } from "../features/landing/signed-in";
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

// The session check is passed in through router context, so tests can replace it without a server.
export type RouterContext = { isSignedIn: () => Promise<boolean> };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <AppShell>
      <Outlet />
      <Toaster />
    </AppShell>
  ),
});

// Public landing page. A signed-in visitor goes straight to the overview, using the same session check as the identity screens.
const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ context }) => redirectSignedInVisitor(context.isSignedIn),
  component: LandingScreen,
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
    mode: input.mode === "recovery" ? ("recovery" as const) : ("totp" as const),
    returnTo: optionalString(input, "returnTo"),
  }),
  // Without a sign-in waiting for a second factor, the code cannot be matched. Send the user to login first.
  beforeLoad: ({ search }) => {
    const target = stepUpRedirect({ challenge: isStepUpPending(), mode: search.mode });
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

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account/sessions",
  component: SessionsScreen,
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

// Click analytics (SKELETONS §5.4, UI-037). The organization is in the path, as in the API. The cursor is the page position.
const clickReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/organizations/$organizationId/reports/clicks",
  validateSearch: (input: Record<string, unknown>) => ({ cursor: optionalString(input, "cursor") }),
  component: function ClickReport() {
    const { organizationId } = clickReportRoute.useParams();
    const search = clickReportRoute.useSearch();
    const navigate = clickReportRoute.useNavigate();
    return (
      <ClickReportScreen
        organizationId={organizationId}
        cursor={search.cursor}
        onNext={(cursor) => void navigate({ search: { cursor } })}
      />
    );
  },
});

const routeTree = rootRoute.addChildren([
  landingRoute,
  overviewRoute,
  registerRoute,
  loginRoute,
  stepUpRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  accountSecurityRoute,
  sessionsRoute,
  membersRoute,
  invitationRoute,
  clickReportRoute,
]);

// Pass a browser history from the entry point. Memory history keeps tests and SSR-free imports safe.
export function createAppRouter(
  history: RouterHistory = createMemoryHistory({ initialEntries: ["/overview"] }),
  context: RouterContext = { isSignedIn },
) {
  return createRouter({ routeTree, history, context });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
