# homebridge-busy-light: icon assets

Direction 2C "Lit day": a calendar page with two binding rings and a header rule, and one
day cell lit as a solid square. The square is the only colored element: it ships in
Available green, and the outline stays paper white. Same 192 grid and stroke 12 as
Notify Switch, Peloton and Generac, on a slate field.

## Colors

| Role | Hex |
| --- | --- |
| Field | `#36434F` (slate, a cool blue-grey; lighter and greyer than Notify Switch steel) |
| Mark | `#F2F2F3` |
| Square | `#3FBF6F` (Available green) |
| Light variant ink | `#36434F` on `#F2F2F3`, square `#24834A` |

Not affiliated with Apple, Google, Microsoft or LIFX. No brand marks or brand colors are used.

## Files

| File | Use |
| --- | --- |
| `busy-light-dark.svg` | 192 x 192 tile as it ships (mark on slate field) |
| `busy-light-light.svg` | 192 x 192 light-ground variant |
| `busy-light-mark.svg` | mark alone, `currentColor` (square included), no field |
| `busy-light-footer.svg` | 24-grid line glyph for the settings page footer, `currentColor` |
| `busy-light-512.png` | 512 x 512 raster, npm and plugin listing |
| `busy-light-192.png` | 192 x 192 raster, plugins list |
| `busy-light-banner.png` | 1280 x 320 settings page and README banner |
| `busy-light-social.png` | 1280 x 640 GitHub social preview |

## Geometry (192 grid, artwork square)

- Page: `132 x 124` at `(30, 40)`, stroke `12`, miter join
- Header rule: `y 78`, `x 30 to 162`, stroke `12`
- Rings: `x 66` and `x 126`, `y 22 to 54`, stroke `12`, butt cap
- Square: `34 x 34` at `(106, 102)`, solid, the only accent
- Minimum size `32px`. Below that, drop the rings and keep the page, rule and square.

Artwork is drawn square. The Homebridge UI rounds the corners itself, so do not
pre-round the PNGs.

## Footer glyph

`busy-light-footer.svg` is drawn on a 24 grid at stroke `1.5` and inherits
`currentColor`, so it takes the settings UI's text color in both themes. The square stays
solid in `currentColor`; the footer is chrome, so it carries no status color. Render at
20px in the footer row:

```html
<img src="busy-light-footer.svg" width="20" height="20" alt="">
Busy Light v1.0.0 · Made by Alex Rodriguez · …
```

Inline the SVG instead of using `<img>` if you need `currentColor` to follow the theme.
