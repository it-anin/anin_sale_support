import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/** popup แจ้งนามสกุลไฟล์ก่อนเปิดหน้าต่างเลือกไฟล์ Product Master (2569-10-29)
 *  ดีไซน์แบบที่ 7 "File Fly" จาก public/product-master-popup-designs.html + ปุ่มกระเบื้องนูนแบบที่ 2
 *  ลำดับ: กดปุ่ม → ไอคอนไฟล์ Excel บินเป็นเส้นโค้งจากปุ่มลงช่องกลาง popup → ข้อความกับปุ่มค่อยตามขึ้นมา
 *  CSS อยู่ใน App.css หัวข้อ "ปุ่มกระเบื้องนูน" และ "popup แจ้งนามสกุลไฟล์" (คลาส ss-tile-btn / ss-mnotice-*) */

/** สี่เหลี่ยมในพิกัดหน้าจอ (viewport) */
export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  /** ตำแหน่งไอคอนบนปุ่มตอนกด = จุดเริ่มของท่าบิน · null = ข้ามท่าบิน (ไอคอนอยู่ในช่องเลย) */
  from: ViewportRect | null;
  /** กด [เลือกไฟล์]
   *  ⚠️ ต้องสั่งเปิดหน้าต่างเลือกไฟล์ (input.click()) แบบ synchronous ในฟังก์ชันนี้ — เบราว์เซอร์ยอมให้เปิดได้เฉพาะ
   *     ตอนอยู่ใน user gesture ถ้าเลื่อนไปทำหลัง await / setTimeout จะถูกบล็อกเงียบ ๆ (ไม่มี error ให้เห็น) */
  onPick: () => void;
  /** เรียกหลังอนิเมชั่นปิดจบ — ฝั่งแม่ unmount คอมโพเนนต์นี้ */
  onClose: () => void;
}

/** measure = ยังไม่เล่นอนิเมชั่น (วัดตำแหน่งช่องปลายทางตอนการ์ดยังไม่ถูกย่อ/ขยาย) → open → closing */
type Phase = 'measure' | 'open' | 'closing';

/** จุดบินของไอคอนไฟล์ — พิกัดอิงมุมซ้ายบนของ overlay (ไม่ใช่ของหน้าจอ) */
interface FlyGeometry {
  x0: number; y0: number;   // กึ่งกลางไอคอนบนปุ่ม
  x1: number; y1: number;   // กึ่งกลางช่องปลายทางใน popup
  w: number; h: number;     // ขนาดไอคอนตอนลงช่อง
  s0: number;               // สเกลตอนเริ่มบิน (ไอคอนบนปุ่มเล็กกว่าไอคอนในช่อง)
}

/** ⚠️ ต้องเท่ากับความยาว ssMnoticeOut / ssMnoticeScrimOut ใน App.css */
const CLOSE_MS = 200;
const FLY_DELAY_MS = 30;
const FLY_MS = 400;
/** ยกเส้นโค้งของท่าบินขึ้นด้านบนกี่ px (เหนือจุดที่สูงกว่าของ 2 ปลาย) */
const ARC_LIFT = 62;

/** ไอคอนไฟล์ xlsx — สีคุมจาก CSS (.ss-doc-body / .ss-doc-fold / .ss-doc-line)
 *  export ให้ MasterRejectNotice.tsx (popup ไฟล์ถูกดีดกลับ) ใช้ร่วมกัน */
export function XlsxDocIcon() {
  return (
    <svg className="ss-doc" viewBox="0 0 48 56" aria-hidden="true">
      <path className="ss-doc-body" d="M7 4a4 4 0 0 1 4-4h18l12 12v40a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4z" />
      <path className="ss-doc-fold" d="M29 0l12 12h-8a4 4 0 0 1-4-4z" />
      <g className="ss-doc-line" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="14" y="24" width="20" height="20" rx="2.5" />
        <path d="M14 31h20M14 37.5h20M24 24v20" />
      </g>
    </svg>
  );
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** เส้นทางบิน = เส้นโค้งกำลังสอง (quadratic Bézier) จากปุ่มไปช่อง โดยจุดควบคุมอยู่เหนือปลายที่สูงกว่า → โก่งขึ้นก่อนค่อยลง
 *  สุ่ม 21 จุดเป็น keyframe เส้นตรงต่อกัน (easing ทั้งท่าคุมที่ตัว animation) · ขยายขนาด + หมุนจาก -28° เข้าตรงตอนลงช่อง */
function flightFrames({ x0, y0, x1, y1, s0 }: FlyGeometry): Keyframe[] {
  const cx = (x0 + x1) / 2;
  const cy = Math.min(y0, y1) - ARC_LIFT;
  const N = 20;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    const s = s0 + (1 - s0) * Math.pow(t, 0.6);
    frames.push({ transform: `translate(${x}px, ${y}px) scale(${s}) rotate(${-28 * (1 - t)}deg)`, offset: t });
  }
  return frames;
}

export function MasterUploadNotice({ from, onPick, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const slotDocRef = useRef<HTMLSpanElement>(null);
  const flyRef = useRef<HTMLSpanElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [phase, setPhase] = useState<Phase>('measure');
  const [geo, setGeo] = useState<FlyGeometry | null>(null);
  const [landed, setLanded] = useState(false);

  // 1) วัดตำแหน่งช่องปลายทาง "ก่อนเล่นอนิเมชั่น" — popup เริ่มที่ขนาดจริง (ยังไม่มีคลาส is-open ที่ย่อ/ขยายการ์ด)
  //    ใช้ useLayoutEffect: setState ในนี้ถูก flush ก่อนเบราว์เซอร์วาดภาพ จึงไม่มีเฟรมที่เห็น popup ก่อนอนิเมชั่นเริ่ม
  //    ⚠️ ห้ามวัดหลัง is-open — การ์ดเริ่มจาก scale(.93) ค่าที่ได้จะเพี้ยนแล้วไอคอนลงช่องไม่ตรง
  useLayoutEffect(() => {
    if (phase !== 'measure') return;   // StrictMode (dev) รัน effect ซ้ำ — วัดครั้งเดียวพอ
    const overlay = overlayRef.current;
    const slot = slotDocRef.current;
    if (!prefersReducedMotion() && from && overlay && slot) {
      const base = overlay.getBoundingClientRect();
      const s = slot.getBoundingClientRect();
      if (s.width > 0 && s.height > 0) {
        setGeo({
          x0: from.left - base.left + from.width / 2,
          y0: from.top - base.top + from.height / 2,
          x1: s.left - base.left + s.width / 2,
          y1: s.top - base.top + s.height / 2,
          w: s.width,
          h: s.height,
          s0: from.height / s.height,
        });
        setPhase('open');
        return;
      }
    }
    // ไม่บิน (ผู้ใช้ตั้งค่าลดการเคลื่อนไหว / ไม่รู้ตำแหน่งปุ่ม): ไอคอนอยู่ในช่องเลย ข้อความ+ปุ่มขึ้นพร้อมกัน
    setLanded(true);
    setPhase('open');
  }, [phase, from]);

  // 2) เล่นท่าบิน — จบแล้วสลับเป็นไอคอนในช่องจริง (ตำแหน่งเดียวกัน ไม่กระตุก) แล้วค่อยโชว์ข้อความ + ปุ่ม
  useEffect(() => {
    if (!geo) return;
    const el = flyRef.current;
    if (!el) return;
    let cancelled = false;
    const anim = el.animate(flightFrames(geo), {
      duration: FLY_MS,
      delay: FLY_DELAY_MS,
      easing: 'cubic-bezier(.45, .05, .2, 1)',
      fill: 'both',
    });
    anim.finished.then(() => { if (!cancelled) setLanded(true); }).catch(() => { /* ถูก cancel (ปิดก่อน/StrictMode) */ });
    return () => { cancelled = true; anim.cancel(); };
  }, [geo]);

  // 3) ลงช่องแล้ว → โฟกัสปุ่ม [เลือกไฟล์] (ผู้ใช้คีย์บอร์ดกด Enter ต่อได้เลย)
  useEffect(() => {
    if (landed) primaryRef.current?.focus({ preventScroll: true });
  }, [landed]);

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setPhase('closing');
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

  const handlePick = () => {
    if (closingRef.current) return;   // กดรัว ๆ ไม่เปิดหน้าต่างเลือกไฟล์ซ้ำ
    onPick();                          // ⚠️ ก่อนอย่างอื่นเสมอ — ยังอยู่ใน user gesture
    requestClose();
  };

  // ⚠️ ไม่มี onClick ปิดที่ overlay โดยตั้งใจ — กฎเดียวกับ modal อื่นในแอป (ลากเมาส์ออกนอกกล่องแล้ว popup หาย)
  const overlayClass = 'ss-mnotice-overlay'
    + (phase === 'open' ? ' is-open' : '')
    + (phase === 'closing' ? ' is-closing' : '')
    + (landed ? ' is-landed' : '');

  return (
    <div ref={overlayRef} className={overlayClass}>
      <div className="ss-mnotice-scrim" />
      <div className="ss-mnotice" role="dialog" aria-modal="true" aria-labelledby="ss-mnotice-title" aria-describedby="ss-mnotice-msg">
        <div className={`ss-mnotice-slot${landed ? ' is-landed' : ''}`}>
          <span className="ss-mnotice-ring" />
          <span ref={slotDocRef} className="ss-mnotice-slot-doc"><XlsxDocIcon /></span>
        </div>
        <p className="ss-mnotice-cap" id="ss-mnotice-title">อัปโหลด Product Master</p>
        <p className="ss-mnotice-msg ss-mnotice-after" id="ss-mnotice-msg" style={{ '--i': 0 } as CSSProperties}>
          ใช้ไฟล์นามสกุล <span className="ss-mnotice-ext">.xlsx</span>
        </p>
        <div className="ss-mnotice-actions ss-mnotice-after" style={{ '--i': 1 } as CSSProperties}>
          <button type="button" className="ss-tile-btn ss-tile-btn--lg" onClick={requestClose}>ยกเลิก</button>
          <button ref={primaryRef} type="button" className="ss-tile-btn ss-tile-btn--lg ss-tile-btn--primary" onClick={handlePick}>เลือกไฟล์</button>
        </div>
      </div>
      {geo && !landed && (
        <span
          ref={flyRef}
          className="ss-mnotice-fly"
          aria-hidden="true"
          style={{
            width: geo.w,
            height: geo.h,
            margin: `${-geo.h / 2}px 0 0 ${-geo.w / 2}px`,
            transform: `translate(${geo.x0}px, ${geo.y0}px) scale(${geo.s0}) rotate(-28deg)`,
          }}
        >
          <XlsxDocIcon />
        </span>
      )}
    </div>
  );
}
