-- Correct the currency label on backfilled estimates.
--
-- The unified-costs backfill took each row's currency from Twilio's price_unit
-- whenever one was present. But price_unit accompanies the *billed* price, and a
-- row with no billed price carries the rate-card estimate instead — which is
-- computed from the RATE_CARD_CURRENCY rates, not from Twilio's unit. On this
-- account (billed in GBP, rate card in USD) that stamped GBP on nine USD
-- figures, making the estimate look ~1.3x larger than it is.
--
-- An amount is only meaningful next to the unit it was computed in.
update public.costs
   set currency = 'USD'
 where estimated
   and source in ('sms', 'whatsapp')
   and currency <> 'USD';
