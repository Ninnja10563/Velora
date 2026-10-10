import { getChatGPTUser } from "@/app/chatgpt-auth";
import { accountStateSchema, allowAccountMutation, BodyTooLargeError, isSameOriginRequest, readBoundedJson } from "@/lib/account-validation";
import { deleteAccountState, readAccountState, storageConfigured, trustedIdentityEnabled, writeAccountState } from "@/lib/storage";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store", "Vary": "Cookie, oai-authenticated-user-id" };
function reply(value: unknown, status = 200) { return Response.json(value, { status, headers: noStore }); }
async function identity() { return trustedIdentityEnabled() ? getChatGPTUser() : null; }

export async function GET() {
  const user = await identity();
  if (!user) return reply({ authenticated: false, user: null, syncAvailable: false, identityAvailable: trustedIdentityEnabled(), message: "Guest mode: saved products stay in this browser." });
  const account = { authenticated: true, user: { id: user.userId, displayName: user.displayName }, identityAvailable: true };
  if (!storageConfigured()) return reply({ ...account, syncAvailable: false, message: "Account sync is not configured. Your browser shortlist still works." }, 503);
  try {
    return reply({ ...account, syncAvailable: true, state: await readAccountState(user.userId) });
  } catch {
    return reply({ ...account, syncAvailable: false, message: "Account storage could not be reached. Browser data is unchanged." }, 503);
  }
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) return reply({ error: "Same-origin requests are required." }, 403);
  const user = await identity();
  if (!user) return reply({ error: "Sign in to sync an account." }, 401);
  if (!allowAccountMutation(user.userId)) return reply({ error: "Too many account updates. Try again in a minute." }, 429);
  if (!storageConfigured()) return reply({ error: "Account sync is not configured." }, 503);
  try {
    const parsed = accountStateSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) return reply({ error: "Account data is invalid. Check saved products and preferences." }, 400);
    await writeAccountState(user.userId, parsed.data);
    return reply({ saved: true, state: parsed.data });
  } catch (error) {
    if (error instanceof BodyTooLargeError) return reply({ error: "Account data is too large." }, 413);
    return reply({ error: error instanceof SyntaxError ? "Invalid JSON." : "Account storage could not be reached. Your browser data is unchanged." }, error instanceof SyntaxError ? 400 : 503);
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return reply({ error: "Same-origin requests are required." }, 403);
  const user = await identity();
  if (!user) return reply({ error: "Sign in to delete account data." }, 401);
  if (!allowAccountMutation(user.userId)) return reply({ error: "Too many account updates. Try again in a minute." }, 429);
  if (!storageConfigured()) return reply({ error: "Account storage is not configured." }, 503);
  try {
    await deleteAccountState(user.userId);
    return reply({ deleted: true, message: "Your Velora account data was deleted. Your ChatGPT account is unchanged." });
  } catch {
    return reply({ error: "Account data could not be deleted. Try again when storage is available." }, 503);
  }
}
