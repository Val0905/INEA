const { useEffect, useState } = React;

function App() {
  useEffect(() => {
    const splash = document.getElementById('splash');
    const app = document.getElementById('app');
    // dar tiempo a montar y luego mostrar contenido
    requestAnimationFrame(() => {
      if (splash) splash.classList.add('hidden');
      if (app) app.classList.add('visible');
    });

    // Prefetch inicial (calienta caché del navegador)
    const files = [
      './XLSX/ATNYSEG_150925.xlsx',
      './XLSX/SIGASTI_150925.xlsx'
    ];
    files.forEach(u => {
      fetch(u, { cache: 'reload' }).catch(() => {});
    });
    // Intento opcional de actualización vía servicio Node (si lo levantaste con START_SERVER)
    fetch('http://localhost:3030/update?auto=1', { method: 'GET' }).catch(() => {});
  }, []);

  const items = [
    '1 Amecameca',
    '3 Atizapán',
    '4 Cuautitlán',
    '5 Chalco',
    '6 Ecatepec',
    '9 Los Reyes',
    '10 Naucalpan',
    '11 Nezahualcóyotl',
    '12 Otumba',
    '15 Texcoco',
    '16 Tlalnepantla',
    '19 Zumpango',
  ];
  const mid = Math.ceil(items.length / 2);
  const col1 = items.slice(0, mid);
  const col2 = items.slice(mid);
  const [selected, setSelected] = useState(null);
  const [module, setModule] = useState(null); // null | 'aten' | 'sigasti'

  const parseRegion = (label) => {
    const str = String(label || '').trim();
    const m = str.match(/^(\d{1,3})\s+(.+)$/);
    if (m) return { code: m[1].trim(), name: m[2].trim() };
    const digits = (str.match(/\d+/)?.[0] || '').trim();
    const name = str.replace(/^\d+\s*/, '').trim();
    return { code: digits, name };
  };

  function fetchExcelBuffer(filename) {
    // Si el usuario subió el archivo, úsalo
    if (window.__EXCEL_FILES__ && window.__EXCEL_FILES__[filename]) {
      return Promise.resolve(window.__EXCEL_FILES__[filename]);
    }
    // Si no, intenta fetch normal
    return fetch('./XLSX/' + filename).then(r => r.arrayBuffer());
  }

  // Prefetch del Excel al seleccionar una región (calienta la caché HTTP)
  useEffect(() => {
    if (!selected) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        await fetchExcelBuffer('ATNYSEG_150925.xlsx', {
          signal: ctrl.signal,
          cache: 'force-cache'
        });
        // Prefetch también SIGASTI al elegir región
        await fetchExcelBuffer('SIGASTI_150925.xlsx', { cache: 'force-cache' });
      } catch {}
    })();
    return () => ctrl.abort();
  }, [selected]);

  const navigateTo = (page, extra = {}) => {
    if (!selected) return;
    const { code, name } = parseRegion(selected);
    const qs = new URLSearchParams({ regionCode: code, regionName: name, strict: '1', ...extra });
    window.location.href = `./HTML/${page}?${qs.toString()}`;
  };

  return (
    <div className="main-container">
      <nav className="menu" aria-label="Menú principal">
        <header className="menu-header">
          <h2>Coordinación Regional Del Valle de México</h2>
          <img className="instituto-logo" src="/IMG/Logo.png" alt="Instituto" />
        </header>

        <div className="menu-divider" />

        <div className="menu-content">
          <div className="menu-columns">
            <div className="col">
              {col1.map((label) => (
                <button
                  type="button"
                  key={label}
                  className="menu-item"
                  onClick={() => { setSelected(label); setModule(null); }} // reinicia paso intermedio
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="col">
              {col2.map((label) => (
                <button
                  type="button"
                  key={label}
                  className="menu-item"
                  onClick={() => { setSelected(label); setModule(null); }} // reinicia paso intermedio
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <aside className="menu-detail" aria-live="polite">
            <h3>{selected || 'Selecciona una opción'}</h3>

            {selected && (
              <div className="menu-actions">
                {!module && (
                  <>
                    <button
                      type="button"
                      className="action-btn primary"
                      onClick={() => setModule('aten')}
                    >
                      Atención y Seguimiento
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      onClick={() => setModule('sigasti')}
                    >
                      SIGASTI
                    </button>
                  </>
                )}

                {module === 'aten' && (
                  <>
                    <button
                      type="button"
                      className="action-btn primary"
                      onClick={() => navigateTo('consulta-individual.html')}
                    >
                      Consulta individual
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      onClick={() => navigateTo('consulta-global.html')}
                    >
                      Consulta Global
                    </button>
                  </>
                )}

                {module === 'sigasti' && (
                  <>
                    <button
                      type="button"
                      className="action-btn primary"
                      onClick={() => navigateTo('SIGASTI-individual.html', { module: 'sigasti' })}
                    >
                      Consulta individual
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      onClick={() => navigateTo('SIGASTI-global.html', { module: 'sigasti' })}
                    >
                      Consulta Global
                    </button>
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      </nav>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(<App />);
