import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// รหัสหน้าทั้งหมดในแอป (ใช้เป็น currentPage + key ตาราง app_page_settings)
export type PageId =
  | 'pricetag'
  | 'druglabel'
  | 'editprice'
  | 'stockcheck'
  | 'customerhistory'
  | 'outbound'
  | 'salesupport'
  | 'pendingdocs';

export interface PageNavDef {
  id: PageId;
  icon: ReactNode;
  label: string;
  title: string;
}

// ไอคอนแบบเส้น (Line Regular) — ไม่มีสีในตัว ใช้ currentColor จึงเปลี่ยนสีตามสถานะปุ่มเอง
// ขนาด/น้ำหนักเส้นคุมจาก CSS `.page-nav-icon svg` ใน App.css (stroke-width 1.75)
const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
);

const IconTag = (
  <Svg>
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z" />
    <circle cx="7" cy="7" r="1.4" />
  </Svg>
);
const IconLabel = (
  <Svg>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8" />
    <path d="M8 17h5" />
  </Svg>
);
const IconEditPrice = (
  <Svg>
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="m16 3 5 5M10 14l-1 4 4-1L22 8a2.1 2.1 0 0 0-5-5Z" />
  </Svg>
);
const IconBox = (
  <Svg>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </Svg>
);
const IconCard = (
  <Svg>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <circle cx="8.5" cy="10.2" r="2" />
    <path d="M14 9.5h4" />
    <path d="M14 13h4" />
    <path d="M5.2 16.6c.7-1.4 1.9-2.1 3.3-2.1s2.6.7 3.3 2.1" />
  </Svg>
);
const IconTruck = (
  <Svg>
    <path d="M1 5h13v11H1z" />
    <path d="M14 9h4l3 3.2V16h-7z" />
    <circle cx="6" cy="18.4" r="2" />
    <circle cx="17.5" cy="18.4" r="2" />
  </Svg>
);
const IconBell = (
  <Svg>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </Svg>
);
// เอกสาร + นาฬิกา = เอกสารที่ค้างอยู่
const IconDocClock = (
  <Svg>
    <path d="M12 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8l5 5v3" />
    <path d="M14 3v5h5" />
    <circle cx="17" cy="17" r="4" />
    <path d="M17 15.2V17l1.3 1" />
  </Svg>
);

// ขอคืนเงิน: ลูกศรย้อนกลับรอบเหรียญ · ขนส่ง: จุดเริ่ม → ปักหมุดปลายทาง
// (ไม่ใช้รูปรถบรรทุกเพราะปุ่ม Outbound ใช้อยู่แล้ว กันสับสน)
const IconRefund = (
  <Svg>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);
const IconRoute = (
  <Svg>
    <circle cx="6" cy="18" r="2.2" />
    <path d="M8.2 18H15a3 3 0 0 0 3-3" />
    <path d="M18 2.8a4 4 0 0 0-4 4c0 3.1 4 7.2 4 7.2s4-4.1 4-7.2a4 4 0 0 0-4-4Z" />
    <circle cx="18" cy="6.8" r="1.2" />
  </Svg>
);
// ลูกศร ↗ = สัญญาณว่าปุ่มนี้เปิดเว็บภายนอก
const IconExternal = (
  <Svg>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </Svg>
);

// ลำดับ + ไอคอน + ป้ายชื่อ ของปุ่มนำทาง (เดิม hardcode ซ้ำทุกหน้า — ย้ายมารวมที่นี่)
export const PAGE_NAV: PageNavDef[] = [
  { id: 'pricetag',        icon: IconTag,   label: 'Price',    title: 'หน้าป้ายราคา' },
  { id: 'druglabel',       icon: IconLabel, label: 'Label',    title: 'ฉลากยา' },
  { id: 'stockcheck',      icon: IconBox,   label: 'Stock',    title: 'เช็คสต๊อค' },
  { id: 'customerhistory', icon: IconCard,  label: 'Customer', title: 'ประวัติลูกค้า' },
  { id: 'outbound',        icon: IconTruck, label: 'Outbound', title: 'เบิกสินค้าด่วน' },
  { id: 'salesupport',     icon: IconBell,  label: 'Support',  title: 'SaleSupport' },
  { id: 'pendingdocs',     icon: IconDocClock, label: 'Pending', title: 'เอกสารที่ยังไม่กดส่ง' },
];

const EDIT_PRICE_NAV: PageNavDef = {
  id: 'editprice', icon: IconEditPrice, label: 'Edit Price', title: 'เปรียบเทียบและปรับราคา',
};

// ทุกหน้าใช้ context เดียวกัน เพื่อแทนช่อง Label เฉพาะรหัสจัดซื้อ
export const PurchasingNavigationContext = createContext<(() => void) | null>(null);

export type PageVisibility = Record<PageId, boolean>;

// ค่าเริ่มต้น: เปิดหน้าเดิมทั้งหมด ส่วน Edit Price เปิดเฉพาะ PURCHASING ใน App
export const DEFAULT_VISIBILITY: PageVisibility = {
  pricetag: true,
  druglabel: true,
  editprice: false,
  stockcheck: true,
  customerhistory: true,
  outbound: true,
  salesupport: true,
  pendingdocs: true,
};

export const PageVisibilityContext = createContext<PageVisibility>(DEFAULT_VISIBILITY);
export const usePageVisibility = () => useContext(PageVisibilityContext);

export type PageNotifications = Partial<Record<PageId, boolean | number>>;
export const PageNotificationContext = createContext<PageNotifications>({});
export const usePageNotifications = () => useContext(PageNotificationContext);

export type NavHandlers = Record<Exclude<PageId, 'editprice'>, () => void>;

// ลิงก์ไปเว็บฟอร์มภายนอก — เปิดแท็บใหม่ ทุกโปรไฟล์เห็นเหมือนกัน (ไม่ผูกกับสิทธิ์หน้า/app_page_settings)
// เพิ่ม/แก้ลิงก์ที่นี่ที่เดียว ปุ่มบน Hero ทุกหน้าเปลี่ยนตาม
export interface ExternalLinkDef {
  id: string;
  icon: ReactNode;
  label: string;
  href: string;
}

export const EXTERNAL_LINKS: ExternalLinkDef[] = [
  { id: 'refund', icon: IconRefund, label: 'แบบฟอร์มขอคืนเงิน', href: 'https://it-anin.github.io/Refund_Request_Form/' },
  { id: 'transport', icon: IconRoute, label: 'แบบฟอร์มขออนุมัติขนส่ง', href: 'https://it-anin.github.io/transport_request_form/' },
];

// ปุ่มลิงก์แบบ "Expanding Rail" (แบบที่ 9 จาก public/hero-link-btn-designs.html, 2569-11-23)
// ปกติเป็นวงกลมไอคอน 40px ชี้เมาส์/โฟกัสด้วยคีย์บอร์ดแล้วขยายโชว์ชื่อ — สไตล์อยู่ App.css `.hero-link*`
// ใช้ <a target="_blank"> ไม่ใช่ปุ่ม + window.open เพื่อให้คลิกขวา/คัดลอกลิงก์ได้
// ⚠️ ต้องมี rel="noopener noreferrer" เสมอ — กันหน้าที่เปิดใหม่เข้าถึง window.opener ของแอป
export function HeroLinkRail() {
  return (
    <nav className="hero-links" aria-label="ลิงก์แบบฟอร์ม">
      {EXTERNAL_LINKS.map(link => (
        <a
          key={link.id}
          className="hero-link"
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          title={`${link.label} — เปิดในแท็บใหม่`}
          aria-label={`${link.label} (เปิดในแท็บใหม่)`}
        >
          <span className="hero-link-icon">{link.icon}</span>
          <span className="hero-link-more">
            <span className="hero-link-clip">
              <span className="hero-link-label">{link.label}<span className="hero-link-ext">{IconExternal}</span></span>
            </span>
          </span>
        </a>
      ))}
    </nav>
  );
}

// แถวปุ่มนำทาง (ใช้ร่วมทุกหน้า) — แสดงครบทุกเมนู หน้าที่ถูกปิดใช้ปุ่ม disabled แบบจาง
export function PageNavRow({ current, handlers }: { current: PageId; handlers: NavHandlers }) {
  const visible = usePageVisibility();
  const notifications = usePageNotifications();
  const onGoEditPrice = useContext(PurchasingNavigationContext);
  const pages = PAGE_NAV.map(page => page.id === 'druglabel' && onGoEditPrice ? EDIT_PRICE_NAV : page);

  // ปุ่มลิงก์ต้องลอยที่มุมซ้ายบนของ Hero "เต็มจอ" (`.hero-header`) แต่แถวนี้ถูกซ้อนอยู่ใน `.hero-content`
  // ซึ่งกว้างแค่ 900px และเป็น position: relative → วาง absolute ตรงนี้ปุ่มจะไปอยู่มุมกล่อง 900px กลางจอ
  // จึงใช้ portal ส่งปุ่มไปวางเป็นลูกของ `.hero-header` โดยตรง แล้วทุกหน้าที่ใช้ PageNavRow ได้ปุ่มเอง
  // callback ref (ไม่ใช่ useLayoutEffect): รันตอน commit ก่อนเบราว์เซอร์วาดภาพ จึงไม่กระพริบ และไม่เตือนตอน SSR/เทส
  const [heroEl, setHeroEl] = useState<HTMLElement | null>(null);
  const rowRef = useCallback((node: HTMLDivElement | null) => {
    setHeroEl(node?.closest<HTMLElement>('.hero-header') ?? null);
  }, []);

  return (
    <>
    {heroEl && createPortal(<HeroLinkRail />, heroEl)}
    <div className="search-nav-row" ref={rowRef}>
      {pages.map(p => (
        <button
          key={p.id}
          type="button"
          className={`page-nav-card${p.id === current ? ' page-nav-card--active' : ''}${!visible[p.id] ? ' page-nav-card--disabled' : ''}`}
          disabled={!visible[p.id]}
          onClick={p.id === 'editprice' ? onGoEditPrice ?? undefined : handlers[p.id]}
          title={visible[p.id] ? p.title : `${p.title} · ยังไม่เปิดใช้งาน`}
          aria-current={p.id === current ? 'page' : undefined}
        >
          {visible[p.id] && !!notifications[p.id] && p.id !== current && (
            <span className="page-nav-notification-dot" aria-label="มีข้อมูลอัปเดตใหม่" />
          )}
          <span className="page-nav-icon">{p.icon}</span>
          <span className="page-nav-label">{p.label}</span>
        </button>
      ))}
    </div>
    </>
  );
}
