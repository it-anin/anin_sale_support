import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { XlsxDocIcon, prefersReducedMotion } from './MasterUploadNotice';
import { masterColumnKinds, type MasterColumnDiff } from './masterColumns';

/** popup "ไฟล์ถูกดีดกลับ" — ไฟล์ Product Master มีคอลัมน์ เพิ่ม/เปลี่ยน/ลบ จึงอัปโหลดไม่ได้ (2569-10-29)
 *  ดีไซน์แบบที่ 6 "File Reject" จาก public/master-columns-popup-designs.html + ตำแหน่งเซลล์ (เช่น J1) ตามที่ผู้ใช้สั่ง
 *  ลำดับ: ไอคอนไฟล์ตกลงช่อง → วงแดงสั่น → ตรา ✕ → ข้อความ รายการ และปุ่มค่อยตามขึ้นมา (ทุกท่าเป็น CSS ล้วน)
 *  CSS อยู่ใน App.css หัวข้อ "popup ไฟล์ถูกดีดกลับ" (คลาส ss-mreject-*) · ตัวเทียบคอลัมน์คือ masterColumns.ts */

interface Props {
  /** ชื่อไฟล์ที่ผู้ใช้เลือก */
  fileName: string;
  /** ผลเทียบหัวคอลัมน์ (ไม่ใช่ null — ตรงมาตรฐานแล้วไม่ต้องเปิด popup นี้) */
  diff: MasterColumnDiff;
  /** เรียกหลังอนิเมชั่นปิดจบ — ฝั่งแม่ unmount คอมโพเนนต์นี้ */
  onClose: () => void;
}

/** ⚠️ ต้องเท่ากับความยาว ssMnoticeOut / ssMnoticeScrimOut ใน App.css */
const CLOSE_MS = 200;
/** ปุ่ม [ตกลง] เริ่มโผล่ตอน ~1.04 วิ (App.css: ssMrejectRise เริ่ม 0.74 วิ + ลำดับที่ 5 × 0.06 วิ)
 *  ก่อนหน้านั้นกดไม่ได้ (pointer-events: none) — กันกดโดนปุ่มที่ยังมองไม่เห็นแล้ว popup หายไปก่อนได้อ่าน */
const ACTIONS_MS = 1040;

/** ลำดับการขึ้นของข้อความ/รายการ/ปุ่ม (--i) — ดีเลย์จริงคำนวณใน CSS */
const rise = (i: number) => ({ '--i': i }) as CSSProperties;

function Sign({ children }: { children: ReactNode }) {
  return (
    <span className="ss-mreject-sg" aria-hidden="true">
      <svg viewBox="0 0 24 24">{children}</svg>
    </span>
  );
}

export function MasterRejectNotice({ fileName, diff, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [closing, setClosing] = useState(false);
  // ลดการเคลื่อนไหว: ไม่มีท่า (CSS เหลือแค่เฟด) จึงไม่ต้องรอ — ปุ่มกดได้ทันที
  const [landed, setLanded] = useState(prefersReducedMotion);

  // เปิดมาแล้วย้ายโฟกัสเข้ากล่องทันที — ไม่งั้นโฟกัสค้างที่ปุ่ม "อัปโหลด Product Master" ด้านหลัง (popup .xlsx คืนโฟกัสให้ปุ่มนั้นตอนปิด)
  // กด Enter/Space ในวินาทีแรก (ก่อนปุ่ม [ตกลง] โผล่) จะไปกดปุ่มด้านหลังแล้ว popup .xlsx เด้งซ้อนขึ้นมา · alertdialog ควรมีโฟกัสอยู่ข้างในอยู่แล้ว
  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (landed) return;
    const timer = window.setTimeout(() => setLanded(true), ACTIONS_MS);
    return () => window.clearTimeout(timer);
  }, [landed]);

  // ปุ่มโผล่แล้ว → โฟกัสที่ [ตกลง] (ผู้ใช้คีย์บอร์ดกด Enter ปิดได้เลย)
  useEffect(() => {
    if (landed) primaryRef.current?.focus({ preventScroll: true });
  }, [landed]);

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => onCloseRef.current(), CLOSE_MS);
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  // Esc ปิดได้ทันทีตั้งแต่ตอนยังเล่นท่าอยู่ (ไม่ต้องรอปุ่มโผล่)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  // ⚠️ ไม่มี onClick ปิดที่ overlay โดยตั้งใจ — กฎเดียวกับ modal อื่นในแอป (ลากเมาส์ออกนอกกล่องแล้ว popup หาย)
  const overlayClass = 'ss-mreject-overlay'
    + (closing ? ' is-closing' : ' is-open')
    + (landed ? ' is-landed' : '');

  return (
    <div className={overlayClass}>
      <div className="ss-mreject-scrim" />
      <div ref={dialogRef} tabIndex={-1} className="ss-mreject" role="alertdialog" aria-modal="true" aria-labelledby="ss-mreject-title" aria-describedby="ss-mreject-details">
        <div className="ss-mreject-body">
          <div className="ss-mreject-slot" aria-hidden="true">
            <span className="ss-mreject-ring" />
            <span className="ss-mreject-doc"><XlsxDocIcon /></span>
            <span className="ss-mreject-x">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </span>
          </div>
          <p className="ss-mreject-cap ss-mreject-rise" style={rise(0)}>อัปโหลด Product Master</p>
          <h3 className="ss-mreject-title ss-mreject-rise" id="ss-mreject-title" style={rise(1)}>
            ไฟล์มี <span className="ss-mreject-kinds">{masterColumnKinds(diff)}</span> คอลัมน์
            <br />
            <span className="ss-mreject-bad">ไม่สามารถอัปโหลดได้</span>
          </h3>
          <p className="ss-mreject-file ss-mreject-rise" style={rise(2)} title={fileName}>
            <XlsxDocIcon />
            <span>{fileName}</span>
          </p>
          {/* ทุกรายการแสดงครบ ไม่ตัดด้วย … (ต่างจากในแกลเลอรี) — ถ้ายาวเกินให้เลื่อนในกรอบ
              เซลล์ (J1) บอกตำแหน่งหัวคอลัมน์ในไฟล์ · "ลบ" ไม่มีเซลล์เพราะคอลัมน์นั้นไม่อยู่ในไฟล์
              ⚠️ คั่นรายการด้วยช่องว่างจริง {' '} ไม่ใช่แค่ margin — ไม่งั้นก๊อปวาง/โปรแกรมอ่านหน้าจอจะได้ "RemarkO1Updated_ByP1" */}
          <ul className="ss-mreject-list ss-mreject-rise" id="ss-mreject-details" style={rise(3)}>
            {diff.added.length > 0 && (
              <li className="ss-mreject-item ss-mreject-item--add">
                <Sign><path d="M12 5v14M5 12h14" /></Sign>
                <span className="ss-mreject-txt">
                  <b>เพิ่ม {diff.added.length}</b>
                  {diff.added.map(a => (
                    <Fragment key={a.cell}>
                      {' '}
                      <span className="ss-mreject-tok">{a.name} <em className="ss-mreject-cell">{a.cell}</em></span>
                    </Fragment>
                  ))}
                </span>
              </li>
            )}
            {diff.changed.length > 0 && (
              <li className="ss-mreject-item ss-mreject-item--chg">
                <Sign><path d="M6 8h12m0 0-3.5-3.5M18 8l-3.5 3.5" /><path d="M18 16H6m0 0 3.5-3.5M6 16l3.5 3.5" /></Sign>
                <span className="ss-mreject-txt">
                  <b>เปลี่ยน {diff.changed.length}</b>
                  {diff.changed.map(c => (
                    <Fragment key={c.cell}>
                      {' '}
                      <span className="ss-mreject-tok">{c.from} <i>→</i> {c.to} <em className="ss-mreject-cell">{c.cell}</em></span>
                    </Fragment>
                  ))}
                </span>
              </li>
            )}
            {diff.removed.length > 0 && (
              <li className="ss-mreject-item ss-mreject-item--del">
                <Sign><path d="M5 12h14" /></Sign>
                <span className="ss-mreject-txt">
                  <b>ลบ {diff.removed.length}</b>
                  {diff.removed.map(name => (
                    <Fragment key={name}>
                      {' '}
                      <span className="ss-mreject-tok">{name}</span>
                    </Fragment>
                  ))}
                </span>
              </li>
            )}
          </ul>
          <p className="ss-mreject-safe ss-mreject-rise" style={rise(4)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 5 6v5.5c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6z" />
              <path d="m9 12 2.2 2.2L15 10.5" />
            </svg>
            ยังไม่มีข้อมูลถูกอัปโหลดเข้าระบบ
          </p>
        </div>
        <div className="ss-mreject-actions ss-mreject-rise" style={rise(5)}>
          <button ref={primaryRef} type="button" className="ss-tile-btn ss-tile-btn--lg ss-tile-btn--primary" onClick={requestClose}>ตกลง</button>
        </div>
      </div>
    </div>
  );
}
