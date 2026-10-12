// ปรับขนาดตัวอักษรเนื้อหาฉลากให้พอดีความสูง 65 มม. (2569-10-12)
//
// ผู้ใช้ขอเนื้อหา 9.5pt ตัวหนา (เดิม 8pt) — วัดกับยาจริง 332 รายการแล้ว ถ้าตายตัวที่ 9.5pt
// ฉลาก ~80% ล้นความสูง และหน้าต่างพิมพ์ (overflow: hidden) ตัดบรรทัดท้ายทิ้ง (ข้อควรระวัง/การเก็บรักษา)
// → เริ่มที่ 9.5pt แล้วลดทีละ 0.5pt เฉพาะฉลากที่ยังล้น (ร่วมกับระยะห่างที่กระชับขึ้นใน App.css)
// ผลวัดตอนทำ (ภาษาไทย ไม่มีชื่อลูกค้า): 9.5pt ~300 รายการ · 9pt ~26 · ที่เหลือไม่กี่ตัวที่ข้อความยาวมาก

export const LABEL_BODY_MAX_PT = 9.5;
export const LABEL_BODY_MIN_PT = 6.5;
const LABEL_BODY_STEP_PT = 0.5;

/** ลองขนาดบน element `.dl-label` จริงแล้วคืนขนาดใหญ่สุดที่ไม่ล้น
 *  ⚠️ element ต้อง "มองเห็นได้" (มี layout) — `display: none` วัด scrollHeight ไม่ได้ (ได้ 0 เสมอ = พอดีหลอก ๆ)
 *     DrugLabelPage จึงวัดบน Label ตัว Preview แล้วส่งขนาดเดียวกันให้ตัวพิมพ์ (ที่ซ่อนอยู่) ทาง prop
 *  · `transform: scale(1.25)` ของ Preview ไม่กระทบการวัด — scrollHeight/clientHeight เป็นค่า layout ก่อน transform
 *  · fits = false แปลว่าเล็กสุดแล้วยังล้น → ส่วนล่างจะถูกตัดตอนพิมพ์ (หน้าเว็บเตือนผู้ใช้) */
export function fitLabelBodySize(el: HTMLElement): { size: number; fits: boolean } {
  for (let size = LABEL_BODY_MAX_PT; size >= LABEL_BODY_MIN_PT; size -= LABEL_BODY_STEP_PT) {
    el.style.setProperty('--dl-body-size', `${size}pt`);
    if (el.scrollHeight - el.clientHeight <= 1) return { size, fits: true };
  }
  el.style.setProperty('--dl-body-size', `${LABEL_BODY_MIN_PT}pt`);
  return { size: LABEL_BODY_MIN_PT, fits: false };
}
