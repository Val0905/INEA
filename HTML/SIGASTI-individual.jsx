const { useState, useEffect, useRef } = React;

// Worker actualizado: filtra por región y RFC
const WORKER_SRC = `
  let dataCache = null;
  const norm = v => String(v ?? '').trim();
  const fold = s => norm(s).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');

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

  self.onmessage = async (e) => {
    const { type, excelUrl, rfc, regionCode, regionName } = e.data || {};
    try{
      if (type === 'warmup'){
        await ensureData(excelUrl);
        self.postMessage({ type: 'ready' });
        return;
      }
      if (type !== 'search') return;

      await ensureData(excelUrl);
      if (!dataCache || !dataCache.length){
        self.postMessage({ type:'result', row: null });
        return;
      }

      const sample = dataCache[0] || {};
      const czCodeKey = ['iCveCZ','ICveCZ'].find(k => Object.prototype.hasOwnProperty.call(sample, k));
      const czNameKey = ['cNombreCZ','CNombreCZ','cDesCZ','CDesCZ'].find(k => Object.prototype.hasOwnProperty.call(sample, k));
      const rfcKey = ['cRFE','CRFE','RFC','cRfc'].find(k => Object.prototype.hasOwnProperty.call(sample, k)) || 'cRFE';

      const wantCode = norm(regionCode);
      const wantName = fold(regionName);
      const wantRFC  = norm(rfc).toUpperCase();

      const found = dataCache.find(r => {
        if ((wantCode || wantName) && (czCodeKey || czNameKey)){
          const rowCode = czCodeKey ? norm(r[czCodeKey]) : '';
          const rowName = czNameKey ? fold(r[czNameKey]) : '';
          if (wantCode && rowCode !== wantCode) return false;
          if (wantName && rowName && rowName !== wantName) return false;
        }
        const rowRFC = norm(r[rfcKey]).toUpperCase();
        return rowRFC === wantRFC;
      }) || null;

      self.postMessage({ type:'result', row: found });
    }catch(err){
      self.postMessage({ type:'error', message: err.message || 'Error al procesar el archivo.' });
    }
  };
`;

function SIGASTIIndividual(){
  const [rfc, setRfc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [row, setRow] = useState(null);

  const EXCEL_URL = '../XLSX/SIGASTI_150925.xlsx';

  const DISPLAY_FIELDS = [
    { label: 'Paterno', key: 'cPaterno' },
    { label: 'Materno', key: 'cMaterno' },
    { label: 'Nombre', key: 'cNombre' },
    { label: 'Clave y Nombre Coordinación de Zona', key: 'coordNombreCZ' },
    { label: 'Acreditó', key: 'Acreditó' },
    { label: 'Nivel', key: 'cNivel' },
    { label: 'Aliado', key: 'cAliado' },
    { label: 'Nombre sede', key: 'cNombreSede' },
    { label: 'Tipo Examen', key: 'cTipoExamen' },
    { label: 'Aliado Otro', key: 'cAliadoOtro' },
    { label: 'Fecha Conclusión', key: 'fConclusion' },
    { label: 'Fecha Creación Certificado', key: 'fCreacionCertificado' },
    { label: 'Clave Grupo subproyecto', key: 'icvegposub' },
    { label: 'Clave y Descripción Subproyecto', key: 'subproyectoCombo' },
    { label: 'Clave y Descripción Dependencia', key: 'dependenciaCombo' },
  ];

  const DATE_KEYS = new Set(['fConclusion','fCreacionCertificado']);
  const normalize = v => String(v ?? '').trim().replace(/\.0$/, '');
  const pad2 = n => String(n).padStart(2,'0');
  const toDateStr = d => `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
  function formatDate(value){
    if (value == null || value === '') return '';
    if (typeof value === 'number'){
      const ms = Math.round((value - 25569) * 86400 * 1000);
      const d = new Date(ms); return isNaN(d)?normalize(value):toDateStr(d);
    }
    const s = String(value).trim();
    if (/^\d+(\.\d+)?$/.test(s)){
      const num = Number(s); const ms = Math.round((num - 25569)*86400*1000);
      const d = new Date(ms); if(!isNaN(d)) return toDateStr(d);
    }
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m){
      const y = m[3].length===2 ? Number(`20${m[3]}`):Number(m[3]);
      const d = new Date(y, Number(m[2])-1, Number(m[1]));
      return isNaN(d)?s:toDateStr(d);
    }
    const d = new Date(s); return isNaN(d)?s:toDateStr(d);
  }

  const workerRef = useRef(null);
  const workerUrlRef = useRef('');
  const regionRef = useRef({ code:'', name:'' });

  useEffect(() => {
    // región desde querystring
    const qs = new URLSearchParams(window.location.search);
    regionRef.current = {
      code: String(qs.get('regionCode') || '').trim(),
      name: String(qs.get('regionName') || '').trim()
    };

    // crear worker
    const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    workerRef.current = w;
    workerUrlRef.current = url;

    w.onmessage = (ev) => {
      const { type, row: result, message } = ev.data || {};
      if (type === 'result'){
        setLoading(false);
        if (!result){
          setRow(null);
          setError('No se encontró un registro con ese RFC en la coordinación seleccionada.');
          return;
        }
        const mapped = {};
        DISPLAY_FIELDS.forEach(({ key }) => {
          if (key === 'coordNombreCZ') {
            const clave = normalize(result['iCveCZ']);
            const nombre = normalize(result['cNombreCZ'] || result['cDesCZ']);
            mapped[key] = [clave, nombre].filter(Boolean).join(', ');
          } else if (key === 'subproyectoCombo') {
            const clave = normalize(result['icvesubproyecto']);
            const des   = normalize(result['cdessubproyecto']);
            mapped[key] = [clave, des].filter(Boolean).join(', ');
          } else if (key === 'dependenciaCombo') {
            const clave = normalize(result['icvedepend']);
            const des   = normalize(result['cdesdependencia']);
            mapped[key] = [clave, des].filter(Boolean).join(', ');
          } else {
            const raw = result[key];
            mapped[key] = DATE_KEYS.has(key) ? formatDate(raw) : normalize(raw);
          }
        });
        setRow(mapped);
        setError('');
      } else if (type === 'error'){
        setLoading(false);
        setError(message || 'Error al procesar el archivo.');
      }
    };

    // warmup
    try{
      const excelAbs = new URL(EXCEL_URL, window.location.href).toString();
      w.postMessage({ type:'warmup', excelUrl: excelAbs });
    }catch{}

    return () => {
      if (workerRef.current) workerRef.current.terminate();
      if (workerUrlRef.current) URL.revokeObjectURL(workerUrlRef.current);
    };
  }, []);

  function handleSearch(e){
    e.preventDefault();
    setError(''); setRow(null);
    const r = String(rfc).trim().toUpperCase();
    if (!r){ setError('Ingresa el RFC.'); return; }
    if (!workerRef.current){ setError('No se pudo iniciar la búsqueda.'); return; }

    // URL absoluta del Excel
    let excelAbs = '';
    try{ excelAbs = new URL(EXCEL_URL, window.location.href).toString(); }
    catch{ setError('No se pudo resolver la ruta del Excel.'); return; }

    setLoading(true);
    workerRef.current.postMessage({
      type:'search',
      excelUrl: excelAbs,
      rfc: r,
      regionCode: regionRef.current.code,
      regionName: regionRef.current.name
    });
  }

  return (
    <div className="consulta-page">
      <div className="consulta-header">
        <h2>SIGASTI - Consulta individual</h2>
        <img className="instituto-logo" src="/IMG/Logo.png" alt="Instituto" />
      </div>
      <div className="consulta-divider"></div>

      <div className="consulta-grid">
        <section className="consulta-form">
          <form onSubmit={handleSearch}>
            <label>RFC</label>
            <input
              type="text"
              value={rfc}
              onChange={e=>setRfc(e.target.value)}
              placeholder="Ingrese el RFC"
              disabled={loading}
              required
            />
            <div className="consulta-actions">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Buscando...' : 'Buscar'}
              </button>
              <button type="button" className="btn" disabled={loading}
                onClick={()=>{ setRfc(''); setRow(null); setError(''); }}>
                Limpiar
              </button>
            </div>
          </form>
          {error && <div className="consulta-error">{error}</div>}
          {loading && !error && <div className="consulta-loading">Procesando archivo…</div>}
        </section>

        <aside className="consulta-result" aria-live="polite">
          <h3>Resultado</h3>
          {row ? (
            <table>
              <tbody>
                {DISPLAY_FIELDS.map(({ label, key }) => (
                  <tr key={key}>
                    <th>{label}</th>
                    <td>{row[key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color:'#6b6b6b' }}>Sin datos para mostrar.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

// Montaje
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<SIGASTIIndividual />);
