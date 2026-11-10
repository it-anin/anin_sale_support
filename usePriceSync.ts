import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

interface PriceSyncStatus {
  data_version: number | string;
  last_success_at: string | null;
  request_id?: number | string;
  completed_request_id?: number | string;
  refresh_requested_at?: string | null;
  last_request_completed_at?: string | null;
  last_checked_at?: string | null;
  last_error_at?: string | null;
  last_error?: string | null;
  last_request_error?: string | null;
}

const requestNumber = (value: number | string | undefined) => BigInt(value ?? 0);
const pendingRequest = (row: PriceSyncStatus | null) => row != null
  && requestNumber(row.request_id) > requestNumber(row.completed_request_id);
const statusTime = (row: PriceSyncStatus) => Math.max(0, ...[
  row.refresh_requested_at, row.last_request_completed_at, row.last_checked_at, row.last_error_at,
].map(value => Date.parse(value ?? '') || 0));

/** Observes data across navigation. Only requestRefresh (the Admin badge) queues MSSQL work. */
export function usePriceSync(enabled: boolean) {
  const [dataVersion, setDataVersion] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<PriceSyncStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [targetRequest, setTargetRequest] = useState<string | null>(null);
  const [waitingLong, setWaitingLong] = useState(false);
  const statusRef = useRef<PriceSyncStatus | null>(null);
  const targetRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const readStatusRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!enabled) {
      statusRef.current = null;
      targetRef.current = null;
      setStatus(null);
      setTargetRequest(null);
      setRequestError('');
      setAvailable(null);
      return;
    }
    let cancelled = false;
    let reading = false;
    let lastRead = 0;
    let lastVersion: bigint | null = null;
    const apply = (row: PriceSyncStatus) => {
      if (cancelled || row.data_version == null) return;
      const next = BigInt(row.data_version);
      const previous = statusRef.current;
      if (lastVersion !== null && next < lastVersion) return;
      if (previous) {
        if (requestNumber(row.request_id) < requestNumber(previous.request_id)
            || requestNumber(row.completed_request_id) < requestNumber(previous.completed_request_id)) return;
        if (next === lastVersion && requestNumber(row.request_id) === requestNumber(previous.request_id)
            && requestNumber(row.completed_request_id) === requestNumber(previous.completed_request_id)
            && statusTime(row) < statusTime(previous)) return;
      }
      statusRef.current = row;
      setStatus(row);
      setAvailable(row.request_id != null && row.completed_request_id != null);
      // Queue/completion updates do not cause product queries when data is unchanged.
      if (lastVersion === null || next > lastVersion) {
        lastVersion = next;
        setUpdatedAt(row.last_success_at);
        setDataVersion(value => value + 1);
      }
    };
    const readStatus = async () => {
      if (cancelled || reading) return;
      reading = true;
      lastRead = Date.now();
      try {
        const { data, error } = await supabase.from('price_sync')
          .select('*').eq('id', 1).maybeSingle();
        // Until the setup SQL is installed, keep the existing read/search flow.
        if (!error && data) apply(data);
        else if (!cancelled && (!error || error.code === '42P01' || error.code === 'PGRST205')) setAvailable(false);
      } catch {
        // The next status poll/reconnect retries without requesting MSSQL work.
      } finally { reading = false; }
    };
    readStatusRef.current = readStatus;
    const whenVisible = () => {
      if (document.visibilityState === 'visible') void readStatus();
    };
    const channel = supabase.channel('price-data-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'price_sync', filter: 'id=eq.1' },
        payload => apply(payload.new as PriceSyncStatus))
      .subscribe(state => { if (state === 'SUBSCRIBED') void readStatus(); });
    void readStatus();
    const timer = window.setInterval(() => {
      const pending = pendingRequest(statusRef.current) || (targetRef.current != null
        && requestNumber(statusRef.current?.completed_request_id) < BigInt(targetRef.current));
      if (pending || Date.now() - lastRead >= 60_000) whenVisible();
    }, 3_000);
    window.addEventListener('focus', whenVisible);
    document.addEventListener('visibilitychange', whenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', whenVisible);
      document.removeEventListener('visibilitychange', whenVisible);
      if (readStatusRef.current === readStatus) readStatusRef.current = async () => {};
      void supabase.removeChannel(channel);
    };
  }, [enabled]);

  const requestRefresh = useCallback(async () => {
    if (!enabled || submittingRef.current || pendingRequest(statusRef.current)) return;
    if (!available) { setRequestError('ระบบดึงข้อมูลยังไม่พร้อมใช้งาน'); return; }
    submittingRef.current = true;
    setSubmitting(true);
    setRequestError('');
    setTargetRequest(null);
    targetRef.current = null;
    try {
      const { data, error } = await supabase.rpc('request_price_refresh');
      if (error) throw error;
      if (data == null) { setRequestError('กรุณารอสักครู่แล้วลองใหม่'); return; }
      const target = String(data);
      targetRef.current = target;
      setTargetRequest(target);
      await readStatusRef.current();
    } catch { setRequestError('ขอดึงข้อมูลล่าสุดไม่สำเร็จ กรุณาลองอีกครั้ง'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }, [enabled, available]);

  const refreshing = submitting || pendingRequest(status) || (targetRequest != null
    && requestNumber(status?.completed_request_id) < BigInt(targetRequest));
  useEffect(() => {
    setWaitingLong(false);
    if (!refreshing) return;
    const timer = window.setTimeout(() => setWaitingLong(true), 90_000);
    return () => window.clearTimeout(timer);
  }, [refreshing]);
  const targetError = targetRequest != null && requestNumber(status?.completed_request_id) >= BigInt(targetRequest)
    && requestNumber(status?.request_id) === BigInt(targetRequest) ? status?.last_request_error : null;
  const error = requestError || targetError || status?.last_error || '';
  const refreshMessage = refreshing
    ? waitingLong ? 'ยังรอเครื่องในร้าน กรุณาตรวจว่า Agent เปิดอยู่' : 'กำลังรอเครื่องในร้านดึงข้อมูลล่าสุด…'
    : error || (targetRequest != null ? 'ตรวจข้อมูลล่าสุดเรียบร้อยแล้ว' : '');
  return { dataVersion, updatedAt, available, requestRefresh, refreshing, refreshMessage, refreshError: !!error };
}
