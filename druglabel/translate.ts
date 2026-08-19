import { FunctionsHttpError } from '@supabase/supabase-js';
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
  if (error) {
    let detail = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (body?.error) detail = body.error;
      } catch {
        // body ไม่ใช่ JSON — ใช้ error.message เดิม
      }
    }
    throw new Error(`แปลภาษาไม่สำเร็จ: ${detail}`);
  }
  if (data?.rate_limit) {
    const min = data.retry_minutes as number | null;
    throw new Error(min ? `ถึง rate limit — รอประมาณ ${min} นาที แล้วลองใหม่` : 'ถึง rate limit — รอสักครู่แล้วลองใหม่');
  }

  // 🚨 ด่านสุดท้ายกันคำแปลว่างไปทับฟอร์มแล้วผู้ใช้กดบันทึกโดยไม่รู้ตัว (เคยเกิดจริง — SKU 101248
  // ได้แถว null ครบทุกภาษาลง DB) edge function ก็เช็คให้อีกชั้นแล้ว แต่ deploy คนละทางกับเว็บ
  // (Vercel auto-deploy ↔ supabase functions deploy ที่ต้องรันมือ) เวอร์ชันเก่าจึงยังค้างอยู่ได้
  const result = (data ?? {}) as TranslationResult;
  const emptyLangs = targetLangs.filter(l => {
    const t = result[l];
    return !t || !Object.values(t).some(v => typeof v === 'string' && v.trim() !== '');
  });
  if (emptyLangs.length) {
    throw new Error(`ไม่ได้รับคำแปลของภาษา: ${emptyLangs.join(', ')} — ไม่ได้แก้ไขข้อมูลในฟอร์ม ลองใหม่อีกครั้ง`);
  }

  return result;
}

export function getTargetLangs(sourceLang: Lang): Lang[] {
  return (['th', 'en', 'zh', 'ja', 'my', 'km', 'ko'] as Lang[]).filter(l => l !== sourceLang);
}
