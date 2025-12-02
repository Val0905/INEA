const { useState, useEffect, useRef } = React;

const WORKER_SRC = `
  let dataCache = null;
  const norm = v => String(v ?? '').trim();
  const fold = s => norm(s).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
  async function ensureData(excelUrl){
    if (dataCache) return;
    const res = await fetch(excelUrl);
    if(!res.ok) throw new Error('No se pudo cargar el Excel: '+res.status);
    const ab = await res.arrayBuffer();
    importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const wb = XLSX.read(ab,{type:'array',dense:true});
    const ws = wb.Sheets[wb.SheetNames[0]];
    dataCache = XLSX.utils.sheet_to_json(ws,{defval:''});
  }
  self.onmessage = async (e)=>{
    const { type, excelUrl, regionCode, regionName } = e.data||{};
    try{
      if(type==='warmup'){ await ensureData(excelUrl); self.postMessage({type:'ready'}); return; }
      if(type!=='aggregate') return;
      await ensureData(excelUrl);
      if(!dataCache || !dataCache.length){ self.postMessage({type:'stats', emitido:0, entregado:0, cancelado:0, total:0, yearlyStats:{}}); return; }

      const sample = dataCache[0]||{};
      const czCodeKey = ['iCveCZ','ICveCZ'].find(k=>Object.prototype.hasOwnProperty.call(sample,k));
      const czNameKey = ['cNombreCZ','CNombreCZ','cDesCZ','CDesCZ'].find(k=>Object.prototype.hasOwnProperty.call(sample,k));
      const statusKeysGuess = [
        'cEstatusCertificado','EstatusCertificado','estatusCertificado',
        'cEstatus','Estatus','Status','cStatus','cEstatusDoc','Estatus_Doc',
        'Acreditó','cAcredito'
      ];
      const statusKey = statusKeysGuess.find(k=>Object.prototype.hasOwnProperty.call(sample,k));
      if(!statusKey){ self.postMessage({type:'error', message:'No se encontró columna de estatus (Emitido/Entregado/Cancelado).'}); return; }

      const elaboracionKey = ['fElaboracion','FElaboracion'].find(k=>Object.prototype.hasOwnProperty.call(sample,k));
      const emisionKey = ['fEmisionCertificado','FEmisionCertificado'].find(k=>Object.prototype.hasOwnProperty.call(sample,k));
      const entregaKey = ['fEntregaCertificado','FEntregaCertificado'].find(k=>Object.prototype.hasOwnProperty.call(sample,k));

      const wantCode = norm(regionCode);
      const wantName = fold(regionName);

      let emitido=0, entregado=0, cancelado=0, totalFiltrados=0;
      const yearlyStats = {};
      const blankCounts = { elaboracion: 0, emision: 0, entrega: 0 };

      for(const r of dataCache){
        if((wantCode || wantName) && (czCodeKey || czNameKey)){
          const rowCode = czCodeKey ? norm(r[czCodeKey]) : '';
          const rowName = czNameKey ? fold(r[czNameKey]) : '';
          if(wantCode && rowCode !== wantCode) continue;
          if(wantName && rowName && rowName !== wantName) continue;
        }
        const rawStatus = norm(r[statusKey]).toUpperCase();
        if(!rawStatus) continue;
        totalFiltrados++;
        if(rawStatus === 'EMITIDO') emitido++;
        else if(rawStatus === 'ENTREGADO') entregado++;
        else if(rawStatus === 'CANCELADO') cancelado++;

        const getYear = (val) => {
          if(!val) return null;
          try {
            if(typeof val === 'number' && val > 1){ // Excel date number
              return XLSX.SSF.parse_date_code(val).y;
            }
            if(typeof val === 'string'){
              const d = new Date(val);
              if(!isNaN(d)) return d.getFullYear();
            }
          } catch(err){}
          return null;
        };

        const yearElaboracion = elaboracionKey ? getYear(r[elaboracionKey]) : null;
        const yearEmision = emisionKey ? getYear(r[emisionKey]) : null;
        const yearEntrega = entregaKey ? getYear(r[entregaKey]) : null;

        if(elaboracionKey && !r[elaboracionKey]) blankCounts.elaboracion++;
        if(emisionKey && !r[emisionKey]) blankCounts.emision++;
        if(entregaKey && !r[entregaKey]) blankCounts.entrega++;

        const updateYear = (year, key) => {
          if(!year || year < 2017) return;
          if(!yearlyStats[year]) yearlyStats[year] = { elaboracion: 0, emision: 0, entrega: 0 };
          yearlyStats[year][key]++;
        };

        updateYear(yearElaboracion, 'elaboracion');
        updateYear(yearEmision, 'emision');
        updateYear(yearEntrega, 'entrega');
      }

      self.postMessage({type:'stats', emitido, entregado, cancelado, total: totalFiltrados, yearlyStats, blankCounts});
    }catch(err){
      self.postMessage({type:'error', message: err.message || 'Error al procesar el archivo.'});
    }
  };
`;

function ChartBar({ labels, data, height=360 }){
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  useEffect(()=>{
    if(!window.Chart || !canvasRef.current) return;
    if(Chart.registerables){ try{ Chart.register(...Chart.registerables); }catch{} }
    const ctx = canvasRef.current.getContext('2d');
    if(chartRef.current){
      chartRef.current.data.labels = labels;
      chartRef.current.data.datasets[0].data = data;
      chartRef.current.update();
    }else{
      chartRef.current = new Chart(ctx,{
        type:'bar',
        data:{
          labels,
          datasets:[{
            label:'Certificados',
            data,
            backgroundColor:['#2196F3','#4CAF50','#9F2241'],
            borderWidth:1
          }]
        },
        options:{
          responsive:true,
            maintainAspectRatio:false,
            plugins:{ legend:{ display:false }, tooltip:{ enabled:true } },
            scales:{ y:{ beginAtZero:true } }
        }
      });
    }
    return ()=>{ if(chartRef.current){ chartRef.current.destroy(); chartRef.current=null; } };
  },[labels,data]);
  return <div style={{height}}><canvas ref={canvasRef}/></div>;
}

function YearlyStatsTable({ stats, blankCounts }) {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = 2017; y <= currentYear; y++) {
    years.push(y);
  }

  const hasData = Object.keys(stats).length > 0;

  if (!hasData) {
    return null;
  }

  const totals = { elaboracion: 0, emision: 0, entrega: 0, totalAnual: 0 };

  const yearlyData = years.map(year => {
    const yearStats = stats[year] || { elaboracion: 0, emision: 0, entrega: 0 };
    const totalAnual = yearStats.elaboracion + yearStats.emision + yearStats.entrega;
    totals.elaboracion += yearStats.elaboracion;
    totals.emision += yearStats.emision;
    totals.entrega += yearStats.entrega;
    totals.totalAnual += totalAnual;
    return { year, ...yearStats, totalAnual };
  });

  return (
    <div className="yearly-stats-container">
      <h3 style={{textAlign:'center', marginTop:0, marginBottom: '20px'}}>Certificados por Año</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
        <thead>
          <tr style={{ backgroundColor: '#9F2241', color: 'white' }}>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Año</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>Elaboración</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>Emisión</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>Entrega</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>Total por Año</th>
          </tr>
        </thead>
        <tbody>
          {yearlyData.map(({ year, elaboracion, emision, entrega, totalAnual }) => (
            <tr key={year}>
              <td style={{ padding: '8px', border: '1px solid #ddd', fontWeight: 'bold' }}>{year}</td>
              <td style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>{elaboracion}</td>
              <td style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>{emision}</td>
              <td style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>{entrega}</td>
              <td style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center', fontWeight: 'bold' }}>{totalAnual}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ backgroundColor: '#f2f2f2', fontWeight: 'bold' }}>
            <td style={{ padding: '10px', border: '1px solid #ddd' }}>Total General</td>
            <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>{totals.elaboracion}</td>
            <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}></td>
            <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}></td>
            <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}></td>
          </tr>
          <tr style={{ backgroundColor: '#f2f2f2', fontWeight: 'bold' }}>
            <td style={{ padding: '10px', border: '1px solid #ddd' }}>Total en blanco</td>
            <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>{blankCounts.elaboracion}</td>
            <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>{blankCounts.emision}</td>
            <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>{blankCounts.entrega}</td>
            <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SigastiGlobal(){
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [stats,setStats]=useState({emitido:0,entregado:0,cancelado:0,total:0});
  const [yearlyStats, setYearlyStats] = useState({});
  const [blankCounts, setBlankCounts] = useState({ elaboracion: 0, emision: 0, entrega: 0 });
  const workerRef = useRef(null);
  const workerUrlRef = useRef('');
  const regionRef = useRef({code:'',name:''});
  const EXCEL_URL='../XLSX/SIGASTI_150925.xlsx';

  useEffect(()=>{
    const qs = new URLSearchParams(window.location.search);
    regionRef.current = {
      code:String(qs.get('regionCode')||'').trim(),
      name:String(qs.get('regionName')||'').trim()
    };
    const blob = new Blob([WORKER_SRC],{type:'application/javascript'});
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    workerRef.current=w;
    workerUrlRef.current=url;
    w.onmessage = ev=>{
      const {type,message,emitido,entregado,cancelado,total, yearlyStats, blankCounts}=ev.data||{};
      if(type==='ready') return;
      if(type==='stats'){
        setLoading(false);
        setError('');
        setStats({emitido,entregado,cancelado,total});
        setYearlyStats(yearlyStats || {});
        setBlankCounts(blankCounts || { elaboracion: 0, emision: 0, entrega: 0 });
      }else if(type==='error'){
        setLoading(false);
        setError(message||'Error.');
      }
    };
    try{
      const abs = new URL(EXCEL_URL, window.location.href).toString();
      w.postMessage({type:'warmup', excelUrl:abs});
    }catch{}
    return ()=>{
      if(workerRef.current) workerRef.current.terminate();
      if(workerUrlRef.current) URL.revokeObjectURL(workerUrlRef.current);
    };
  },[]);

  function handleConsultar(){
    setError('');
    setStats({emitido:0,entregado:0,cancelado:0,total:0});
    setYearlyStats({});
    setBlankCounts({ elaboracion: 0, emision: 0, entrega: 0 });
    if(!workerRef.current){ setError('Worker no disponible.'); return; }
    let abs='';
    try{ abs=new URL(EXCEL_URL,window.location.href).toString(); }
    catch{ setError('No se pudo resolver ruta de Excel.'); return; }
    setLoading(true);
    workerRef.current.postMessage({
      type:'aggregate',
      excelUrl:abs,
      regionCode:regionRef.current.code,
      regionName:regionRef.current.name
    });
  }

  const labels=['Emitido','Entregado','Cancelado'];
  const data=[stats.emitido,stats.entregado,stats.cancelado];

  return (
    <div>
      <div className="consulta-grid">
        <section className="consulta-form">
          <form onSubmit={e=>{e.preventDefault(); handleConsultar();}}>
            <label>Acción</label>
            <div className="consulta-actions">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Consultando…':'Consultar certificados'}
              </button>
            </div>
          </form>
          {(regionRef.current.code || regionRef.current.name) && (
            <div style={{marginTop:10,fontWeight:800,color:'#9F2241'}}>
              Zona: {regionRef.current.code}{regionRef.current.name?` - ${regionRef.current.name}`:''}
            </div>
          )}
          {error && <div className="consulta-error">{error}</div>}
        </section>
        <aside className="consulta-result" aria-live="polite">
          <div className="result-content">
            <h3>Certificados por estatus</h3>
            <div className="totales-cert">
              <div><b>Emitido:</b> {stats.emitido}</div>
              <div><b>Entregado:</b> {stats.entregado}</div>
              <div><b>Cancelado:</b> {stats.cancelado}</div>
              <hr style={{border:'0',borderTop:'1px solid #eee',margin:'6px 0'}}/>
              <div><b>Total filtrados:</b> {stats.total}</div>
            </div>
            {loading && <div className="consulta-loading">Cargando…</div>}
            {!loading && stats.total>0 && (
              <div className="chart-center">
                <ChartBar labels={labels} data={data} height={280} />
              </div>
            )}
            {!loading && stats.total===0 && !error && <div style={{color:'#6b6b6b'}}>Sin datos para mostrar.</div>}
          </div>
        </aside>
      </div>
      {!loading && stats.total > 0 && <YearlyStatsTable stats={yearlyStats} blankCounts={blankCounts} />}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<SigastiGlobal />);
