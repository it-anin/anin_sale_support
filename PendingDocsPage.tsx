import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { supabase } from './supabase';
import { AnimatedLogoText } from './AnimatedLogo';
import { PageNavRow } from './pageAccess';
import { SearchIcon } from './SearchIcon';
import { STORE_BRANCH_CODES, branchCodeLabel } from './auth';

// หน้า "ตรวจสอบเอกสารค้าง" — ใบโอนสินค้าออกที่สาขายังไม่กด "ส่ง" ใน ProMaxx
// ข้อมูลมาจาก pending-docs-agent.mjs (เครื่องในร้าน อ่าน MSSQL แบบ SELECT อย่างเดียว) ผ่าน Supabase
// เว็บไม่ได้ต่อ MSSQL ตรง — แค่ "ขอ" ข้อมูลสดผ่าน RPC แล้วรอ Agent ส่งกลับมา (~2-3 วิ)

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
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  row_count: number;
}

/** ค้างกี่วันถึงขึ้นสี — ใบโอนควรกดส่งภายในวันที่ทำ */
const WARN_DAYS = 1;
const ALERT_DAYS = 3;
/** หน้าที่เปิดค้างไว้ขอข้อมูลสดเองทุก 1 นาที — RPC ฝั่ง Supabase ยุบรวมทุกเครื่องเหลือ ≤ 1 ครั้ง/นาที */
const AUTO_REFRESH_MS = 60_000;
/** ขอแล้วเครื่องในร้านไม่ตอบนานเกินนี้ = บอกผู้ใช้ว่าข้อมูลที่เห็นอาจเก่า (นับด้วยนาฬิกาเครื่องนี้เอง) */
const AGENT_TIMEOUT_MS = 15_000;
/** focus/สลับแท็บถี่ๆ ไม่ต้องยิง RPC ทุกครั้ง (ฝั่ง Supabase throttle 10 วิอยู่แล้ว ตรงนี้แค่ไม่ส่งเปล่าๆ) */
const MANUAL_MIN_GAP_MS = 10_000;
const ROW_LIMIT = 1000;
const ALL_TAB = 'ทั้งหมด';
// ไม่มีแท็บ "คลังสินค้า" โดยตั้งใจ — ใน ProMaxx คลังกับหน้าร้าน SRC เป็นสาขาเดียวกัน (SYSBRANCHID 0)
// ใบของคลังจึงขึ้นเป็น SRC (BRANCH_ID_MAP ใน pending-docs-agent.mjs) แท็บคลังจะเป็น 0 ตลอดถ้าใส่ไว้
const TAB_ORDER: readonly string[] = STORE_BRANCH_CODES;
const SYNC_COLUMNS = 'refresh_requested_at, last_success_at, last_error, last_error_at, row_count';

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
  const lastSuccessMsRef = useRef<number | null | undefined>(undefined);
  const statusVersionRef = useRef(-Infinity);
  const lastManualRequestRef = useRef(0);
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

  // สถานะเปลี่ยน (realtime / โหลดซ้ำ) → ถ้า Agent ซิงค์สำเร็จรอบใหม่ ให้โหลดตารางใหม่
  const applyStatus = useCallback((next: SyncStatus) => {
    // เวลาทั้ง 3 ช่องเดินหน้าอย่างเดียว (now() ของ DB) → ค่าสูงสุด = "รุ่น" ของสถานะ
    // ผลที่ขอไปก่อนแต่มาถึงทีหลัง (request ซ้อนกัน) จะไม่ย้อนสถานะบนหน้าจอ
    const version = Math.max(
      toMs(next.refresh_requested_at) ?? -Infinity,
      toMs(next.last_success_at) ?? -Infinity,
      toMs(next.last_error_at) ?? -Infinity,
    );
    if (version < statusVersionRef.current) return;
    statusVersionRef.current = version;
    setStatus(next);
    const successMs = toMs(next.last_success_at);
    if (lastSuccessMsRef.current !== undefined && successMs !== lastSuccessMsRef.current) void fetchRows();
    lastSuccessMsRef.current = successMs;
  }, [fetchRows]);

  const fetchStatus = useCallback(async () => {
    const { data, error } = await supabase
      .from('pending_docs_sync')
      .select(SYNC_COLUMNS)
      .eq('id', 1)
      .maybeSingle();
    if (!error && data) applyStatus(data as SyncStatus);
  }, [applyStatus]);

  // ขอข้อมูลสดจาก Agent — auto = ตัวจับเวลาทุก 1 นาที (throttle ฝั่ง Supabase 60 วิ) / คนกด = 10 วิ
  const requestRefresh = useCallback(async (auto: boolean) => {
    if (!auto) {
      if (Date.now() - lastManualRequestRef.current < MANUAL_MIN_GAP_MS) return;
      lastManualRequestRef.current = Date.now();
    }
    // ⚠️ ต้อง await — query builder ของ supabase-js ไม่ส่ง request จนกว่าจะถูกเรียก .then() (CLAUDE.md)
    const { error } = await supabase.rpc('request_pending_docs_refresh', { p_auto: auto });
    if (error) console.error('[เอกสารค้าง] ขอข้อมูลสดไม่สำเร็จ', error);
    await fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (notSupported) return;
    lastSuccessMsRef.current = undefined;
    statusVersionRef.current = -Infinity;
    // อ่านสถานะก่อนแล้วค่อยอ่านตาราง — ตารางจะใหม่เท่ากับหรือกว่าเวลาที่ป้ายบอกเสมอ
    // รอบที่ซิงค์เสร็จหลังจากนี้มาทาง realtime/applyStatus แล้วโหลดตารางใหม่เอง
    void fetchStatus().then(fetchRows);
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

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void requestRefresh(false);
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    // เปิดค้างไว้ = ขอข้อมูลสดเองทุก 1 นาที เฉพาะแท็บที่มองเห็นอยู่ (แท็บที่ซ่อนไม่ไปกวน MSSQL Express ที่ใช้ร่วมกับ POS)
    // fetchStatus ในนั้นเป็นตัวสำรองด้วย — realtime หลุดก็ยังรู้ว่ามีข้อมูลรอบใหม่
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void requestRefresh(true);
    }, AUTO_REFRESH_MS);

    return () => {
      void supabase.removeChannel(channel);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(timer);
    };
  }, [notSupported, branchFilter, fetchRows, fetchStatus, requestRefresh, applyStatus]);

  const requestedMs = toMs(status?.refresh_requested_at);
  const successMs = toMs(status?.last_success_at);
  const errorMs = toMs(status?.last_error_at);
  // คำขอล่าสุดใหม่กว่าผลล่าสุด (สำเร็จหรือ error) = Agent ยังทำอยู่ — เทียบเวลาของ DB กับ DB จึงไม่โดนนาฬิกาเครื่องเพี้ยน
  const waiting = requestedMs !== null && requestedMs > Math.max(successMs ?? -Infinity, errorMs ?? -Infinity);
  const showError = !waiting && Boolean(status?.last_error) && errorMs !== null && errorMs > (successMs ?? -Infinity);

  // นับ 15 วิตั้งแต่เริ่มรอ — คำขอใหม่ระหว่างที่ยังรออยู่ (ตัวจับเวลา 1 นาที) ไม่เริ่มนับใหม่
  // ไม่งั้นตอนเครื่องในร้านดับ ป้ายจะสลับ "กำลังดึง…" ↔ "ไม่ตอบ" ทุกนาทีเหมือนกำลังทำงานอยู่
  useEffect(() => {
    if (!waiting) {
      setAgentSilent(false);
      return;
    }
    const t = window.setTimeout(() => setAgentSilent(true), AGENT_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [waiting]);

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
  const lastDataText = successMs !== null ? formatSyncTime(successMs) : null;
  const shownAt = lastDataText ? ` — แสดงข้อมูล ณ ${lastDataText}` : '';

  let syncBadge: ReactNode;
  if (!status) {
    syncBadge = <span className="updated-badge updated-badge--loading">Loading...</span>;
  } else if (waiting && !agentSilent) {
    syncBadge = (
      <span className="updated-badge pd-sync-badge--busy">
        <span className="pd-spin" aria-hidden="true">🔄</span> กำลังดึงข้อมูลล่าสุด…
      </span>
    );
  } else if (waiting) {
    syncBadge = <span className="updated-badge pd-sync-badge--warn">⚠️ เครื่องในร้านไม่ตอบ{shownAt}</span>;
  } else if (showError) {
    syncBadge = <span className="updated-badge pd-sync-badge--error">❌ {status.last_error}{shownAt}</span>;
  } else if (lastDataText) {
    syncBadge = <span className="updated-badge">ข้อมูล ณ {lastDataText}</span>;
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
                  lastManualRequestRef.current = 0; // คนกดเองส่งเสมอ (ฝั่ง Supabase ยังกันถี่ 10 วิ)
                  void requestRefresh(false);
                }}
                disabled={waiting && !agentSilent}
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
              <p>โปรไฟล์ที่เข้าสู่ระบบอยู่ไม่ได้สังกัดสาขาหน้าร้าน จึงไม่มีใบโอนสินค้าของตัวเอง</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const owner = canSeeAll ? '' : ` ของ ${branchText(userBranch ?? null)}`;
  const headerText = !rowsLoaded
    ? 'กำลังโหลด…'
    : `ใบโอนที่ยังไม่กด "ส่ง"${owner} — ${visibleRows.length.toLocaleString()} ใบ${rows.length === ROW_LIMIT ? ` (แสดงสูงสุด ${ROW_LIMIT.toLocaleString()} ใบ)` : ''}`;
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
              placeholder="ค้นหาเลขที่ใบโอน รหัส หรือชื่อสินค้า..."
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
                <th className="pd-col-doc">เลขที่ใบโอน</th>
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
                        ? 'ไม่มีใบโอนค้างส่ง 🎉'
                        : 'ไม่พบใบโอนที่ตรงกับคำค้นหา'}
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
                <h2 id="pd-items-title">ใบโอน {openDoc.doc_no}</h2>
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
