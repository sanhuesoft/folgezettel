# Folgezettel Sidebar — Obsidian Plugin

Plugin inicial que busca la propiedad `zid` en el frontmatter de las notas y muestra en un sidebar derecho las notas con `zid` ordenadas e indentadas en estilo Folgezettel.

Instalación y pruebas rápidas

1. Desde la carpeta del plugin:

```bash
cd obsidian-zettelkasten-plugin
npm install
npm run build
```

2. Copia la carpeta resultante al directorio de plugins de Obsidian (o instala el build manualmente):

 - En macOS: `~/Library/Application Support/obsidian/YourVault/Plugins/` (coloca el contenido de esta carpeta allí)

3. Reinicia Obsidian y activa el plugin en la lista de Community Plugins.

Uso

- Ejecuta el comando "Open Folgezettel sidebar" desde la paleta de comandos si la vista no aparece automáticamente.
- Las notas con `zid` en su frontmatter aparecerán ordenadas; hacer click abre la nota.

Notas

- El parser acepta formatos como `1`, `1a`, `1a1`, `1.1` y combina números y letras para ordenar. Es una implementación inicial — se puede afinar según tus reglas de numeración Folgezettel.
