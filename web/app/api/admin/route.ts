import { getChatGPTUser } from "@/app/chatgpt-auth";
import { isAllowedAdmin } from "@/lib/account-validation";
import { getAnalyticsSummary, trustedIdentityEnabled } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie, oai-authenticated-user-id" };
  const user = trustedIdentityEnabled() ? await getChatGPTUser() : null;
  if (!user || !isAllowedAdmin(user.userId, process.env.ADMIN_USER_IDS)) {
    return Response.json({ error: "Administrator access required." }, { status: 403, headers });
  }
  try {
    return Response.json(await getAnalyticsSummary(), { headers });
  } catch {
    return Response.json({ error: "Analytics storage is unavailable. No metrics have been substituted." }, { status: 503, headers });
  }
}
