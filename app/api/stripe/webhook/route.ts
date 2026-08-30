import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { requireValue, serverEnv } from "../../../../lib/env";
import { stripeClient } from "../../../../lib/stripe/server";

function subscriptionRow(subscription:Stripe.Subscription){
  const organisationId=subscription.metadata.organisation_id;
  const plan=subscription.metadata.plan||"unknown";
  const periodEnd=(subscription.items.data[0] as Stripe.SubscriptionItem|undefined)?.current_period_end;
  return {organisation_id:organisationId,stripe_customer_id:typeof subscription.customer==="string"?subscription.customer:subscription.customer.id,stripe_subscription_id:subscription.id,plan,status:subscription.status,venue_quantity:subscription.items.data.reduce((sum,item)=>sum+(item.quantity??1),0),current_period_end:periodEnd?new Date(periodEnd*1000).toISOString():null,cancel_at_period_end:subscription.cancel_at_period_end,grace_until:subscription.status==="past_due"?new Date(Date.now()+7*86400000).toISOString():null};
}
export async function POST(request:Request){
  const raw=await request.text();const signature=request.headers.get("stripe-signature");if(!signature)return NextResponse.json({error:"Missing signature"},{status:400});
  let event:Stripe.Event;try{event=await stripeClient().webhooks.constructEventAsync(raw,signature,requireValue(serverEnv().STRIPE_WEBHOOK_SECRET,"STRIPE_WEBHOOK_SECRET"));}catch{return NextResponse.json({error:"Invalid signature"},{status:400})}
  const admin=createSupabaseAdminClient();const hash=createHash("sha256").update(raw).digest("hex");const {error:claimError}=await admin.from("stripe_webhook_events").insert({stripe_event_id:event.id,event_type:event.type,created_at_stripe:new Date(event.created*1000).toISOString(),payload_hash:hash,processing_status:"processing"});
  if(claimError?.code==="23505")return NextResponse.json({received:true,duplicate:true});if(claimError)return NextResponse.json({error:"Event storage failed"},{status:500});
  try{
    if(event.type==="checkout.session.completed"){const session=event.data.object;const organisationId=session.metadata?.organisation_id;if(organisationId&&session.customer)await admin.from("organisations").update({stripe_customer_id:typeof session.customer==="string"?session.customer:session.customer.id}).eq("id",organisationId)}
    if(["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"].includes(event.type)){const subscription=event.data.object as Stripe.Subscription;const row=subscriptionRow(subscription);if(row.organisation_id){await admin.from("subscriptions").upsert(row,{onConflict:"organisation_id"});const enabled=["active","trialing"].includes(row.status);await admin.from("feature_entitlements").upsert([{organisation_id:row.organisation_id,feature:"closing",enabled,source:"stripe"},{organisation_id:row.organisation_id,feature:"profit_pro",enabled:enabled&&row.plan.startsWith("pro"),source:"stripe"}],{onConflict:"organisation_id,feature"})}}
    await admin.from("stripe_webhook_events").update({processing_status:"processed",processed_at:new Date().toISOString()}).eq("stripe_event_id",event.id);return NextResponse.json({received:true});
  }catch{await admin.from("stripe_webhook_events").update({processing_status:"failed",error_code:"PROCESSING_FAILED"}).eq("stripe_event_id",event.id);return NextResponse.json({error:"Processing failed"},{status:500})}
}
