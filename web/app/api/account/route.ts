import { accountStateSchema, allowAccountMutation, BodyTooLargeError, isSameOriginRequest, readBoundedJson } from "../../../lib/account-validation.ts";
import { deleteAccountState, readAccountState, storageConfigured, writeAccountState } from "../../../lib/storage.ts";
import { authConfigured, authFailure, authResponse, clearSession, deleteSupabaseIdentity, resolveUser, type AuthContext } from "../../../lib/auth.ts";
import { HttpError } from "../../../lib/security.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let context: AuthContext | undefined;
  try {
    context = await resolveUser(request);
    if (!context.user) return authResponse({ authenticated: false, user: null, syncAvailable: false, identityAvailable: authConfigured() || process.env.TRUST_SITES_IDENTITY === "true", authAvailable: authConfigured(), message: "Guest mode: saved products stay in this browser." }, context);
    const account = { authenticated: true, user: context.user, identityAvailable: true, authAvailable: authConfigured() };
    if (!storageConfigured()) return authResponse({ ...account, syncAvailable: false, message: "Account storage is not configured. Your browser shortlist still works." }, context, 503);
    return authResponse({ ...account, syncAvailable: true, state: await readAccountState(context.user.id) }, context);
  } catch (error) { return authFailure(error, context?.headers); }
}

export async function PUT(request: Request) {
  let context: AuthContext | undefined;
  try {
    if (!isSameOriginRequest(request)) throw new HttpError("Same-origin account requests are required.", 403);
    context = await resolveUser(request);
    if (!context.user) throw new HttpError("Sign in to sync your account.", 401);
    if (!allowAccountMutation(context.user.id)) throw new HttpError("Too many account updates. Try again in a minute.", 429);
    if (!storageConfigured()) throw new HttpError("Account storage is not configured.", 503);
    const parsed = accountStateSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) throw new HttpError("Account data is invalid. Check saved products and preferences.", 400);
    await writeAccountState(context.user.id, parsed.data);
    return authResponse({ saved: true, state: parsed.data }, context);
  } catch (error) {
    if (error instanceof BodyTooLargeError) error = new HttpError("Account data is too large.", 413);
    if (error instanceof SyntaxError) error = new HttpError("Invalid JSON.", 400);
    return authFailure(error, context?.headers);
  }
}

export async function DELETE(request: Request) {
  let context: AuthContext | undefined;
  try {
    if (!isSameOriginRequest(request)) throw new HttpError("Same-origin account requests are required.", 403);
    context = await resolveUser(request);
    if (!context.user) throw new HttpError("Sign in to delete your account.", 401);
    if (!allowAccountMutation(context.user.id)) throw new HttpError("Too many account updates. Try again in a minute.", 429);
    if (!storageConfigured()) throw new HttpError("Account storage is not configured.", 503);
    await deleteAccountState(context.user.id);
    try { await deleteSupabaseIdentity(context.user); }
    catch { throw new HttpError("Your stored Velora data was deleted, but deletion of your sign-in account could not be confirmed. If you can still sign in, retry to finish deleting it.", 503); }
    clearSession(context.headers, request);
    return authResponse({ deleted: true, message: context.user.provider === "supabase" ? "Your Velora account and associated personal data were deleted." : "Your Velora data was deleted. Your ChatGPT account is unchanged." }, context);
  } catch (error) { return authFailure(error, context?.headers); }
}
