import { handleAuth } from "../../../../lib/auth.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) { return handleAuth(request, "signout"); }
