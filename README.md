# Folgezettel for Obsidian

This plugin allows you to implement the **Folgezettel architecture** directly within your Obsidian vault. By reading the `zid` property from each note's frontmatter, it generates a structural hierarchy that replicates the specific nomenclature used in Niklas Luhmann's **Zettelkasten II** with the highest possible precision.

## Key Features

* **Luhmann-Style Hierarchy:** Automatically generates a tree view based on the unique numbering logic of the original Zettelkasten.
* **Non-Invasive:** It does not change how Obsidian manages your files or folders. The plugin simply parses notes with a defined `zid` property to build a virtual organizational layer.
* **Seamless Integration:** Works with your existing workflow by leveraging standard YAML frontmatter.

## Roadmap

* [ ] **Visual Diagrams:** I am currently working on implementing diagram generation inspired by the digital version of the [Luhmann Archive](https://niklas-luhmann-archiv.de/).

## Usage

- Run the **"Open Folgezettel"** command from the Command Palette if the view does not appear automatically.
- Notes with a `zid` property in their frontmatter will be displayed in the sorted tree view. Hovering over any row will reveal three buttons for creating or assigning notes.

## Note Types

- **Next Note**: Creates the subsequent note at the current level. For example, the next note for `5.2a` is `5.2b`. If that note already exists, it generates an intermediate note following Luhmann’s nomenclature: between `5.2a` and `5.2b`, it creates `5.2a1`.
- **Branch Note**: Creates a note one level deeper in the hierarchy, alternating between numbers and uppercase letters. For example, the branch for `7.4` is `7.4A`, while the branch for `4.5b` is `4.5bA`.
- **Footnote**: Creates a note one level deeper but positioned before all branch notes of that level. Luhmann used these to comment on the original note, acting as a true footnote. For example, the footnote for `4.5a` is `4.5a.1`, which is placed before the branch note `4.5aA`.

## Contribute

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/V7V31W2DDV)