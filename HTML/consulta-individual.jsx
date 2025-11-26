const { useState, useEffect, useRef } = React;

// Worker: ahora busca por RFC (cRFE)
const WORKER_SRC = `
  let dataCache = null;
  const normalize = v => String(v ?? '').trim().replace(/\\\\.0$/, '');
  const stripZeros = v => String(v ?? '').trim().replace(/^0+/, '');
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
  self.onmessage = async (e) => {
    const { type, excelUrl, rfc, regionCode, regionName } = e.data || {};
    try {
      // warmup opcional para precargar el Excel
      if (type === 'warmup') {
        await ensureData(excelUrl);
        self.postMessage({ type: 'ready' });
        return;
      }
      if (type !== 'search') return;

      await ensureData(excelUrl);
      if (!dataCache || !dataCache.length) { self.postMessage({ type:'result', row: null }); return; }

      const sample = dataCache[0] || {};
      const codeKey = ['iCveCZ','ICveCZ'].find(k => Object.prototype.hasOwnProperty.call(sample, k));
      const nameKey = ['cDesCZ','CDesCZ'].find(k => Object.prototype.hasOwnProperty.call(sample, k));
      const rfcKey  = ['cRFE','CRFE','cRfc','RFC'].find(k => Object.prototype.hasOwnProperty.call(sample, k)) || 'cRFE';

      const wantCode = stripZeros(regionCode || '');
      const wantName = fold(regionName || '');
      const keyRFC = String(rfc || '').trim().toUpperCase();

      const found = dataCache.find(r => {
        if ((wantCode || wantName) && (codeKey || nameKey)) {
          const rowCode = codeKey ? stripZeros(r[codeKey]) : '';
          const rowName = nameKey ? fold(r[nameKey]) : '';
          if (wantCode && rowCode !== wantCode) return false;
          if (wantName && rowName && rowName !== wantName) return false;
        }
        const rowRFC = String(r[rfcKey] ?? '').trim().toUpperCase();
        return rowRFC === keyRFC;
      }) || null;

      self.postMessage({ type:'result', row: found });
    } catch (err) {
      self.postMessage({ type:'error', message: err.message || 'Error al procesar el archivo.' });
    }
  };
`;

function ConsultaIndividual() {
  const [rfc, setRfc] = useState(''); // antes id
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [row, setRow] = useState(null);

  const EXCEL_URL = '../XLSX/ATNYSEG_150925.xlsx';

  const DISPLAY_FIELDS = [
    { label: 'ID del educando', key: 'idEducando' },
    { label: 'Clave y Descripción coordinación', key: 'claveCoord' },
    { label: 'Clave RFE', key: 'cRFE' },
    { label: 'Apellido paterno Educando', key: 'cpaternoEdu' },
    { label: 'Apellido materno Educando', key: 'cmaternoEdu' },
    { label: 'Nombre Educando', key: 'cnombreEdu' },
    { label: 'Fecha de Nacimiento', key: 'fNacimiento' },
    { label: 'Colonia', key: 'cColonia' },
    { label: 'Clave y Descripción Municipio', key: 'claveMunicipio' },
    { label: 'Clave y SubProyecto', key: 'claveSubProyecto' },
    { label: 'Clave y Dependencia', key: 'claveDependencia' },
    { label: 'Clave y Descripción Situación', key: 'claveSituacion' },
    { label: 'Fecha Situación', key: 'fSituacion' },
    { label: 'Fecha último Movimiento', key: 'fUltimoMovimiento' },
    { label: 'Etapa', key: 'cIdenEtapaEB' },
    { label: 'Clave y Modelo Educativo', key: 'claveModelo' },
    { label: 'No.Modulos Básicos Faltantes', key: 'iNumModBasFaltantes' },
    { label: 'No.Modulos Diversificados Faltantes', key: 'iNumModDivFaltantes' },
    { label: 'Clave Modulo 1', key: 'iCveModulo1' },
    { label: 'Nomeclatura Modulo 1', key: 'cIdenModulo1' },
    { label: 'Fecha Inicio Atención 1', key: 'fIniAten1' },
    { label: 'Clave Modalidad Estudio 1', key: 'iCveModalEstu1' },
    { label: 'Fecha Registro Circulo de Estudio', key: 'fRegistro' },
    { label: 'Clave y Descripción Unidad Operativa', key: 'claveUnidadOperativa' }
  ];

  const normalize = (v) => String(v ?? '').trim().replace(/\.0$/, '');

  // === Formateo de fechas: dd/mm/aaaa ===
  const DATE_KEYS = new Set([
    'fNacimiento',
    'fSituacion',
    'fUltimoMovimiento',
    'fIniAten1',
    'fRegistro',
  ]);
  const pad2 = (n) => String(n).padStart(2, '0');
  const toDateStr = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  function formatDate(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'number') {
      const ms = Math.round((value - 25569) * 86400 * 1000); // serial Excel -> ms
      const d = new Date(ms);
      return isNaN(d) ? normalize(value) : toDateStr(d);
    }
    const str = String(value).trim();
    if (!str) return '';
    // Serial Excel como string
    if (/^\d+(\.\d+)?$/.test(str)) {
      const num = Number(str);
      if (!Number.isNaN(num)) {
        const ms = Math.round((num - 25569) * 86400 * 1000);
        const d = new Date(ms);
        if (!isNaN(d)) return toDateStr(d);
      }
    }
    // dd/mm/aaaa o dd-mm-aaaa
    const m1 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m1) {
      const y = m1[3].length === 2 ? Number(`20${m1[3]}`) : Number(m1[3]);
      const d = new Date(y, Number(m1[2]) - 1, Number(m1[1]));
      return isNaN(d) ? str : toDateStr(d);
    }
    // ISO u otros parseables
    const d = new Date(str);
    return isNaN(d) ? str : toDateStr(d);
  }

  const workerRef = useRef(null);
  const workerUrlRef = useRef('');
  const regionRef = useRef({ code: '', name: '' });

  useEffect(() => {
    // leer región
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
      if (type === 'result') {
        setLoading(false);
        if (!result) {
          setRow(null);
          setError('No se encontró un educando con ese RFC en la región seleccionada.');
          return;
        }
        const mapped = {};
        DISPLAY_FIELDS.forEach(({ key }) => {
          if (key === 'claveCoord') {
            const cve = normalize(result['iCveCZ']);
            const des = normalize(result['cDesCZ']);
            mapped[key] = [cve, des].filter(Boolean).join(', ');
          } else if (key === 'claveMunicipio') {
            const cve = normalize(result['iCveMunicipio']);
            const des = normalize(result['cDesMunicipio']);
            mapped[key] = [cve, des].filter(Boolean).join(', ');
          } else if (key === 'claveSubProyecto') {
            const cve = normalize(result['iCveSubProyecto']);
            const sub = normalize(result['cIdenSubPro']);
            mapped[key] = [cve, sub].filter(Boolean).join(', ');
          } else if (key === 'claveDependencia') {
            const cve = normalize(result['iCveDepend']);
            const dep = normalize(result['cIdenDepen']);
            mapped[key] = [cve, dep].filter(Boolean).join(', ');
          } else if (key === 'claveSituacion') {
            const cve = normalize(result['iCveSituacion']);
            const des = normalize(result['cDesSituacion']);
            mapped[key] = [cve, des].filter(Boolean).join(', ');
          } else if (key === 'claveModelo') {
            const cve = normalize(result['iCveModelo']);
            const mod = normalize(result['cIdenModelo']);
            mapped[key] = [cve, mod].filter(Boolean).join(', ');
          } else if (key === 'claveUnidadOperativa') {
            const cve = normalize(result['iCveIE']);
            const des = normalize(result['cDesIE']);
            mapped[key] = [cve, des].filter(Boolean).join(', ');
          } else {
            // respeta formateo de fechas si aplica
            mapped[key] = (typeof DATE_KEYS !== 'undefined' && DATE_KEYS.has(key))
              ? formatDate(result[key])
              : String(result[key] ?? '').trim();
          }
        });
        setRow(mapped);
        setError('');
      } else if (type === 'error') {
        setLoading(false);
        setError(message || 'Error al procesar el archivo.');
      }
    };

    // warmup: precarga/parseo en segundo plano al montar
    try {
      const excelAbsUrl = new URL('../XLSX/ATNYSEG_150925.xlsx', window.location.href).toString();
      w.postMessage({ type: 'warmup', excelUrl: excelAbsUrl });
    } catch {}
    return () => {
      if (workerRef.current) workerRef.current.terminate();
      if (workerUrlRef.current) URL.revokeObjectURL(workerUrlRef.current);
    };
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setError('');
    setRow(null);
    const keyRFC = String(rfc || '').trim().toUpperCase();
    if (!keyRFC) return;
    if (!workerRef.current) { setError('No se pudo iniciar el lector.'); return; }

    // URL absoluta del Excel para el Worker
    let excelAbsUrl = '';
    try {
      excelAbsUrl = new URL(EXCEL_URL, window.location.href).toString();
    } catch {
      setError('No se pudo resolver la ruta del archivo Excel.');
      return;
    }

    setLoading(true);
    workerRef.current.postMessage({
      type: 'search',
      excelUrl: excelAbsUrl,
      rfc: keyRFC,
      regionCode: regionRef.current.code,
      regionName: regionRef.current.name
    });
  };

  return (
    <div className="consulta-page">
      <div className="consulta-header">
        <h2>Consulta individual</h2>
        <img className="instituto-logo" src="/IMG/Logo.png" alt="Instituto" />
      </div>
      <div className="consulta-divider"></div>

      <div className="consulta-grid">
        <section className="consulta-form">
          <form onSubmit={handleSearch}>
            <label>RFC (cRFE)</label>
            <input
              type="text"
              value={rfc}
              onChange={e => setRfc(e.target.value)}
              placeholder="Ingrese el RFC"
              required
              disabled={loading}
            />
            <div className="consulta-actions">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Buscando...' : 'Buscar'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => { setRfc(''); setRow(null); setError(''); }}
                disabled={loading}
              >
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
            <div style={{ color: '#6b6b6b' }}>Sin datos para mostrar.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

// Montaje del componente en #root (faltaba)
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<ConsultaIndividual />);
