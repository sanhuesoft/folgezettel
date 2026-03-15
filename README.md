# Folgezettel — Obsidian Plugin

Plugin que busca la propiedad `zid` en el frontmatter de las notas y muestra en un sidebar derecho las notas con `zid` ordenadas e indentadas en estilo Folgezettel.

## Uso

- Ejecuta el comando "Abrir Folgezettel" desde la paleta de comandos si la vista no aparece automáticamente.
- Las notas con `zid` en su frontmatter aparecerán ordenadas; hacer click abre la nota.

## Notas

- El parser acepta formatos como `1`, `1a`, `1a1`, `1.1` y combina números y letras para ordenar.
- También se puede elegir el separador de niveles. Las opciones son `.`, `,` y `/`. 