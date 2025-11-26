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
      if(!dataCache || !dataCache.length){ self.postMessage({type:'stats', emitido:0, entregado:0, cancelado:0, total:0}); return; }

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

      const wantCode = norm(regionCode);
      const wantName = fold(regionName);

      let emitido=0, entregado=0, cancelado=0, totalFiltrados=0;

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
      }

      self.postMessage({type:'stats', emitido, entregado, cancelado, total: totalFiltrados});
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

function SigastiGlobal(){
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [stats,setStats]=useState({emitido:0,entregado:0,cancelado:0,total:0});
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
      const {type,message,emitido,entregado,cancelado,total}=ev.data||{};
      if(type==='ready') return;
      if(type==='stats'){
        setLoading(false);
        setError('');
        setStats({emitido,entregado,cancelado,total});
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
              <ChartBar labels={labels} data={data} height={360} />
            </div>
          )}
          {!loading && stats.total===0 && !error && <div style={{color:'#6b6b6b'}}>Sin datos para mostrar.</div>}
        </aside>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<SigastiGlobal />);
