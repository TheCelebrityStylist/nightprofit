# Financial calculation contract

All money is integer minor units. EUR €12.34 is `1234`. Percentages are basis points: 21% is `2100`. Division rounds half-up unless a formula explicitly requires ceiling for safety. Gross, net and VAT values are named and never mixed.

## Formulas

- Expected cash = opening float + cash sales − cash refunds − paid-outs − safe drops.
- Actual cash = sum(denomination value × count).
- Close difference = accounted total − expected total.
- Net from VAT-inclusive gross = gross × 10,000 ÷ (10,000 + VAT bps).
- Gross profit = net revenue − direct cost.
- Gross margin bps = gross profit × 10,000 ÷ net revenue.
- Event contribution = net event revenue − every direct event cost.
- Personnel percentage = personnel cost × 10,000 ÷ net revenue.
- Tiered payout = sum(revenue inside each band × that band rate).
- Bottle yield = floor(package ml ÷ serving ml).
- Cost per serving = package cost ÷ usable yield.
- Break-even revenue = fixed cost ÷ contribution margin percentage, rounded up.
- Revenue per visitor/labour hour = relevant revenue ÷ units.
- Margin change = current margin bps − historical snapshotted margin bps.

## Worked fixtures

Opening float €300 + sales €2,250 − refunds €50 − paid-outs €120 − safe drops €800 = expected cash €1,580. Accounted €1,575.14 yields −€4.86. A 70 cl bottle with 40 ml pours yields 17 complete servings; a €34 bottle costs €2 per usable serving. Gross €121 at 21% VAT yields net €100.

Approved closes persist input, output, configuration version and content hash. Product price or configuration changes never mutate a historical result. Tests in `tests/calculations.test.ts` reproduce these examples.
