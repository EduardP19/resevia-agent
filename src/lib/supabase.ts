import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || ''; // Use ANON key for now, SERVICE for back-end logic

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ Supabase credentials missing in .env');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
