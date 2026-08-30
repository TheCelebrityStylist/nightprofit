import Stripe from "stripe";
import { requireValue, serverEnv } from "../env";
export function stripeClient(){return new Stripe(requireValue(serverEnv().STRIPE_SECRET_KEY,"STRIPE_SECRET_KEY"),{maxNetworkRetries:2})}
export type PlanKey="diagnostic"|"essential_monthly"|"essential_annual"|"pro_monthly"|"pro_annual";
export function priceFor(plan:PlanKey){const env=serverEnv();const prices:Record<PlanKey,string|undefined>={diagnostic:env.STRIPE_DIAGNOSTIC_PRICE_ID,essential_monthly:env.STRIPE_ESSENTIAL_MONTHLY_PRICE_ID,essential_annual:env.STRIPE_ESSENTIAL_ANNUAL_PRICE_ID,pro_monthly:env.STRIPE_PRO_MONTHLY_PRICE_ID,pro_annual:env.STRIPE_PRO_ANNUAL_PRICE_ID};return requireValue(prices[plan],`Stripe price for ${plan}`)}
