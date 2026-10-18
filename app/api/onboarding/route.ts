import { NextResponse } from "next/server";

// Invitation only: new organisations are not created through self sign-up.
export async function POST() {
  return NextResponse.json({ errorCode: "INVITE_ONLY" }, { status: 403 });
}
