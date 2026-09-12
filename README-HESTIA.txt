========================================
  Menú Digital SaaS - Guía Hestia CP
========================================

ARCHIVOS INCLUIDOS
------------------
- server.js          (servidor Node.js)
- package.json       (dependencias)
- public/            (páginas HTML)
- .env               (configuración de la base de datos Akamai)

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
Ya está configurada para usar MySQL de Akamai (externa).
No necesitas crear base de datos en Hestia para este proyecto.

========================================
PASO A PASO EN HESTIA
========================================

1) CREAR DOMINIO (si aún no tienes uno)
   - Entra a Hestia como usuario "barba" o "JORGE"
   - Menú WEB → Agregar dominio web
   - Ejemplo: menudigital.tudominio.com  (o el dominio que tengas)
   - Guarda

2) SUBIR LOS ARCHIVOS
   Opción A - Administrador de archivos (recomendado desde el celular/panel):
   - WEB → clic en tu dominio → Administrador de archivos
   - Entra a la carpeta: public_html  (o private/nodeapp si usas Node)
   - Sube el ZIP (botón Subir)
   - Descomprime el ZIP dentro de public_html
   - Mueve el CONTENIDO de la carpeta saas-menu-digital
     al raíz de public_html (no dejes una subcarpeta de más)

   Opción B - FTP:
   - Usa FileZilla o similar
   - Host: 67.205.131.73  (o tu IP/servidor)
   - Usuario y contraseña del usuario Hestia (JORGE o barba)
   - Sube todo a: /home/JORGE/web/TU-DOMINIO/public_html/

3) INSTALAR NODE.JS Y DEPENDENCIAS (necesitas SSH o terminal)
   - Si tienes acceso SSH:
       cd /home/JORGE/web/TU-DOMINIO/public_html
       npm install --production

   - Si Hestia tiene "Node.js" en el dominio:
       WEB → tu dominio → Advanced / Node.js
       Activa Node.js, apunta al archivo server.js
       Puerto: 3000 (o el que te asigne Hestia)

4) ARRANCAR LA APLICACIÓN
   Con SSH (recomendado con PM2 para que no se caiga):
       npm install -g pm2
       cd /home/JORGE/web/TU-DOMINIO/public_html
       pm2 start server.js --name menu-digital
       pm2 save
       pm2 startup

5) CONFIGURAR PROXY / PUERTO EN HESTIA
   - El servidor Node escucha en el puerto 3000 por defecto
   - En WEB → dominio → Proxy / Backend:
       Activa proxy hacia http://127.0.0.1:3000
   - O usa la función "Node.js App" de Hestia si está disponible
     (elige server.js y el puerto)

6) PROBAR
   - Abre: https://tu-dominio.com
   - Login: barbanesta@gmail.com / ClaVe1234a
   - Admin: https://tu-dominio.com/admin.html  →  barba99

NOTAS IMPORTANTES
-----------------
- Las carpetas dashboard.html y catalog.html aún no están
  creadas en este paquete. El login redirige a dashboard.html.
  Si necesitas esas páginas, pídelas y las genero.

- La base de datos es EXTERNA (Akamai). Tu servidor solo
  necesita salida a internet hacia el host de MySQL en el puerto 15367.

- Carpeta de subidas de imágenes: public/uploads
  Debe tener permisos de escritura (chmod 755 o 775).

SOPORTE RÁPIDO SI FALLA EL REGISTRO / LOGIN
-------------------------------------------
1. Revisa que Node esté corriendo:  pm2 status
2. Revisa logs:  pm2 logs menu-digital
3. Prueba la API:  curl http://127.0.0.1:3000/api/admin/stats
