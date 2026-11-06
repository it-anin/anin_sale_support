import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

interface StockSyncStatus {
  refresh_requested_at: string | null;
  last_success_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

const STATUS_POLL_MS = 60_000;
const WAITING_POLL_MS = 3_000;
// Stock รวม movement สะสม; Agent จำกัด query 60 วิ (Pending ใช้ query ที่เล็กกว่า).
const AGENT_TIMEOUT_MS = 75_000;

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00').replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(ms) ? ms : null;
}

export function useStockSync() {
  // null = กำลังตรวจ, false = ยังใช้ CSV (ยังไม่ได้ติดตั้ง schema ใหม่).
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<StockSyncStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [userRequestMs, setUserRequestMs] = useState<number | null>(null);
  const [agentSilent, setAgentSilent] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const lastSuccessRef = useRef<number | null | undefined>(undefined);
  const statusVersionRef = useRef(-Infinity);
  const lastRequestRef = useRef(0);

  const applyStatus = useCallback((next: StockSyncStatus) => {
    const version = Math.max(...[
      next.refresh_requested_at, next.last_success_at, next.last_checked_at, next.last_error_at,
    ].map(value => toMs(value) ?? -Infinity));
    if (version < statusVersionRef.current) return;
    statusVersionRef.current = version;
    setAvailable(true);
    setStatus(next);
    setStatusError('');
    const success = toMs(next.last_success_at);
    if (lastSuccessRef.current !== undefined && success !== lastSuccessRef.current) {
      setDataVersion(value => value + 1);
    }
    lastSuccessRef.current = success;
  }, []);

  const fetchStatus = useCallback(async (): Promise<StockSyncStatus | null> => {
    try {
      const { data, error } = await supabase.from('stock_sync').select('*').eq('id', 1).maybeSingle();
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') {
          setAvailable(false);
          setStatusError('');
        } else setStatusError('อ่านสถานะสต๊อคไม่สำเร็จ กรุณาลองอีกครั้ง');
        return null;
      }
      if (!data) {
        setAvailable(false);
        return null;
      }
      applyStatus(data as StockSyncStatus);
      return data as StockSyncStatus;
    } catch {
      setStatusError('อ่านสถานะสต๊อคไม่สำเร็จ กรุณาลองอีกครั้ง');
      return null;
    }
  }, [applyStatus]);

  const requestRefresh = useCallback(async (auto: boolean, manual = false) => {
    if (!manual && Date.now() - lastRequestRef.current < 10_000) return;
    lastRequestRef.current = Date.now();
    if (!auto) setRequesting(true);
    try {
      const { data, error } = await supabase.rpc('request_stock_refresh', { p_auto: auto });
      if (error) {
        setStatusError('ขอข้อมูลล่าสุดไม่สำเร็จ กรุณาลองอีกครั้ง');
        return;
      }
      const row = await fetchStatus();
      const created = toMs(typeof data === 'string' ? data : null);
      const target = created ?? (auto ? null : toMs(row?.refresh_requested_at));
      if (target !== null) setUserRequestMs(previous => Math.max(previous ?? -Infinity, target));
    } catch {
      setStatusError('ขอข้อมูลล่าสุดไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally { setRequesting(false); }
  }, [fetchStatus]);

  useEffect(() => {
    void fetchStatus();
    const channel = supabase.channel('stock-page-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stock_sync' }, payload => {
        const next = payload.new as Partial<StockSyncStatus>;
        if ('last_success_at' in next) applyStatus(next as StockSyncStatus);
        else void fetchStatus();
      })
      .subscribe(state => { if (state === 'SUBSCRIBED') void fetchStatus(); });
    const whenBack = () => {
      if (document.visibilityState === 'visible') {
        void fetchStatus().then(row => { if (row) void requestRefresh(true); });
      }
    };
    window.addEventListener('focus', whenBack);
    document.addEventListener('visibilitychange', whenBack);
    // อ่าน Supabase 1 แถวเท่านั้น — เปิดค้างไว้ไม่ได้ขอให้ Agent ถาม MSSQL.
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchStatus();
    }, STATUS_POLL_MS);
    return () => {
      void supabase.removeChannel(channel);
      window.removeEventListener('focus', whenBack);
      document.removeEventListener('visibilitychange', whenBack);
      window.clearInterval(poll);
    };
  }, [applyStatus, fetchStatus, requestRefresh]);

  useEffect(() => {
    if (available) void requestRefresh(false);
  }, [available, requestRefresh]);

  const successMs = toMs(status?.last_success_at);
  const dataMs = Math.max(successMs ?? -Infinity, toMs(status?.last_checked_at) ?? -Infinity);
  const errorMs = toMs(status?.last_error_at);
  const answeredMs = Math.max(dataMs, errorMs ?? -Infinity);
  const requestedMs = toMs(status?.refresh_requested_at);
  const waiting = requestedMs !== null && requestedMs > answeredMs;
  const userWaiting = userRequestMs !== null && userRequestMs > answeredMs;

  useEffect(() => {
    if (!waiting) { setAgentSilent(false); return; }
    const timer = window.setTimeout(() => setAgentSilent(true), AGENT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  useEffect(() => {
    if (!userWaiting || agentSilent) return;
    const poll = window.setInterval(() => void fetchStatus(), WAITING_POLL_MS);
    return () => window.clearInterval(poll);
  }, [userWaiting, agentSilent, fetchStatus]);

  return {
    available, statusError, dataVersion, successMs,
    dataMs: Number.isFinite(dataMs) ? dataMs : null,
    busy: requesting || userWaiting,
    agentSilent: waiting && agentSilent,
    agentError: !userWaiting && status?.last_error && errorMs !== null && errorMs > dataMs ? status.last_error : '',
    refresh: () => requestRefresh(false, true),
  };
}
