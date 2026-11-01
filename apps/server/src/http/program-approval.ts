import type { Clock, IdGenerator } from "@moneytrap/app";
import { type ProgramApprovalStatus, requestProgramApproval } from "@moneytrap/app/src/eligibility/request-approval";
import type { ProgramApprovalStore } from "@moneytrap/app/src/ports/program-approval-store";
import { type Id, parseId } from "@moneytrap/domain";
import { Elysia, t } from "elysia";
import type { Kysely } from "kysely";
import { errorResponse } from "./error-map";
import { guard, type PrincipalResolver } from "./guards/enforce";
import { requestIdOf } from "./request-id";

export const PROGRAM_APPROVAL_PATH = "/api/organizations/:organizationId/programs/:programId/request-approval";
// The key the guard table uses for this route: the method and the path.
export const PROGRAM_APPROVAL_KEY = `POST ${PROGRAM_APPROVAL_PATH}`;

export interface ProgramApprovalWiring {
  db: Kysely<unknown>;
  store: ProgramApprovalStore;
  clock: Clock;
  ids: IdGenerator;
  principal: PrincipalResolver;
}

// The response state for each status view. A new request is pending; a status the network has already reported is
// returned as it is, so a repeat call never reads as pending after approval.
const STATE: Record<ProgramApprovalStatus, string> = {
  requested: "pending",
  approved: "approved",
  rejected: "rejected",
};

// Asks for approval of one program for one property (API-035, WP-4.10). The organization is the one in the path, which
// the guard checks against the caller's membership and catalog:write. The body names only the property.
// Mounted only when the composition root supplies the store. Without it the route is not served at all.
export function programApprovalRoutes(wiring?: ProgramApprovalWiring) {
  const app = new Elysia({ name: "program-approval" });
  if (!wiring) return app;
  const { db, store, clock, ids, principal } = wiring;
  return app.post(
    PROGRAM_APPROVAL_PATH,
    {
      ...guard(PROGRAM_APPROVAL_KEY, principal),
      body: t.Object({ property_id: t.String() }),
    },
    async ({ params, body, request, set }) => {
      const caller = await principal(request.headers);
      const organizationId = parseId("organization", params.organizationId) as Id<"organization">;
      const result = await requestProgramApproval(
        { db, clock, ids, actor: { type: "user", id: caller?.userId ?? "" } },
        store,
        { organizationId, propertyId: body.property_id, programId: params.programId },
      );
      if (!result.ok) {
        const { status, body: error } = errorResponse(result.code, requestIdOf(request), "Request failed");
        set.status = status;
        return error;
      }
      set.status = 202;
      return { state: STATE[result.value.status] };
    },
  );
}
