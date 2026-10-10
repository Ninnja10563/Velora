import { handleAuth } from "../../../../lib/auth.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) { return handleAuth(request, "session"); }
