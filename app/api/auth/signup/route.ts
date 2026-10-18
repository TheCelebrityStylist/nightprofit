import { NextResponse } from "next/server";

// Accounts are only created through a personal invitation link (/employee-onboarding/<token>).
export async function POST(){
  return NextResponse.json({errorCode:"INVITE_ONLY"},{status:403});
}
