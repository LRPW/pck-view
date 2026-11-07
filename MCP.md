# PckView MCP

Run PckView as a local stdio MCP server by configuring the client with this
command and argument list. Use absolute paths and an existing output directory.

```json
{
  "command": "D:/tools/pwforge.exe",
  "args": [
    "--mcp",
    "D:/client/interfaces.pck",
    "D:/work/interfaces-edited.pck"
  ]
}
```

The process opens one source archive. The output must be a new file, and the
source is read-only. Edits are private to this session.

1. Use `search_ui` with part of a window's archive path.
2. Use `inspect_ui` with the returned path. The result contains the element
   tree as a flat list with parent indices and the current revision.
3. Use `patch_ui` with the same entry, revision, node index, attribute (`x`, `y`, `Width`, or `Height`) and integer
   value.
4. Use `preview_ui` to capture the same interface renderer as the desktop editor,
   including available game textures, fonts, and flex layout.
5. Call `save` to stage the current revision in memory, then
   `build_archive` to write the new PCK. Further patches require another
   `save`. Only the completed build survives process exit.
6. To verify the result independently, start another session with the built
   archive as input and call `inspect_ui` on the same path.

Standalone builds write a companion PKX when the archive crosses the split
boundary. The build result returns its path in `companion`. The desktop editor and MCP server maintain
separate sessions.

Run the real-archive smoke test from the PckView directory after building:

```powershell
node scripts/mcp-smoke.mjs src-tauri/target/debug/pwforge.exe D:/client/interfaces.pck inventorydetail.xml
```

## Project mode

Configure the same MCP client with one argument after `--mcp`:

```json
{
  "command": "D:/tools/pwforge.exe",
  "args": [
    "--mcp",
    "D:/work/forge/forge.pwforge"
  ]
}
```

`search_ui` searches XML paths in all indexed project archives and returns
archive-qualified paths such as `archives/interfaces.pck/interfaces/inventorydetail.xml`.
Pass that full path to inspect, patch, and preview.

`save` writes edits to the project using the desktop editor's edit storage.
`build_archive` runs the normal project build, including any other saved
project edits, and returns the build directory and archive names. Reopening the
project reads the saved edits. The desktop editor and MCP still have separate
in-memory sessions.

Run the smoke test against a disposable project copy with no saved edits.
It saves a real change and leaves the project edit and build available for inspection.

```powershell
node scripts/mcp-smoke.mjs src-tauri/target/debug/pwforge.exe D:/work/forge/forge.pwforge inventorydetail.xml
```

## Preview runtime

Build the frontend with `npm run build` before building the Rust executable.
PNG capture uses Node.js 22+ and Chrome or Edge in a temporary headless profile.
Set `PCKVIEW_MCP_BROWSER` to override the browser executable. MCP returns the
image plus counts of loaded textures and fonts and paths of missing resources.
For project previews, include the archives containing the window's textures.
Native GFX is outside the current capture adapter.

## Create or open projects from MCP

Start the executable with just `--mcp` to begin without an open project.
Use `open_project` with `manifest`, or `create_project` with `source` (client
directory), `parent` (existing destination directory), `name`, and `archives`
(relative PCK paths). The new project copies client data, fonts and selected
archives using the standard importer.

## Data and localization

- `list_data` finds project data paths. `read_data` and `replace_data` exchange
  base64 with a 256 MiB editor limit. Use the revision from the read.
- `inspect_data` takes an `entry` and `selection`. An empty selection lists
  element or shop schemas, returns the quest count, or reads territories.
  Pass `{list, row}` for element or shop records, or `{row}` for quest records.
- `patch_data` takes the inspected `revision` and a `patch` object. Elements and
  shops accept `{list, row, fields: [[fieldIndex, "value"]]}`. Quests accept
  `{changes: [{row, fields: {"fieldIndex": "value"}}]}`. Territories accept
  `{row, fields}` with territory properties and optional top-level `speed` for
  nation-war files. Call `save` before building.
- `export_texts` writes the source localization JSON. The agent can translate
  the segments itself or call `translate_texts` with `settings`, `texts`, and
  `target`. The provider settings accept `provider`, `endpoint`, `model`,
  `source`, and `glossary`. Keys come from PckView's saved credentials.
- `save_translations` accepts `language` and
  `changes: {entries: [{file, path, texts}]}`. Call `apply_translations` to
  write the translated resources to project edits, then `build_archive`.

The data smoke test imports a disposable client directory containing
`elements.data`, `gshop2.data`, `tasks.data`, `dyn_tasks.data`,
`task_npc.data`, `domain.data` and `opaque.bin` (bytes 00 01) under
`data/`. It uses a loopback mock translation provider.

```powershell
node scripts/mcp-smoke.mjs src-tauri/target/debug/pwforge.exe D:/work/test-client --data D:/work/test-projects
```
