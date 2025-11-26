const { useState, useEffect, useRef } = React;

// Componente de barra con Chart.js nativo
function ChartBar({ labels, counts, height = 380 }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!window.Chart || !canvasRef.current) return;

    // Registrar escalas/controladores si no están
    if (Chart.registerables) {
      try { Chart.register(...Chart.registerables); } catch {}
    }

    // Crear/actualizar
    const ctx = canvasRef.current.getContext('2d');
    if (chartRef.current) {
      // actualizar dataset/labels
      chartRef.current.data.labels = labels;
      chartRef.current.data.datasets[0].data = counts;
      chartRef.current.update();
    } else {
      const palette = ['#9F2241','#7B1E5A','#5B2FA6','#3F51B5','#2196F3','#03A9F4','#00BCD4','#009688','#4CAF50','#8BC34A','#CDDC39','#FFC107','#FF9800','#FF5722'];
      const colors = labels.map((_, i) => palette[i % palette.length]);
      chartRef.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Conteo',
            data: counts,
            backgroundColor: colors,
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          scales: { x: { ticks: { autoSkip: false, maxRotation: 60 } }, y: { beginAtZero: true } }
        }
      });
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [labels, counts]);

  return (
    <div style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// Worker: filtra por cDesCZ (coordinación), cDesSituacion=ACTIVO y cSexo M/F
const WORKER_SRC = `
  let dataCache = null;
  const normalize = v => String(v ?? '').trim().replace(/\\\\.0$/, '');
  const fold = s => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  async function ensureData(excelUrl){
    if (dataCache) return;
    const res = await fetch(excelUrl);
    if (!res.ok) throw new Error('No se pudo cargar el Excel: ' + res.status);
    const ab = await res.arrayBuffer();
    importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const wb = XLSX.read(ab, { type: 'array', dense: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    dataCache = XLSX.utils.sheet_to_json(ws, { defval: '' });
  }
  function isActivo(row, situKey){
    return String(row[situKey] ?? '').trim().toUpperCase() === 'ACTIVO';
  }
  self.onmessage = async (e) => {
    const { type, excelUrl, regionName } = e.data || {};
    try {
      if (type === 'warmup') {
        await ensureData(excelUrl);
        self.postMessage({ type: 'ready' });
        return;
      }
      if (type !== 'aggregate' && type !== 'export') return;
      await ensureData(excelUrl);
      if (!dataCache || !dataCache.length) {
        const emptyMeta = { total: 0, muni: 0, activos: 0, hombres: 0, mujeres: 0 };
        if (type === 'aggregate') self.postMessage({ type:'stats', labels: [], counts: [], meta: emptyMeta });
        else self.postMessage({ type:'exportData', rows: [], meta: emptyMeta });
        return;
      }

      const sample = dataCache[0] || {};
      const czKey   = ['cDesCZ','CDesCZ'].find(k => Object.prototype.hasOwnProperty.call(sample, k)) || 'cDesCZ';
      const sexKey  = ['cSexo','CSexo'].find(k => Object.prototype.hasOwnProperty.call(sample, k)) || 'cSexo';
      const situKey = ['cDesSituacion','CDesSituacion'].find(k => Object.prototype.hasOwnProperty.call(sample, k)) || 'cDesSituacion';

      const selCZ = fold(regionName || '');
      if (!selCZ) {
        const emptyMeta = { total: dataCache.length, muni: 0, activos: 0, hombres: 0, mujeres: 0 };
        if (type === 'aggregate') self.postMessage({ type:'stats', labels: [], counts: [], meta: emptyMeta });
        else self.postMessage({ type:'exportData', rows: [], meta: emptyMeta });
        return;
      }

      const total = dataCache.length;
      let muni = 0, activos = 0, hombres = 0, mujeres = 0;
      const outRows = [];

      for (const r of dataCache) {
        const rowCZ = fold(r[czKey]);
        if (rowCZ !== selCZ) continue;
        muni++;

        if (!isActivo(r, situKey)) continue;
        activos++;

        const sx = String(r[sexKey] ?? '').trim().toUpperCase();
        if (sx === 'M') hombres++;
        else if (sx === 'F') mujeres++;
        // Para export, solo incluir M/F; si quieres incluir también vacíos, elimina la condición siguiente.
        if (type === 'export') {
          if (sx === 'M' || sx === 'F') outRows.push(r);
        }
      }

      if (type === 'aggregate') {
        const labels = ['Hombres (M)','Mujeres (F)'];
        const counts = [hombres, mujeres];
        self.postMessage({ type:'stats', labels, counts, meta: { total, muni, activos, hombres, mujeres } });
      } else {
        self.postMessage({ type:'exportData', rows: outRows, meta: { total, muni, activos, hombres, mujeres } });
      }
    } catch (err) {
      const msg = err.message || 'Error al procesar el archivo.';
      if (type === 'aggregate') self.postMessage({ type:'error', message: msg });
      else self.postMessage({ type:'error', message: msg });
    }
  };
`;

function ConsultaGlobal() {
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [labels, setLabels] = useState([]);
  const [counts, setCounts] = useState([]);
  const [region, setRegion] = useState({ code: '', name: '' });
  const [meta, setMeta] = useState({ total: 0, muni: 0, activos: 0, hombres: 0, mujeres: 0 });

  const EXCEL_URL = '../XLSX/ATNYSEG_150925.xlsx';
  const TEMPLATE_URL = '../XLSX/plantillas/ResumenChartTemplate.xlsx'; // plantilla con gráfica en "Resumen"
  const workerRef = useRef(null);
  const workerUrlRef = useRef('');

  // Registrar Chart.js (UMD)
  useEffect(() => {
    if (window.Chart && Chart.registerables) {
      try { Chart.register(...Chart.registerables); } catch {}
    }
  }, []);

  useEffect(() => {
    // leer región
    const qs = new URLSearchParams(window.location.search);
    setRegion({
      code: String(qs.get('regionCode') || '').trim(),
      name: String(qs.get('regionName') || '').trim()
    });

    // crear worker + warmup
    const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    workerRef.current = w;
    workerUrlRef.current = url;

    w.onmessage = async (ev) => {
      const { type, labels: L, counts: C, message, meta: payloadMeta, rows } = ev.data || {};
      if (type === 'ready') return;
      if (type === 'stats') {
        setLoading(false);
        setError('');
        setLabels(L || []);
        setCounts(C || []);
        if (payloadMeta) setMeta(payloadMeta);
      } else if (type === 'exportData') {
        setExporting(false);
        try {
          // 1) Intentar usar plantilla con gráfica incrustada
          let wb = null;
          try {
            const tplRes = await fetch(TEMPLATE_URL, { cache: 'no-cache' });
            if (tplRes.ok) {
              const tplAb = await tplRes.arrayBuffer();
              wb = XLSX.read(tplAb, { type: 'array' });
            }
          } catch {}

          if (wb) {
            // Hoja Resumen: escribir los valores en A2:B4 (la gráfica del template debe apuntar a este rango)
            const wsResumen = wb.Sheets['Resumen'] || wb.Sheets[wb.SheetNames[0]];
            const hombres = payloadMeta?.hombres ?? 0;
            const mujeres = payloadMeta?.mujeres ?? 0;
            const totalAct = hombres + mujeres;

            // Título A1 (opcional) y tabla A2:B4
            wsResumen['A1'] = { t: 's', v: 'Desglose de activos' };
            wsResumen['A2'] = { t: 's', v: 'Masculino (M)' };
            wsResumen['B2'] = { t: 'n', v: hombres };
            wsResumen['A3'] = { t: 's', v: 'Femenino (F)' };
            wsResumen['B3'] = { t: 'n', v: mujeres };
            wsResumen['A4'] = { t: 's', v: 'Total activos' };
            wsResumen['B4'] = { t: 'n', v: totalAct };
            wsResumen['!cols'] = [{ wch: 26 }, { wch: 14 }];
            wsResumen['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];

            // Hoja Detalle: reemplazar o crear
            const wsDetalle = XLSX.utils.json_to_sheet(rows || []);
            wb.Sheets['Detalle'] = wsDetalle;
            if (!wb.SheetNames.includes('Detalle')) wb.SheetNames.push('Detalle');

            // Guardar
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const safeName = String(region.name || 'Coordinacion').replace(/[\\/:*?"<>|]+/g, '_');
            XLSX.writeFile(wb, `Activos_${safeName}_${yyyy}-${mm}-${dd}.xlsx`);
          } else {
            // 2) Fallback sin plantilla (no incluye gráfica incrustada)
            const wb2 = XLSX.utils.book_new();
            const hombres = payloadMeta?.hombres ?? 0;
            const mujeres = payloadMeta?.mujeres ?? 0;
            const totalAct = hombres + mujeres;

            const wsResumen2 = XLSX.utils.aoa_to_sheet([
              ['Desglose de activos'],
              ['Masculino (M)', hombres],
              ['Femenino (F)', mujeres],
              ['Total activos', totalAct],
            ]);
            wsResumen2['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
            wsResumen2['!cols'] = [{ wch: 26 }, { wch: 14 }];
            XLSX.utils.book_append_sheet(wb2, wsResumen2, 'Resumen');

            const wsDetalle2 = XLSX.utils.json_to_sheet(rows || []);
            XLSX.utils.book_append_sheet(wb2, wsDetalle2, 'Detalle');

            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const safeName = String(region.name || 'Coordinacion').replace(/[\\/:*?"<>|]+/g, '_');
            XLSX.writeFile(wb2, `Activos_${safeName}_${yyyy}-${mm}-${dd}.xlsx`);
          }
        } catch (e) {
          setError(e.message || 'No se pudo generar el Excel.');
        }
      } else if (type === 'error') {
        setLoading(false);
        setExporting(false);
        setError(message || 'Error al procesar el archivo.');
      }
    };

    try {
      const excelAbs = new URL(EXCEL_URL, window.location.href).toString();
      w.postMessage({ type: 'warmup', excelUrl: excelAbs });
    } catch {}

    // cleanup (corrección del bloque truncado)
    return () => {
      if (workerRef.current) workerRef.current.terminate();
      if (workerUrlRef.current) URL.revokeObjectURL(workerUrlRef.current);
    };
  }, []);

  function handleConsultar() {
    setError('');
    setLabels([]);
    setCounts([]);
    if (!region.name) { setError('Abre esta consulta desde el índice seleccionando un lugar.'); return; }
    if (!workerRef.current) { setError('No se pudo iniciar la consulta.'); return; }

    let excelAbs = '';
    try { excelAbs = new URL(EXCEL_URL, window.location.href).toString(); }
    catch { setError('No se pudo resolver la ruta del Excel.'); return; }

    setLoading(true);
    workerRef.current.postMessage({
      type: 'aggregate',
      excelUrl: excelAbs,
      regionName: region.name   // filtro por cDesCZ exacto (normalizado en el worker)
    });
  }

  function handleExport() {
    setError('');
    if (!region.name) { setError('Abre esta consulta desde el índice seleccionando un lugar.'); return; }
    if (!workerRef.current) { setError('No se pudo iniciar la exportación.'); return; }
    let excelAbs = '';
    try { excelAbs = new URL(EXCEL_URL, window.location.href).toString(); }
    catch { setError('No se pudo resolver la ruta del Excel.'); return; }
    setExporting(true);
    workerRef.current.postMessage({
      type: 'export',
      excelUrl: excelAbs,
      regionName: region.name
    });
  }

  return (
    <div className="consulta-page">
      <div className="consulta-header">
        <h2>Consulta global</h2>
        <img className="instituto-logo" src="/IMG/Logo.png" alt="Instituto" />
      </div>
      <div className="consulta-divider"></div>

      <div className="consulta-grid">
        <section className="consulta-form">
          <div className="consulta-actions" style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={handleConsultar} disabled={loading || !region.name}>
              {loading ? 'Consultando…' : 'Consultar activos'}
            </button>
            <button type="button" className="btn" onClick={handleExport} disabled={exporting || !region.name}>
              {exporting ? 'Generando…' : 'Descargar Excel'}
            </button>
          </div>
          {region.name && (
            <div style={{ marginTop: 10, fontWeight: 800, color: '#9F2241' }}>
              Coordinación: {region.name}
            </div>
          )}
          {/* Desglose por sexo y total de activos */}
          {(meta.total > 0) && (
            <div style={{ marginTop: 10, padding: '8px 10px', border: '1px solid rgba(0,0,0,.06)', borderRadius: 8, background: '#fff' }}>
              <div style={{ fontWeight: 800, color: '#9F2241', marginBottom: 6 }}>Desglose de activos</div>
              <div>Masculino (M): <strong>{meta.hombres}</strong></div>
              <div>Femenino (F): <strong>{meta.mujeres}</strong></div>
              <div>Total activos: <strong>{meta.hombres + meta.mujeres}</strong></div>
            </div>
          )}
          {error && <div className="consulta-error">{error}</div>}
        </section>

        <aside className="consulta-result" aria-live="polite">
          <h3>
            Activos en {region.name || '—'} 
          </h3>
          {loading && <div className="consulta-loading">Cargando gráficas…</div>}
          {!loading && labels.length > 0 && (
            // desplazar un poco a la izquierda la gráfica
            <div style={{ marginLeft: -14, paddingRight: 6 }}>
              <ChartBar labels={labels} counts={counts} height={380} />
            </div>
          )}
          {!loading && labels.length === 0 && <div style={{ color: '#6b6b6b' }}>Sin datos para mostrar.</div>}
        </aside>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<ConsultaGlobal />);
