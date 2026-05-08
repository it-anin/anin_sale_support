const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LANG_NAMES: Record<string, string> = {
  th: 'Thai',
  en: 'English',
  zh: 'Simplified Chinese',
  ja: 'Japanese',
  my: 'Burmese (Myanmar)',
  km: 'Khmer (Cambodian)',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { source_lang, fields, target_langs } = await req.json();

    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured in Supabase secrets');

    const sourceName = LANG_NAMES[source_lang] ?? source_lang;
    const targetList = (target_langs as string[])
      .map(l => `"${l}" (${LANG_NAMES[l] ?? l})`).join(', ');

    const prompt = `You are a professional pharmacist and medical translator.
Translate the following medicine label fields from ${sourceName} into these target languages: ${targetList}.

Source fields (${sourceName}):
${JSON.stringify(fields, null, 2)}

Rules:
- Translate accurately for a pharmacy drug label context.
- Keep medicine names (trade_name, generic_name) in their standard international form when appropriate.
- CRITICAL: Use consistent terminology across ALL fields for each language. Whatever term you choose for trade_name, use that exact same term (not synonyms or alternate spellings) whenever referring to this medicine in usage, indication, warning, and storage fields.
- If a source field is empty (""), keep it empty in translation.
- Return ONLY a raw JSON object — no markdown, no code fence, no explanation.

Required JSON format:
{
  "en": { "trade_name": "...", "generic_name": "...", "usage": "...", "indication": "...", "warning": "...", "storage": "..." },
  "zh": { ... }
}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 8192,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      if (groqRes.status === 429) {
        const match = errText.match(/try again in (\d+)m[\d.]+s/);
        const minutes = match ? parseInt(match[1]) + 1 : null;
        return new Response(
          JSON.stringify({ rate_limit: true, retry_minutes: minutes }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Groq API error: ${errText}`);
    }

    const groqData = await groqRes.json();
    let content: string = groqData.choices[0].message.content;

    // Strip markdown code fence if present
    content = content.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

    const raw = JSON.parse(content);

    // Normalize — ensure all fields exist for every requested language
    const normalized: Record<string, object> = {};
    for (const lang of target_langs as string[]) {
      normalized[lang] = {
        trade_name:   raw[lang]?.trade_name   ?? '',
        generic_name: raw[lang]?.generic_name ?? '',
        usage:        raw[lang]?.usage        ?? '',
        indication:   raw[lang]?.indication   ?? '',
        warning:      raw[lang]?.warning      ?? '',
        storage:      raw[lang]?.storage      ?? '',
      };
    }

    return new Response(JSON.stringify(normalized), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
