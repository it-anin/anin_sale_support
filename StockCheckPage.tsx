import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { AnimatedLogoText } from './AnimatedLogo';
import { PageNavRow } from './pageAccess';
import { SearchIcon } from './SearchIcon';

interface StockItem {
  branch: string;
  sku: string;
  name: string;
  qty: string;
  unit: string;
  price: string;
}

const TABS = ['คลังสินค้า', 'SRC', 'KKL', 'SSS'] as const;

interface Props {
  onGoPriceTag: () => void;
  onGoDrugLabel: () => void;
  onGoStockCheck: () => void;
  onGoCustomerHistory: () => void;
  onGoOutbound: () => void;
  onGoSaleSupport: () => void;
}

export function StockCheckPage({ onGoPriceTag, onGoDrugLabel, onGoStockCheck, onGoCustomerHistory, onGoOutbound, onGoSaleSupport }: Props) {
  const [results,      setResults]      = useState<StockItem[]>([]);
  const [activeTab,    setActiveTab]    = useState<string>('คลังสินค้า');
  const [search,       setSearch]       = useState('');
  const [searching,    setSearching]    = useState(false);
  const [searched,     setSearched]     = useState(false);
  const [lastUploaded, setLastUploaded] = useState('');

  useEffect(() => {
    supabase
      .from('stock')
      .select('uploaded_at')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]?.uploaded_at) {
          const d = new Date(data[0].uploaded_at);
          setLastUploaded(d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }));
        }
      });
  }, []);

  const doSearch = useCallback(async (term: string, branch: string) => {
    const q = term.trim();
    if (!q) { setResults([]); setSearched(false); return; }
    setSearching(true);
    setSearched(true);
    const isNumeric = /^\d+$/.test(q);
    const query = supabase
      .from('stock')
      .select('branch, sku, name, qty, unit, price')
      .eq('branch', branch)
      .order('sku')
      .limit(300);
    const { data, error } = await (isNumeric
      ? query.ilike('sku', `${q}%`)
      : query.ilike('name', `%${q}%`));
    if (!error && data) {
      setResults(data.map(r => ({
        branch: r.branch ?? '',
        sku:    r.sku    ?? '',
        name:   r.name   ?? '',
        qty:    r.qty    ?? '',
        unit:   r.unit   ?? '',
        price:  r.price  ?? '',
      })));
    }
    setSearching(false);
  }, []);

  useEffect(() => {
    if (search.trim()) doSearch(search, activeTab);
    else { setResults([]); setSearched(false); }
  }, [activeTab]);

  useEffect(() => {
    const t = setTimeout(() => doSearch(search, activeTab), 200);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="app-container">
      <div className="hero-header">
        <div className="hero-content">
          <h1 className="logo-premium"><AnimatedLogoText text="CHECK STOCK" /></h1>
          <div className="tagline-row">
            {lastUploaded
              ? <span className="updated-badge">Last Updated : {lastUploaded}</span>
              : <span className="updated-badge updated-badge--loading">Loading...</span>
            }
          </div>
          <PageNavRow current="stockcheck" handlers={{ pricetag: onGoPriceTag, druglabel: onGoDrugLabel, stockcheck: onGoStockCheck, customerhistory: onGoCustomerHistory, outbound: onGoOutbound, salesupport: onGoSaleSupport }} />
        </div>
      </div>

      <div className="container">
        <div className="table-search-row">
          <div className="search-premium">
            <input
              type="text"
              className="search-input-premium"
              placeholder="ค้นหา SKU หรือชื่อสินค้า..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button className="search-btn-premium">
              {searching ? '⏳' : <SearchIcon />}
            </button>
          </div>
        </div>

        {searched && <div className="stock-tabs">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`stock-tab${activeTab === tab ? ' stock-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>}

        {searched && (
          <div className="product-table-wrap stock-table-wrap">
            <div className="selected-table-header">
              <span>{results.length} รายการ {results.length === 300 && '(แสดงสูงสุด 300)'}</span>
            </div>
            <table className="product-table stock-table">
              <thead>
                <tr>
                  <th className="stock-col-sku">SKU</th>
                  <th className="stock-col-name">ชื่อสินค้า</th>
                  <th className="stock-col-qty">จำนวน</th>
                  <th className="stock-col-unit">หน่วย</th>
                  <th className="stock-col-price">ราคาต่อหน่วย</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>
                      ไม่พบข้อมูล
                    </td>
                  </tr>
                ) : (
                  results.map((item, i) => (
                    <tr key={i}>
                      <td className="stock-col-sku">{item.sku}</td>
                      <td className="stock-col-name">{item.name}</td>
                      <td className="stock-col-qty">{isNaN(Number(item.qty)) ? item.qty : Math.floor(Number(item.qty))}</td>
                      <td className="stock-col-unit">{item.unit}</td>
                      <td className="stock-col-price">{isNaN(Number(item.price)) ? item.price : Math.floor(Number(item.price)).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!searched && (
          <div className="stock-empty-state">
            <div className="stock-empty-icon">
              <svg className="stock-empty-icon-img" viewBox="0 0 96 96" aria-hidden="true">
                <path d="M48 20 L74 33 L74 63 L48 76 L22 63 L22 33 Z" fill="none" stroke="#4891db" strokeWidth="4" strokeLinejoin="round" />
                <path d="M22 33 L48 46 L74 33" fill="none" stroke="#4891db" strokeWidth="4" strokeLinejoin="round" />
                <path d="M48 46 L48 76" fill="none" stroke="#4891db" strokeWidth="4" />
              </svg>
            </div>
            <div>พิมพ์ SKU หรือชื่อสินค้าในช่องค้นหาด้านบน</div>
          </div>
        )}
      </div>
    </div>
  );
}
