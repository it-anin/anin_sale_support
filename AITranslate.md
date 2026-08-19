# AI Translation — โครงสร้าง Code

ระบบแปลภาษาอัตโนมัติสำหรับฉลากยา ใช้ Groq API (`openai/gpt-oss-120b`) ผ่าน Supabase Edge Function

---

## ภาพรวม Flow

```
ผู้ใช้กด "✨ แปลด้วย AI" (Add modal หรือ Edit modal)
        │
        ▼
druglabel/DrugLabelPage.tsx
  handleAutoTranslate() / handleEditAutoTranslate()
        │
        ▼
druglabel/translate.ts
  translateMedicineLabel()
        │  เรียกผ่าน Supabase JS Client (supabase.functions.invoke)
        ▼
supabase/functions/translate-medicine/index.ts
  (Deno Edge Function)
        │  เรียก Groq API
        ▼
Groq — openai/gpt-oss-120b
  แปลข้อมูลฉลากยาทั้งหมดในครั้งเดียว (1 request / ทุกภาษาปลายทาง)
        │
        ▼
ผลลัพธ์กลับมาแสดงในฟอร์มแต่ละ tab ภาษา
```

---

## ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | บทบาท |
|------|--------|
| `druglabel/translate.ts` | ฟังก์ชัน client-side สำหรับเรียก translation |
| `supabase/functions/translate-medicine/index.ts` | Edge Function — รับ request, เรียก Groq, คืน JSON |
| `druglabel/DrugLabelPage.tsx` | UI ทั้งหน้า — รวมปุ่มแปล (`handleAutoTranslate`/`handleEditAutoTranslate`), แสดงผล, จัดการ error |
| `druglabel/types.ts` | type `Lang` และ `LANGS` ที่ใช้ร่วมกัน |

---

## 1. `druglabel/translate.ts`

ไฟล์หลักสำหรับ AI translation ฝั่ง client

### Types

```ts
export interface MedicineLabelFields {
  trade_name: string;
  generic_name: string;
  usage: string;
  indication: string;
  warning: string;
  storage: string;
}

export type TranslationResult = Partial<Record<Lang, MedicineLabelFields>>;
```

### ฟังก์ชัน

**`translateMedicineLabel(sourceLang, fields, targetLangs)`**
- รับข้อมูลฉลากภาษาต้นทาง และ list ภาษาปลายทาง
- เรียก Supabase Edge Function `translate-medicine`
- คืน `TranslationResult` หรือ throw Error พร้อมข้อความภาษาไทย
- ⚠️ **error handling พิเศษ:** `supabase.functions.invoke()` โยน error ที่มี `.message` เป็นข้อความ generic เสมอ ("Edge function returned a non-2xx status code") ไม่ว่าสาเหตุจริงจะเป็นอะไร — โค้ดจึงเช็คว่า error เป็น `FunctionsHttpError` แล้ว `await error.context.json()` เพื่ออ่านข้อความ error จริงจาก response body ของ edge function มาโชว์แทน (แก้ 2569-08 หลังเจอบั๊กจริงที่ error message ไม่บอกอะไรเลย)

**`getTargetLangs(sourceLang)`**
- คืนทุกภาษาที่รองรับ ยกเว้นภาษาต้นทาง
- ใช้เพื่อส่งเป็น `targetLangs` ใน `translateMedicineLabel()`

---

## 2. `supabase/functions/translate-medicine/index.ts`

Deno Edge Function ที่ deploy บน Supabase — **deploy แยกจาก Vercel** ⚠️ push ขึ้น GitHub master ไม่ทำให้ edge function เวอร์ชันใหม่ขึ้นเองอัตโนมัติ ต้องรัน `npx supabase functions deploy translate-medicine --project-ref <ref>` เอง (ต้อง `supabase login` ก่อนครั้งแรก)

### Input (POST body)

```json
{
  "source_lang": "th",
  "fields": {
    "trade_name": "พาราเซตามอล 500 mg",
    "generic_name": "Paracetamol",
    "usage": "ทานครั้งละ 1-2 เม็ด ทุก 4-6 ชั่วโมง",
    "indication": "บรรเทาปวด ลดไข้",
    "warning": "ห้ามใช้เกินวันละ 8 เม็ด",
    "storage": "เก็บในที่แห้ง อุณหภูมิต่ำกว่า 30 องศา"
  },
  "target_langs": ["en", "zh", "ja", "my", "km", "ko"]
}
```

### Output (JSON)

```json
{
  "en": { "trade_name": "...", "generic_name": "...", ... },
  "zh": { "trade_name": "...", "generic_name": "...", ... },
  "ja": { ... },
  "my": { ... },
  "km": { ... },
  "ko": { ... }
}
```

Rate limit hit → status **200** พร้อม `{ rate_limit: true, retry_minutes: number | null }` (จงใจไม่ใช้ status 500 หรือ field ชื่อ `error` — เคยทำให้ Supabase SDK ตีความ response ผิดมาก่อน)

Error อื่นๆ (เช่น GROQ_API_KEY หาย, Groq API ปฏิเสธ request, โมเดลถูก deprecate) → status **500** พร้อม `{ error: "ข้อความจริง" }`

### การทำงานภายใน

1. รับ request และ validate body
2. อ่าน `GROQ_API_KEY` จาก Supabase secrets
3. สร้าง prompt ที่ระบุ: ภาษาต้นทาง, ข้อมูลฉลาก, ภาษาปลายทาง
4. ส่งไปยัง `https://api.groq.com/openai/v1/chat/completions`
   - Model: `openai/gpt-oss-120b`
   - Temperature: `0.2` (คงที่, ลด hallucination)
   - Max tokens: `8192`
5. Strip markdown code fence ออกจาก response (ถ้ามี)
6. Parse JSON และ normalize ให้ครบทุก field
7. คืน JSON ไปยัง client

> ⚠️ **โมเดลเดิมคือ `llama-3.3-70b-versatile` — Groq เลิกรองรับแล้ว (deprecated 2569-08)** ทำให้ error "model_not_found" เปลี่ยนมาใช้ `openai/gpt-oss-120b` ตามคำแนะนำของ Groq — ถ้า Groq เลิกรองรับโมเดลนี้อีกในอนาคต จะเจอ error รูปแบบเดียวกัน (`Groq API error: {"error":{"code":"model_not_found",...}}`) ต้องเช็ค [Groq deprecations](https://console.groq.com/docs/deprecations) แล้วเปลี่ยนโมเดลตรงนี้ + deploy ใหม่

### Environment Variable ที่ต้องตั้ง

| ตัวแปร | ที่ตั้ง |
|--------|---------|
| `GROQ_API_KEY` | Supabase Dashboard → Edge Functions → Secrets |

---

## 3. `druglabel/DrugLabelPage.tsx`

### `handleAutoTranslate()` — ใช้ใน Add modal

```
1. เช็คว่ากรอก trade_name ในแท็บที่เลือกแล้ว
2. เรียก translateMedicineLabel() จาก druglabel/translate.ts — แปลทุกภาษา (ยกเว้น source lang)
3. เมื่อสำเร็จ — อัปเดต form.translations ทุกภาษา
4. เมื่อ error — แสดงข้อความ error ใต้ปุ่มแปล
```

### `handleEditAutoTranslate()` — ใช้ใน Edit modal

```
1. เช็คว่ากรอก trade_name ในแท็บที่เลือกแล้ว
2. หา missingLangs — เฉพาะภาษาที่ยังว่างอยู่ (ทุก field เป็น empty string)
3. ถ้าทุกภาษามีข้อมูลแล้ว → error "ทุกภาษามีข้อมูลอยู่แล้ว"
4. เรียก translateMedicineLabel() แปลเฉพาะ missingLangs — ไม่เขียนทับภาษาที่มีข้อมูลแล้ว
```

รายละเอียด flow การใช้งานเต็ม ๆ อยู่ที่ [`druglabel/CLAUDE.md`](druglabel/CLAUDE.md) หัวข้อ "Drug Label — Auto Translate"

---

## ภาษาที่รองรับ

| Code | ภาษา |
|------|------|
| `th` | ภาษาไทย |
| `en` | English |
| `zh` | 中文 (Simplified Chinese) |
| `ja` | 日本語 |
| `my` | မြန်မာ (Burmese) |
| `km` | ខ្មែរ (Khmer) |
| `ko` | 한국어 (Korean) |

---

## การเพิ่มภาษาใหม่

1. เพิ่ม code ใน `Lang` type และ `LANGS` array — `druglabel/types.ts`
2. เพิ่ม `FIELD_LABELS` mapping ของภาษาใหม่ — `druglabel/Label.tsx`
3. เพิ่มใน `LANG_NAMES` — `supabase/functions/translate-medicine/index.ts`
4. เพิ่มใน `getTargetLangs()` — `druglabel/translate.ts`
5. อัปเดต `check` constraint ใน Supabase SQL:
   ```sql
   ALTER TABLE label.medicine_translations
     DROP CONSTRAINT medicine_translations_lang_check;
   ALTER TABLE label.medicine_translations
     ADD CONSTRAINT medicine_translations_lang_check
     CHECK (lang IN ('th','en','zh','ja','my','km','ko','NEW_CODE'));
   ```
6. รัน `npx supabase functions deploy translate-medicine --project-ref <ref>` (ข้อ 3 แก้ edge function ต้อง deploy ใหม่ถึงจะมีผล)
