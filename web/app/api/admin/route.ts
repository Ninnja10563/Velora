import { isAllowedAdmin } from "../../../lib/account-validation.ts";
import { getAnalyticsSummary } from "../../../lib/storage.ts";
import { authFailure, authResponse, resolveUser, type AuthContext } from "../../../lib/auth.ts";
import { HttpError } from "../../../lib/security.ts";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let context: AuthContext | undefined;
  try {
    context = await resolveUser(request);
    if (!context.user || !isAllowedAdmin(context.user.id, process.env.ADMIN_USER_IDS)) throw new HttpError("Administrator access required.", 403);
    return authResponse(await getAnalyticsSummary(), context);
  } catch (error) { return authFailure(error, context?.headers); }
}
