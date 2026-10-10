import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { signInPath } from "@/lib/auth/paths";
import { env } from "@/lib/env";

export default auth((req) => {
  if (req.auth?.user) return NextResponse.next();
  const callbackUrl = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  return NextResponse.redirect(new URL(signInPath(callbackUrl), env.appBaseUrl));
});

export const config = { matcher: ["/app/:path*"] };
