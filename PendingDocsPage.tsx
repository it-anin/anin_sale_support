import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { supabase } from './supabase';
import { AnimatedLogoText } from './AnimatedLogo';
import { PageNavRow } from './pageAccess';
import { SearchIcon } from './SearchIcon';
import { STORE_BRANCH_CODES, branchCodeLabel } from './auth';

// หน้า "ตรวจสอบเอกสารค้าง" — ใบโอนสินค้าออกที่สาขายังไม่กด "ส่ง" ใน ProMaxx
// ข้อมูลมาจาก pending-docs-agent.mjs (เครื่องในร้าน อ่าน MSSQL แบบ SELECT อย่างเดียว) ผ่าน Supabase
// เว็บไม่ได้ต่อ MSSQL ตรง — ตอนเปิดหน้า / กด 🔄 / กลับมาที่แท็บ "ขอ" ข้อมูลสดผ่าน RPC แล้วรอ Agent ตอบ (~2-3 วิ)
// Agent ถาม ProMaxx เฉพาะตอนมีคำขอ (ผู้ใช้สั่ง 2569-10-27 — บางวันไม่มีการโอนเลย ไม่เข้าหน้านี้ก็ไม่ต้องโหลด)
// ส่งชุดใหม่มา (realtime) เฉพาะตอนข้อมูลเปลี่ยน · เปิดค้างไว้เฉยๆ ไม่มีใครไปถาม ProMaxx

interface TransferItem {
  line_no: number | null;
  code: string;
  name: string;
  qty: number | null;
  serial?: string;
}

interface PendingTransfer {
  sys_tran_no: number | string;
  doc_no: string;
  doc_date: string | null;
  from_branch: string | null;
  to_branch: string | null;
  item_count: number;
  items: TransferItem[];
}

interface SyncStatus {
  refresh_requested_at: string | null;
  /** Agent ส่งชุดใบโอนใหม่ล่าสุด = ข้อมูลใน ProMaxx เปลี่ยน → ค่านี้ขยับเมื่อไรโหลดตารางใหม่ */
  last_success_at: string | null;
  /** Agent ตรวจ ProMaxx สำเร็จล่าสุด เปลี่ยนหรือไม่ก็ตาม — undefined ถ้ายังไม่ได้รัน pending-docs-setup.sql รอบใหม่ */
  last_checked_at?: string | null;
  last_error: string | null;
  last_error_at: string | null;
  row_count: number;
}

/** ค้างกี่วันถึงขึ้นสี — ใบโอนควรกดส่งภายในวันที่ทำ */
const WARN_DAYS = 1;
const ALERT_DAYS = 3;
/**
 * เปิดค้างไว้: อ่านแถวสถานะ 1 แถวใน Supabase ทุก 1 นาที (เผื่อ realtime หลุด) — ไม่ได้ขอให้ Agent ไปถาม ProMaxx
 * คนอื่นเปิดหน้าแล้วข้อมูลเปลี่ยน หน้านี้ก็ได้ชุดใหม่ตามไปด้วย
 */
const STATUS_POLL_MS = 60_000;
/** ระหว่างรอคำตอบของคำขอที่หน้านี้สั่ง อ่านสถานะถี่ขึ้น — realtime ของเบราว์เซอร์ใช้ไม่ได้ก็ยังเห็นผลทันที */
const WAITING_POLL_MS = 3_000;
/** ขอแล้วเครื่องในร้านไม่ตอบนานเกินนี้ = บอกผู้ใช้ว่าข้อมูลที่เห็นอาจเก่า (นับด้วยนาฬิกาเครื่องนี้เอง) */
const AGENT_TIMEOUT_MS = 15_000;
/** focus + visibilitychange ยิงพร้อมกันตอนสลับแท็บ — ไม่ต้องยิง RPC ทุกครั้ง (ปุ่ม 🔄 ข้ามข้อนี้ ฝั่ง Supabase ยังกันถี่ 10 วิ) */
const REQUEST_MIN_GAP_MS = 10_000;
const ROW_LIMIT = 1000;
const ALL_TAB = 'ทั้งหมด';
// "คลังสินค้า" = คลัง Warehouse ของสาขาแยกชากค้อ · SRC = คลัง Front Store สาขาเดียวกัน
// Agent แยกจากคลังต้นทางของใบ (WAREHOUSE_MAP ใน pending-docs-agent.mjs) — ชื่อแท็บต้องตรงกับค่าใน map เป๊ะ
const TAB_ORDER: readonly string[] = ['คลังสินค้า', ...STORE_BRANCH_CODES];

/** เวลาจาก Supabase → มิลลิวินาที (realtime อาจส่งรูปแบบ "YYYY-MM-DD HH:MM:SS.ffffff+00" มา ไม่ใช่ ISO เป๊ะ) */
function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00').replace(/(\.\d{3})\d+/, '$1');
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

function bangkokToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
}

function daysPending(docDate: string | null, today: string): number | null {
  if (!docDate) return null;
  const diff = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${docDate}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : null;
}

function formatDocDate(docDate: string | null): string {
  return docDate
    ? new Date(`${docDate}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })
    : '-';
}

function formatSyncTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Bangkok' });
}

function formatQty(qty: number | null): string {
  return qty === null ? '-' : qty.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function branchText(code: string | null): string {
  return branchCodeLabel(code) || '-';
}

function DaysBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="pd-days">-</span>;
  const tone = days >= ALERT_DAYS ? ' pd-days--alert' : days >= WARN_DAYS ? ' pd-days--warn' : '';
  return <span className={`pd-days${tone}`}>{days === 0 ? 'วันนี้' : `${days} วัน`}</span>;
}

interface Props {
  onGoPriceTag: () => void;
  onGoDrugLabel: () => void;
  onGoStockCheck: () => void;
  onGoCustomerHistory: () => void;
  onGoOutbound: () => void;
  onGoSaleSupport: () => void;
  onGoPendingDocs: () => void;
  /** Profile.branch ของคนที่ล็อกอิน */
  userBranch?: string;
  /** คลังสินค้า / จัดซื้อ — เห็นใบค้างส่งของทุกสาขา */
  canSeeAll: boolean;
}

export function PendingDocsPage({
  onGoPriceTag, onGoDrugLabel, onGoStockCheck, onGoCustomerHistory, onGoOutbound, onGoSaleSupport, onGoPendingDocs,
  userBranch, canSeeAll,
}: Props) {
  const isStoreBranch = (STORE_BRANCH_CODES as readonly string[]).includes(userBranch ?? '');
  // Sale Admin ฯลฯ — ไม่ใช่สาขาหน้าร้านและไม่ใช่คลัง/จัดซื้อ จึงไม่มีใบโอนของตัวเอง (ผู้ใช้สั่งให้เข้าไม่ได้ 2569-10-27)
  // ⚠️ ห้ามปล่อยผ่านด้วย fallback เป็นสาขาอื่น — จะเห็นใบของสาขาที่ไม่ใช่ของตัวเอง
  const notSupported = !canSeeAll && !isStoreBranch;
  const branchFilter = canSeeAll ? null : (userBranch ?? null);

  const [rows, setRows] = useState<PendingTransfer[]>([]);
  const [rowsLoaded, setRowsLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [agentSilent, setAgentSilent] = useState(false);
  const [activeTab, setActiveTab] = useState(ALL_TAB);
  const [search, setSearch] = useState('');
  const [openDoc, setOpenDoc] = useState<PendingTransfer | null>(null);
  /** เวลา (ของ DB) ของคำขอที่คนบนหน้านี้สั่งเอง — ป้ายหมุนจนกว่า Agent ตอบคำขอนี้ */
  const [userRequestMs, setUserRequestMs] = useState<number | null>(null);
  const lastSuccessMsRef = useRef<number | null | undefined>(undefined);
  const statusVersionRef = useRef(-Infinity);
  const lastRequestRef = useRef(0);
  const fetchSeqRef = useRef(0);

  const fetchRows = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    let query = supabase
      .from('pending_transfers')
      .select('sys_tran_no, doc_no, doc_date, from_branch, to_branch, item_count, items')
      .order('doc_date', { ascending: true, nullsFirst: false })
      .order('doc_no', { ascending: true })
      .limit(ROW_LIMIT);
    if (branchFilter) query = query.eq('from_branch', branchFilter);
    const { data, error } = await query;
    if (seq !== fetchSeqRef.current) return; // มีรอบที่ใหม่กว่าแล้ว ทิ้งผลเก่า กันตารางกระโดดกลับ
    setRowsLoaded(true);
    if (error) {
      const missingSetup = error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message);
      setLoadError(missingSetup
        ? 'ยังไม่ได้รัน pending-docs-setup.sql ใน Supabase'
        : `โหลดข้อมูลไม่สำเร็จ: ${error.message}`);
      return;
    }
    setRows((data ?? []).map(row => ({ ...row, items: Array.isArray(row.items) ? row.items : [] })) as PendingTransfer[]);
    setLoadError('');
  }, [branchFilter]);

  // สถานะเปลี่ยน (realtime / โหลดซ้ำ) → ถ้า Agent ส่งชุดใบโอนใหม่ ให้โหลดตารางใหม่
  const applyStatus = useCallback((next: SyncStatus) => {
    // เวลาทุกช่องเดินหน้าอย่างเดียว (now() ของ DB) → ค่าสูงสุด = "รุ่น" ของสถานะ
    // ผลที่ขอไปก่อนแต่มาถึงทีหลัง (request ซ้อนกัน) จะไม่ย้อนสถานะบนหน้าจอ
    const version = Math.max(
      toMs(next.refresh_requested_at) ?? -Infinity,
      toMs(next.last_success_at) ?? -Infinity,
      toMs(next.last_checked_at) ?? -Infinity,
      toMs(next.last_error_at) ?? -Infinity,
    );
    if (version < statusVersionRef.current) return;
    statusVersionRef.current = version;
    setStatus(next);
    // last_success_at ขยับเฉพาะตอน Agent ส่งชุดใหม่ (ข้อมูลใน ProMaxx เปลี่ยน) — ตรวจแล้วเหมือนเดิมไม่โหลดตารางซ้ำ
    const successMs = toMs(next.last_success_at);
    if (lastSuccessMsRef.current !== undefined && successMs !== lastSuccessMsRef.current) void fetchRows();
    lastSuccessMsRef.current = successMs;
  }, [fetchRows]);

  const fetchStatus = useCallback(async (): Promise<SyncStatus | null> => {
    // '*' ไม่ใช่รายชื่อคอลัมน์โดยตั้งใจ — เว็บ deploy ทันทีที่ push แต่ last_checked_at มีหลังผู้ใช้รัน
    // pending-docs-setup.sql รอบใหม่ · ระบุคอลัมน์ที่ยังไม่มี = PostgREST ปฏิเสธทั้งคำขอ ป้ายค้าง "Loading..."
    const { data, error } = await supabase
      .from('pending_docs_sync')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return null;
    applyStatus(data as SyncStatus);
    return data as SyncStatus;
  }, [applyStatus]);

  // ขอให้ Agent ไปถาม ProMaxx — ทางเดียวที่ทำให้ MSSQL ถูกถาม (ไม่มีใครเปิดหน้านี้ = ไม่ถามเลย)
  //   คนสั่งเอง (เปิดหน้า / 🔄) → ถามทันที (Supabase กันถี่ 10 วิ)
  //   กลับมาที่แท็บ (auto) → Supabase ปล่อยผ่านเฉพาะตอนข้อมูลเก่ากว่า 2 นาที ไม่ผ่านก็เงียบไป
  // ป้ายหมุนรอผลเฉพาะคำขอที่หน้านี้ทำให้เกิดจริง
  const requestRefresh = useCallback(async (auto: boolean) => {
    if (Date.now() - lastRequestRef.current < REQUEST_MIN_GAP_MS) return;
    lastRequestRef.current = Date.now();
    // ⚠️ ต้อง await — query builder ของ supabase-js ไม่ส่ง request จนกว่าจะถูกเรียก .then() (CLAUDE.md)
    const { data, error } = await supabase.rpc('request_pending_docs_refresh', { p_auto: auto });
    if (error) console.error('[เอกสารค้าง] ขอข้อมูลสดไม่สำเร็จ', error);
    const row = await fetchStatus();
    // null = Supabase ไม่ตั้งคำขอใหม่ · คนสั่งเอง → มีคำขอภายใน 10 วิอยู่แล้ว รอผลของคำขอนั้นแทน (ตอบไปแล้วก็ไม่หมุน)
    const created = toMs(typeof data === 'string' ? data : null);
    const target = created ?? (auto ? null : toMs(row?.refresh_requested_at));
    if (target !== null) setUserRequestMs(prev => (prev === null || target > prev ? target : prev));
  }, [fetchStatus]);

  useEffect(() => {
    if (notSupported) return;
    lastSuccessMsRef.current = undefined;
    statusVersionRef.current = -Infinity;
    // อ่านสถานะก่อนแล้วค่อยอ่านตาราง — ตารางจะใหม่เท่ากับหรือกว่าเวลาที่ป้ายบอกเสมอ
    // รอบที่ข้อมูลเปลี่ยนหลังจากนี้มาทาง realtime/applyStatus แล้วโหลดตารางใหม่เอง
    void fetchStatus().then(() => fetchRows());
    void requestRefresh(false);

    // publish แค่ตาราง status 1 แถว (ไม่ใช่ตารางใบโอน) — replace ทีละหลายร้อยแถวจะเป็น realtime หลายร้อยข้อความ
    const channel = supabase
      .channel(`pending-docs-sync-${branchFilter ?? 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_docs_sync' }, payload => {
        const next = payload.new as Partial<SyncStatus> | undefined;
        if (next && 'last_success_at' in next) applyStatus(next as SyncStatus);
        else void fetchStatus();
      })
      .subscribe();

    // กลับมาที่แท็บ = เหมือนเข้าหน้านี้ใหม่ → ขอข้อมูลสดถ้าข้อมูลเก่ากว่า 2 นาที (สลับไปกด "ส่ง" ใน ProMaxx แล้วกลับมาเห็นผลเอง)
    const refreshWhenBack = () => {
      if (document.visibilityState === 'visible') void requestRefresh(true);
    };
    window.addEventListener('focus', refreshWhenBack);
    document.addEventListener('visibilitychange', refreshWhenBack);
    // 🚨 เปิดค้างไว้เฉยๆ ห้ามขอให้ Agent ถาม ProMaxx ตามรอบ (ผู้ใช้สั่ง) — ตรงนี้แค่อ่านแถวสถานะใน Supabase
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchStatus();
    }, STATUS_POLL_MS);

    return () => {
      void supabase.removeChannel(channel);
      window.removeEventListener('focus', refreshWhenBack);
      document.removeEventListener('visibilitychange', refreshWhenBack);
      window.clearInterval(timer);
    };
  }, [notSupported, branchFilter, fetchRows, fetchStatus, requestRefresh, applyStatus]);

  const requestedMs = toMs(status?.refresh_requested_at);
  const successMs = toMs(status?.last_success_at);
  const checkedMs = toMs(status?.last_checked_at);
  const errorMs = toMs(status?.last_error_at);
  // ข้อมูลถูกต้อง ณ ครั้งล่าสุดที่ Agent อ่าน MSSQL สำเร็จ — ส่งชุดใหม่ (success) หรือตรวจแล้วเหมือนเดิม (checked) ก็นับ
  const dataMs = Math.max(successMs ?? -Infinity, checkedMs ?? -Infinity);
  const answeredMs = Math.max(dataMs, errorMs ?? -Infinity);
  // คำขอล่าสุด (ของใครก็ได้) ใหม่กว่าผลล่าสุด = Agent ยังไม่ตอบ — เทียบเวลาของ DB กับ DB จึงไม่โดนนาฬิกาเครื่องเพี้ยน
  const waiting = requestedMs !== null && requestedMs > answeredMs;
  // ป้ายหมุนเฉพาะตอนรอคำขอที่หน้านี้ทำให้เกิด — คนอื่นเปิดหน้า Pending ไม่ทำให้ป้ายของเรากระพริบ
  const userWaiting = userRequestMs !== null && userRequestMs > answeredMs;
  const showError = !userWaiting && Boolean(status?.last_error) && errorMs !== null && errorMs > dataMs;

  // นับ 15 วิตั้งแต่เริ่มรอ (คำขอของใครก็ได้) — คำขอใหม่ระหว่างที่ยังรออยู่ไม่เริ่มนับใหม่
  // ไม่งั้นตอนเครื่องในร้านดับ ป้ายจะสลับ "กำลังดึง…" ↔ "ไม่ตอบ" ทุกครั้งที่มีคำขอเหมือนกำลังทำงานอยู่
  useEffect(() => {
    if (!waiting) {
      setAgentSilent(false);
      return;
    }
    const t = window.setTimeout(() => setAgentSilent(true), AGENT_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [waiting]);

  // รอคำตอบของคำขอที่หน้านี้สั่ง → อ่านสถานะทุก 3 วิ (ไม่เกิน 15 วิ) ไม่ต้องพึ่ง realtime อย่างเดียว
  // เน็ตสาขาบล็อก websocket ก็ยังเห็นผลทันที แทนที่จะขึ้น "เครื่องในร้านไม่ตอบ" ทั้งที่ Agent ตอบแล้ว
  useEffect(() => {
    if (!userWaiting || agentSilent) return;
    const t = window.setInterval(() => void fetchStatus(), WAITING_POLL_MS);
    return () => window.clearInterval(t);
  }, [userWaiting, agentSilent, fetchStatus]);

  useEffect(() => {
    if (!openDoc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenDoc(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDoc]);

  // แท็บต้นทาง (เฉพาะคลังสินค้า/จัดซื้อ) — โชว์สาขาหลักครบทุกแท็บแม้เป็น 0 + สาขาอื่นที่โผล่ในข้อมูล
  const tabs = useMemo(() => {
    if (!canSeeAll) return [];
    const counts = new Map<string, number>(TAB_ORDER.map(b => [b, 0]));
    for (const row of rows) {
      const key = row.from_branch || '-';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const rank = (b: string) => (TAB_ORDER.includes(b) ? TAB_ORDER.indexOf(b) : TAB_ORDER.length);
    const keys = [...counts.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'th'));
    return [{ key: ALL_TAB, count: rows.length }, ...keys.map(key => ({ key, count: counts.get(key) ?? 0 }))];
  }, [rows, canSeeAll]);
  const effectiveTab = tabs.some(t => t.key === activeTab) ? activeTab : ALL_TAB;

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      if (canSeeAll && effectiveTab !== ALL_TAB && (row.from_branch || '-') !== effectiveTab) return false;
      if (!q) return true;
      return row.doc_no.toLowerCase().includes(q)
        || row.items.some(item => item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q));
    });
  }, [rows, search, canSeeAll, effectiveTab]);

  const today = bangkokToday();
  const lastDataText = Number.isFinite(dataMs) ? formatSyncTime(dataMs) : null;
  const shownAt = lastDataText ? ` — แสดงข้อมูล ณ ${lastDataText}` : '';
  const changedTitle = successMs !== null ? `รายการเอกสารเปลี่ยนครั้งล่าสุด ${formatSyncTime(successMs)}` : undefined;

  let syncBadge: ReactNode;
  if (!status) {
    syncBadge = <span className="updated-badge updated-badge--loading">Loading...</span>;
  } else if (waiting && agentSilent) {
    syncBadge = <span className="updated-badge pd-sync-badge--warn">⚠️ เครื่องในร้านไม่ตอบ{shownAt}</span>;
  } else if (userWaiting) {
    syncBadge = (
      <span className="updated-badge pd-sync-badge--busy">
        <span className="pd-spin" aria-hidden="true">🔄</span> กำลังดึงข้อมูลล่าสุด…
      </span>
    );
  } else if (showError) {
    syncBadge = <span className="updated-badge pd-sync-badge--error">❌ {status.last_error}{shownAt}</span>;
  } else if (lastDataText) {
    syncBadge = <span className="updated-badge" title={changedTitle}>ข้อมูล ณ {lastDataText}</span>;
  } else {
    syncBadge = <span className="updated-badge pd-sync-badge--warn">ยังไม่มีข้อมูลจากเครื่องในร้าน</span>;
  }

  const heroHeader = (
    <div className="hero-header">
      <div className="hero-content">
        <h1 className="logo-premium"><AnimatedLogoText text="PENDING DOCS" /></h1>
        <div className="tagline-row">
          {!notSupported && (
            <>
              {syncBadge}
              <button
                type="button"
                className="updated-badge pd-refresh-btn"
                onClick={() => {
                  lastRequestRef.current = 0; // คนกดเองส่งเสมอ (ฝั่ง Supabase ยังกันถี่ 10 วิ)
                  void requestRefresh(false);
                }}
                disabled={userWaiting && !agentSilent}
                title="ขอข้อมูลล่าสุดจาก ProMaxx"
              >
                🔄 ดึงข้อมูลล่าสุด
              </button>
            </>
          )}
        </div>
        <PageNavRow current="pendingdocs" handlers={{ pricetag: onGoPriceTag, druglabel: onGoDrugLabel, stockcheck: onGoStockCheck, customerhistory: onGoCustomerHistory, outbound: onGoOutbound, salesupport: onGoSaleSupport, pendingdocs: onGoPendingDocs }} />
      </div>
    </div>
  );

  // ต้องอยู่หลัง hooks ทั้งหมด (early-return ก่อน hooks ผิดกฎ React)
  if (notSupported) {
    return (
      <div className="app-container">
        {heroHeader}
        <div className="container">
          <div className="product-table-wrap stock-table-wrap">
            <div className="outbound-empty-note">
              <p><strong>หน้านี้ใช้ได้เฉพาะรหัสสาขา (SRC / KKL / SSS) และคลังสินค้า/จัดซื้อ</strong></p>
              <p>โปรไฟล์ที่เข้าสู่ระบบอยู่ไม่ได้สังกัดสาขาหน้าร้าน จึงไม่มีเอกสารของตัวเอง</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const owner = canSeeAll ? '' : ` ของ ${branchText(userBranch ?? null)}`;
  const headerText = !rowsLoaded
    ? 'กำลังโหลด…'
    : `เอกสารที่ยังไม่กด "ส่ง"${owner} — ${visibleRows.length.toLocaleString()} ใบ${rows.length === ROW_LIMIT ? ` (แสดงสูงสุด ${ROW_LIMIT.toLocaleString()} ใบ)` : ''}`;
  const hasSerial = Boolean(openDoc?.items.some(item => item.serial));
  const openDocDays = openDoc ? daysPending(openDoc.doc_date, today) : null;

  return (
    <div className="app-container">
      {heroHeader}

      <div className="container">
        <div className="table-search-row table-search-row--match-table">
          <div className="search-premium">
            <input
              type="text"
              className="search-input-premium"
              placeholder="ค้นหาเลขที่เอกสาร รหัส หรือชื่อสินค้า..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button className="search-btn-premium" type="button" aria-label="ค้นหา">
              <SearchIcon />
            </button>
          </div>
        </div>

        {canSeeAll && rowsLoaded && (
          <div className="stock-tabs">
            {tabs.map(tab => (
              <button
                key={tab.key}
                type="button"
                className={`stock-tab${effectiveTab === tab.key ? ' stock-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.key === ALL_TAB ? tab.key : branchText(tab.key)}
                <span className="stock-tab-count">{tab.count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="product-table-wrap stock-table-wrap">
          <div className="selected-table-header">
            <span>{headerText}</span>
          </div>
          {loadError && <div className="pd-load-error">{loadError}</div>}
          {/* ⚠️ .stock-table เป็น table-layout: fixed — ความกว้างคอลัมน์อยู่ที่ .pd-col-* ใน App.css ผลรวมต้อง 100% */}
          <table className="product-table stock-table pd-table">
            <thead>
              <tr>
                <th className="pd-col-doc">เลขที่เอกสาร</th>
                <th className="pd-col-date">วันที่</th>
                <th className="pd-col-route">ต้นทาง → ปลายทาง</th>
                <th className="pd-col-items">รายการ</th>
                <th className="pd-col-days">ค้าง</th>
                <th className="pd-col-view" aria-label="ดูสินค้า" />
              </tr>
            </thead>
            {!rowsLoaded ? (
              <tbody className="ch-skeleton">
                {Array.from({ length: 5 }, (_, i) => (
                  <tr key={i}>
                    <td className="pd-col-doc"><span /></td>
                    <td className="pd-col-date"><span /></td>
                    <td className="pd-col-route"><span /></td>
                    <td className="pd-col-items"><span /></td>
                    <td className="pd-col-days"><span /></td>
                    <td className="pd-col-view"><span /></td>
                  </tr>
                ))}
              </tbody>
            ) : (
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="pd-empty">
                      {rows.length === 0 && !loadError
                        ? 'ไม่มีเอกสารค้างส่ง 🎉'
                        : 'ไม่พบเอกสารที่ตรงกับคำค้นหา'}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map(doc => (
                    <tr key={String(doc.sys_tran_no)} className="pd-row" onClick={() => setOpenDoc(doc)}>
                      <td className="pd-col-doc" title={doc.doc_no}>{doc.doc_no}</td>
                      <td className="pd-col-date">{formatDocDate(doc.doc_date)}</td>
                      <td className="pd-col-route">
                        {branchText(doc.from_branch)} <span className="pd-arrow">→</span> {branchText(doc.to_branch)}
                      </td>
                      <td className="pd-col-items">{doc.item_count}</td>
                      <td className="pd-col-days"><DaysBadge days={daysPending(doc.doc_date, today)} /></td>
                      <td className="pd-col-view">
                        <button
                          type="button"
                          className="pd-view-btn"
                          onClick={e => {
                            e.stopPropagation();
                            setOpenDoc(doc);
                          }}
                        >
                          ดูสินค้า
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            )}
          </table>
        </div>
      </div>

      {/* ปิดได้ทาง ✕ / Esc เท่านั้น ไม่ปิดตอนคลิกพื้นหลัง — กันลากเลือกข้อความแล้วปล่อยเมาส์นอกกล่องแล้ว popup หาย */}
      {openDoc && (
        <div className="modal-overlay">
          <div className="modal-content pd-items-modal" role="dialog" aria-modal="true" aria-labelledby="pd-items-title">
            <div className="modal-header pd-items-header">
              <div>
                <h2 id="pd-items-title">เอกสาร {openDoc.doc_no}</h2>
                <p className="pd-items-meta">
                  {formatDocDate(openDoc.doc_date)} · {branchText(openDoc.from_branch)} → {branchText(openDoc.to_branch)}
                  {' · '}ค้าง <DaysBadge days={openDocDays} />
                </p>
              </div>
              <button type="button" className="modal-close" onClick={() => setOpenDoc(null)} aria-label="ปิด">✕</button>
            </div>
            <div className="pd-items-body">
              <table className="pd-items-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>รหัสสินค้า</th>
                    <th>ชื่อสินค้า</th>
                    {hasSerial && <th>Serial</th>}
                    <th className="pd-num">จำนวน</th>
                  </tr>
                </thead>
                <tbody>
                  {openDoc.items.map((item, i) => (
                    <tr key={`${item.line_no ?? 'x'}-${i}`}>
                      <td>{item.line_no ?? i + 1}</td>
                      <td>{item.code}</td>
                      <td>{item.name}</td>
                      {hasSerial && <td>{item.serial ?? ''}</td>}
                      <td className="pd-num">{formatQty(item.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
