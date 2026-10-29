import { useEffect, useRef, useState } from 'react';
import { XlsxDocIcon } from './MasterUploadNotice';

/** การ์ดอัปโหลด Product Master — เช็กลิสต์ 3 ขั้นที่ระบบทำจริง (2569-10-29)
 *  ผู้ใช้สั่ง: เอา popup "📤 สรุปการเปลี่ยนแปลง Product Master" ออก ทำเป็นหน้าเดียวกับตอนกดปุ่ม และขึ้นว่า
 *  "อัปโหลดเสร็จสิ้น" พร้อมเครื่องหมายถูกสีเขียว → เลือกแบบที่ 8 "Checklist" จาก public/master-upload-done-designs.html
 *  หน้าตา/ขนาด/ปุ่มกระเบื้องนูนเหมือน popup ".xlsx" (MasterUploadNotice) และ popup "ไฟล์ถูกดีดกลับ" (MasterRejectNotice)
 *  ลำดับ: อ่านไฟล์ ✓ (เสร็จแล้วตอนการ์ดเปิด) → เทียบกับข้อมูลเดิม → บันทึกลงระบบ (นับ SKU ทีละ 100) → เสร็จสิ้น ✓ เขียว
 *        หรือพังที่ขั้นไหนก็ขึ้น ✕ ที่ขั้นนั้น + ข้อความ + [ลองอีกครั้ง]
 *  ตัวขับคือ runMasterUpload ใน SaleSupportPage.tsx (ส่ง `run` ลงมาเป็น props) — component นี้ไม่แตะฐานข้อมูลเอง
 *  CSS อยู่ใน App.css หัวข้อ "การ์ดอัปโหลด Product Master" (คลาส ss-mup-*) */

export type MasterUploadStatus = 'running' | 'done' | 'error';

/** สถานะทั้งหมดของการอัปโหลดรอบหนึ่ง — SaleSupportPage สร้างใหม่ทุกครั้งที่ขยับ (immutable) */
export interface MasterUploadRun {
  status: MasterUploadStatus;
  /** SKU ที่จะบันทึก (หลังตัดแถวไม่มี SKU / SKU ซ้ำ) */
  rows: number;
  /** แถวในไฟล์ที่ข้าม (ไม่มี SKU / SKU ซ้ำ ใช้แถวแรก) — แสดงต่อท้ายขั้น "อ่านไฟล์" เฉพาะตอนมี */
  skipped: number;
  /** ผลเทียบกับ product_master เดิม — null = ยังเทียบไม่เสร็จ (ขั้น 2 กำลังทำ)
   *  cleared = ช่องที่ไฟล์เว้นว่างจึงล้างค่าเดิมในระบบเป็นว่าง (upsert ส่ง null ทั้งคอลัมน์) */
  compared: { added: number; changed: number; cleared: number } | null;
  /** SKU ที่บันทึกแล้ว (ขั้น 3) */
  saved: number;
  /** ขั้นที่พัง — เฉพาะ status 'error' (ขั้น 1 ไม่มี: ไฟล์ที่อ่านไม่ได้/คอลัมน์ผิดไม่เปิดการ์ดนี้ ดู handleMasterFile) */
  failedStep: 2 | 3 | null;
  error: string;
}

interface Props {
  run: MasterUploadRun;
  /** กด [ตกลง] / [ปิด] หลังเสร็จหรือพัง — ปิดไม่ได้ระหว่าง running · เรียกหลังอนิเมชั่นปิดจบ ฝั่งแม่ unmount คอมโพเนนต์นี้ */
  onClose: () => void;
  /** กด [ลองอีกครั้ง] ตอนพัง — ฝั่งแม่เริ่มจากขั้นที่พัง (ขั้น 3 ใช้ผลเทียบเดิม ไม่คำนวณใหม่) */
  onRetry: () => void;
}

type StepState = 'pending' | 'active' | 'done' | 'failed';

/** สถานะของ 3 ขั้นจาก run — ฟังก์ชันล้วน
 *  ขั้น 1 "อ่านไฟล์" เสร็จเสมอ: การ์ดนี้เปิดหลังอ่านไฟล์+ตรวจหัวคอลัมน์ผ่านแล้ว (ไม่ผ่าน = popup ไฟล์ถูกดีดกลับ ไม่ใช่การ์ดนี้) */
export function masterUploadStepStates(run: MasterUploadRun): [StepState, StepState, StepState] {
  const compared = run.compared !== null;
  const failed = run.status === 'error';
  const step2: StepState = compared ? 'done' : failed && run.failedStep === 2 ? 'failed' : 'active';
  const step3: StepState = run.status === 'done' ? 'done'
    : failed && run.failedStep === 3 ? 'failed'
    : compared ? 'active' : 'pending';
  return ['done', step2, step3];
}

/** ⚠️ ต้องเท่ากับความยาว ssMnoticeOut / ssMnoticeScrimOut ใน App.css (ใช้ keyframes ร่วมกับ popup .xlsx) */
const CLOSE_MS = 200;

const STATE_TEXT: Record<StepState, string> = {
  pending: 'รอ',
  active: 'กำลังทำ',
  done: 'เสร็จแล้ว',
  failed: 'ไม่สำเร็จ',
};

export function MasterUploadProgress({ run, onClose, onRetry }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [closing, setClosing] = useState(false);
  const { status } = run;
  const canClose = status !== 'running';
  const canCloseRef = useRef(canClose);
  canCloseRef.current = canClose;

  // เปิดมา (กำลังอัปโหลด) ย้ายโฟกัสเข้ากล่องทันที — ไม่งั้นโฟกัสค้างที่ปุ่ม "อัปโหลด Product Master" ด้านหลัง
  // กด Enter/Space ระหว่างรอแล้วไปกดปุ่มนั้นซ้ำ (บทเรียนเดียวกับ MasterRejectNotice)
  // เสร็จ/พัง → โฟกัสที่ปุ่มหลัก (คีย์บอร์ดกด Enter ปิดได้เลย) · กด [ลองอีกครั้ง] แล้วกลับมา running → ปุ่มเดิมหายไป คืนโฟกัสเข้ากล่อง
  useEffect(() => {
    (canClose ? primaryRef : dialogRef).current?.focus({ preventScroll: true });
  }, [canClose]);

  const requestClose = () => {
    if (closingRef.current || !canCloseRef.current) return;   // ระหว่างอัปโหลดปิดไม่ได้ — ไม่งั้นไม่มีที่ให้เห็นว่าพังกลางทางหรือเปล่า
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => onCloseRef.current(), CLOSE_MS);
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const [s1, s2, s3] = masterUploadStepStates(run);
  const n = (v: number) => v.toLocaleString();
  const steps: { state: StepState; title: string; sub: string; hint?: string }[] = [
    {
      state: s1,
      title: 'อ่านไฟล์',
      sub: `${n(run.rows)} SKU${run.skipped > 0 ? ` · ข้าม ${n(run.skipped)}` : ''}`,
      hint: run.skipped > 0 ? `ข้าม ${n(run.skipped)} แถว (ไม่มี SKU / SKU ซ้ำ ใช้แถวแรก)` : undefined,
    },
    {
      state: s2,
      title: 'เทียบกับข้อมูลเดิม',
      sub: run.compared ? `ใหม่ ${n(run.compared.added)} · เปลี่ยน ${n(run.compared.changed)}` : '',
    },
    {
      state: s3,
      title: 'บันทึกลงระบบ',
      sub: s3 === 'pending' ? '' : `${n(run.saved)} / ${n(run.rows)} SKU`,
    },
  ];

  const message = status === 'done' ? 'อัปโหลดเสร็จสิ้น'
    : status === 'error' ? 'อัปโหลดไม่สำเร็จ'
    : <>กำลังอัปโหลด<span className="ss-mup-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></>;

  // ⚠️ ไม่มี onClick ปิดที่ overlay โดยตั้งใจ — กฎเดียวกับ modal อื่นในแอป (ลากเมาส์ออกนอกกล่องแล้ว popup หาย)
  return (
    <div className={`ss-mup-overlay ${closing ? 'is-closing' : 'is-open'}`} data-st={status}>
      <div className="ss-mup-scrim" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="ss-mup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-mup-title"
        aria-busy={status === 'running'}
      >
        <div className="ss-mup-slot" aria-hidden="true">
          <span className="ss-mup-ring" />
          <span className="ss-mup-doc"><XlsxDocIcon /></span>
          <svg className="ss-mup-chk" viewBox="0 0 24 24"><path pathLength={1} d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          <span className="ss-mup-x"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></span>
        </div>
        <p className="ss-mup-cap" id="ss-mup-title">อัปโหลด Product Master</p>
        <div className="ss-mup-msgs" role="status" aria-live="polite">
          {/* key = สถานะ → ข้อความใหม่เกิดใหม่แล้วเล่นท่าเลื่อนขึ้น (ข้อความเก่าหายทันที ไม่ซ้อน) */}
          <p key={status} className={`ss-mup-msg${status === 'error' ? ' is-bad' : ''}`}>{message}</p>
        </div>
        <ol className="ss-mup-steps" aria-label="ขั้นตอนการอัปโหลด">
          {steps.map(step => (
            <li key={step.title} className={`ss-mup-step is-${step.state}`} aria-current={step.state === 'active' ? 'step' : undefined}>
              <span className="ss-mup-st" aria-hidden="true">
                <span className="ss-mup-sp" />
                <span className="ss-mup-ok"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>
                <span className="ss-mup-no"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></span>
              </span>
              <span className="ss-mup-tt">{step.title}<span className="ss-mup-sr"> — {STATE_TEXT[step.state]}</span></span>
              {/* ข้อความรองเกิดตอนขั้นนั้นมีข้อมูลครั้งแรก (เล่นท่าเลื่อนขึ้นตอนเกิด) · ตัวนับที่ขยับต่อจากนั้นแก้ข้อความที่เดิม ไม่เล่นท่าซ้ำ */}
              {step.sub && <span className="ss-mup-sub" title={step.hint}>{step.sub}</span>}
            </li>
          ))}
        </ol>
        {status === 'error' && <p className="ss-mup-err" role="alert">{run.error}</p>}
        {/* ไฟล์เว้นว่างช่องที่ในระบบมีค่า → ถูกล้างเป็นว่างไปแล้ว (เดิมโชว์เป็นการ์ดสีแดงในหน้าต่างสรุปก่อนกดยืนยัน — ตอนนี้ไม่มีขั้นยืนยัน จึงบอกหลังเสร็จ) */}
        {status === 'done' && run.compared && run.compared.cleared > 0 && (
          <p className="ss-mup-warn">⚠️ ไฟล์เว้นว่าง — ล้างค่าเดิมในระบบเป็นว่าง {n(run.compared.cleared)} ช่อง</p>
        )}
        <div className="ss-mup-actions">
          {status === 'running' && (
            <button type="button" className="ss-tile-btn ss-tile-btn--lg" disabled>
              <span className="ss-mup-spin" aria-hidden="true" />กำลังอัปโหลด…
            </button>
          )}
          {status === 'done' && (
            <button ref={primaryRef} type="button" className="ss-tile-btn ss-tile-btn--lg ss-tile-btn--primary" onClick={requestClose}>ตกลง</button>
          )}
          {status === 'error' && (
            <>
              <button type="button" className="ss-tile-btn ss-tile-btn--lg" onClick={requestClose}>ปิด</button>
              <button ref={primaryRef} type="button" className="ss-tile-btn ss-tile-btn--lg ss-tile-btn--primary" onClick={onRetry}>ลองอีกครั้ง</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
