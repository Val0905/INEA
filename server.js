// Servidor Express + Multer que guarda en Public/XLSX y expone /upload (y /health). Ejecuta desde la carpeta Public
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
// Render provee PORT; fallback a 3030 en local
const PORT = process.env.PORT || 3030;
// Sirve estáticos desde la carpeta Public
const PUBLIC_DIR = __dirname;
const XLSX_DIR = path.join(PUBLIC_DIR, 'XLSX');

// Asegurar carpeta destino
fs.mkdirSync(XLSX_DIR, { recursive: true });

// CORS (en producción puedes limitar a tu dominio)
app.use(cors());

// Servir estáticos
app.use(express.static(PUBLIC_DIR));

// Multer: solo .xlsx y límite alto (ajusta si necesitas)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, XLSX_DIR),
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const fileFilter = (_req, file, cb) => {
  if (/\.xlsx$/i.test(file.originalname)) cb(null, true);
  else cb(new Error('Solo .xlsx permitidos'));
};
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

// Upload: espera 2 archivos en el campo "files"
app.post('/upload', (req, res) => {
  upload.array('files', 2)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ ok: false, error: 'File too large' });
        }
        return res.status(400).json({ ok: false, error: err.message || 'Upload error' });
      }
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
    const files = (req.files || []).map(f => path.posix.join('XLSX', f.filename));
    if (files.length < 2) return res.status(400).json({ ok: false, error: 'Se requieren 2 archivos' });
    return res.json({ ok: true, files });
  });
});

// Escuchar en 0.0.0.0 para PaaS
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor activo en puerto ${PORT}`);
  console.log(`Guardando .xlsx en: ${XLSX_DIR}`);
});
