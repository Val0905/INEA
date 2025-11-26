// Estado global mínimo (sin shim ni buffers en memoria)
// ...existing code (no borres tus imports/eventos previos)...

// Bootstrap UI: insertar barra bajo el h3 del panel derecho, con fallback de contenedor
document.addEventListener('DOMContentLoaded', function () {
  setupUploadUI();
});

function setupUploadUI(){
  const target = document.getElementById('app') || document.getElementById('root') || document.body;
  if (!target) return;

  const tryRender = () => {
    const detail = document.querySelector('.menu-detail');
    const title = detail?.querySelector('h3');
    // Evitar duplicado o insertar mientras hay loader
    if (detail && title && !detail.querySelector('.upload-bar.inline-detail') && !detail.querySelector('.upload-loading')) {
      const el = document.createElement('div');
      el.className = 'upload-bar inline-detail';
      el.innerHTML = `
        <span class="upload-title">Subir archivos</span>
        <label class="upload-control">
          <input type="file" id="fileInputDetail" accept=".xlsx" multiple />
          <span class="upload-button">Elegir</span>
        </label>
        <span id="fileStatusDetail" class="upload-status"></span>
      `;
      title.insertAdjacentElement('afterend', el);
      const input = el.querySelector('#fileInputDetail');
      const statusEl = el.querySelector('#fileStatusDetail');
      input.addEventListener('change', handleFiles(statusEl, input));
    }
  };

  // Intento inmediato (por si ya está renderizado)
  tryRender();

  // Observar cambios del árbol para insertar cuando aparezca .menu-detail
  const observer = new MutationObserver(() => tryRender());
  observer.observe(target, { childList: true, subtree: true });
}

// Bases de API: 1) mismo origen, 2) valor configurado, 3) localhost:3030
const __CONFIG_BASE__ = (typeof window !== 'undefined' && window.__UPLOAD_API__) || '';
const __FALLBACK_BASE__ = 'http://localhost:3030';

// Subir archivos al backend probando varias bases sin /health
async function saveFilesToServer(files){
  const candidates = ['', __CONFIG_BASE__, __FALLBACK_BASE__]
    .filter((v, i, a) => v !== undefined && a.indexOf(v) === i);

  let lastErr = null;
  for (const base of candidates) {
    try {
      const filesSaved = await uploadToBase(base, files);
      return filesSaved; // éxito
    } catch (e) {
      lastErr = e;
      // intenta siguiente base
    }
  }
  throw lastErr || new Error('No se pudo contactar al backend');
}

// Intenta subir a una base concreta
async function uploadToBase(base, files){
  const url = (base || '') + '/upload';
  const fd = new FormData();
  files.forEach(f => fd.append('files', f, f.name));
  const res = await fetch(url, { method: 'POST', body: fd }).catch(err => { throw normalizeNetErr(err); });
  if (!res.ok) {
    const body = await safeText(res);
    // Manejo específico de límite de tamaño
    if (res.status === 413 || /File too large/i.test(body)) {
      throw new Error('Archivo demasiado grande. Límite del servidor: 200 MB por archivo.');
    }
    throw new Error(`Upload failed ${res.status} ${res.statusText} - ${body || 'sin detalle'} (${url})`);
  }
  const json = await res.json().catch(() => ({}));
  if (!json || json.ok !== true || !Array.isArray(json.files) || json.files.length < 2) {
    throw new Error(`Respuesta inválida del servidor (${url})`);
  }
  return json.files; // rutas tipo "XLSX/ATNYSEG_....xlsx"
}

function normalizeNetErr(err){
  if (err && err.name === 'TypeError') return new Error('Failed to fetch (CORS/servidor no disponible)');
  return err || new Error('Error de red');
}
async function safeText(res){ try { return await res.text(); } catch { return ''; } }

// Validaciones + animación + subida al servidor (sin shim)
function handleFiles(statusEl, inputEl) {
  return function (e) {
    const files = Array.from(e.target.files || []);
    // Validar cantidad exacta
    if (files.length !== 2) {
      alert('Debes seleccionar 2 archivos.');
      if (inputEl) inputEl.value = '';
      return;
    }
    // Validar extensión .xlsx
    if (!files.every(f => /\.(xlsx)$/i.test(f.name))) {
      alert('Solo se permiten archivos .xlsx.');
      if (inputEl) inputEl.value = '';
      return;
    }
    // Validar prefijos requeridos
    const names = files.map(f => f.name || '');
    const hasATNYSEG = names.some(n => n.startsWith('ATNYSEG'));
    const hasSIGASTI = names.some(n => n.startsWith('SIGASTI'));
    if (!(hasATNYSEG && hasSIGASTI)) {
      alert('Los archivos deben iniciar con ATNYSEG y SIGASTI (en cualquier orden).');
      if (inputEl) inputEl.value = '';
      return;
    }

    // Ocultar barra y mostrar animación de carga
    const bar = inputEl.closest('.upload-bar.inline-detail');
    if (bar && !bar.classList.contains('hidden')) {
      bar.classList.add('hidden');
      const loading = document.createElement('div');
      loading.className = 'upload-loading';
      loading.innerHTML = `
        <div class="spinner" aria-hidden="true"></div>
        <span class="upload-msg">Cargando...</span>
      `;
      bar.parentNode.insertBefore(loading, bar.nextSibling);
    }
    const loadingEl = bar?.parentNode.querySelector('.upload-loading');

    // Subir originales al servidor y ocultar loader al terminar
    (async () => {
      try {
        const saved = await saveFilesToServer(files);
        if (inputEl) inputEl.value = '';
        // Notificar a la app que ya están disponibles en /XLSX
        try { window.dispatchEvent(new CustomEvent('excel:filesSaved', { detail: { files: saved }})); } catch(_e){}
      } catch (err) {
        console.error('Error subiendo archivos:', err);
        const msg = /demasiado grande|413/.test(err.message)
          ? 'Archivo demasiado grande. Reduce el tamaño o solicita aumentar el límite en el servidor.'
          : `No se pudieron guardar los archivos en el servidor.\nDetalle: ${err.message}\n- ¿Backend activo y CORS correcto?\n- ¿Permisos de escritura en /XLSX?`;
        alert(msg);
        if (bar) bar.classList.remove('hidden');
      } finally {
        if (loadingEl) {
          loadingEl.classList.add('done');
          setTimeout(() => loadingEl.remove(), 500);
        }
      }
    })();
  };
}

// Bootstrap: inserción del UI de subida (sin cambios fuera de esto)
// document.addEventListener('DOMContentLoaded', ...)  // ...existing code...

// Nota: en Render, saveFilesToServer probará '' (same-origin) y funcionará con /upload del server.js.
// Si despliegas backend separado, define window.__UPLOAD_API__ en HTML antes de cargar este script.
