# Folgezettel for Obsidian

This plugin allows you to implement the **Folgezettel architecture** directly within your Obsidian vault. By reading the `zid` property from each note's frontmatter, it generates a structural hierarchy and visual graphs that replicate the specific nomenclature used in Niklas Luhmann's **Zettelkasten II** with high precision.

## Key Features

* **Luhmann-Style Hierarchy:** Automatically generates a tree view based on the unique numbering logic of the original Zettelkasten, using `/` as the primary level separator.
* **Visual Graph View:** A dedicated graph visualization to explore the connections and branching of your Zettelkasten architecture.
* **Integrated Bibliography:** Support for managing references and citations stored in your "Bibliografía" folder.
* **Non-Invasive:** It does not change how Obsidian manages your files or folders. The plugin simply parses notes with a defined `zid` property to build a virtual organizational layer.

## Usage

* **Open Folgezettel**: Run this command from the Command Palette to open the tree view in the right sidebar.
* **Open Folgezettel Graph**: Use this command to open the visual representation of your structural links.
* **Citations**: Type `{{` in the editor to trigger suggestions for bibliography entries. The plugin will render these as interactive references.
* **Managing Notes**: Hover over any note in the Folgezettel view to see buttons for creating or assigning new notes based on the current hierarchy.

## Note Types

The plugin follows a specific logic for generating new IDs (`zid`):

* **Next Note**: Creates the subsequent note at the current level. For example, the next note for `5/2a` is `5/2b`. If `5/2b` already exists, it generates an intermediate note: `5/2a1`.
* **Branch Note**: Creates a note one level deeper.
    * For a top-level area like `7`, the branch is `7/1`.
    * If the ID ends in a number (e.g., `7/1`), the branch adds an uppercase letter: `7/1A`.
    * If it ends in a letter, it alternates between uppercase and lowercase (e.g., `7/1A` -> `7/1Aa`).
* **Inserted Note**: Creates an intermediate note to comment on or expand an existing one.
    * If the ID ends in a number (e.g., `7/4`), it adds a lowercase letter: `7/4a`.
    * If it ends in an uppercase letter (e.g., `7/4A`), it adds a number: `7/4A1`.

## Installation

1.  Download the latest release files (`main.js`, `manifest.json`, and `styles.css`).
2.  In your vault, go to `.obsidian/plugins/` and create a folder named `folgezettel`.
3.  Place the downloaded files into that folder.
4.  Enable **Folgezettel** in Obsidian's **Community Plugins** settings.

---
**Author:** Fabián Sanhueza Vásquez