# Making a theme

Most requests ("a darker green", "a centred header", "a different font") are presets and settings of an existing theme: write them to `/appearance` as described in [editing and layout](editing.md). An adjustment only this resume needs goes in the resume's own stylesheet, `/appearance/css` (same page). Make a new theme when the user wants a look for all their resumes that none of the themes can give.

A theme is a folder with two files and no code:

- `manifest.json`: `id` (2–40 lowercase letters, digits or hyphens, starting with a letter; cannot be a built-in id and should not change once used), `name`, `version`, colour `presets` (the first is the default), `settings` the user can switch, and default spacing.
- `theme.css`: plain CSS for the classes and variables the page skeleton exposes. Rules are nested inside `.rs-theme--<id>` when the theme loads, so write `.rs-name { … }`, not `.rs-theme--<id> .rs-name`. A setting appears on the root, so target it as `&.rs-set-<setting>-<value> .rs-name { … }` (toggles: `&.rs-set-<setting>`).

The skeleton is the same for every theme, so pagination, links and exported text never depend on the theme. Its classes: `rs-header` (`rs-header--photo`), `rs-identity`, `rs-name`, `rs-headline`, `rs-contacts`, `rs-contact` (`data-kind`, `data-code`), `rs-contact-icon` (`data-icon`), `rs-contact-label`, `rs-contact-value`, `rs-details`, `rs-detail` (`data-kind`), `rs-detail-label`, `rs-detail-value`, `rs-photo`, `rs-section-title`, `rs-section-index`, `rs-section-rule`, `rs-entry-head`, `rs-entry-main`, `rs-entry-title`, `rs-entry-subtitle`, `rs-entry-meta`, `rs-entry-location`, `rs-entry-date`, `rs-summary`, `rs-description`, `rs-bullet`, `rs-bullet-mark`, `rs-skill`, `rs-skill-category`, `rs-skill-items`. Variables: `--rs-accent`, `--rs-font-size`, `--rs-line-height`, `--rs-section-space`, `--rs-page-margin`, `--rs-font-family`. Use the variables rather than fixed values so the user's spacing, font and colour choices keep working.

## Workflow

1. `lulicv theme new <id> --from <standard|editorial|minimal|business|timeline> --name <中文名> --output <directory>` copies a built-in theme into a new folder. Start from the closest one and change as little as needed. Nothing is installed yet.
2. Edit `theme.css` (and the manifest's presets or settings).
3. `lulicv theme check <directory> --images <directory>` checks the package, then lays out four fictitious samples (one page, two pages, with photo, long mixed Chinese–English text) with the real Renderer and writes page images. Rendering the samples uses the workspace's Bridge, started if needed. Exit 1 means `errors` or a sample with `issues`; also read `warnings` (unknown classes or variables, hard-coded colours, a sample longer than expected).
4. Look at every image. Repeat 2–3 until `passed` is true and the pages look right.
5. Show the user the images, then `lulicv theme install <directory>`. Installing the same id again replaces it; the editor picks it up without a reload.
6. Apply it with `lulicv theme use <resume id> <theme id>`; `lulicv themes` lists installed themes with `source: "installed"`.

`lulicv theme remove <id>` uninstalls a theme. Resumes that still use it keep the id, render with 标准 and are listed in `usedBy`; reinstalling restores them. Replaced and removed versions are kept in the workspace trash. Workspace backups cover resumes only, not installed themes: keep the theme folder.

The CSS may not load anything: `@import`, `@font-face`, remote `url()` and similar are rejected. Images are limited to small inline `data:image/svg+xml` or `data:image/png` URLs; fonts are the built-in ones (思源黑体, MiSans, 霞鹜新晰黑) chosen through presets.

## Taste

- Hierarchy comes from size and weight, then space; not from colour, boxes or lines everywhere.
- Body text is black or near-black. The accent colour (`var(--rs-accent)`) is for the name, section titles and at most one more element.
- At most two typefaces, and one is usually enough.
- Keep the body near the user's chosen size; do not shrink text to fit a page, adjust spacing instead.
- Aim for calm and legible on A4 print and in screening software: no background fills behind body text, no light grey text, no decorative fonts for content.
- Prefer one clear idea (a strong name block, a distinctive section title) over many small effects.
