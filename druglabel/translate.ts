import { supabase } from '../supabase';
import type { Lang } from './types';

export interface MedicineLabelFields {
  trade_name: string;
  generic_name: string;
  usage: string;
  indication: string;
  warning: string;
  storage: string;
}

export type TranslationResult = Partial<Record<Lang, MedicineLabelFields>>;

export async function translateMedicineLabel(
  sourceLang: Lang,
  fields: MedicineLabelFields,
  targetLangs: Lang[],
): Promise<TranslationResult> {
  const { data, error } = await supabase.functions.invoke('translate-medicine', {
    body: { source_lang: sourceLang, fields, target_langs: targetLangs },
  });
  if (error) throw new Error(`แปลภาษาไม่สำเร็จ: ${error.message}`);
  if (data?.rate_limit) {
    const min = data.retry_minutes as number | null;
    throw new Error(min ? `ถึง rate limit — รอประมาณ ${min} นาที แล้วลองใหม่` : 'ถึง rate limit — รอสักครู่แล้วลองใหม่');
  }
  return data as TranslationResult;
}

export function getTargetLangs(sourceLang: Lang): Lang[] {
  return (['th', 'en', 'zh', 'ja', 'my', 'km', 'ko'] as Lang[]).filter(l => l !== sourceLang);
}
