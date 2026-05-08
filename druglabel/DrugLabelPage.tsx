import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabaseLabel, supabaseLabelError, supabaseLabelWrite, TBL_SETTINGS, TBL_MEDICINES, TBL_TRANSLATIONS } from './supabase';
import { LANGS, type Lang, type Medicine, type ShopSettings } from './types';
import { Label } from './Label';
import { DLResultList } from './ResultList';
import { translateMedicineLabel, getTargetLangs } from './translate';

const BRANCH_PROFILES = [
  { id: 'hq',        shop_name_th: 'สาขาชากค้อ',          shop_name_en: 'Chak Kho Branch',           phone: '082-0311590' },
  { id: 'nine-kilo', shop_name_th: 'สาขาเก้ากิโล',         shop_name_en: 'Kao Ki Lo Branch',          phone: '098-8201512' },
  { id: 'suan-suea', shop_name_th: 'สาขาสวนเสือศรีราชา',   shop_name_en: 'Suan Suea SiRacha Branch',  phone: '092-2469002' },
] as const;

type BranchId = (typeof BRANCH_PROFILES)[number]['id'];

type MedRow = { id: string; sku: string; barcode: string | null };
type TrRow  = { medicine_id: string; trade_name?: string | null; generic_name?: string | null;
                usage?: string | null; indication?: string | null; warning?: string | null; storage?: string | null };

type TrForm = { trade_name: string; generic_name: string; usage: string; indication: string; warning: string; storage: string };
type AddForm = { sku: string; barcode: string; translations: Record<Lang, TrForm> };

const emptyTr = (): TrForm => ({ trade_name: '', generic_name: '', usage: '', indication: '', warning: '', storage: '' });
const emptyForm = (): AddForm => ({
  sku: '', barcode: '',
  translations: Object.fromEntries(LANGS.map(l => [l.code, emptyTr()])) as Record<Lang, TrForm>,
});

function flatMed(med: MedRow, tr: Omit<TrRow, 'medicine_id'> | null): Medicine {
  return {
    id: med.id, sku: med.sku, barcode: med.barcode,
    trade_name:   tr?.trade_name   ?? `(${med.sku})`,
    generic_name: tr?.generic_name ?? null,
    usage:        tr?.usage        ?? null,
    indication:   tr?.indication   ?? null,
    warning:      tr?.warning      ?? null,
    storage:      tr?.storage      ?? null,
  };
}

interface Props {
  onGoPriceTag: () => void;
  onGoDrugLabel: () => void;
}

export function DrugLabelPage({ onGoPriceTag, onGoDrugLabel }: Props) {
  const [settings,       setSettings]       = useState<ShopSettings | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<BranchId>('hq');
  const [lang,           setLang]           = useState<Lang>('th');
  const [searchInput,    setSearchInput]    = useState('');
  const [lastQuery,      setLastQuery]      = useState('');
  const [results,        setResults]        = useState<Medicine[]>([]);
  const [selected,       setSelected]       = useState<Medicine | null>(null);
  const [patientName,    setPatientName]    = useState('');
  const [loading,        setLoading]        = useState(false);
  const [searched,       setSearched]       = useState(false);
  const [error,          setError]          = useState<string | null>(null);

  // Add medicine modal
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [addFormLang,    setAddFormLang]    = useState<Lang>('th');
  const [addForm,        setAddForm]        = useState<AddForm>(emptyForm);
  const [addSaving,      setAddSaving]      = useState(false);
  const [addError,       setAddError]       = useState('');
  const [translating,    setTranslating]    = useState(false);
  const [translateError, setTranslateError] = useState('');
  const [showEditModal,  setShowEditModal]  = useState(false);
  const [editFormLang,   setEditFormLang]   = useState<Lang>('th');
  const [editForm,       setEditForm]       = useState<AddForm>(emptyForm);
  const [editSaving,     setEditSaving]     = useState(false);
  const [editLoading,    setEditLoading]    = useState(false);
  const [editError,      setEditError]      = useState('');

  const printRootRef    = useRef<HTMLDivElement>(null);
  const overlayDownRef  = useRef(false);

  const branch = BRANCH_PROFILES.find((b) => b.id === selectedBranch) ?? BRANCH_PROFILES[0];
  const activeSettings = settings
    ? { ...settings, shop_name_th: branch.shop_name_th, shop_name_en: branch.shop_name_en, phone: branch.phone }
    : null;

  useEffect(() => {
    if (!supabaseLabel) { setError(supabaseLabelError ?? 'Supabase not configured.'); return; }
    supabaseLabel.from(TBL_SETTINGS).select('*').eq('id', 1).single()
      .then(({ data, error: e }) => {
        if (e) { setError(`โหลด settings ไม่ได้: ${e.message}`); return; }
        setSettings(data as ShopSettings);
      });
  }, []);

  useEffect(() => {
    if (lastQuery) void doSearch(lastQuery, lang, selected?.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  useEffect(() => {
    const q = searchInput.trim();
    if (q.length < 2) {
      if (q.length === 0) { setResults([]); setSearched(false); setSelected(null); }
      return;
    }
    const timer = setTimeout(() => {
      setLastQuery(q);
      void doSearch(q, lang);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  async function loadByIds(ids: string[], searchLang: Lang): Promise<Medicine[]> {
    if (!supabaseLabel || ids.length === 0) return [];
    const { data: meds, error: e1 } = await supabaseLabel.from(TBL_MEDICINES).select('id, sku, barcode').in('id', ids);
    if (e1) throw e1;
    const { data: trs, error: e2 } = await supabaseLabel.from(TBL_TRANSLATIONS)
      .select('medicine_id, trade_name, generic_name, usage, indication, warning, storage')
      .in('medicine_id', ids).eq('lang', searchLang);
    if (e2) throw e2;
    const trMap  = new Map((trs  ?? []).map((t: TrRow) => [t.medicine_id, t]));
    const medMap = new Map((meds ?? []).map((m: MedRow) => [m.id, m]));
    return ids.map(id => { const m = medMap.get(id); return m ? flatMed(m, trMap.get(id) ?? null) : null; })
      .filter((m): m is Medicine => m !== null);
  }

  async function doSearch(q: string, searchLang: Lang, keepId?: string) {
    if (!supabaseLabel) { setError(supabaseLabelError ?? 'Supabase not configured.'); setSearched(true); return; }
    setLoading(true); setError(null); setSearched(true);
    try {
      const [medRes, trRes] = await Promise.all([
        supabaseLabel.from(TBL_MEDICINES).select('id, sku, barcode')
          .or(`sku.eq.${q},barcode.eq.${q},barcode.ilike.%${q}%`).limit(20),
        supabaseLabel.from(TBL_TRANSLATIONS).select('medicine_id')
          .or(`trade_name.ilike.%${q}%,generic_name.ilike.%${q}%`).limit(50),
      ]);
      if (medRes.error) throw medRes.error;
      if (trRes.error) throw trRes.error;
      const medIds = (medRes.data ?? []).map((r: MedRow) => r.id);
      const trIds  = (trRes.data  ?? []).map((r: { medicine_id: string | null }) => r.medicine_id).filter(Boolean) as string[];
      const allIds = Array.from(new Set([...medIds, ...trIds])).slice(0, 30);
      const meds = await loadByIds(allIds, searchLang);
      setResults(meds);
      setSelected(keepId ? (meds.find(m => m.id === keepId) ?? (meds.length === 1 ? meds[0] : null)) : (meds.length === 1 ? meds[0] : null));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ค้นหาไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveMedicine() {
    if (!supabaseLabelWrite) { setAddError('Supabase write client ไม่พร้อม'); return; }
    const sku = addForm.sku.trim();
    if (!sku) { setAddError('กรุณากรอก SKU'); return; }
    setAddSaving(true); setAddError('');
    try {
      const usage_ref = addForm.translations['th'].usage.trim().slice(0, 100);
      const { data: medData, error: medErr } = await supabaseLabelWrite
        .from('medicines')
        .upsert({ sku, usage_ref, barcode: addForm.barcode.trim() || null }, { onConflict: 'sku,usage_ref' })
        .select('id').single();
      if (medErr) throw medErr;

      const medicine_id = medData.id;
      const translations = LANGS
        .map(l => ({ medicine_id, lang: l.code, ...addForm.translations[l.code] }))
        .filter(t => t.trade_name || t.generic_name || t.usage || t.indication || t.warning || t.storage)
        .map(t => ({
          medicine_id: t.medicine_id, lang: t.lang,
          trade_name:   t.trade_name   || null,
          generic_name: t.generic_name || null,
          usage:        t.usage        || null,
          indication:   t.indication   || null,
          warning:      t.warning      || null,
          storage:      t.storage      || null,
        }));

      if (translations.length) {
        const { error: trErr } = await supabaseLabelWrite
          .from('medicine_translations').upsert(translations, { onConflict: 'medicine_id,lang' });
        if (trErr) throw trErr;
      }

      setShowAddModal(false);
      setAddForm(emptyForm());
      if (lastQuery) void doSearch(lastQuery, lang);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message
        : (err as { message?: string })?.message
        ?? JSON.stringify(err);
      setAddError(msg);
    } finally {
      setAddSaving(false);
    }
  }

  async function handleAutoTranslate() {
    const tr = addForm.translations[addFormLang];
    if (!tr.trade_name.trim()) { setTranslateError('กรุณากรอกชื่อการค้าในแท็บที่เลือกก่อน'); return; }
    setTranslating(true); setTranslateError('');
    try {
      const result = await translateMedicineLabel(addFormLang, tr, getTargetLangs(addFormLang));
      setAddForm(f => ({ ...f, translations: { ...f.translations, ...result } }));
    } catch (err: unknown) {
      setTranslateError(err instanceof Error ? err.message : 'แปลภาษาไม่สำเร็จ');
    } finally {
      setTranslating(false);
    }
  }

  async function handleOpenEditModal() {
    if (!selected) return;
    if (!supabaseLabel) { setError(supabaseLabelError ?? 'Supabase read client ไม่พร้อม'); return; }
    setShowEditModal(true);
    setEditLoading(true);
    setEditError('');
    setEditFormLang(lang);
    try {
      const [medRes, trRes] = await Promise.all([
        supabaseLabel
          .from(TBL_MEDICINES)
          .select('sku, barcode')
          .eq('id', selected.id)
          .single(),
        supabaseLabel
          .from(TBL_TRANSLATIONS)
          .select('lang, trade_name, generic_name, usage, indication, warning, storage')
          .eq('medicine_id', selected.id),
      ]);
      if (medRes.error) throw medRes.error;
      if (trRes.error) throw trRes.error;

      const form = emptyForm();
      form.sku = medRes.data.sku ?? selected.sku;
      form.barcode = medRes.data.barcode ?? selected.barcode ?? '';
      for (const row of trRes.data ?? []) {
        const rowLang = row.lang as Lang;
        if (!LANGS.some((l) => l.code === rowLang)) continue;
        form.translations[rowLang] = {
          trade_name: row.trade_name ?? '',
          generic_name: row.generic_name ?? '',
          usage: row.usage ?? '',
          indication: row.indication ?? '',
          warning: row.warning ?? '',
          storage: row.storage ?? '',
        };
      }
      setEditForm(form);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'โหลดข้อมูลสำหรับแก้ไขไม่สำเร็จ';
      setEditError(msg);
    } finally {
      setEditLoading(false);
    }
  }

  async function handleUpdateMedicine() {
    if (!selected) { setEditError('ไม่พบรายการที่ต้องการแก้ไข'); return; }
    if (!supabaseLabelWrite) { setEditError('Supabase write client ไม่พร้อม'); return; }
    const sku = editForm.sku.trim();
    if (!sku) { setEditError('กรุณากรอก SKU'); return; }
    setEditSaving(true);
    setEditError('');
    try {
      const usage_ref = editForm.translations['th'].usage.trim().slice(0, 100);
      const { error: medErr } = await supabaseLabelWrite
        .from('medicines')
        .update({ sku, barcode: editForm.barcode.trim() || null, usage_ref })
        .eq('id', selected.id);
      if (medErr) throw medErr;

      const translations = LANGS.map((l) => {
        const t = editForm.translations[l.code];
        return {
          medicine_id: selected.id,
          lang: l.code,
          trade_name: t.trade_name || null,
          generic_name: t.generic_name || null,
          usage: t.usage || null,
          indication: t.indication || null,
          warning: t.warning || null,
          storage: t.storage || null,
        };
      });

      const { error: trErr } = await supabaseLabelWrite
        .from('medicine_translations')
        .upsert(translations, { onConflict: 'medicine_id,lang' });
      if (trErr) throw trErr;

      setShowEditModal(false);
      if (lastQuery) {
        await doSearch(lastQuery, lang, selected.id);
      } else {
        await doSearch(sku, lang, selected.id);
        setLastQuery(sku);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message
        : (err as { message?: string })?.message
        ?? JSON.stringify(err);
      setEditError(msg);
    } finally {
      setEditSaving(false);
    }
  }

  function setEditTrField(trgLang: Lang, field: keyof TrForm, value: string) {
    setEditForm((f) => ({
      ...f,
      translations: {
        ...f.translations,
        [trgLang]: { ...f.translations[trgLang], [field]: value },
      },
    }));
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setLastQuery(q);
    void doSearch(q, lang);
  }

  function handlePrint() {
    if (!selected || !activeSettings || !printRootRef.current) return;
    const labelMarkup = printRootRef.current.innerHTML;
    const headMarkup  = Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))
      .map(n => n.outerHTML).join('\n');
    const win = window.open('', '_blank', 'width=420,height=320');
    if (!win) { setError('ไม่สามารถเปิดหน้าต่างพิมพ์ได้ — กรุณาอนุญาต pop-ups'); return; }
    win.document.open();
    win.document.write(`<!doctype html><html lang="th"><head>
      <meta charset="UTF-8"/><title>Print Label</title>${headMarkup}
      <style>
        @page { size: 95mm 65mm; margin: 0; }
        html,body { margin:0;padding:0;width:95mm;height:65mm;overflow:hidden;background:#fff; }
        body { display:flex;align-items:flex-start;justify-content:flex-start; }
        .dl-label-print-root { display:block!important;width:95mm;height:65mm;margin:0;padding:0;overflow:hidden; }
        .dl-label { margin:0!important;border:none!important;box-shadow:none!important; }
      </style>
    </head><body><div class="dl-label-print-root">${labelMarkup}</div></body></html>`);
    win.document.close(); win.focus();
    const runPrint = () => { win.print(); win.close(); };
    if (win.document.readyState === 'complete') setTimeout(runPrint, 150);
    else win.addEventListener('load', () => setTimeout(runPrint, 150), { once: true });
  }

  function setTrField(lang: Lang, field: keyof TrForm, value: string) {
    setAddForm(f => ({ ...f, translations: { ...f.translations, [lang]: { ...f.translations[lang], [field]: value } } }));
  }

  return (
    <>
      {/* Hero Header */}
      <div className="hero-header dl-hero-header">
        <div className="hero-content">
          <h1 className="logo-premium">ANIN LABEL</h1>
          <div className="tagline-row">
            {BRANCH_PROFILES.map(b => (
              <button key={b.id} className={`dl-branch-btn${selectedBranch === b.id ? ' active' : ''}`}
                onClick={() => setSelectedBranch(b.id)} type="button">{b.shop_name_th}</button>
            ))}
          </div>
          <div className="search-nav-row">
            <form className="search-premium" onSubmit={handleSearch}>
              <input className="search-input-premium" type="text" autoFocus
                placeholder="ค้นหา SKU / บาร์โค้ด / ชื่อยา"
                value={searchInput} onChange={e => setSearchInput(e.target.value)} />
              <button className="search-btn-premium" type="submit" disabled={loading}>{loading ? '...' : '🔍'}</button>
            </form>
            <button className="page-nav-card" onClick={onGoPriceTag} type="button" title="ไปหน้าป้ายราคา">
              <span className="page-nav-icon">🏷️</span>
              <span className="page-nav-label">ป้ายราคา</span>
            </button>
            <button className="page-nav-card page-nav-card--active" onClick={onGoDrugLabel} type="button" title="หน้าฉลากยา">
              <span className="page-nav-icon">📰</span>
              <span className="page-nav-label">ฉลากยา</span>
            </button>
          </div>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="dl-page"><div className="dl-main">
        <section className="dl-results-panel">
          <div className="dl-upload-row">
            <button className="dl-upload-btn" type="button" onClick={() => { setAddForm(emptyForm()); setAddError(''); setShowAddModal(true); }}>
              ➕ เพิ่มฉลากยาใหม่
            </button>
          </div>
          {error   && <div className="dl-error-line">{error}</div>}
          {loading && <div className="dl-status-line">กำลังค้นหา...</div>}
          {!loading && !searched && <div className="dl-status-line">สแกนบาร์โค้ด หรือค้นหาด้วย SKU / ชื่อยา</div>}
          {!loading && searched && results.length === 0 && !error && (
            <div className="dl-status-line">ไม่พบรายการ — ลองใช้ชื่ออื่น</div>
          )}
          <DLResultList results={results} selectedId={selected?.id ?? null} onSelect={setSelected} />
        </section>

        <aside className="dl-preview-panel">
          <div className="dl-preview-panel-header">
            <span>Preview ฉลากยา · 90×65 mm</span>
            <div className="dl-lang-selector">
              {LANGS.map(({ code, label }) => (
                <button key={code} className={`dl-lang-btn${lang === code ? ' active' : ''}`}
                  onClick={() => setLang(code)} type="button">{label}</button>
              ))}
            </div>
          </div>
          <div className="dl-patient-input-wrap">
            <label htmlFor="patient-name">ชื่อลูกค้า</label>
            <input id="patient-name" className="dl-patient-input" type="text"
              placeholder="ระบุชื่อลูกค้า (ถ้ามี)" value={patientName}
              onChange={e => setPatientName(e.target.value)} />
          </div>
          {selected && activeSettings ? (
            <>
              <div className="dl-preview-frame">
                <Label medicine={selected} settings={activeSettings} lang={lang} patientName={patientName || undefined} preview />
              </div>
              <div className="dl-print-actions">
                <button className="dl-btn-print" onClick={handlePrint} type="button">🖨️ พิมพ์ฉลากยา</button>
                <button className="dl-btn-edit" onClick={handleOpenEditModal} type="button">✏️ แก้ไขข้อมูล</button>
              </div>
            </>
          ) : (
            <div className="dl-empty-preview">เลือกรายการเพื่อดูตัวอย่างฉลาก</div>
          )}
        </aside>
      </div>

      {/* Hidden print root */}
      {selected && activeSettings && (
        <div ref={printRootRef} className="dl-label-print-root">
          <Label medicine={selected} settings={activeSettings} lang={lang} patientName={patientName || undefined} />
        </div>
      )}
      </div>

      {/* Add Medicine Modal */}
      {showAddModal && (
        <div className="dl-modal-overlay"
          onMouseDown={e => { overlayDownRef.current = e.target === e.currentTarget; }}
          onClick={() => { if (overlayDownRef.current) setShowAddModal(false); }}>
          <div className="dl-modal">
            <div className="dl-modal-header">
              <span>➕ เพิ่มฉลากยาใหม่</span>
              <button className="dl-modal-close" onClick={() => setShowAddModal(false)} type="button">✕</button>
            </div>

            <div className="dl-modal-body">
              {/* SKU + Barcode */}
              <div className="dl-add-row">
                <div className="dl-add-field">
                  <label>SKU <span className="dl-add-required">*</span></label>
                  <input className="dl-add-input" type="text" placeholder="รหัสสินค้า"
                    value={addForm.sku} onChange={e => setAddForm(f => ({ ...f, sku: e.target.value }))} />
                </div>
                <div className="dl-add-field">
                  <label>Barcode</label>
                  <input className="dl-add-input" type="text" placeholder="บาร์โค้ด (ถ้ามี)"
                    value={addForm.barcode} onChange={e => setAddForm(f => ({ ...f, barcode: e.target.value }))} />
                </div>
              </div>

              {/* Language tabs + auto-translate */}
              <div className="dl-add-lang-tabs-row">
                <div className="dl-add-lang-tabs">
                  {LANGS.map(l => {
                    const hasFill = l.code !== 'th' && Object.values(addForm.translations[l.code]).some(v => v.trim() !== '');
                    return (
                      <button key={l.code} type="button"
                        className={`dl-add-lang-tab${addFormLang === l.code ? ' active' : ''}`}
                        onClick={() => setAddFormLang(l.code)}>
                        {l.label}
                        {hasFill && <span className="dl-lang-dot" />}
                      </button>
                    );
                  })}
                </div>
                <button className="dl-translate-btn" type="button"
                  disabled={translating} onClick={handleAutoTranslate}>
                  {translating ? '⏳ กำลังแปล...' : '✨ แปลด้วย AI'}
                </button>
              </div>
              {translateError && <div className="dl-add-error">{translateError}</div>}

              {/* Per-language fields */}
              {LANGS.filter(l => l.code === addFormLang).map(l => (
                <div key={l.code} className="dl-add-lang-fields">
                  {([
                    ['trade_name',   'ชื่อการค้า / Name'],
                    ['generic_name', 'ชื่อยา / Generic Name'],
                    ['usage',        'วิธีใช้ / Administration'],
                    ['indication',   'ข้อบ่งใช้ / Indication'],
                    ['warning',      'ข้อควรระวัง / Warning'],
                    ['storage',      'การเก็บรักษา / Storage'],
                  ] as [keyof TrForm, string][]).map(([field, label]) => (
                    <div key={field} className="dl-add-field">
                      <label>{label}</label>
                      <textarea className="dl-add-textarea" rows={field === 'trade_name' || field === 'generic_name' ? 1 : 2}
                        placeholder={label}
                        value={addForm.translations[l.code][field]}
                        onChange={e => setTrField(l.code, field, e.target.value)} />
                    </div>
                  ))}
                </div>
              ))}

              {addError && <div className="dl-add-error">{addError}</div>}
            </div>

            <div className="dl-modal-footer">
              <button className="dl-btn-cancel" type="button" onClick={() => setShowAddModal(false)}>ยกเลิก</button>
              <button className="dl-btn-save" type="button" disabled={addSaving} onClick={handleSaveMedicine}>
                {addSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Medicine Modal */}
      {showEditModal && (
        <div className="dl-modal-overlay"
          onMouseDown={e => { overlayDownRef.current = e.target === e.currentTarget; }}
          onClick={() => { if (overlayDownRef.current) setShowEditModal(false); }}>
          <div className="dl-modal">
            <div className="dl-modal-header">
              <span>✏️ แก้ไขข้อมูลฉลากยา</span>
              <button className="dl-modal-close" onClick={() => setShowEditModal(false)} type="button">✕</button>
            </div>
            <div className="dl-modal-body">
              {editLoading ? (
                <div className="dl-status-line">กำลังโหลดข้อมูล...</div>
              ) : (
                <>
                  <div className="dl-add-row">
                    <div className="dl-add-field">
                      <label>SKU <span className="dl-add-required">*</span></label>
                      <input className="dl-add-input" type="text" placeholder="รหัสสินค้า"
                        value={editForm.sku} onChange={e => setEditForm(f => ({ ...f, sku: e.target.value }))} />
                    </div>
                    <div className="dl-add-field">
                      <label>Barcode</label>
                      <input className="dl-add-input" type="text" placeholder="บาร์โค้ด (ถ้ามี)"
                        value={editForm.barcode} onChange={e => setEditForm(f => ({ ...f, barcode: e.target.value }))} />
                    </div>
                  </div>

                  <div className="dl-add-lang-tabs-row">
                    <div className="dl-add-lang-tabs">
                      {LANGS.map(l => (
                        <button key={l.code} type="button"
                          className={`dl-add-lang-tab${editFormLang === l.code ? ' active' : ''}`}
                          onClick={() => setEditFormLang(l.code)}>
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {LANGS.filter(l => l.code === editFormLang).map(l => (
                    <div key={l.code} className="dl-add-lang-fields">
                      {([
                        ['trade_name',   'ชื่อการค้า / Name'],
                        ['generic_name', 'ชื่อยา / Generic Name'],
                        ['usage',        'วิธีใช้ / Administration'],
                        ['indication',   'ข้อบ่งใช้ / Indication'],
                        ['warning',      'ข้อควรระวัง / Warning'],
                        ['storage',      'การเก็บรักษา / Storage'],
                      ] as [keyof TrForm, string][]).map(([field, label]) => (
                        <div key={field} className="dl-add-field">
                          <label>{label}</label>
                          <textarea className="dl-add-textarea" rows={field === 'trade_name' || field === 'generic_name' ? 1 : 2}
                            placeholder={label}
                            value={editForm.translations[l.code][field]}
                            onChange={e => setEditTrField(l.code, field, e.target.value)} />
                        </div>
                      ))}
                    </div>
                  ))}
                  {editError && <div className="dl-add-error">{editError}</div>}
                </>
              )}
            </div>
            <div className="dl-modal-footer">
              <button className="dl-btn-cancel" type="button" onClick={() => setShowEditModal(false)}>ยกเลิก</button>
              <button className="dl-btn-save" type="button" disabled={editSaving || editLoading} onClick={handleUpdateMedicine}>
                {editSaving ? 'กำลังบันทึก...' : '💾 บันทึกการแก้ไข'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
