# Infourqui Mercado

Plataforma de comercio electrónico con catálogo, carrito, pasarela de transferencias/efectivo, seguimiento de envíos, escáner de SKU con cámara y modo PC Local / Red LAN / Cloudflare.

## Ejecutar desde GitHub Codespaces

Este repositorio incluye configuración lista para **GitHub Codespaces** (`.devcontainer/devcontainer.json` y `.vscode/tasks.json`).

1. En tu repositorio de GitHub, hacé clic en el botón **Code** → pestaña **Codespaces** → **Create codespace on main**.
2. Codespaces instalará automáticamente **Node.js 22** y las dependencias del proyecto (`npm install`).
3. Al abrirse el editor, el servidor se iniciará automáticamente en el **puerto 3000** y GitHub abrirá la vista previa web en tu navegador.
   - Si no se inició automáticamente, ejecutá en la terminal:
     ```bash
     npm run dev
     ```
4. En la pestaña **Ports** (Puertos) de Codespaces podés cambiar la visibilidad del puerto `3000` a **Public** si querés abrir la tienda desde celulares o compartir el enlace.

### Variables opcionales (Codespaces Secrets)

Podés configurar secretos opcionales en **GitHub → Settings → Codespaces → Secrets**:

- `GEMINI_API_KEY`: habilita la lectura automática de comprobantes de transferencia.
- `LOCAL_ADMIN_PASSWORD`: fija una contraseña administradora por entorno (si queda vacía, la aplicación te permite crearla desde el formulario inicial).

## Comandos principales

```bash
# Desarrollo (servidor Express + Vite en puerto 3000)
npm run dev

# Modo solo PC local (127.0.0.1:3000)
npm run start:pc-local

# Modo Red Local LAN y Cloudflare (0.0.0.0:3000)
npm run start:pc-red

# Compilar para producción
npm run build
```
