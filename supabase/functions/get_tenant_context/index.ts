import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authorization = req.headers.get("Authorization");

  if (!authorization) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const tenantId = await readTenantId(req);

  if (!tenantId) {
    return jsonResponse({ error: "Missing tenant_id" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
  }

  const accessToken = readBearerToken(authorization);

  if (!accessToken) {
    return jsonResponse({ error: "Invalid Authorization header" }, 401);
  }

  const isServiceRoleRequest = accessToken === supabaseServiceRoleKey;

  if (!isServiceRoleRequest) {
    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await authClient.auth.getClaims(accessToken);

    if (error || !data?.claims?.sub) {
      return jsonResponse({ error: "Invalid JWT" }, 401);
    }
  }

  const supabase = isServiceRoleRequest
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : createClient(supabaseUrl, supabaseAnonKey, {
        global: {
          headers: {
            Authorization: authorization,
          },
        },
      });

  const { data, error } = await supabase.rpc("get_tenant_context", {
    tenant_id: tenantId,
  });

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse(data ?? {});
});

function readBearerToken(authorization: string): string | null {
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function readTenantId(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const queryTenantId = url.searchParams.get("tenant_id");

  if (queryTenantId) {
    return queryTenantId;
  }

  if (req.method !== "POST") {
    return null;
  }

  try {
    const body = await req.json();
    return typeof body?.tenant_id === "string" ? body.tenant_id : null;
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
