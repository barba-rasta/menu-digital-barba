========================================
  Menú Digital SaaS - Guía de instalación
========================================

CONTENIDO DEL ZIP
-----------------
server.js          Servidor Node.js
package.json       Dependencias
.env               Base de datos Akamai + secretos
Dockerfile         (opcional, Docker)
wasmer.toml        (opcional, Wasmer)
public/            Páginas web
  index.html       Inicio
  login.html       Login negocio
  register.html    Registro
  dashboard.html   Panel del negocio
  catalog.html     Catálogo público
  admin.html       Panel administrador
  uploads/         Imágenes subidas

CUENTAS PRECARGADAS
-------------------
Negocio:
  Email:     barbanesta@gmail.com
  Password:  ClaVe1234a
  Catálogo:  /catalog.html?slug=tacos-jovenazo

Admin:
  URL:       /admin.html
  Password:  barba99

BASE DE DATOS
-------------
MySQL de Akamai (ya configurada en .env y server.js).
No necesitas crear otra base de datos.

========================================
INSTALACIÓN SOLO CON IP (sin dominio)
========================================

1) Sube este ZIP por FTP a tu servidor
   Ejemplo de carpeta:
   /home/USUARIO/menu-digital/

2) Descomprime y deja los archivos así:
   menu-digital/
   ├── server.js
   ├── package.json
   ├── .env
   └── public/
       ├── index.html
       ├── login.html
       ...

3) Por SSH:
   cd /home/USUARIO/menu-digital
   npm install --production
   npm install -g pm2
   pm2 start server.js --name menu-digital
   pm2 save
   pm2 startup

4) Abre el puerto 3000 en el firewall:
   ufw allow 3000/tcp

5) Entra en el navegador:
   http://TU-IP:3000
   http://TU-IP:3000/login.html
   http://TU-IP:3000/catalog.html?slug=tacos-jovenazo
   http://TU-IP:3000/admin.html

Ejemplo con tu IP:
   http://67.205.131.73:3000

========================================
INSTALACIÓN CON DOMINIO (Hestia)
========================================

1) Sube los archivos a:
   /home/USUARIO/web/TU-DOMINIO/public_html/

2) npm install --production
   pm2 start server.js --name menu-digital

3) En Hestia: Proxy hacia http://127.0.0.1:3000
   o activa Node.js en el dominio apuntando a server.js

========================================
COMANDOS ÚTILES
========================================
pm2 status
pm2 logs menu-digital
pm2 restart menu-digital
pm2 stop menu-digital

Permisos de subida de imágenes:
chmod -R 775 public/uploads
