import { NextResponse } from 'next/server';
import { TEST_UI_TRANSCRIPTS_TABLE, getDefaultSalon, supabase } from '@/lib/supabase';
import { safeLog } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type HealthCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

function formatError(error: any) {
  return error?.message || 'Unknown error';
}

export async function GET() {
  const checks: HealthCheck[] = [];

  checks.push({
    name: 'SUPABASE_URL',
    ok: Boolean(process.env.SUPABASE_URL),
    detail: process.env.SUPABASE_URL ? 'Configured' : 'Missing',
  });

  checks.push({
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    ok: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY),
    detail:
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
        ? 'Configured'
        : 'Missing',
  });

  checks.push({
    name: 'AI_MODEL_API_KEY',
    ok: Boolean(process.env.AI_MODEL_API_KEY),
    detail: process.env.AI_MODEL_API_KEY ? 'Configured' : 'Missing',
  });

  try {
    const salon = await getDefaultSalon();
    checks.push({
      name: 'default_salon',
      ok: Boolean(salon),
      detail: salon ? 'Default salon found' : 'No salon found in business_profiles',
    });
  } catch (error: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Agent sandbox health default salon check',
    });
    checks.push({
      name: 'default_salon',
      ok: false,
      detail: formatError(error),
    });
  }

  try {
    const { error } = await supabase
      .from(TEST_UI_TRANSCRIPTS_TABLE)
      .delete()
      .eq('session_id', '00000000-0000-0000-0000-000000000000')
      .eq('role', 'draft');

    if (error) throw error;

    checks.push({
      name: 'test_ui_transcripts_write_path',
      ok: true,
      detail: `${TEST_UI_TRANSCRIPTS_TABLE} is writable`,
    });
  } catch (error: any) {
    safeLog({
      type: 'error',
      level: 'error',
      category: 'system',
      event: 'db_error',
      error: error?.message || String(error),
      stack: error?.stack,
      query_description: 'Agent sandbox health transcript write check',
    });
    checks.push({
      name: 'test_ui_transcripts_write_path',
      ok: false,
      detail: formatError(error),
    });
  }

  const ok = checks.every((check) => check.ok);

  return NextResponse.json({
    ok,
    checks,
  });
}
