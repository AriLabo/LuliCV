import standard from '../../src/themes/standard/theme.css?raw';
import editorial from '../../src/themes/editorial/theme.css?raw';
import minimal from '../../src/themes/minimal/theme.css?raw';

/** Stylesheets of the built-in themes, the starting point for `lulicv theme new --from`. */
export const builtinThemeCss: Record<string, string> = { standard, editorial, minimal };
