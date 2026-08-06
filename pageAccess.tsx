import { createContext, useContext, type ReactNode } from 'react';

// รหัสหน้าทั้งหมดในแอป (ใช้เป็น currentPage + key ตาราง app_page_settings)
export type PageId =
  | 'pricetag'
  | 'druglabel'
  | 'stockcheck'
  | 'customerhistory'
  | 'outbound'
  | 'salesupport';

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

// ลำดับ + ไอคอน + ป้ายชื่อ ของปุ่มนำทาง (เดิม hardcode ซ้ำทุกหน้า — ย้ายมารวมที่นี่)
export const PAGE_NAV: PageNavDef[] = [
  { id: 'pricetag',        icon: IconTag,   label: 'Price',    title: 'หน้าป้ายราคา' },
  { id: 'druglabel',       icon: IconLabel, label: 'Label',    title: 'ฉลากยา' },
  { id: 'stockcheck',      icon: IconBox,   label: 'Stock',    title: 'เช็คสต๊อค' },
  { id: 'customerhistory', icon: IconCard,  label: 'Customer', title: 'ประวัติลูกค้า' },
  { id: 'outbound',        icon: IconTruck, label: 'Outbound', title: 'เบิกสินค้าด่วน' },
  { id: 'salesupport',     icon: IconBell,  label: 'Support',  title: 'SaleSupport' },
];

export type PageVisibility = Record<PageId, boolean>;

// ค่าเริ่มต้น: เปิดทุกหน้า (fail-safe — ถ้าโหลดค่าจาก Supabase ไม่ได้ ยังใช้ได้ครบ)
export const DEFAULT_VISIBILITY: PageVisibility = {
  pricetag: true,
  druglabel: true,
  stockcheck: true,
  customerhistory: true,
  outbound: true,
  salesupport: true,
};

export const PageVisibilityContext = createContext<PageVisibility>(DEFAULT_VISIBILITY);
export const usePageVisibility = () => useContext(PageVisibilityContext);

export type NavHandlers = Record<PageId, () => void>;

// แถวปุ่มนำทาง (ใช้ร่วมทุกหน้า) — ซ่อนปุ่มของหน้าที่ถูกปิด ยกเว้นหน้าปัจจุบัน (กันปุ่ม active หาย)
export function PageNavRow({ current, handlers }: { current: PageId; handlers: NavHandlers }) {
  const visible = usePageVisibility();
  return (
    <div className="search-nav-row">
      {PAGE_NAV.filter(p => visible[p.id] || p.id === current).map(p => (
        <button
          key={p.id}
          className={`page-nav-card${p.id === current ? ' page-nav-card--active' : ''}`}
          onClick={handlers[p.id]}
          title={p.title}
        >
          <span className="page-nav-icon">{p.icon}</span>
          <span className="page-nav-label">{p.label}</span>
        </button>
      ))}
    </div>
  );
}
