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
async function initDB() {
  try {
    db = await mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 25060,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: {
        rejectUnauthorized: false // Requerido para DigitalOcean
      },
      waitForConnections: true,
      connectionLimit: 10
    });

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
        logoImage LONGTEXT
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
        image LONGTEXT
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
        ['Taco de Asada', 'Tacos', 25.00, 'Taco de carne asada con cilantro y cebolla'],
        ['Taco de Pastor', 'Tacos', 22.00, 'Taco al pastor con piña'],
        ['Taco de Suadero', 'Tacos', 23.00, 'Suadero suave y jugoso'],
        ['Quesadilla', 'Antojitos', 45.00, 'Quesadilla de queso con guisado a elegir'],
        ['Agua de Horchata', 'Bebidas', 20.00, 'Agua fresca de horchata 500ml']
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
    const { name, description, phone, address, businessHours, mapUrl, facebookUrl, instagramUrl, tiktokUrl, themeColor } = req.body;

    let bannerImage = req.files && req.files['banner'] ? bufferToBase64(req.files['banner'][0]) : null;
    let logoImage = req.files && req.files['logo'] ? bufferToBase64(req.files['logo'][0]) : null;

    let query = `UPDATE businesses SET name=?, description=?, phone=?, address=?, businessHours=?, mapUrl=?, facebookUrl=?, instagramUrl=?, tiktokUrl=?, themeColor=?`;
    let params = [name, description, phone, address, businessHours, mapUrl, facebookUrl, instagramUrl, tiktokUrl, themeColor];

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
  const [products] = await db.query(`SELECT * FROM products WHERE businessSlug = ?`, [req.user.slug]);
  res.json(products);
});

app.post('/api/products', authMiddleware, upload.single('media'), async (req, res) => {
  try {
    const { name, category, price, description } = req.body;
    let imageUrl = req.file ? bufferToBase64(req.file) : (req.body.image || '');

    await db.query(
      `INSERT INTO products (businessSlug, name, category, price, description, image) VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.slug, name, category || 'General', parseFloat(price), description || '', imageUrl]
    );

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error guardando producto:', err);
    res.status(500).json({ error: 'Error al guardar producto' });
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

  const [products] = await db.query(`SELECT * FROM products WHERE businessSlug = ?`, [req.params.slug]);
  const [comments] = await db.query(`SELECT * FROM comments WHERE businessSlug = ? ORDER BY createdAt DESC`, [req.params.slug]);

  const totalReviews = comments.length;
  const avgRating = totalReviews > 0 ? (comments.reduce((acc, c) => acc + c.rating, 0) / totalReviews).toFixed(1) : '5.0';
  const categories = ['Todos', ...new Set(products.map(p => p.category || 'General'))];

  res.json({ business, products, categories, comments, avgRating, totalReviews });
});

app.post('/api/comments', async (req, res) => {
  const { businessSlug, author, text, rating } = req.body;
  await db.query(
    `INSERT INTO comments (businessSlug, author, text, rating) VALUES (?, ?, ?, ?)`,
    [businessSlug, author, text, parseInt(rating) || 5]
  );
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
      `SELECT id, name, slug, email, phone, description, address, businessHours, themeColor, bannerImage, logoImage FROM businesses ORDER BY id DESC`
    );
    for (const b of rows) {
      const [[{ productCount }]] = await db.query(`SELECT COUNT(*) as productCount FROM products WHERE businessSlug = ?`, [b.slug]);
      const [[{ commentCount }]] = await db.query(`SELECT COUNT(*) as commentCount FROM comments WHERE businessSlug = ?`, [b.slug]);
      b.productCount = productCount;
      b.commentCount = commentCount;
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar negocios' });
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
    res.json({ businesses, products, comments });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ==================== DIRECTORIO PÚBLICO & SHORTLINKS ====================

app.get('/api/directory', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Base de datos no conectada' });
    const [rows] = await db.query(
      `SELECT id, name, slug, description, phone, address, businessHours, themeColor, bannerImage, logoImage
       FROM businesses ORDER BY name ASC`
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
