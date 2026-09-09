import { NextResponse } from 'next/server';
import { logError, logJob, safeLog } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { getSMSMessage } from '@/lib/twilio';
import {
  smsMetadataFromTwilioMessage,
  recordMessageCost,
} from '@/lib/costs';

export const dynamic = 'force-dynamic';

const DEFAULT_BATCH_SIZE = 50;
const MAX_LOOKUP_ATTEMPTS = 72;

function toRawPayload(message: any) {
  try {
    return JSON.parse(JSON.stringify(message));
  } catch {
    return {};
  }
}

async function reconcileSmsPricing() {
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const batchSize = Number(process.env.SMS_PRICING_RECONCILE_BATCH_SIZE || DEFAULT_BATCH_SIZE);
  const startedAt = Date.now();

  // The schedule for this job lives outside the repo (no vercel.json), so
  // "did it actually run?" was previously unanswerable — a run that found
  // nothing to price looked identical to a run that never happened. This
  // heartbeat fires before any work, so absence of it means absence of a run.
  logJob('sms_pricing_started', { category: 'sms', source: 'api.cron.sms-pricing', batch_size: batchSize });

  try {
    // Rows still carrying the rate-card estimate rather than Twilio's billed
    // figure. `estimated` replaces the old "price is null" test: a cost row is
    // never priceless, it just hasn't been confirmed yet.
    const { data: rows, error } = await supabase
      .from('costs')
      .select('id, reference, session_id, transcript_id, salon_id, source, direction, price_lookup_attempts')
      .eq('estimated', true)
      .in('source', ['sms', 'whatsapp'])
      .not('reference', 'is', null)
      .lt('created_at', cutoffIso)
      .lt('price_lookup_attempts', MAX_LOOKUP_ATTEMPTS)
      .order('created_at', { ascending: true })
      .limit(Number.isFinite(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE);

    if (error) throw error;

    let checked = 0;
    let priced = 0;
    let pending = 0;
    let failed = 0;

    for (const row of rows || []) {
      checked++;
      try {
        const twilioMessage = await getSMSMessage(row.reference);
        const metadata = smsMetadataFromTwilioMessage(twilioMessage);
        const hasPrice = metadata.price !== null && metadata.price !== undefined;

        await recordMessageCost({
          twilioMessageSid: row.reference,
          channel: row.source as 'sms' | 'whatsapp',
          sessionId: row.session_id,
          transcriptId: row.transcript_id,
          salonId: row.salon_id,
          direction: row.direction,
          ...metadata,
          pricedAt: hasPrice ? nowIso : undefined,
          lastPriceLookupAt: nowIso,
          priceLookupAttempts: (row.price_lookup_attempts || 0) + 1,
          rawPayload: toRawPayload(twilioMessage),
        });

        if (hasPrice) priced++;
        else pending++;
      } catch (error: any) {
        failed++;
        await supabase
          .from('costs')
          .update({
            last_price_lookup_at: nowIso,
            price_lookup_attempts: (row.price_lookup_attempts || 0) + 1,
            updated_at: nowIso,
          })
          .eq('id', row.id);

        safeLog({
          type: 'error',
          level: 'warning',
          category: 'sms',
          event: 'sms_price_lookup_failed',
          twilio_message_sid: row.reference,
          error: error?.message || String(error),
          stack: error?.stack,
        });
      }
    }

    logJob('sms_pricing_finished', {
      category: 'sms',
      source: 'api.cron.sms-pricing',
      duration_ms: Date.now() - startedAt,
      checked,
      priced,
      pending,
      failed,
    });

    return NextResponse.json({ checked, priced, pending, failed });
  } catch (error: any) {
    logError('sms', 'sms_pricing_failed', error, {
      source: 'api.cron.sms-pricing',
      duration_ms: Date.now() - startedAt,
      query_description: 'Cron SMS pricing reconciliation failed',
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return reconcileSmsPricing();
}

export async function POST() {
  return reconcileSmsPricing();
}
