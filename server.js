const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
require('dotenv').config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_wasmer_cloud';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'barba99';

// Configurar límite elevado en el parser de JSON para recibir strings Base64 de imágenes
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Subida de imágenes en memoria RAM (evita usar el disco efímero de Render)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Límite de 10MB por archivo
});

// Helper para convertir archivo de Multer (buffer) a string Data URL Base64
const bufferToBase64 = (file) => {
  if (!file) return null;
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
};

// Conexión a MySQL (Lectura limpia desde process.env para evitar bloqueos de GitHub)
let db;

// Helper de migración: agrega columnas nuevas a tablas existentes sin romper la base actual
async function ensureColumn(table, column, definition) {
  try {
    const [cols] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
    if (cols.length === 0) {
      await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`Migración: columna añadida ${table}.${column}`);
    }
  } catch (err) {
    console.log(`(skip) ${table}.${column}: ${err.message}`);
  }
}

async function initDB() {
  try {
    const dbConfig = {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 25060,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10
    };
    // Solo usar SSL si NO es localhost (para poder probar en local sin certificados)
    if (process.env.DB_HOST && !['localhost', '127.0.0.1'].includes(process.env.DB_HOST)) {
      dbConfig.ssl = { rejectUnauthorized: false }; // Requerido para DigitalOcean
    }
    db = await mysql.createPool(dbConfig);

    // Tablas configuradas con LONGTEXT para almacenar imágenes en Base64
    await db.query(`
      CREATE TABLE IF NOT EXISTS businesses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        description TEXT,
        address VARCHAR(255) DEFAULT '',
        businessHours VARCHAR(255) DEFAULT '9:00 AM - 8:00 PM',
        mapUrl TEXT,
        facebookUrl TEXT,
        instagramUrl TEXT,
        tiktokUrl TEXT,
        themeColor VARCHAR(50) DEFAULT '#4f46e5',
        bannerImage LONGTEXT,
        logoImage LONGTEXT,
        visits INT DEFAULT 0,
        orders INT DEFAULT 0,
        isActive TINYINT DEFAULT 1,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        businessSlug VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(255) DEFAULT 'General',
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        image LONGTEXT,
        videoUrl TEXT,
        available TINYINT DEFAULT 1,
        featured TINYINT DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        businessSlug VARCHAR(255) NOT NULL,
        author VARCHAR(255) NOT NULL,
        text TEXT NOT NULL,
        rating INT DEFAULT 5,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ===== NUEVAS TABLAS (idempotentes) =====
    await db.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        businessSlug VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        date VARCHAR(20),
        time VARCHAR(20),
        guests INT DEFAULT 2,
        notes TEXT,
        status VARCHAR(20) DEFAULT 'pendiente',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        businessSlug VARCHAR(255) NOT NULL,
        code VARCHAR(50) NOT NULL,
        discountType VARCHAR(20) DEFAULT 'percent',
        discountValue DECIMAL(10,2) NOT NULL DEFAULT 10,
        active TINYINT DEFAULT 1,
        expiresAt DATE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        businessSlug VARCHAR(255) NOT NULL,
        customerName VARCHAR(255),
        phone VARCHAR(50),
        items TEXT,
        total DECIMAL(10,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'nuevo',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS business_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        businessSlug VARCHAR(255) NOT NULL,
        image LONGTEXT,
        caption VARCHAR(255) DEFAULT '',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS visits_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        businessSlug VARCHAR(255) NOT NULL,
        visitDate DATE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        businessSlug VARCHAR(255) NOT NULL,
        type VARCHAR(50) DEFAULT 'info',
        message VARCHAR(500),
        isRead TINYINT DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migraciones para bases de datos ya existentes (no rompen datos actuales)
    await ensureColumn('businesses', 'visits', 'INT DEFAULT 0');
    await ensureColumn('businesses', 'orders', 'INT DEFAULT 0');
    await ensureColumn('businesses', 'isActive', 'TINYINT DEFAULT 1');
    await ensureColumn('businesses', 'createdAt', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await ensureColumn('businesses', 'language', "VARCHAR(10) DEFAULT 'es'");
    await ensureColumn('businesses', 'currency', "VARCHAR(10) DEFAULT '$'");
    await ensureColumn('businesses', 'allowReservations', 'TINYINT DEFAULT 1');
    await ensureColumn('products', 'videoUrl', 'TEXT');
    await ensureColumn('products', 'available', 'TINYINT DEFAULT 1');
    await ensureColumn('products', 'featured', 'TINYINT DEFAULT 0');
    await ensureColumn('products', 'createdAt', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

    // Negocio precargado: Tacos El Jovenazo
    const [existing] = await db.query(`SELECT id FROM businesses WHERE slug = ? OR email = ?`, [
      'tacos-jovenazo',
      'barbanesta@gmail.com'
    ]);
    if (existing.length === 0) {
      const hashedPassword = await bcrypt.hash('ClaVe1234a', 10);
      await db.query(
        `INSERT INTO businesses (name, slug, email, password, phone, description) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          'Tacos El Jovenazo',
          'tacos-jovenazo',
          'barbanesta@gmail.com',
          hashedPassword,
          '+524771847322',
          'Los mejores tacos de la zona'
        ]
      );
      console.log('Negocio precargado: Tacos El Jovenazo (slug: tacos-jovenazo)');

      const sampleProducts = [
        ['Taco de Asada', '🌮 Tacos', 25.00, 'Taco de carne asada con cilantro y cebolla'],
        ['Taco de Pastor', '🌮 Tacos', 22.00, 'Taco al pastor con piña'],
        ['Taco de Suadero', '🌮 Tacos', 23.00, 'Suadero suave y jugoso'],
        ['Quesadilla', '🧀 Antojitos', 45.00, 'Quesadilla de queso con guisado a elegir'],
        ['Agua de Horchata', '🥤 Bebidas', 20.00, 'Agua fresca de horchata 500ml']
      ];
      for (const [name, category, price, description] of sampleProducts) {
        await db.query(
          `INSERT INTO products (businessSlug, name, category, price, description, image) VALUES (?, ?, ?, ?, ?, ?)`,
          ['tacos-jovenazo', name, category, price, description, '']
        );
      }
      console.log('Productos de ejemplo agregados para Tacos El Jovenazo');
    }

    console.log('Base de datos conectada correctamente');
  } catch (err) {
    console.error('Error al conectar la base de datos:', err);
  }
}

initDB().catch(console.error);

// Middleware Autenticación de Usuario
const authMiddleware = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    const verified = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Token inválido' });
  }
};

// Helper: estado abierto/cerrado a partir del horario "9:00 AM - 8:00 PM"
function getOpenStatus(businessHours) {
  if (!businessHours) return { open: true, label: '' };
  const m = businessHours.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return { open: true, label: '' };
  const toMin = (h, min, ap) => {
    let hh = parseInt(h);
    if (ap.toUpperCase() === 'PM' && hh !== 12) hh += 12;
    if (ap.toUpperCase() === 'AM' && hh === 12) hh = 0;
    return hh * 60 + parseInt(min);
  };
  const start = toMin(m[1], m[2], m[3]);
  const end = toMin(m[4], m[5], m[6]);
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const open = cur >= start && cur < end;
  return { open, label: open ? 'Abierto ahora' : 'Cerrado' };
}

// ==================== RUTAS API USUARIO ====================

app.post('/api/register', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada.' });

    const { name, slug, email, password, phone, description } = req.body;

    if (!name || !slug || !email || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    if (slug.length < 3) {
      return res.status(400).json({ error: 'El slug debe tener al menos 3 caracteres' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      `INSERT INTO businesses (name, slug, email, password, phone, description) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, slug, email, hashedPassword, phone || '', description || '']
    );

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error en /api/register:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'El slug o el email ya están registrados' });
    }
    res.status(500).json({ error: 'Error al registrar: ' + (err.message || 'desconocido') });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada.' });

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }

    const [rows] = await db.query(`SELECT * FROM businesses WHERE email = ?`, [email]);
    const business = rows[0];

    if (!business) return res.status(400).json({ error: 'Usuario no encontrado' });

    const validPass = await bcrypt.compare(password, business.password);
    if (!validPass) return res.status(400).json({ error: 'Contraseña incorrecta' });

    const token = jwt.sign({ slug: business.slug, id: business.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, slug: business.slug, name: business.name });
  } catch (err) {
    console.error('Error en /api/login:', err.message);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.get('/api/business/profile', authMiddleware, async (req, res) => {
  const [rows] = await db.query(`SELECT * FROM businesses WHERE slug = ?`, [req.user.slug]);
  if (rows[0]) delete rows[0].password;
  res.json(rows[0]);
});

app.put('/api/business/profile', authMiddleware, upload.fields([{ name: 'banner' }, { name: 'logo' }]), async (req, res) => {
  try {
    const { name, description, phone, address, businessHours, mapUrl, facebookUrl, instagramUrl, tiktokUrl, themeColor, language, currency, allowReservations } = req.body;

    let bannerImage = req.files && req.files['banner'] ? bufferToBase64(req.files['banner'][0]) : null;
    let logoImage = req.files && req.files['logo'] ? bufferToBase64(req.files['logo'][0]) : null;

    let query = `UPDATE businesses SET name=?, description=?, phone=?, address=?, businessHours=?, mapUrl=?, facebookUrl=?, instagramUrl=?, tiktokUrl=?, themeColor=?, language=?, currency=?, allowReservations=?`;
    let params = [name, description, phone, address, businessHours, mapUrl, facebookUrl, instagramUrl, tiktokUrl, themeColor, language || 'es', currency || '$', allowReservations === 'false' || allowReservations === false ? 0 : 1];

    if (bannerImage) { query += `, bannerImage=?`; params.push(bannerImage); }
    if (logoImage) { query += `, logoImage=?`; params.push(logoImage); }

    query += ` WHERE slug=?`;
    params.push(req.user.slug);

    await db.query(query, params);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error actualizando perfil:', err);
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

app.get('/api/my-products', authMiddleware, async (req, res) => {
  const [products] = await db.query(`SELECT * FROM products WHERE businessSlug = ? ORDER BY featured DESC, createdAt DESC`, [req.user.slug]);
  res.json(products);
});

app.post('/api/products', authMiddleware, upload.single('media'), async (req, res) => {
  try {
    const { name, category, price, description, videoUrl, available, featured } = req.body;
    let imageUrl = req.file ? bufferToBase64(req.file) : (req.body.image || '');

    await db.query(
      `INSERT INTO products (businessSlug, name, category, price, description, image, videoUrl, available, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.slug,
        name,
        category || 'General',
        parseFloat(price),
        description || '',
        imageUrl,
        videoUrl || '',
        available === 'false' || available === false ? 0 : 1,
        featured === 'true' || featured === true ? 1 : 0
      ]
    );

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error guardando producto:', err);
    res.status(500).json({ error: 'Error al guardar producto' });
  }
});

// EDITAR PRODUCTO
app.put('/api/products/:id', authMiddleware, upload.single('media'), async (req, res) => {
  try {
    const { name, category, price, description, videoUrl, available, featured } = req.body;
    const id = req.params.id;

    let query = `UPDATE products SET name=?, category=?, price=?, description=?, videoUrl=?, available=?, featured=?`;
    let params = [
      name,
      category || 'General',
      parseFloat(price),
      description || '',
      videoUrl || '',
      available === 'false' || available === false ? 0 : 1,
      featured === 'true' || featured === true ? 1 : 0
    ];

    if (req.file) {
      query += `, image=?`;
      params.push(bufferToBase64(req.file));
    }

    query += ` WHERE id=? AND businessSlug=?`;
    params.push(id, req.user.slug);

    const [result] = await db.query(query, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Producto no encontrado' });

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error actualizando producto:', err);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

app.delete('/api/products/:id', authMiddleware, async (req, res) => {
  await db.query(`DELETE FROM products WHERE id = ? AND businessSlug = ?`, [req.params.id, req.user.slug]);
  res.json({ status: 'ok' });
});

app.get('/api/my-comments', authMiddleware, async (req, res) => {
  const [comments] = await db.query(`SELECT * FROM comments WHERE businessSlug = ? ORDER BY createdAt DESC`, [req.user.slug]);
  res.json(comments);
});

app.delete('/api/comments/:id', authMiddleware, async (req, res) => {
  await db.query(`DELETE FROM comments WHERE id = ? AND businessSlug = ?`, [req.params.id, req.user.slug]);
  res.json({ status: 'ok' });
});

app.get('/api/catalog/:slug', async (req, res) => {
  const [bRows] = await db.query(`SELECT * FROM businesses WHERE slug = ?`, [req.params.slug]);
  if (!bRows[0]) return res.status(404).json({ error: 'Negocio no encontrado' });

  const business = bRows[0];
  delete business.password;

  // Registrar visita (analítica básica)
  await db.query(`UPDATE businesses SET visits = visits + 1 WHERE slug = ?`, [req.params.slug]);
  await db.query(`INSERT INTO visits_log (businessSlug, visitDate) VALUES (?, CURDATE())`, [req.params.slug]);

  const [products] = await db.query(
    `SELECT * FROM products WHERE businessSlug = ? ORDER BY featured DESC, createdAt DESC`,
    [req.params.slug]
  );
  const [comments] = await db.query(`SELECT * FROM comments WHERE businessSlug = ? ORDER BY createdAt DESC`, [req.params.slug]);
  const [coupons] = await db.query(`SELECT * FROM coupons WHERE businessSlug = ? AND active = 1`, [req.params.slug]);
  const [gallery] = await db.query(`SELECT * FROM business_images WHERE businessSlug = ? ORDER BY createdAt DESC`, [req.params.slug]);

  const totalReviews = comments.length;
  const avgRating = totalReviews > 0 ? (comments.reduce((acc, c) => acc + c.rating, 0) / totalReviews).toFixed(1) : '5.0';
  const categories = ['Todos', ...new Set(products.map(p => p.category || 'General'))];
  const openStatus = getOpenStatus(business.businessHours);

  res.json({ business, products, categories, comments, coupons, gallery, avgRating, totalReviews, openStatus });
});

app.post('/api/comments', async (req, res) => {
  const { businessSlug, author, text, rating } = req.body;
  await db.query(
    `INSERT INTO comments (businessSlug, author, text, rating) VALUES (?, ?, ?, ?)`,
    [businessSlug, author, text, parseInt(rating) || 5]
  );
  // Notificación al negocio
  await db.query(
    `INSERT INTO notifications (businessSlug, type, message) VALUES (?, 'review', ?)`,
    [businessSlug, `Nueva reseña de ${author} (${parseInt(rating) || 5}★): ${String(text || '').slice(0, 60)}`]
  );
  res.json({ status: 'ok' });
});

// Registrar pedido (contador + detalle completo)
app.post('/api/orders', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada' });
    const { businessSlug, customerName, phone, items, total } = req.body;
    if (!businessSlug) return res.status(400).json({ error: 'Falta businessSlug' });
    await db.query(`UPDATE businesses SET orders = orders + 1 WHERE slug = ?`, [businessSlug]);
    if (Array.isArray(items) && items.length > 0) {
      await db.query(
        `INSERT INTO orders (businessSlug, customerName, phone, items, total) VALUES (?, ?, ?, ?, ?)`,
        [businessSlug, customerName || '', phone || '', JSON.stringify(items), parseFloat(total) || 0]
      );
      await db.query(
        `INSERT INTO notifications (businessSlug, type, message) VALUES (?, 'order', ?)`,
        [businessSlug, `Nuevo pedido recibido ($${parseFloat(total || 0).toFixed(2)})`]
      );
    }
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error registrando pedido:', err);
    res.status(500).json({ error: 'Error al registrar pedido' });
  }
});

// ==================== RESERVACIONES ====================

app.post('/api/reservations', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada' });
    const { businessSlug, name, phone, date, time, guests, notes } = req.body;
    if (!businessSlug || !name || !date || !time) {
      return res.status(400).json({ error: 'Faltan datos de la reservación' });
    }
    await db.query(
      `INSERT INTO reservations (businessSlug, name, phone, date, time, guests, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [businessSlug, name, phone || '', date, time, parseInt(guests) || 2, notes || '']
    );
    await db.query(
      `INSERT INTO notifications (businessSlug, type, message) VALUES (?, 'reservation', ?)`,
      [businessSlug, `Nueva reservación de ${name} (${date} ${time})`]
    );
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error creando reservación:', err);
    res.status(500).json({ error: 'Error al crear reservación' });
  }
});

app.get('/api/my-reservations', authMiddleware, async (req, res) => {
  const [rows] = await db.query(`SELECT * FROM reservations WHERE businessSlug = ? ORDER BY createdAt DESC`, [req.user.slug]);
  res.json(rows);
});

app.put('/api/reservations/:id', authMiddleware, async (req, res) => {
  const { status } = req.body;
  await db.query(`UPDATE reservations SET status = ? WHERE id = ? AND businessSlug = ?`, [status, req.params.id, req.user.slug]);
  res.json({ status: 'ok' });
});

app.delete('/api/reservations/:id', authMiddleware, async (req, res) => {
  await db.query(`DELETE FROM reservations WHERE id = ? AND businessSlug = ?`, [req.params.id, req.user.slug]);
  res.json({ status: 'ok' });
});

// ==================== CUPONES ====================

app.post('/api/coupons', authMiddleware, async (req, res) => {
  try {
    const { code, discountType, discountValue, expiresAt } = req.body;
    if (!code || !discountValue) return res.status(400).json({ error: 'Faltan datos del cupón' });
    const [existing] = await db.query(`SELECT id FROM coupons WHERE businessSlug = ? AND code = ?`, [req.user.slug, String(code).toUpperCase()]);
    if (existing.length) return res.status(400).json({ error: 'Ese código ya existe' });
    await db.query(
      `INSERT INTO coupons (businessSlug, code, discountType, discountValue, expiresAt) VALUES (?, ?, ?, ?, ?)`,
      [req.user.slug, String(code).toUpperCase(), discountType === 'fixed' ? 'fixed' : 'percent', parseFloat(discountValue), expiresAt || null]
    );
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error creando cupón:', err);
    res.status(500).json({ error: 'Error al crear cupón' });
  }
});

app.get('/api/my-coupons', authMiddleware, async (req, res) => {
  const [rows] = await db.query(`SELECT * FROM coupons WHERE businessSlug = ? ORDER BY createdAt DESC`, [req.user.slug]);
  res.json(rows);
});

app.delete('/api/coupons/:id', authMiddleware, async (req, res) => {
  await db.query(`DELETE FROM coupons WHERE id = ? AND businessSlug = ?`, [req.params.id, req.user.slug]);
  res.json({ status: 'ok' });
});

// Validar cupón desde el catálogo público
app.post('/api/coupons/validate', async (req, res) => {
  try {
    const { businessSlug, code } = req.body;
    const [rows] = await db.query(
      `SELECT * FROM coupons WHERE businessSlug = ? AND code = ? AND active = 1`,
      [businessSlug, String(code || '').toUpperCase()]
    );
    const c = rows[0];
    if (!c) return res.status(404).json({ valid: false, message: 'Cupón no válido' });
    if (c.expiresAt && new Date(c.expiresAt) < new Date()) {
      return res.status(400).json({ valid: false, message: 'Este cupón ya expiró' });
    }
    res.json({ valid: true, discountType: c.discountType, discountValue: parseFloat(c.discountValue), message: 'Cupón aplicado' });
  } catch (err) {
    res.status(500).json({ valid: false, message: 'Error al validar' });
  }
});

// ==================== PEDIDOS (detalle) ====================

app.get('/api/my-orders', authMiddleware, async (req, res) => {
  const [rows] = await db.query(`SELECT * FROM orders WHERE businessSlug = ? ORDER BY createdAt DESC`, [req.user.slug]);
  res.json(rows);
});

app.put('/api/orders/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  await db.query(`UPDATE orders SET status = ? WHERE id = ? AND businessSlug = ?`, [status, req.params.id, req.user.slug]);
  res.json({ status: 'ok' });
});

// ==================== ANALYTICS ====================

app.get('/api/analytics', authMiddleware, async (req, res) => {
  try {
    const slug = req.user.slug;
    const [visits] = await db.query(
      `SELECT visitDate, COUNT(*) as count FROM visits_log WHERE businessSlug = ? AND visitDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY visitDate ORDER BY visitDate`,
      [slug]
    );
    const [[{ totalOrders }]] = await db.query(`SELECT COUNT(*) as totalOrders FROM orders WHERE businessSlug = ?`, [slug]);
    const [[{ totalReservations }]] = await db.query(`SELECT COUNT(*) as totalReservations FROM reservations WHERE businessSlug = ?`, [slug]);
    const [[{ pendingReservations }]] = await db.query(`SELECT COUNT(*) as pendingReservations FROM reservations WHERE businessSlug = ? AND status = 'pendiente'`, [slug]);
    const [[{ newOrders }]] = await db.query(`SELECT COUNT(*) as newOrders FROM orders WHERE businessSlug = ? AND status = 'nuevo'`, [slug]);

    // Productos más pedidos (agregar en JS porque items es JSON)
    const [orders] = await db.query(`SELECT items FROM orders WHERE businessSlug = ?`, [slug]);
    const productCount = {};
    orders.forEach(o => {
      try {
        const items = JSON.parse(o.items || '[]');
        items.forEach(it => {
          const k = it.name || 'Producto';
          productCount[k] = (productCount[k] || 0) + (it.qty || 1);
        });
      } catch (e) {}
    });
    const topProducts = Object.entries(productCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

    res.json({ visits, totalOrders, totalReservations, pendingReservations, newOrders, topProducts });
  } catch (err) {
    console.error('Error en analytics:', err);
    res.status(500).json({ error: 'Error al obtener analytics' });
  }
});

// ==================== NOTIFICACIONES ====================

app.get('/api/notifications', authMiddleware, async (req, res) => {
  const [rows] = await db.query(`SELECT * FROM notifications WHERE businessSlug = ? ORDER BY createdAt DESC LIMIT 30`, [req.user.slug]);
  const [[{ unread }]] = await db.query(`SELECT COUNT(*) as unread FROM notifications WHERE businessSlug = ? AND isRead = 0`, [req.user.slug]);
  res.json({ list: rows, unread });
});

app.post('/api/notifications/read', authMiddleware, async (req, res) => {
  await db.query(`UPDATE notifications SET isRead = 1 WHERE businessSlug = ?`, [req.user.slug]);
  res.json({ status: 'ok' });
});

// ==================== GALERÍA ====================

app.post('/api/business/gallery', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const image = req.file ? bufferToBase64(req.file) : (req.body.image || '');
    const { caption } = req.body;
    if (!image) return res.status(400).json({ error: 'Falta la imagen' });
    await db.query(`INSERT INTO business_images (businessSlug, image, caption) VALUES (?, ?, ?)`, [req.user.slug, image, caption || '']);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error subiendo imagen:', err);
    res.status(500).json({ error: 'Error al subir imagen' });
  }
});

app.delete('/api/business/gallery/:id', authMiddleware, async (req, res) => {
  await db.query(`DELETE FROM business_images WHERE id = ? AND businessSlug = ?`, [req.params.id, req.user.slug]);
  res.json({ status: 'ok' });
});

// ==================== RUTAS ADMIN ====================

const adminMiddleware = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const verified = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    if (!verified.isAdmin) return res.status(403).json({ error: 'Acceso denegado' });
    req.admin = verified;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ token, status: 'ok' });
  }
  res.status(401).json({ error: 'Contraseña incorrecta' });
});

app.get('/api/admin/businesses', adminMiddleware, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada' });
    const [rows] = await db.query(
      `SELECT id, name, slug, email, phone, description, address, businessHours, themeColor, bannerImage, logoImage, visits, orders, isActive, createdAt FROM businesses ORDER BY id DESC`
    );
    for (const b of rows) {
      const [[{ productCount }]] = await db.query(`SELECT COUNT(*) as productCount FROM products WHERE businessSlug = ?`, [b.slug]);
      const [[{ commentCount }]] = await db.query(`SELECT COUNT(*) as commentCount FROM comments WHERE businessSlug = ?`, [b.slug]);
      const [[{ orderCount }]] = await db.query(`SELECT COUNT(*) as orderCount FROM orders WHERE businessSlug = ?`, [b.slug]);
      const [[{ reservationCount }]] = await db.query(`SELECT COUNT(*) as reservationCount FROM reservations WHERE businessSlug = ?`, [b.slug]);
      const [comments] = await db.query(`SELECT rating FROM comments WHERE businessSlug = ?`, [b.slug]);
      b.productCount = productCount;
      b.commentCount = commentCount;
      b.reviewCount = commentCount;
      b.orderCount = orderCount;
      b.reservationCount = reservationCount;
      b.totalReviews = comments.length;
      b.avgRating = comments.length
        ? (comments.reduce((a, c) => a + c.rating, 0) / comments.length).toFixed(1)
        : '5.0';
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar negocios' });
  }
});

// EDITAR negocio desde el panel admin
app.put('/api/admin/businesses/:id', adminMiddleware, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada' });
    const { name, description, phone, email, address, businessHours, themeColor } = req.body;
    await db.query(
      `UPDATE businesses SET name=?, description=?, phone=?, email=?, address=?, businessHours=?, themeColor=? WHERE id=?`,
      [name, description, phone, email, address, businessHours, themeColor, req.params.id]
    );
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar negocio' });
  }
});

// Restablecer contraseña de un negocio
app.post('/api/admin/businesses/:id/reset-password', adminMiddleware, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada' });
    const { password } = req.body;
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const hashed = await bcrypt.hash(String(password), 10);
    await db.query(`UPDATE businesses SET password=? WHERE id=?`, [hashed, req.params.id]);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al restablecer contraseña' });
  }
});

// Activar / desactivar negocio
app.put('/api/admin/businesses/:id/status', adminMiddleware, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada' });
    const { isActive } = req.body;
    await db.query(`UPDATE businesses SET isActive=? WHERE id=?`, [isActive ? 1 : 0, req.params.id]);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

app.delete('/api/admin/businesses/:id', adminMiddleware, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada' });
    const [rows] = await db.query(`SELECT slug FROM businesses WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Negocio no encontrado' });
    const slug = rows[0].slug;
    await db.query(`DELETE FROM products WHERE businessSlug = ?`, [slug]);
    await db.query(`DELETE FROM comments WHERE businessSlug = ?`, [slug]);
    await db.query(`DELETE FROM orders WHERE businessSlug = ?`, [slug]);
    await db.query(`DELETE FROM reservations WHERE businessSlug = ?`, [slug]);
    await db.query(`DELETE FROM coupons WHERE businessSlug = ?`, [slug]);
    await db.query(`DELETE FROM business_images WHERE businessSlug = ?`, [slug]);
    await db.query(`DELETE FROM notifications WHERE businessSlug = ?`, [slug]);
    await db.query(`DELETE FROM visits_log WHERE businessSlug = ?`, [slug]);
    await db.query(`DELETE FROM businesses WHERE id = ?`, [req.params.id]);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar negocio' });
  }
});

app.get('/api/admin/stats', adminMiddleware, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada' });
    const [[{ businesses }]] = await db.query(`SELECT COUNT(*) as businesses FROM businesses`);
    const [[{ products }]] = await db.query(`SELECT COUNT(*) as products FROM products`);
    const [[{ comments }]] = await db.query(`SELECT COUNT(*) as comments FROM comments`);
    const [[{ orders }]] = await db.query(`SELECT COUNT(*) as orders FROM orders`);
    const [[{ reservations }]] = await db.query(`SELECT COUNT(*) as reservations FROM reservations`);
    const [[{ visits }]] = await db.query(`SELECT COALESCE(SUM(visits),0) as visits FROM businesses`);
    res.json({ businesses, products, comments, orders, reservations, visits });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ==================== DIRECTORIO PÚBLICO & SHORTLINKS ====================

app.get('/api/directory', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada' });
    const [rows] = await db.query(
      `SELECT id, name, slug, description, phone, address, businessHours, themeColor, bannerImage, logoImage, visits, orders
       FROM businesses WHERE isActive = 1 ORDER BY name ASC`
    );
    for (const b of rows) {
      const [[{ productCount }]] = await db.query(
        `SELECT COUNT(*) as productCount FROM products WHERE businessSlug = ?`, [b.slug]
      );
      const [comments] = await db.query(
        `SELECT rating FROM comments WHERE businessSlug = ?`, [b.slug]
      );
      b.productCount = productCount;
      b.totalReviews = comments.length;
      b.avgRating = comments.length
        ? (comments.reduce((a, c) => a + c.rating, 0) / comments.length).toFixed(1)
        : '5.0';
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar directorio' });
  }
});

// Redirección corta
app.get('/m/:slug', (req, res) => {
  res.redirect(302, '/catalog.html?slug=' + encodeURIComponent(req.params.slug));
});

// Info de enlace corto para QR
app.get('/api/shortlink/:slug', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada' });
    const [rows] = await db.query(
      `SELECT name, slug FROM businesses WHERE slug = ?`, [req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Negocio no encontrado' });
    const host = req.get('x-forwarded-host') || req.get('host');
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const shortUrl = proto + '://' + host + '/m/' + rows[0].slug;
    const catalogUrl = proto + '://' + host + '/catalog.html?slug=' + rows[0].slug;
    res.json({ name: rows[0].name, slug: rows[0].slug, shortUrl, catalogUrl });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));
