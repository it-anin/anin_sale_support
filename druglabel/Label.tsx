import { forwardRef, type CSSProperties } from 'react';
import type { Lang, LabelShopInfo, Medicine } from './types';
import { formatBeDate } from './format';

const FIELD_LABELS: Record<Lang, { trade_name: string; generic_name: string; usage: string; indication: string; warning: string; storage: string; patient: string; pharmacist: string }> = {
  th: { trade_name: 'ชื่อการค้า',  generic_name: 'ชื่อยา',       usage: 'วิธีใช้',     indication: 'ข้อบ่งใช้',    warning: 'ข้อควรระวัง',    storage: 'การเก็บรักษา',  patient: 'ชื่อลูกค้า', pharmacist: 'เภสัชกร' },
  en: { trade_name: 'Trade Name',  generic_name: 'Generic Name', usage: 'Directions',  indication: 'Indication',   warning: 'Warning',         storage: 'Storage',        patient: 'Patient', pharmacist: 'Pharmacist' },
  zh: { trade_name: '商品名',       generic_name: '通用名',        usage: '用法用量',     indication: '适应症',        warning: '注意事项',         storage: '储存方法',        patient: '患者姓名', pharmacist: '药剂师' },
  ja: { trade_name: '商品名',       generic_name: '一般名',        usage: '用法・用量',   indication: '効能・効果',    warning: '注意事項',         storage: '保管方法',        patient: '患者名', pharmacist: '薬剤師' },
  my: { trade_name: 'ကုန်အမှတ်',   generic_name: 'အမည်တွင်',    usage: 'အသုံးပြုနည်း', indication: 'အကြောင်းပြချက်', warning: 'သတိပြုရန်',    storage: 'သိမ်းဆည်းနည်း', patient: 'လူနာအမည်', pharmacist: 'ဆေးဝါးပညာရှင်' },
  km: { trade_name: 'ឈ្មោះពាណិជ្ជ', generic_name: 'ឈ្មោះទូទៅ',  usage: 'របៀបប្រើ',   indication: 'សញ្ញាបង្ហាញ',  warning: 'ការព្រមាន',      storage: 'ការរក្សាទុក',   patient: 'ឈ្មោះអ្នកជំងឺ', pharmacist: 'ឱសថការី' },
  ko: { trade_name: '상품명',       generic_name: '일반명',        usage: '복용법',       indication: '적응증',         warning: '주의사항',         storage: '보관방법',        patient: '환자명', pharmacist: '약사' },
};

const ANIN_LOGO  = '/anin.png';
const LINE_ICON  = '/line-icon.png';
const PHONE_ICON = '/phone-icon.png';

interface Props {
  medicine: Medicine;
  /** ข้อมูลร้านของสาขาที่ล็อกอิน — รวมเภสัชกรประจำสาขา (พิมพ์เป็นบรรทัดสุดท้ายของฉลากเสมอ) */
  settings: LabelShopInfo;
  lang?: Lang;
  patientName?: string;
  date?: Date;
  preview?: boolean;
  /** ขนาดตัวอักษรเนื้อหา (pt) ที่ fitLabelBodySize คำนวณจากตัว Preview — ส่งค่าเดียวกันให้ทั้ง Preview และตัวพิมพ์
   *  เป็น CSS var บน element (`--dl-body-size`) ตัวพิมพ์จึงพาค่าไปด้วยตอน handlePrint ก๊อป innerHTML */
  bodySize?: number;
}

export const Label = forwardRef<HTMLDivElement, Props>(
  ({ medicine, settings, lang = 'th', patientName, date, preview, bodySize }, ref) => {
    const dateStr = formatBeDate(date ?? new Date());
    const lbl = FIELD_LABELS[lang];
    const style = bodySize ? ({ '--dl-body-size': `${bodySize}pt` } as CSSProperties) : undefined;
    return (
      <div ref={ref} className={`dl-label${preview ? ' dl-label-preview' : ''}`} style={style} aria-label="medicine label">
        <div className="dl-label-header">
          <div className="dl-label-shop">
            <img className="dl-label-logo-image" src={ANIN_LOGO} alt="ANIN logo" />
            <div>
              <div className="dl-label-shop-name-th">{settings.shop_name_th}</div>
              <div className="dl-label-shop-name-en">{settings.shop_name_en}</div>
            </div>
          </div>
          <div className="dl-label-contact">
            <div className="dl-label-contact-info">
              <div className="dl-label-contact-row">
                <img className="dl-label-contact-icon" src={PHONE_ICON} alt="Phone" />
                <span>{settings.phone}</span>
              </div>
              <div className="dl-label-contact-row">
                <img className="dl-label-contact-icon" src={LINE_ICON} alt="LINE" />
                <span>{settings.line_id}</span>
              </div>
            </div>
            <div className="dl-label-date">{dateStr}</div>
          </div>
        </div>

        <div className="dl-label-divider" />

        <div className="dl-label-section">
          {patientName && <div className="dl-label-patient"><strong>{lbl.patient}:</strong> {patientName}</div>}
          <div><strong>{lbl.trade_name}:</strong> {medicine.trade_name}</div>
          {medicine.generic_name && <div><strong>{lbl.generic_name}:</strong> {medicine.generic_name}</div>}
        </div>

        <div className="dl-label-divider" />

        {medicine.usage && (
          <>
            <div className="dl-label-section"><strong>{lbl.usage}:</strong> {medicine.usage}</div>
            <div className="dl-label-divider" />
          </>
        )}

        {medicine.indication && (
          <>
            <div className="dl-label-section"><strong>{lbl.indication}:</strong> {medicine.indication}</div>
            <div className="dl-label-divider" />
          </>
        )}

        {/* ท้ายฉลาก: ข้อควรระวัง/การเก็บรักษา + เภสัชกร — ดันลงล่างสุดด้วย margin-top:auto ของกล่องนี้ที่เดียว
            (ใส่ auto ทั้งกล่องนอกและ .dl-label-warn พื้นที่ว่างจะถูกแบ่งครึ่ง ข้อควรระวังลอยกลางฉลาก)
            เส้นคั่นเหนือเภสัชกรเป็น border-top ของบรรทัดเภสัชกรเอง (กระชับกว่า .dl-label-divider — ดูเหตุผลใน App.css)
            → เส้นหลังข้อควรระวังจึงมีเฉพาะเมื่อมีการเก็บรักษาตามหลัง */}
        <div className="dl-label-bottom">
          {(medicine.warning || medicine.storage) && (
            <div className="dl-label-warn">
              {medicine.warning && (
                <>
                  <div className="dl-label-section"><strong>{lbl.warning}:</strong> {medicine.warning}</div>
                  {medicine.storage && <div className="dl-label-divider" />}
                </>
              )}
              {medicine.storage && (
                <div className="dl-label-section"><strong>{lbl.storage}:</strong> {medicine.storage}</div>
              )}
            </div>
          )}
          <div className="dl-label-pharmacist"><strong>{lbl.pharmacist} :</strong> {settings.pharmacist}</div>
        </div>
      </div>
    );
  }
);

Label.displayName = 'Label';
