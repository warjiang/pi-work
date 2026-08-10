# Pi Work icon set

The icon system is deliberately monochrome:

- Black: `#000000`
- White: `#FFFFFF`

The visual direction is flat, geometric, and high-contrast. It avoids
gradients, shadows, and decorative color so the icon remains recognizable at
small system sizes.

## Sources

- `source/app-icon.svg` — shared application icon master
- `source/menu-bar-template.svg` — monochrome linear macOS menu bar master
- `source/tray.svg` — simplified monochrome tray master

## Generated assets

Run:

```sh
node scripts/generate-icons.mjs
```

from `apps/desktop`.

| Platform/use | Asset |
| --- | --- |
| macOS Dock, Finder, DMG | `generated/mac/icon.icns` |
| macOS menu bar 1× | `generated/mac/pi-workTemplate.png` |
| macOS menu bar Retina | `generated/mac/pi-workTemplate@2x.png` |
| Windows desktop, Start, installer | `generated/windows/icon.ico` |
| Windows individual PNG sizes | `generated/windows/*.png` |
| Linux launcher | `generated/linux/*.png` |
| Windows/Linux tray | `generated/tray/*.png` |
| Marketing/in-app master PNG | `generated/app-icon-1024.png` |

The macOS menu bar filenames end in `Template`, allowing Electron/macOS to
invert the monochrome icon automatically for light and dark menu bars.

## Deliberately omitted

- File association icons: Pi Work does not currently register a document type.
- Microsoft Store tiles: the current Windows target is NSIS, not MSIX/Store.
- Development/staging badges: there is currently one application channel.
