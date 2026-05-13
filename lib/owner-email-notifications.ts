import { safeLog } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

type AttentionStatus = 'needs_approval' | 'escalated';

type NotifyOwnerInput = {
  conversationId: string;
  salonId: string;
  status: AttentionStatus;
  clientPhone?: string | null;
};

function normalizeAttentionReason(status: AttentionStatus): 'needs_approval' | 'escalated' | null {
  if (status === 'needs_approval') return 'needs_approval';
  if (status === 'escalated') return 'escalated';
  return null;
}

function getConversationUrl(conversationId: string) {
  return `https://app.resevia.co.uk/dashboard/sessions/${conversationId}`;
}

function buildEmailContent(params: {
  salonName: string;
  clientPhone: string;
  reason: 'needs_approval' | 'escalated';
  conversationId: string;
}) {
  const reasonText = params.reason === 'needs_approval' ? 'Needs approval' : 'Escalated';
  const summaryLine =
    params.reason === 'needs_approval'
      ? 'A reply is waiting for your approval before it is sent.'
      : 'The AI escalated this conversation and it now needs owner attention.';
  const url = getConversationUrl(params.conversationId);
  const subject = 'Approval Required';
  const text = [
    `Phone: ${params.clientPhone}`,
    `Reason: ${reasonText}`,
    `Review: ${url}`,
  ].join('\n');

  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f3f8;font-family:Arial,sans-serif;color:#1f2937;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:20px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:20px 20px 8px 20px;">
                <p style="margin:0;font-size:12px;letter-spacing:1px;color:#6b7280;text-transform:uppercase;font-weight:700;">Resevia Alert</p>
                <h1 style="margin:8px 0 0 0;font-size:20px;line-height:1.3;color:#111827;">Conversation needs your attention</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 20px 0 20px;">
                <p style="margin:0 0 10px 0;font-size:15px;line-height:1.5;color:#374151;"><strong>Phone:</strong> ${params.clientPhone}</p>
                <p style="margin:0 0 10px 0;font-size:15px;line-height:1.5;color:#374151;"><strong>Reason:</strong> ${reasonText}</p>
                <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;color:#6b7280;">${summaryLine}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 20px 24px 20px;">
                <a href="${url}" style="display:inline-block;background:#6d28d9;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;font-size:14px;">Review Now</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

async function sendViaResend(to: string, subject: string, html: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is missing. Owner notification emails require Resend.');
  }

  const from = 'Resevia <hello@resevia.co.uk>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${body}`);
  }

  return true;
}

async function resolveOwnerEmail(salonId: string) {
  const { data: tenantProfile } = await supabase
    .from('1_business_profiles')
    .select('email, name')
    .eq('id', salonId)
    .maybeSingle();

  const tenantEmail =
    typeof tenantProfile?.email === 'string' && tenantProfile.email.trim().length > 0
      ? tenantProfile.email.trim()
      : null;

  if (tenantEmail) {
    return {
      email: tenantEmail,
      salonName: typeof tenantProfile?.name === 'string' && tenantProfile.name.trim() ? tenantProfile.name.trim() : 'Your Salon',
    };
  }

  return {
    email: null,
    salonName: (typeof tenantProfile?.name === 'string' && tenantProfile.name.trim()) || 'Your Salon',
  };
}

export async function notifyOwnerConversationAttention(input: NotifyOwnerInput) {
  const reason = normalizeAttentionReason(input.status);
  if (!reason) return;

  const owner = await resolveOwnerEmail(input.salonId);
  if (!owner.email) {
    safeLog({
      level: 'warning',
      category: 'auth',
      event: 'owner_notification_skipped',
      tenant_id: input.salonId,
      session_id: input.conversationId,
      reason: 'owner_email_missing',
    });
    return;
  }

  const clientPhone = (input.clientPhone || '').trim() || 'Unknown number';
  const email = buildEmailContent({
    salonName: owner.salonName,
    clientPhone,
    reason,
    conversationId: input.conversationId,
  });

  try {
    await sendViaResend(owner.email, email.subject, email.html, email.text);

    safeLog({
      level: 'info',
      category: 'auth',
      event: 'owner_notification_sent',
      tenant_id: input.salonId,
      session_id: input.conversationId,
      reason,
      user_id: owner.email,
    });
  } catch (error: any) {
    safeLog({
      level: 'error',
      category: 'auth',
      event: 'owner_notification_failed',
      tenant_id: input.salonId,
      session_id: input.conversationId,
      reason,
      user_id: owner.email,
      error: error?.message || String(error),
      stack: error?.stack,
    });
    throw error;
  }
}
