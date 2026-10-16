import {createHash,randomBytes} from "node:crypto";

export const STAFF_ONBOARDING_TOKEN_BYTES=32;
export function createStaffOnboardingToken(){return randomBytes(STAFF_ONBOARDING_TOKEN_BYTES).toString("base64url")}
export function hashStaffOnboardingToken(token:string){
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error("Invalid staff onboarding token");
  return createHash("sha256").update(token,"utf8").digest("hex");
}
export function onboardingMessage(language:"nl"|"en",name:string,organisationName:string,link:string){
  return language==="nl"?`Hoi ${name}, ${organisationName} nodigt je uit voor NightProfit. Rond je beveiligde personeelsprofiel af via ${link}`:`Hi ${name}, ${organisationName} invited you to NightProfit. Complete your secure employee profile at ${link}`;
}
